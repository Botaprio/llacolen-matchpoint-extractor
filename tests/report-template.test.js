'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOG,
  matchSourceRecord,
  aggregateAllowedEvents,
  filteredAnalysis
} = require('../src/services/report-template');

const DATES = {
  lunes: '2025-06-02', martes: '2025-06-03', miercoles: '2025-06-04',
  jueves: '2025-06-05', viernes: '2025-06-06', sabado: '2025-06-07', domingo: '2025-06-01'
};

function sourceName(row) {
  const parts = row.descriptor.split('|').map((x) => x.trim());
  return parts.slice(0, -2).join(' ');
}

test('las 464 filas válidas de las plantillas oficiales se resuelven de forma inequívoca', () => {
  let count = 0;
  for (const sheet of CATALOG.sheets) {
    for (const row of sheet.rows) {
      const match = matchSourceRecord({
        activity_name: sourceName(row),
        event_date: DATES[row.day],
        start_time: row.time,
        attendees: 1,
        capacity: 10
      });
      assert.equal(match.matched, true, `${sheet.sheet} fila ${row.row}: ${match.reason || 'sin coincidencia'}`);
      assert.equal(match.sheet.workbook, sheet.workbook);
      assert.equal(match.sheet.sheet, sheet.sheet);
      assert.equal(match.row.row, row.row);
      count += 1;
    }
  }
  assert.equal(count, 464);
});

test('una actividad que no existe en los Excel queda completamente excluida', () => {
  const invalid = {
    activity_name: 'ACTIVIDAD INVENTADA NO AUTORIZADA',
    event_date: '2025-06-02',
    start_time: '12:34',
    attendees: 999,
    capacity: 999
  };
  const result = aggregateAllowedEvents([invalid]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0]._exclude_reason, 'NOT_IN_TEMPLATE_FAMILIES');
});

test('el análisis y por extensión el PDF no incluyen actividades fuera de plantilla', () => {
  const valid = {
    activity_name: 'ZUMBA',
    event_date: '2025-06-02',
    start_time: '07:30',
    attendees: 12,
    capacity: 30
  };
  const invalid = {
    activity_name: 'EVENTO EMPRESA EXTERNA',
    event_date: '2025-06-02',
    start_time: '07:30',
    attendees: 100,
    capacity: 100
  };
  const analysis = filteredAnalysis({
    run: { date_from: '2025-06-01', date_to: '2025-06-30' },
    events: [valid, invalid]
  });
  assert.equal(analysis.activities.length, 1);
  assert.equal(analysis.activities[0].activity_name, 'ZUMBA');
  assert.equal(analysis.totals.attendees, 12);
  assert.equal(analysis.excludedCount, 1);
});
