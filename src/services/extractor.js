'use strict';

const crypto = require('node:crypto');
const { enumerateDates, formatForDisplay } = require('./date-utils');
const {
  buildWarnings,
  normalizeWhitespace,
  occupancyPercentage,
  parseAttendanceLabel,
  parseDetailText
} = require('./parsers');

const IFRAME_SELECTOR = '#iframeContenido';
const VIEW_SELECTOR = 'select[name="ctl01$CC$DropDownListCuadros"]';

class ExtractionCancelledError extends Error {
  constructor() {
    super('Extracción cancelada por el usuario.');
    this.name = 'ExtractionCancelledError';
  }
}

function safeSyntheticId(eventDate, raw) {
  return `synthetic-${crypto.createHash('sha1').update([
    eventDate,
    raw.resourceId,
    raw.startTime,
    raw.endTime,
    raw.activityName
  ].join('|')).digest('hex').slice(0, 16)}`;
}

class MatchPointExtractor {
  constructor({ browserSession, database, onProgress }) {
    this.browserSession = browserSession;
    this.database = database;
    this.onProgress = onProgress || (() => {});
  }

  assertNotCancelled(token) {
    if (token?.cancelled) throw new ExtractionCancelledError();
  }

  emit(payload) {
    this.onProgress({ timestamp: new Date().toISOString(), ...payload });
  }

  async run({ runId, dateFrom, dateTo, cancellationToken, fastMode = false }) {
    const page = await this.browserSession.requireAuthenticatedPage();
    const dates = enumerateDates(dateFrom, dateTo);
    const counters = {
      processedDays: 0,
      processedViews: 0,
      eventCount: 0,
      attendeeCount: 0,
      participantCount: 0,
      warningCount: 0
    };
    this.counters = counters;
    const seenEvents = new Map();

    await this.openReservationBoard(page);

    for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 1) {
      this.assertNotCancelled(cancellationToken);
      const eventDate = dates[dateIndex];
      await this.setDate(page, eventDate);
      const views = await this.readViews(page);
      if (!views.length) throw new Error('MatchPoint no devolvió cuadros; el día no se puede considerar completo.');

      this.emit({
        stage: 'date',
        message: `Procesando ${eventDate}`,
        currentDate: eventDate,
        dateIndex: dateIndex + 1,
        dateTotal: dates.length,
        counters
      });

      for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
        this.assertNotCancelled(cancellationToken);
        const view = views[viewIndex];
        await this.selectView(page, view.value);
        const rawEvents = await this.readCalendarEvents(page, { eventDate, viewValue: view.value });

        this.emit({
          stage: 'view',
          message: `${eventDate}: ${view.text}`,
          currentDate: eventDate,
          currentView: view.text,
          viewIndex: viewIndex + 1,
          viewTotal: views.length,
          dateIndex: dateIndex + 1,
          dateTotal: dates.length,
          counters
        });

        for (const raw of rawEvents) {
          this.assertNotCancelled(cancellationToken);
          const attendance = parseAttendanceLabel(raw.attendanceLabel);
          const matchpointEventId = raw.id || safeSyntheticId(eventDate, raw);
          const eventKey = `${eventDate}:${matchpointEventId}`;
          const event = {
            matchpointEventId,
            eventDate,
            activityName: raw.activityName || '(Actividad sin nombre)',
            resourceId: raw.resourceId || null,
            startTime: raw.startTime || null,
            endTime: raw.endTime || null,
            attendees: attendance.attendees,
            capacity: attendance.capacity,
            occupancyPct: occupancyPercentage(attendance.attendees, attendance.capacity),
            attendanceStatus: attendance.status,
            rawAttendanceLabel: attendance.raw
          };

          const previous = seenEvents.get(eventKey);
          if (previous) {
            this.database.addEventView(previous.id, view.text);
            if (event.attendees !== previous.attendees || event.capacity !== previous.capacity) {
              this.database.addWarning(runId, previous.id, eventDate, {
                code: 'CONFLICTING_EVENT_DATA',
                message: `El mismo evento presenta cifras distintas entre cuadros: ${previous.attendees ?? 's/d'}/${previous.capacity ?? 's/d'} y ${event.attendees ?? 's/d'}/${event.capacity ?? 's/d'}. Se conserva la primera lectura.`
              });
            }
            continue;
          }
          const eventId = this.database.upsertEvent(runId, event);
          this.database.addEventView(eventId, view.text);
          seenEvents.set(eventKey, { id: eventId, attendees: event.attendees, capacity: event.capacity });
          this.database.setDetailStatus(eventId, fastMode ? 'skipped' : 'not_applicable');
          counters.eventCount += 1;
          counters.attendeeCount += Number.isFinite(event.attendees) ? event.attendees : 0;

          let participants = [];
          let detail = { location: null, monitor: null, resourceName: null };
          let detailRead = false;

          // Las reservas sin "(inscritos/cupo)" suelen ser bloqueos, arriendos o
          // reservas particulares. No tienen la estadística solicitada y abrirlas
          // sólo agrega ruido (muchas muestran el nombre de una persona).
          if (!fastMode && attendance.status !== 'missing_indicator') {
            try {
              const result = await this.readEventDetail(page, matchpointEventId);
              participants = result.participants;
              detail = result.detail;
              detailRead = true;
              this.database.updateEventDetails(eventId, detail);
              this.database.replaceParticipants(eventId, participants);
              this.database.setDetailStatus(eventId, 'read');
              counters.participantCount += participants.length;
            } catch (error) {
              this.database.setDetailStatus(eventId, 'failed');
              const warning = {
                code: 'DETAIL_READ_FAILED',
                message: `No se pudo leer el detalle del evento: ${this.describeDetailError(error)}`
              };
              this.database.addWarning(runId, eventId, eventDate, warning);
              counters.warningCount += 1;
              await this.closeDetailIfOpen(page);
            }
          }

          // Un detalle que no pudo abrirse no equivale a "cero participantes".
          // Así se evita informar desajustes falsos en el Excel.
          const warnings = buildWarnings(event, detailRead ? participants.length : null);
          if (!raw.id) {
            warnings.push({
              code: 'MISSING_EVENT_ID',
              message: 'El evento no tiene ID de MatchPoint; se generó un identificador temporal.'
            });
          }
          for (const warning of warnings) {
            this.database.addWarning(runId, eventId, eventDate, warning);
            counters.warningCount += 1;
          }
        }

        counters.processedViews += 1;
        this.emit({
          stage: 'view',
          message: `${eventDate}: ${view.text} completado`,
          currentDate: eventDate,
          currentView: view.text,
          viewIndex: viewIndex + 1,
          viewTotal: views.length,
          dateIndex: dateIndex + 1,
          dateTotal: dates.length,
          counters
        });
      }

      counters.processedDays += 1;
    }

    // MatchPoint termina algunos postbacks unos milisegundos después de que el
    // último cuadro ya parece listo. Antes de devolver el control a la interfaz
    // esperamos una ventana corta de estabilidad para que una extracción del
    // mes siguiente pueda comenzar inmediatamente, sin tener que hacer un
    // segundo clic. Si MatchPoint no permite comprobarla, no invalidamos una
    // extracción que ya terminó correctamente.
    await this.waitForBoardIdle(page, { timeout: 3_500, stableFor: 550 }).catch(() => {});

    this.emit({ stage: 'complete', message: 'Extracción completada.', counters });
    return counters;
  }

  async boardIsVisible(page) {
    try {
      return await page.frameLocator(IFRAME_SELECTOR).locator(VIEW_SELECTOR).isVisible();
    } catch (_error) {
      return false;
    }
  }

  async openReservationBoard(page) {
    const frame = page.frameLocator(IFRAME_SELECTOR);
    const selector = frame.locator(VIEW_SELECTOR);

    // Si la extracción anterior dejó abierto el Cuadro de Reservas, reutilizamos
    // esa misma vista. Volver a pulsar el icono durante el último postback era
    // la causa más probable del error transitorio al pasar de un mes al siguiente.
    if (await this.boardIsVisible(page)) {
      await this.waitForBoardIdle(page, { timeout: 4_000, stableFor: 450 }).catch(() => {});
      return;
    }

    const icon = page.locator('#imgCuadroReservas');
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await icon.waitFor({ state: 'visible', timeout: attempt === 1 ? 30_000 : 8_000 });
        await icon.click({ timeout: 8_000 });
        await selector.waitFor({ state: 'visible', timeout: 20_000 });
        await this.waitForBoardIdle(page, { timeout: 4_000, stableFor: 450 }).catch(() => {});
        return;
      } catch (error) {
        lastError = error;
        if (await this.boardIsVisible(page)) {
          await this.waitForBoardIdle(page, { timeout: 4_000, stableFor: 450 }).catch(() => {});
          return;
        }
        if (attempt < 3) await page.waitForTimeout(700 * attempt).catch(() => {});
      }
    }

    throw new Error(`No se pudo preparar el Cuadro de Reservas de MatchPoint: ${String(lastError?.message || lastError || 'error desconocido')}`);
  }

  async waitForBoardIdle(page, { timeout = 4_000, stableFor = 450 } = {}) {
    const deadline = Date.now() + timeout;
    let previousSignature = null;
    let stableSince = null;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        const state = await this.readBoardState(page);
        const signature = JSON.stringify([state.selectedValue, state.dateValue, state.events]);
        if (signature === previousSignature) {
          if (stableSince === null) stableSince = Date.now();
          if (Date.now() - stableSince >= stableFor) return state;
        } else {
          previousSignature = signature;
          stableSince = Date.now();
        }
      } catch (error) {
        lastError = error;
        if (!this.isTransientBoardNavigationError(error)) throw error;
        previousSignature = null;
        stableSince = null;
      }
      await page.waitForTimeout(120).catch(() => {});
    }

    if (lastError && !previousSignature) throw lastError;
    return null;
  }

  async frame(page) {
    const frame = page.frameLocator(IFRAME_SELECTOR);
    await frame.locator(VIEW_SELECTOR).waitFor({ state: 'visible', timeout: 30_000 });
    return frame;
  }

  async setDate(page, isoDate) {
    const frame = await this.frame(page);
    const dateInput = frame.locator('#fechaTabla');
    const expected = formatForDisplay(isoDate);
    const [year, month, day] = isoDate.split('-').map(Number);

    // fechaTabla es readonly. MatchPoint sólo ejecuta correctamente su lógica
    // cuando la fecha se elige desde el DatePicker de jQuery UI; escribir en el
    // input o disparar eventos sintéticos deja la vista en el día anterior.
    await dateInput.waitFor({ state: 'visible', timeout: 15_000 });
    const picker = await this.openDatePicker(frame, dateInput);
    await picker.locator('.ui-datepicker-month').selectOption({ index: month - 1 });
    await picker.locator('.ui-datepicker-year').selectOption(String(year));

    // No usamos getByText global: el calendario también puede incluir días del
    // mes anterior/siguiente. Así se elige sólo el día del mes visible.
    const targetDay = picker.locator('.ui-datepicker-calendar td:not(.ui-datepicker-other-month) a')
      .filter({ hasText: new RegExp(`^${day}$`) });
    await targetDay.first().click();

    // La selección sólo cambia el control. El botón propio de MatchPoint es el
    // que vuelve a pedir las reservas para ese día.
    await dateInput.waitFor({ state: 'visible', timeout: 10_000 });
    const selected = await dateInput.evaluate((element) => element.value);
    if (selected !== expected) {
      throw new Error(`MatchPoint no seleccionó la fecha ${expected}; quedó en ${selected || 'vacía'}.`);
    }

    const refresh = frame.locator('#CC_ImageButtonRecargar');
    await refresh.waitFor({ state: 'visible', timeout: 10_000 });
    const before = await this.markBoardForRefresh(frame);
    await refresh.click();
    await this.waitForBoardRefresh(page, before, { dateValue: expected, action: `la fecha ${expected}` });
    await (await this.frame(page)).locator(VIEW_SELECTOR).waitFor({ state: 'visible', timeout: 20_000 });

    const finalDate = await (await this.frame(page)).locator('#fechaTabla').evaluate((element) => element.value);
    if (finalDate !== expected) {
      throw new Error(`MatchPoint recargó una fecha distinta: se solicitó ${expected} y quedó ${finalDate || 'vacía'}.`);
    }
  }

  async openDatePicker(frame, dateInput) {
    const picker = frame.locator('.ui-datepicker').last();
    const trigger = frame.locator('img.ui-datepicker-trigger').last();

    // En esta instalación fechaTabla es readonly y, de forma intermitente,
    // un click sobre el input NO abre el calendario. El disparador oficial
    // del DatePicker (el ícono "...") sí lo hace de forma consistente.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await trigger.waitFor({ state: 'visible', timeout: 5_000 });
        await trigger.click({ timeout: 5_000 });
        await picker.waitFor({ state: 'visible', timeout: 2_500 });
        return picker;
      } catch (error) {
        if (attempt === 3) {
          throw new Error(`No se pudo abrir el calendario de MatchPoint tras 3 intentos: ${String(error.message || error)}`);
        }
        // Como respaldo, se intenta abrir el control por el input y luego se
        // vuelve a usar el disparador oficial. No se escribe ni altera el valor.
        await dateInput.click({ timeout: 5_000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    throw new Error('No se pudo abrir el calendario de MatchPoint.');
  }

  async readViews(page) {
    const frame = await this.frame(page);
    return frame.locator(`${VIEW_SELECTOR} option`).evaluateAll((options) => options.map((option) => ({
      value: option.value,
      text: (option.textContent || '').trim()
    })).filter((option) => option.value !== ''));
  }

  async selectView(page, value) {
    const frame = await this.frame(page);
    const before = await this.markBoardForRefresh(frame);
    try {
      await frame.locator(VIEW_SELECTOR).selectOption(value);
    } catch (error) {
      // Un postback de ASP.NET puede desmontar el selector antes de que
      // Playwright reciba la respuesta. La espera siguiente confirma si la
      // recarga sí se inició; cualquier otro error se vuelve a lanzar.
      if (!this.isTransientBoardNavigationError(error)) throw error;
    }
    await this.waitForBoardRefresh(page, before, { viewValue: value, action: 'el cuadro seleccionado' });
  }

  async markBoardForRefresh(frame) {
    const marker = `llacolen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return frame.locator(VIEW_SELECTOR).evaluate((select, value) => {
      select.dataset.llacolenRefreshMarker = value;
      const events = [...document.querySelectorAll('div.evento')].map((event) => [
        event.id,
        event.getAttribute('idrecurso'),
        event.getAttribute('inicio'),
        event.getAttribute('fin'),
        event.textContent
      ].join('|')).join('||');
      return {
        marker: value,
        selectedValue: select.value,
        dateValue: document.querySelector('#fechaTabla')?.value || '',
        events
      };
    }, marker);
  }

  async readBoardState(page) {
    const frame = await this.frame(page);
    return frame.locator(VIEW_SELECTOR).evaluate((select) => ({
      marker: select.dataset.llacolenRefreshMarker || null,
      selectedValue: select.value,
      dateValue: document.querySelector('#fechaTabla')?.value || '',
      busy: Boolean(window.Sys?.WebForms?.PageRequestManager?.getInstance()?.get_isInAsyncPostBack()
        || window.jQuery?.active || document.readyState === 'loading'),
      events: [...document.querySelectorAll('div.evento')].map((event) => [
        event.id,
        event.getAttribute('idrecurso'),
        event.getAttribute('inicio'),
        event.getAttribute('fin'),
        event.textContent
      ].join('|')).join('||')
    }));
  }

  async waitForBoardRefresh(page, before, { viewValue, dateValue, action }) {
    const startedAt = Date.now();
    const timeoutAt = startedAt + 45_000;
    let lastState = null;

    while (Date.now() < timeoutAt) {
      try {
        const state = await this.readBoardState(page);
        const expectedView = (!viewValue || state.selectedValue === viewValue)
          && (!dateValue || state.dateValue === dateValue) && !state.busy;
        const reloaded = state.marker !== before.marker || state.events !== before.events;

        // En cuadros vacíos o con exactamente los mismos eventos, MatchPoint
        // puede conservar el mismo DOM. Antes eso se interpretaba como un
        // fallo, aunque el selector ya hubiese cargado correctamente. En ese
        // caso esperamos una pausa adicional y verificamos estabilidad.
        const enoughTimeForSameDom = Date.now() - startedAt >= 1_500;
        if (expectedView && (reloaded || enoughTimeForSameDom)) {
          // La vista puede dibujarse en dos pasos. Exigimos que permanezca
          // estable antes de asociar sus eventos al cuadro actual.
          await page.waitForTimeout(350);
          const stableState = await this.readBoardState(page);
          if (
            stableState.selectedValue === state.selectedValue &&
            stableState.dateValue === state.dateValue &&
            stableState.events === state.events && !stableState.busy
          ) return;
        }
        lastState = state;
      } catch (error) {
        if (!this.isTransientBoardNavigationError(error)) throw error;
      }
      await page.waitForTimeout(150);
    }

    const current = lastState ? ` (vista: ${lastState.selectedValue || 'sin valor'}, fecha: ${lastState.dateValue || 'sin valor'})` : '';
    throw new Error(`MatchPoint no terminó de recargar ${action} dentro de 45 segundos${current}. Se detuvo para no asociar eventos a un cuadro incorrecto.`);
  }

  isTransientBoardNavigationError(error) {
    return /detached|Execution context was destroyed|frame was detached|Target page, context or browser has been closed|Timeout/i.test(String(error?.message || ''));
  }

  async readCalendarEvents(page, expected) {
    const frame = await this.frame(page);
    // Fecha, cuadro y eventos se leen atómicamente en el mismo DOM. Una pestaña
    // que regresó a otro día nunca puede escribir esos datos con la fecha pedida.
    return frame.locator('body').evaluate((body, target) => {
      const doc = body.ownerDocument;
      if (target && (doc.querySelector('#fechaTabla')?.value !== target.dateValue
        || doc.querySelector('select[name="ctl01$CC$DropDownListCuadros"]')?.value !== target.viewValue)) {
        throw new Error('La fecha o el cuadro cambió durante la lectura. Se reintentará el día.');
      }
      return [...body.querySelectorAll('div.evento')].map((element) => ({
      id: element.id || null,
      activityName: (element.querySelector('.eventoTexto1')?.textContent || '').trim(),
      attendanceLabel: (element.querySelector('.eventoFecha')?.textContent || '').trim(),
      startTime: element.getAttribute('inicio'),
      endTime: element.getAttribute('fin'),
      resourceId: element.getAttribute('idrecurso')
      }));
    }, expected ? { dateValue: formatForDisplay(expected.eventDate), viewValue: expected.viewValue } : null);
  }

  async readEventDetail(page, matchpointEventId) {
    await this.closeDetailIfOpen(page);
    const frame = await this.frame(page);
    const eventLocator = frame.locator(`div.evento[id="${String(matchpointEventId).replaceAll('"', '\\"')}"]`);
    if (await eventLocator.count() === 0) {
      throw new Error('El evento ya no está visible en el cuadro actual.');
    }

    await eventLocator.first().click();
    const modal = frame.locator('iframe[id^="fancybox-frame"]');
    await modal.last().waitFor({ state: 'visible', timeout: 15_000 });
    const detailFrame = frame.frameLocator('iframe[id^="fancybox-frame"]').last();
    const body = detailFrame.locator('body');
    await body.waitFor({ state: 'visible', timeout: 15_000 });

    const extracted = await body.evaluate((documentBody) => {
      const tables = [...documentBody.querySelectorAll('table')];
      const attendeeCandidates = tables.filter((table) => {
        const headings = [...table.querySelectorAll('th')].map((th) => (th.textContent || '').trim().toLowerCase());
        return headings.includes('nombre') && headings.includes('asistencia');
      });
      const attendeeTable = tables.find((table) => /GridViewListadoAlumnosClase/i.test(table.id || ''))
        || attendeeCandidates.at(-1)
        || null;

      const participants = attendeeTable
        ? [...attendeeTable.querySelectorAll(':scope > tbody > tr, :scope > tr')].map((row) => {
            const cells = [...row.querySelectorAll('td')];
            if (!cells.length) return null;
            const fullName = (cells[0]?.textContent || '').replace(/\s+/g, ' ').trim();
            if (!fullName) return null;
            const statusSelect = row.querySelector('select');
            const attendanceStatus = statusSelect
              ? (statusSelect.selectedOptions?.[0]?.textContent || statusSelect.value || '').trim()
              : null;
            return { fullName, attendanceStatus };
          }).filter(Boolean)
        : [];

      return {
        participants,
        hasParticipantTable: Boolean(attendeeTable),
        text: documentBody.innerText || ''
      };
    });

    if (!extracted.hasParticipantTable) {
      throw new Error('No se encontró la tabla de inscritos; no se interpreta una tabla ausente como cero alumnos.');
    }

    const parsedDetail = parseDetailText(extracted.text);
    const detail = {
      ...parsedDetail,
      resourceName: parsedDetail.location
    };
    await this.closeDetailIfOpen(page);
    return { participants: extracted.participants.map((person) => ({
      fullName: normalizeWhitespace(person.fullName),
      attendanceStatus: normalizeWhitespace(person.attendanceStatus) || null
    })), detail };
  }

  async closeDetailIfOpen(page) {
    const frame = page.frameLocator(IFRAME_SELECTOR);
    const closeSelector = '#fancybox-close, a[title="Close"], a.fancybox-close, .fancybox-close';
    const closeTargets = [frame.locator(closeSelector), page.locator(closeSelector)];
    let closed = false;

    for (const close of closeTargets) {
      if (await close.count().catch(() => 0)) {
        closed = await close.last().click({ timeout: 3_000 }).then(() => true).catch(() => false);
        if (closed) break;
      }
    }

    if (!closed) await page.keyboard.press('Escape').catch(() => {});

    const overlays = [
      frame.locator('.fancybox-overlay, iframe[id^="fancybox-frame"]'),
      page.locator('.fancybox-overlay, iframe[id^="fancybox-frame"]')
    ];
    await Promise.all(overlays.map((overlay) => overlay.first().waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {})));
  }

  describeDetailError(error) {
    const message = String(error?.message || 'Error desconocido.').replace(/\s+/g, ' ');
    if (/intercepts pointer events/i.test(message)) {
      return 'La ventana de detalle anterior bloqueó el cuadro; se cerró y el evento quedó pendiente.';
    }
    return message.slice(0, 420);
  }
}

module.exports = { ExtractionCancelledError, MatchPointExtractor };
