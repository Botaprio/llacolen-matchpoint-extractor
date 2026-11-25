'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AppDatabase } = require('../src/services/database');
const { ParallelExtractor, validateConcurrency } = require('../src/services/parallel-extractor');
const { enumerateDates } = require('../src/services/date-utils');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ failDate, cancelAfter, failAlways = false, pageFailure = false, dateFrom = '2028-02-01', dateTo = '2028-02-29' } = {}) {
  const database = new AppDatabase(':memory:');
  const runId = database.createRun(dateFrom, dateTo, 'quick');
  const token = { cancelled: false };
  const tracker = { active: 0, peak: 0, attempts: new Map(), pages: [], progress: [] };
  const primary = { isClosed: () => false, close: async () => { throw new Error('No cerrar la pestaña principal'); } };
  const extractor = new ParallelExtractor({
    database,
    browserSession: {
      requireAuthenticatedPage: async () => primary,
      createWorkerPage: async () => {
        if (pageFailure) throw new Error('Nueva pestaña no disponible');
        const page = { closed: false, isClosed() { return this.closed; }, async close() { this.closed = true; } };
        tracker.pages.push(page);
        return page;
      }
    },
    onProgress: (progress) => tracker.progress.push(progress),
    extractorFactory: ({ onProgress }) => ({
      closeDetailIfOpen: async () => {},
      run: async ({ dateFrom: date, dateTo: end }) => {
        assert.equal(date, end, 'cada bloque corresponde exactamente a un día');
        tracker.active += 1; tracker.peak = Math.max(tracker.peak, tracker.active);
        const attempt = (tracker.attempts.get(date) || 0) + 1;
        tracker.attempts.set(date, attempt);
        try {
          await delay(date.endsWith('01') ? 12 : 1);
          const e = { matchpointEventId: 'shared-id', eventDate: date, activityName: 'Clase',
            resourceId: '1', startTime: '10:00', endTime: '11:00', attendees: attempt === 1 && date === failDate ? 99 : 2,
            capacity: 10, occupancyPct: 20, attendanceStatus: 'ok', rawAttendanceLabel: '(2/10p)' };
          const id = database.upsertEvent(runId, e);
          database.addEventView(id, 'Vista 1');
          database.upsertEvent(runId, e);
          database.addEventView(id, 'Vista 2');
          onProgress({ stage: 'view', viewTotal: 2, counters: { processedViews: 1 }, message: date });
          if (date === failDate && (failAlways || attempt === 1)) throw new Error('Timeout transitorio');
          if (cancelAfter && tracker.attempts.size >= cancelAfter) token.cancelled = true;
          onProgress({ stage: 'complete', viewTotal: 2, counters: { processedViews: 2 }, message: 'Día listo' });
          return { processedViews: 2, processedDays: 1 };
        } finally { tracker.active -= 1; }
      }
    })
  });
  return { database, tracker, extractor, token, args: { runId, dateFrom, dateTo, concurrency: 4, cancellationToken: token } };
}

test('31 pestañas: cobertura exacta en rangos de 31, 29 y 1 días, sin duplicados y cierre de auxiliares', async () => {
  for (const [dateFrom, dateTo, expectedDays] of [
    ['2026-08-01', '2026-08-31', 31], ['2028-02-01', '2028-02-29', 29], ['2026-08-01', '2026-08-01', 1]
  ]) {
    const s = setup({ dateFrom, dateTo });
    s.args.concurrency = 31;
    try {
      const r = await s.extractor.run(s.args);
      assert.equal(r.status, 'completed');
      assert.equal(s.tracker.peak, expectedDays);
      assert.equal(s.tracker.pages.length, expectedDays - 1);
      assert.equal(s.tracker.attempts.size, expectedDays);
      assert.ok([...s.tracker.attempts.values()].every((count) => count === 1));
      assert.equal(r.counters.processedDays, expectedDays);
      assert.equal(r.counters.eventCount, expectedDays);
      assert.equal(r.counters.attendeeCount, expectedDays * 2);
      assert.equal(r.counters.processedViews, expectedDays * 2);
      assert.ok(s.tracker.pages.every((page) => page.closed));
      assert.equal(s.tracker.progress.filter((p) => p.stage === 'complete').length, 1);
      assert.equal(s.tracker.progress.at(-1).percentage, 100);
      assert.ok(s.tracker.progress.slice(0, -1).every((p) => p.percentage < 100));
    } finally { s.database.close(); }
  }
});

test('reintenta sólo el día fallido y reemplaza su lectura parcial sin sumar dos veces', async () => {
  const s = setup({ failDate: '2028-02-05' });
  try {
    const r = await s.extractor.run(s.args);
    assert.equal(r.status, 'completed');
    assert.equal(s.tracker.attempts.get('2028-02-05'), 2);
    assert.equal([...s.tracker.attempts.values()].reduce((a, b) => a + b, 0), 30);
    assert.equal(r.counters.attendeeCount, 58);
    assert.equal(r.counters.warningCount, 0);
  } finally { s.database.close(); }
});

test('un fallo persistente termina como parcial, nunca como mes completo', async () => {
  const s = setup({ failDate: '2028-02-05', failAlways: true });
  try {
    const r = await s.extractor.run(s.args);
    assert.equal(r.status, 'partial');
    assert.equal(r.counters.processedDays, 28);
    assert.equal(s.database.getDays(s.args.runId).find((d) => d.event_date === '2028-02-05').status, 'failed');
    assert.ok(s.database.getRunData(s.args.runId).warnings.some((w) => w.code === 'INCOMPLETE_DAY'));
    assert.ok(s.tracker.progress.every((p) => p.stage !== 'complete'));
  } finally { s.database.close(); }
});

test('cancelar espera a los trabajadores, conserva lo capturado y no toma nuevos días', async () => {
  const s = setup({ cancelAfter: 4 });
  try {
    const r = await s.extractor.run(s.args);
    assert.equal(r.status, 'cancelled');
    assert.equal(s.tracker.active, 0);
    assert.ok(s.tracker.attempts.size <= 4);
    assert.ok(s.tracker.pages.every((page) => page.closed));
    assert.equal(s.database.getDays(s.args.runId).filter((d) => d.status === 'running' || d.status === 'pending').length, 0);
    assert.ok(r.counters.eventCount > 0);
  } finally { s.database.close(); }
});

test('si no se pueden abrir pestañas adicionales, la principal consume la cola', async () => {
  const s = setup({ pageFailure: true });
  try {
    const r = await s.extractor.run(s.args);
    assert.equal(r.status, 'completed');
    assert.equal(s.tracker.peak, 1);
    assert.equal(r.counters.eventCount, 29);
  } finally { s.database.close(); }
});

test('límites de concurrencia y rangos se validan antes de ejecutar', () => {
  for (const value of [0, 32, 1.5, 'infinito']) assert.throws(() => validateConcurrency(value));
  assert.equal(validateConcurrency(1), 1);
  assert.equal(validateConcurrency(10), 10);
  assert.equal(validateConcurrency(12), 12);
  assert.equal(validateConcurrency(31), 31);
  assert.equal(enumerateDates('2026-08-01', '2026-08-31').length, 31);
});
