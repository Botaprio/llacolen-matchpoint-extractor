'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enumerateDates, formatForMatchPoint, parseIsoDate } = require('../src/services/date-utils');

test('enumera el rango inclusivo', () => {
  assert.deepEqual(enumerateDates('2026-08-20', '2026-08-22'), [
    '2026-08-20',
    '2026-08-21',
    '2026-08-22'
  ]);
});

test('formatea la fecha como espera MatchPoint', () => {
  assert.equal(formatForMatchPoint('2026-08-21'), '21/08/2026');
});

test('rechaza fechas inválidas o rangos invertidos', () => {
  assert.throws(() => parseIsoDate('2026-02-30'));
  assert.throws(() => enumerateDates('2026-08-22', '2026-08-20'));
});
