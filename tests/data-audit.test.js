'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditRun } = require('../src/services/data-audit');

function event(id, fields = {}) {
  return { id, matchpoint_event_id: String(id), event_date: '2026-08-03',
    activity_name: 'Clase fuera de plantilla', start_time: '09:00', end_time: '10:00',
    resource_id: String(id), capacity: 10, attendees: 2, detail_status: 'skipped', ...fields };
}
function data(events, extra = {}) {
  return { run: { id: 1, date_from: '2026-08-03', date_to: '2026-08-03', status: 'completed', extraction_mode: 'quick' },
    events, participants: [], warnings: [],
    days: [{ event_date: '2026-08-03', status: 'completed', processed_views: 29, expected_views: 29 }], ...extra };
}

test('distingue cupo cero, sin inscritos y valores ausentes aun fuera de la plantilla', () => {
  const a = auditRun(data([event(1, { capacity: 0, attendees: 0 }), event(2, { capacity: 10, attendees: 0 }),
    event(3, { capacity: null, attendees: null }), event(4, { capacity: 0, attendees: 3 })]));
  assert.equal(a.summary.zeroCapacityCount, 2);
  assert.equal(a.summary.zeroEnrollmentCount, 1);
  assert.equal(a.summary.missingCapacityCount, 1);
  assert.equal(a.summary.excludedCount, 4);
  const zero = a.findings.filter((f) => f.code === 'ZERO_CAPACITY');
  assert.equal(zero.length, 2);
  assert.equal(zero.find((f) => f.eventId === 4).severity, 'error');
  assert.ok(zero.every((f) => f.occupancyPct === null));
  assert.ok(zero.every((f) => f.templateIncluded === false));
});

test('no inventa discrepancias de nombres para modo rápido o detalles no leídos', () => {
  const a = auditRun(data([event(1), event(2, { detail_status: 'failed' }), event(3, { detail_status: 'unknown' })]));
  assert.ok(!a.findings.some((f) => f.code === 'PARTICIPANT_COUNT_MISMATCH'));
  assert.ok(a.findings.some((f) => f.code === 'DETAIL_NOT_CAPTURED'));
  assert.ok(a.findings.some((f) => f.code === 'DETAIL_READ_FAILED'));
});

test('compara sólo detalles confirmados y no duplica la alerta heredada', () => {
  const a = auditRun(data([event(1, { detail_status: 'read', attendees: 5 })], {
    participants: [{ event_date: '2026-08-03', matchpoint_event_id: '1', full_name: 'Uno' }],
    warnings: [{ event_id: 1, code: 'PARTICIPANT_COUNT_MISMATCH', message: 'Antigua alerta' }]
  }));
  const items = a.findings.filter((f) => f.code === 'PARTICIPANT_COUNT_MISMATCH');
  assert.equal(items.length, 1);
  assert.equal(items[0].participantCount, 1);
});

test('detecta sobrecupo, posibles duplicados, cifras contradictorias y días incompletos', () => {
  const a = auditRun(data([event(1, { attendees: 12, resource_id: '1', raw_attendance_label: '(2/10p)' }),
    event(2, { resource_id: '1' })], { days: [{ event_date: '2026-08-03', status: 'failed', processed_views: 5, expected_views: 29 }] }));
  for (const code of ['OVER_CAPACITY', 'POSSIBLE_DUPLICATE', 'LABEL_MISMATCH', 'INCOMPLETE_DAY']) {
    assert.ok(a.findings.some((f) => f.code === code), code);
  }
});

test('V16: cobertura desconocida y detalle no confirmado no se declaran verificados', () => {
  const a = auditRun(data([event(1, { detail_status: undefined })], {
    run: { id: 1, date_from: '2026-08-03', date_to: '2026-08-03', status: 'completed', extraction_mode: 'complete' }, days: []
  }));
  assert.equal(a.coverage.verified, false);
  assert.ok(a.findings.some((f) => f.code === 'LEGACY_COVERAGE'));
  assert.ok(a.findings.some((f) => f.code === 'DETAIL_COVERAGE_UNKNOWN'));
});

test('la revisión es de sólo lectura y un resultado vacío no certifica ausencia de clases', () => {
  const input = data([]);
  const before = JSON.stringify(input);
  assert.ok(auditRun(input).findings.some((f) => f.code === 'NO_EVENTS'));
  assert.equal(JSON.stringify(input), before);
});
