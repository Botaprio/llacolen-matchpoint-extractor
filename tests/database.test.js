'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AppDatabase } = require('../src/services/database');

test('guarda una extracción completa y genera su resumen diario', () => {
  const database = new AppDatabase(':memory:');
  const runId = database.createRun('2026-08-21', '2026-08-21');
  const eventId = database.upsertEvent(runId, {
    matchpointEventId: '252046',
    eventDate: '2026-08-21',
    activityName: 'ACTIVIDAD DE PRUEBA',
    resourceId: '62',
    startTime: '19:10',
    endTime: '20:30',
    attendees: 1,
    capacity: 15,
    occupancyPct: 6.67,
    attendanceStatus: 'ok',
    rawAttendanceLabel: '19:10-20:30 (1/15p)'
  });

  database.addEventView(eventId, 'CUADRO DE PRUEBA');
  database.replaceParticipants(eventId, [{ fullName: 'PERSONA DE PRUEBA', attendanceStatus: 'n.d.' }]);
  database.addWarning(runId, eventId, '2026-08-21', {
    code: 'TEST_WARNING',
    message: 'Alerta de prueba'
  });
  database.completeRun(runId, 'completed', {
    processedDays: 1,
    processedViews: 29,
    eventCount: 1,
    attendeeCount: 1,
    participantCount: 1,
    warningCount: 1
  });

  const data = database.getRunData(runId);
  assert.equal(data.run.status, 'completed');
  assert.equal(data.run.attendee_count, 1);
  assert.equal(data.summary[0].event_count, 1);
  assert.equal(data.summaryByView[0].view_name, 'CUADRO DE PRUEBA');
  assert.equal(data.summaryByView[0].event_count, 1);
  assert.equal(data.summary[0].attendee_count, 1);
  assert.equal(data.summary[0].capacity, 15);
  assert.equal(data.events[0].view_names, 'CUADRO DE PRUEBA');
  assert.equal(data.participants[0].full_name, 'PERSONA DE PRUEBA');
  assert.equal(data.warnings[0].code, 'TEST_WARNING');
  assert.equal(database.deleteRun(runId), true);
  assert.equal(database.getRun(runId), undefined);
  database.close();
});

test('elimina todo el historial de extracciones', () => {
  const database = new AppDatabase(':memory:');
  database.createRun('2026-08-01', '2026-08-01', 'quick');
  database.createRun('2026-08-02', '2026-08-02', 'complete');
  assert.equal(database.deleteAllRuns(), 2);
  assert.deepEqual(database.listRuns(), []);
  database.close();
});

test('migra datos V16 sin cambiar IDs, cifras, participantes ni alertas', () => {
  const database = new AppDatabase(':memory:');
  try {
    const runId = database.createRun('2026-08-03', '2026-08-03');
    const eventId = database.upsertEvent(runId, {
      matchpointEventId: 'v16', eventDate: '2026-08-03', activityName: 'Pilates', resourceId: '1',
      startTime: '09:00', endTime: '10:00', attendees: 0, capacity: 0, occupancyPct: null,
      attendanceStatus: 'zero_capacity', rawAttendanceLabel: '(0/0p)'
    });
    database.addWarning(runId, eventId, '2026-08-03', { code: 'ZERO_CAPACITY', message: 'Cupo cero' });
    // Esquema anterior a V17: las tablas/datos existentes son los mismos.
    database.db.exec('DROP TABLE run_days; ALTER TABLE runs DROP COLUMN concurrency; ALTER TABLE events DROP COLUMN detail_status;');
    database.migrate();
    const result = database.getRunData(runId);
    assert.equal(result.run.id, runId);
    assert.equal(result.events[0].id, eventId);
    assert.equal(result.events[0].capacity, 0);
    assert.equal(result.events[0].detail_status, 'unknown');
    assert.equal(result.warnings[0].code, 'ZERO_CAPACITY');
    assert.deepEqual(result.days, []);
  } finally { database.close(); }
});

test('al reiniciar recupera una ejecución interrumpida sin dejarla en curso', () => {
  const database = new AppDatabase(':memory:');
  try {
    const runId = database.createRun('2026-08-03', '2026-08-04');
    database.initializeDays(runId, ['2026-08-03', '2026-08-04'], 2);
    database.startDay(runId, '2026-08-03', 1);
    database.updateDay(runId, '2026-08-03', { status: 'completed', processedViews: 29, expectedViews: 29 });
    database.startDay(runId, '2026-08-04', 2);
    database.recoverInterruptedRuns();
    assert.equal(database.getRun(runId).status, 'cancelled');
    assert.equal(database.getRun(runId).processed_days, 1);
    assert.deepEqual(database.getDays(runId).map((day) => day.status), ['completed', 'cancelled']);
  } finally { database.close(); }
});
