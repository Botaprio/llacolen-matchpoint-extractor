'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWarnings,
  occupancyPercentage,
  parseAttendanceLabel,
  parseDetailText
} = require('../src/services/parsers');

test('extrae inscritos y cupo desde la etiqueta de MatchPoint', () => {
  assert.deepEqual(parseAttendanceLabel('19:10-20:30  (1/15p)'), {
    raw: '19:10-20:30 (1/15p)',
    attendees: 1,
    capacity: 15,
    status: 'ok'
  });
});

test('conserva eventos con cero inscritos', () => {
  const parsed = parseAttendanceLabel('16:00-17:45 (0/30p)');
  assert.equal(parsed.attendees, 0);
  assert.equal(parsed.capacity, 30);
  assert.equal(parsed.status, 'ok');
});

test('marca cupo cero y ausencia del indicador', () => {
  assert.equal(parseAttendanceLabel('10:00-11:00 (2/0p)').status, 'zero_capacity');
  assert.equal(parseAttendanceLabel('10:00-11:00').status, 'missing_indicator');
});

test('calcula porcentaje y detecta inconsistencias', () => {
  assert.equal(occupancyPercentage(1, 15), 6.67);
  assert.equal(occupancyPercentage(1, 0), null);
  const warnings = buildWarnings({
    attendees: 3,
    capacity: 2,
    attendanceStatus: 'over_capacity'
  }, 1);
  assert.deepEqual(warnings.map((warning) => warning.code), [
    'OVER_CAPACITY',
    'PARTICIPANT_COUNT_MISMATCH'
  ]);
});

test('extrae lugar y monitor del detalle', () => {
  const parsed = parseDetailText(`
    Actividad: Básquetbol
    Lugar: Multicancha Principal
    Fecha y Horario: 21/08/2026 19:10-20:30
    Monitor: Persona Encargada
    Niveles Todos - Todos
  `);
  assert.equal(parsed.location, 'Multicancha Principal');
  assert.equal(parsed.monitor, 'Persona Encargada');
});
