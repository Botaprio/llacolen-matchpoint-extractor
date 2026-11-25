'use strict';

const { enumerateDates } = require('./date-utils');
const { MatchPointExtractor, ExtractionCancelledError } = require('./extractor');

function validateConcurrency(value = 4) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 31) {
    throw new Error('Selecciona entre 1 y 31 pestañas simultáneas.');
  }
  return count;
}

class ParallelExtractor {
  constructor({ browserSession, database, onProgress = () => {}, extractorFactory }) {
    this.browserSession = browserSession;
    this.database = database;
    this.onProgress = onProgress;
    this.extractorFactory = extractorFactory || ((options) => new MatchPointExtractor(options));
  }

  async run({ runId, dateFrom, dateTo, cancellationToken, fastMode = false, concurrency = 4 }) {
    const dates = enumerateDates(dateFrom, dateTo);
    const workerCount = Math.min(validateConcurrency(concurrency), dates.length);
    const primaryPage = await this.browserSession.requireAuthenticatedPage();
    const workers = Array.from({ length: workerCount }, (_, i) => ({
      id: i + 1, date: null, status: 'waiting', message: 'Preparando pestaña…'
    }));
    const startedAt = Date.now();
    this.database.initializeDays(runId, dates, workerCount);
    let cursor = 0;

    const emit = (message, stage = 'progress') => {
      this.counters = this.database.saveProgress(runId);
      const days = this.database.getDays(runId);
      const finished = days.filter((day) => day.status === 'completed').length;
      const fractional = days.reduce((sum, day) => sum + (day.status === 'running'
        ? Math.min(0.99, day.processed_views / Math.max(1, day.expected_views)) : 0), 0);
      this.onProgress({
        stage, message, counters: this.counters, dateTotal: dates.length,
        percentage: stage === 'complete' ? 100 : Math.min(99, Math.floor(100 * (finished + fractional) / dates.length)),
        workers: workers.map((worker) => ({ ...worker })),
        completedDays: finished, totalDays: dates.length,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString()
      });
    };

    const extractDay = async (worker, page, date) => {
      if (cancellationToken.cancelled) throw new ExtractionCancelledError();
      this.database.startDay(runId, date, worker.id);
      Object.assign(worker, { date, status: 'running', message: 'Preparando cuadros…' });
      emit(`Pestaña ${worker.id}: ${date}`);
      let processedViews = 0;
      let expectedViews = 0;
      const extractor = this.extractorFactory({
        browserSession: { requireAuthenticatedPage: async () => page },
        database: this.database,
        onProgress: (progress) => {
          processedViews = progress.counters?.processedViews || 0;
          expectedViews = progress.viewTotal || expectedViews;
          this.database.updateDay(runId, date, { processedViews, expectedViews });
          worker.message = progress.message;
          // El "complete" de un día no es el final de todo el mes.
          emit(`Pestaña ${worker.id} · ${progress.message}`);
        }
      });
      try {
        const result = await extractor.run({ runId, dateFrom: date, dateTo: date, cancellationToken, fastMode });
        if (cancellationToken.cancelled) throw new ExtractionCancelledError();
        if (!expectedViews || result.processedViews !== expectedViews) {
          throw new Error('No se confirmó la lectura de todos los cuadros del día.');
        }
        this.database.updateDay(runId, date, {
          status: 'completed', processedViews: result.processedViews, expectedViews
        });
        Object.assign(worker, { status: 'waiting', message: 'Día completado' });
      } catch (error) {
        const cancelled = cancellationToken.cancelled || error instanceof ExtractionCancelledError;
        this.database.updateDay(runId, date, {
          status: cancelled ? 'cancelled' : 'failed', processedViews, expectedViews,
          errorMessage: String(error.message || error).replace(/\s+/g, ' ').slice(0, 420)
        });
        Object.assign(worker, { status: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Cancelada' : 'Pendiente de reintento' });
        // Cierra cualquier detalle de esta pestaña antes de asignar otro día.
        await extractor.closeDetailIfOpen?.(page).catch(() => {});
      }
      emit(`Pestaña ${worker.id}: ${worker.message}`);
    };

    emit(`Extracción por días con ${workerCount} pestaña${workerCount === 1 ? '' : 's'}.`, 'start');
    const results = await Promise.allSettled(workers.map(async (worker) => {
      let page = null;
      try {
        if (cancellationToken.cancelled) return;
        page = worker.id === 1 ? primaryPage : await this.browserSession.createWorkerPage();
        while (!cancellationToken.cancelled && cursor < dates.length) {
          // La asignación no contiene awaits: cada fecha pertenece a un trabajador.
          const date = dates[cursor++];
          await extractDay(worker, page, date);
          if (page.isClosed()) break;
        }
      } finally {
        // Sólo las pestañas creadas por el coordinador se cierran automáticamente.
        if (worker.id !== 1 && page) await page.close().catch(() => {});
        if (worker.status !== 'failed') worker.status = cancellationToken.cancelled ? 'cancelled' : 'done';
      }
    }));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        Object.assign(workers[i], { status: 'failed', message: String(result.reason?.message || result.reason).slice(0, 240) });
      }
    });

    // Un error de carga no obliga a repetir el mes. Cuando todas las pestañas
    // quedaron detenidas, se reintentan sólo los días pendientes en una pestaña.
    if (!cancellationToken.cancelled) {
      const retryDays = this.database.getDays(runId).filter((day) => day.status !== 'completed');
      for (const day of retryDays) {
        if (cancellationToken.cancelled) break;
        emit(`Reintentando ${day.event_date} con una sola pestaña…`, 'retry');
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (cancellationToken.cancelled) break;
        try {
          const page = await this.browserSession.requireAuthenticatedPage();
          await extractDay(workers[0], page, day.event_date);
        } catch (error) {
          this.database.updateDay(runId, day.event_date, {
            status: 'failed', errorMessage: String(error.message || error).slice(0, 420)
          });
        }
      }
    }

    for (const day of this.database.getDays(runId)) {
      if (day.status === 'completed') continue;
      if (cancellationToken.cancelled && ['pending', 'running'].includes(day.status)) {
        this.database.updateDay(runId, day.event_date, {
          status: 'cancelled', processedViews: day.processed_views, expectedViews: day.expected_views,
          errorMessage: 'Extracción cancelada antes de completar este día.'
        });
      }
      this.database.addWarning(runId, null, day.event_date, {
        code: 'INCOMPLETE_DAY', message: `Día ${day.event_date} incompleto. ${day.error_message || 'No se verificaron todos sus cuadros.'}`
      });
    }
    const incomplete = this.database.getDays(runId).filter((day) => day.status !== 'completed');
    const status = cancellationToken.cancelled ? 'cancelled' : incomplete.length ? 'partial' : 'completed';
    for (const worker of workers) {
      if (worker.status === 'waiting' || worker.status === 'running') worker.status = 'done';
    }
    const message = status === 'completed' ? 'Extracción completada y consolidada.'
      : status === 'cancelled' ? 'Extracción cancelada. Los datos obtenidos quedaron guardados.'
        : `Extracción parcial: ${incomplete.length} día(s) requieren revisión en Analizar Nuevo.`;
    emit(message, status === 'completed' ? 'complete' : status);
    return { status, counters: this.counters, errorMessage: status === 'completed' ? null : message };
  }
}

module.exports = { ParallelExtractor, validateConcurrency };
