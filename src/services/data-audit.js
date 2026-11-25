'use strict';

const { enumerateDates } = require('./date-utils');
const { aggregateAllowedEvents, TIME_REASONS, normalizeText, normalizeTime } = require('./report-template');
const { parseAttendanceLabel } = require('./parsers');

const severityForCode = {
  ZERO_CAPACITY: 'warning', OVER_CAPACITY: 'error', MISSING_ATTENDANCE_INDICATOR: 'warning',
  DETAIL_READ_FAILED: 'warning', PARTICIPANT_COUNT_MISMATCH: 'warning',
  MISSING_EVENT_ID: 'warning', CONFLICTING_EVENT_DATA: 'error', INCOMPLETE_DAY: 'error'
};

function auditRun(runData) {
  if (!runData?.run) throw new Error('No se encontró la extracción.');
  const { run, events = [], participants = [], warnings = [], days = [] } = runData;
  const findings = [];
  const findingKeys = new Set();
  const sourceWarnings = new Map();
  const participantCounts = new Map();
  const eventKey = (event) => `${event.event_date}|${event.matchpoint_event_id}`;
  for (const participant of participants) {
    const key = eventKey(participant);
    participantCounts.set(key, (participantCounts.get(key) || 0) + 1);
  }
  for (const warning of warnings) {
    const list = sourceWarnings.get(warning.event_id) || [];
    list.push(warning);
    sourceWarnings.set(warning.event_id, list);
  }
  const add = (severity, code, message, event = null, detail = {}) => {
    const key = `${code}|${event ? event.id ?? eventKey(event) : detail.date || message}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push({
      severity, code, message, eventId: event?.id ?? null,
      matchpointEventId: event?.matchpoint_event_id ?? null,
      date: event?.event_date ?? detail.date ?? '',
      activity: event?.activity_name ?? 'Extracción', time: event?.start_time ?? '',
      endTime: event?.end_time ?? '', viewNames: event?.view_names ?? '',
      attendees: event?.attendees ?? null, capacity: event?.capacity ?? null,
      rawLabel: event?.raw_attendance_label ?? '',
      occupancyPct: Number.isFinite(event?.attendees) && Number.isFinite(event?.capacity) && event.capacity > 0
        ? 100 * event.attendees / event.capacity : null,
      participantCount: event?.detail_status === 'read' ? participantCounts.get(eventKey(event)) || 0 : null,
      ...detail
    });
  };

  const expectedDates = enumerateDates(run.date_from, run.date_to);
  const coverage = new Map(days.map((day) => [day.event_date, day]));
  if (days.length) {
    for (const date of expectedDates) {
      const day = coverage.get(date);
      if (!day || day.status !== 'completed' || !day.expected_views || day.processed_views !== day.expected_views) {
        add('error', 'INCOMPLETE_DAY',
          `No se verificó el día completo (${day?.processed_views || 0}/${day?.expected_views || '?'} cuadros). ${day?.error_message || ''}`.trim(),
          null, { date });
      }
    }
  } else {
    add('info', 'LEGACY_COVERAGE', 'Esta extracción anterior a V17 no registra cobertura por día. No se puede certificar desde estos datos que se revisaron todos los cuadros.');
  }
  if (run.status !== 'completed') add('warning', 'RUN_INCOMPLETE', `Estado de la extracción: ${run.status}. Sus totales pueden ser parciales.`);
  if (!events.length) add('warning', 'NO_EVENTS', 'No se capturaron eventos. Esto no demuestra por sí solo que no existieran clases.');
  if (run.extraction_mode === 'quick') {
    add('info', 'DETAIL_NOT_CAPTURED', 'Modo cifras: se revisan cupos e inscritos del cuadro, pero no se capturaron nombres ni asistencia individual.');
  } else if (events.some((event) => !event.detail_status || event.detail_status === 'unknown')) {
    add('info', 'DETAIL_COVERAGE_UNKNOWN', 'Hay registros antiguos sin confirmación de lectura del detalle. La ausencia de nombres no se interpreta como cero alumnos.');
  }

  const resolved = aggregateAllowedEvents(events);
  for (const issue of resolved.scheduleIssues) {
    add('warning', issue.code === 'TIME_ADJUSTED' ? 'TIME_ADJUSTED' : 'TIME_REVIEW',
      issue.status === 'APLICADO' ? `Desfase de horario: ${issue.originalTime} → ${issue.assignedTime} (${issue.delta > 0 ? '+' : ''}${issue.delta} min). ${issue.reason}` : issue.reason,
      issue.raw, { templateIncluded: issue.status === 'APLICADO', originalTime: issue.originalTime, assignedTime: issue.assignedTime, adjustmentMinutes: issue.delta });
  }
  const duplicateGroups = new Map();
  const capacityGroups = new Map();
  let includedCount = 0;
  let zeroCapacityCount = 0;
  let zeroEnrollmentCount = 0;
  let missingCapacityCount = 0;
  for (const event of events) {
    const match = resolved.resolutions.get(event);
    const template = { templateIncluded: match.matched, templateReason: match.reason || null };
    if (match.matched) includedCount += 1;
    const flag = (severity, code, message) => add(severity, code, message, event, template);
    if (event.capacity === 0) {
      zeroCapacityCount += 1;
      flag(event.attendees > 0 ? 'error' : 'warning', 'ZERO_CAPACITY', event.attendees > 0
        ? `Clase declarada con cupo 0 y ${event.attendees} inscritos. Revisar su configuración en MatchPoint.`
        : 'Clase declarada con cupo 0. Confirmar si corresponde a una clase cerrada, suspendida o mal configurada.');
    }
    if (event.attendees === 0 && event.capacity > 0) {
      zeroEnrollmentCount += 1;
      flag('info', 'ZERO_ENROLLMENT', `Clase declarada sin inscritos, con ${event.capacity} cupos. Puede ser válido; no equivale a cupo cero.`);
    }
    if (event.capacity == null) {
      missingCapacityCount += 1;
      flag('warning', 'MISSING_CAPACITY', 'No se obtuvo el cupo de esta reserva o clase. Un dato ausente no equivale a cero.');
    }
    if (event.attendees == null) flag('warning', 'MISSING_ATTENDEES', 'No se obtuvo la cantidad de inscritos.');
    if ([event.attendees, event.capacity].some((value) => value != null && (!Number.isInteger(value) || value < 0))) {
      flag('error', 'INVALID_COUNTS', 'Cupo o inscritos contienen un valor negativo o no entero.');
    }
    if (event.capacity > 0 && event.attendees > event.capacity) {
      flag('error', 'OVER_CAPACITY', `Los ${event.attendees} inscritos superan el cupo de ${event.capacity}.`);
    }
    if (event.event_date < run.date_from || event.event_date > run.date_to) flag('error', 'OUTSIDE_PERIOD', 'El evento está fuera del período solicitado.');
    if (!normalizeTime(event.start_time) || !normalizeTime(event.end_time)) flag('warning', 'MISSING_TIME', 'El horario de inicio o término está ausente o no se pudo interpretar.');
    if (event.detail_status === 'read') {
      const count = participantCounts.get(eventKey(event)) || 0;
      if (Number.isFinite(event.attendees) && count !== event.attendees) {
        flag('warning', 'PARTICIPANT_COUNT_MISMATCH', `El cuadro indica ${event.attendees} inscritos y el detalle guardado contiene ${count} nombres.`);
      }
    }
    if (event.detail_status === 'failed') flag('warning', 'DETAIL_READ_FAILED', 'No se pudo leer el detalle. Los nombres y la asistencia de esta clase no están verificados.');
    const label = parseAttendanceLabel(event.raw_attendance_label);
    if (label.status !== 'missing_indicator' && (label.attendees !== event.attendees || label.capacity !== event.capacity)) {
      flag('error', 'LABEL_MISMATCH', 'La cifra guardada difiere del indicador original leído en MatchPoint.');
    }
    if (!match.matched) {
      const reasons = {
        NOT_IN_TEMPLATE_FAMILIES: 'Actividad fuera de las familias de la plantilla.',
        NO_TEMPLATE_ROW_FOR_DAY_TIME: 'No hay una fila de plantilla para este día y horario.',
        AMBIGUOUS_TEMPLATE_ROW: 'Hay más de una correspondencia posible en la plantilla.',
        NO_EVENT_NAME: 'No se obtuvo el nombre de la actividad.', NO_DAY_OR_TIME: 'Falta día u horario para comparar con la plantilla.'
      };
      flag('info', 'EXCLUDED_FROM_REPORT', `${reasons[match.reason] || TIME_REASONS[match.reason] || match.reason} Se conserva para revisión; no se incluye en el informe oficial.`);
    }
    for (const warning of sourceWarnings.get(event.id) || []) {
      flag(severityForCode[warning.code] || 'warning', warning.code, warning.message);
    }
    // Sólo se señalan posibles duplicados; nunca se borran clases distintas.
    if (event.resource_id && normalizeTime(event.start_time)) {
      const groupKey = [event.event_date, normalizeText(event.activity_name), normalizeTime(event.start_time),
        normalizeTime(event.end_time), event.resource_id].join('|');
      const group = duplicateGroups.get(groupKey) || [];
      group.push({ event, template });
      duplicateGroups.set(groupKey, group);
    }
    if (event.capacity > 0 && event.resource_id && normalizeTime(event.start_time)) {
      const weekday = new Date(`${event.event_date}T12:00:00Z`).getUTCDay();
      const groupKey = [normalizeText(event.activity_name), weekday, normalizeTime(event.start_time), event.resource_id].join('|');
      const group = capacityGroups.get(groupKey) || [];
      group.push({ event, template });
      capacityGroups.set(groupKey, group);
    }
  }
  for (const group of duplicateGroups.values()) {
    if (new Set(group.map(({ event }) => event.matchpoint_event_id)).size < 2) continue;
    for (const { event, template } of group) add('warning', 'POSSIBLE_DUPLICATE',
      'Otra reserva tiene la misma actividad, fecha, horario y recurso, con un ID diferente. Confirmar si son clases distintas.', event, template);
  }
  for (const group of capacityGroups.values()) {
    const values = [...new Set(group.map(({ event }) => event.capacity))].sort((a, b) => a - b);
    if (values.length > 1) {
      const { event, template } = group[0];
      add('warning', 'CAPACITY_VARIATION', `La misma actividad, día de semana, horario y recurso cambia de cupo durante el período: ${values.join(', ')}. Puede ser un ajuste válido; confirmar.`, event, template);
    }
  }
  for (const warning of warnings.filter((item) => item.event_id == null && item.code !== 'INCOMPLETE_DAY')) {
    add(severityForCode[warning.code] || 'warning', warning.code, warning.message, null, { date: warning.event_date || '' });
  }
  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.activity.localeCompare(b.activity, 'es'));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return {
    runId: run.id, label: `${run.date_from} al ${run.date_to}`, generatedAt: new Date().toISOString(),
    summary: { events: events.length, includedCount, excludedCount: events.length - includedCount,
      zeroCapacityCount, zeroEnrollmentCount, missingCapacityCount, adjustedCount: resolved.adjustedCount, ...counts },
    coverage: { total: expectedDates.length, completed: days.filter((day) => day.status === 'completed').length, verified: days.length > 0 },
    findings
  };
}

module.exports = { auditRun };
