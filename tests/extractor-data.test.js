'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MatchPointExtractor } = require('../src/services/extractor');
const { AppDatabase } = require('../src/services/database');

test('extractor real: guarda clases 0/0 y 0/15 y detecta contradicciones entre cuadros sin duplicar', async () => {
  const database = new AppDatabase(':memory:');
  try {
    const runId = database.createRun('2026-08-03', '2026-08-03', 'quick');
    const extractor = new MatchPointExtractor({ database, browserSession: { requireAuthenticatedPage: async () => ({}) } });
    extractor.openReservationBoard = extractor.setDate = extractor.waitForBoardIdle = async () => {};
    extractor.readViews = async () => [{ value: '1', text: 'Vista uno' }, { value: '2', text: 'Vista dos' }];
    let view;
    extractor.selectView = async (_page, value) => { view = value; };
    extractor.readCalendarEvents = async (_page, expected) => {
      assert.equal(expected.eventDate, '2026-08-03');
      assert.equal(expected.viewValue, view);
      return [{ id: '1', activityName: 'Yoga', attendanceLabel: '(0/0p)', startTime: '09:00', endTime: '10:00' },
        { id: '2', activityName: 'Pilates', attendanceLabel: view === '1' ? '(0/15p)' : '(1/15p)', startTime: '10:00', endTime: '11:00' }];
    };
    await extractor.run({ runId, dateFrom: '2026-08-03', dateTo: '2026-08-03', fastMode: true, cancellationToken: {} });
    const data = database.getRunData(runId);
    assert.equal(data.events.length, 2);
    assert.equal(data.events[0].capacity, 0);
    assert.equal(data.events[1].attendees, 0);
    assert.equal(data.events[0].detail_status, 'skipped');
    assert.match(data.events[0].view_names, /Vista uno/);
    assert.match(data.events[0].view_names, /Vista dos/);
    assert.ok(data.warnings.some((w) => w.code === 'ZERO_CAPACITY'));
    assert.ok(data.warnings.some((w) => w.code === 'CONFLICTING_EVENT_DATA'));
  } finally { database.close(); }
});

test('lectura de eventos exige fecha y cuadro de la misma captura del DOM', async () => {
  const extractor = new MatchPointExtractor({ database: {}, browserSession: {} });
  let date = '03-08-2026';
  let view = '1';
  const body = {
    ownerDocument: { querySelector: (selector) => ({ value: selector === '#fechaTabla' ? date : view }) },
    querySelectorAll: () => []
  };
  extractor.frame = async () => ({ locator: () => ({ evaluate: async (fn, arg) => fn(body, arg) }) });
  assert.deepEqual(await extractor.readCalendarEvents({}, { eventDate: '2026-08-03', viewValue: '1' }), []);
  date = '04-08-2026';
  await assert.rejects(extractor.readCalendarEvents({}, { eventDate: '2026-08-03', viewValue: '1' }), /fecha o el cuadro/);
  date = '03-08-2026'; view = '2';
  await assert.rejects(extractor.readCalendarEvents({}, { eventDate: '2026-08-03', viewValue: '1' }), /fecha o el cuadro/);
});
