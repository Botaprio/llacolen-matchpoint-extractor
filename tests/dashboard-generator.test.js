'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRunStats, computeMonthlyClassChanges } = require('../src/services/dashboard-generator');

// Minimal run record as returned by AppDatabase.getRun()
function makeRun(id, dateFrom, dateTo, status = 'completed') {
  return { id, date_from: dateFrom, date_to: dateTo, status, extraction_mode: 'complete', event_count: 0 };
}

// Minimal event record as returned by AppDatabase.getRunData().events
function makeEvent(activityName, eventDate, attendees = 5, capacity = 10, startTime = '10:00') {
  return {
    id: Math.random(),
    run_id: 1,
    matchpoint_event_id: 'evt-' + Math.random().toString(36).slice(2),
    activity_name: activityName,
    event_date: eventDate,
    start_time: startTime,
    end_time: null,
    attendees,
    capacity,
    occupancy_pct: capacity > 0 ? (attendees / capacity) * 100 : 0,
    attendance_status: 'confirmed',
    raw_attendance_label: `${attendees}/${capacity}`,
    view_names: 'Vista 1'
  };
}

describe('buildRunStats — rawActivities', () => {
  it('incluye todas las actividades del mes sin filtrar por catálogo', () => {
    const events = [
      makeEvent('Fútbol Menores', '2025-05-15', 8, 12),
      makeEvent('Fútbol Menores', '2025-05-22', 9, 12),
      makeEvent('Spinning', '2025-05-10', 15, 20),
    ];
    const stats = buildRunStats({ run: makeRun(1, '2025-05-01', '2025-05-31'), events, participants: [], warnings: [], days: [] });
    assert.ok(stats, 'buildRunStats debe devolver un objeto');
    assert.ok(Array.isArray(stats.rawActivities), 'rawActivities debe ser un array');
    const names = stats.rawActivities.map((a) => a.name);
    assert.ok(names.includes('Fútbol Menores'), 'Fútbol Menores debe estar en rawActivities');
    assert.ok(names.includes('Spinning'), 'Spinning debe estar en rawActivities');
  });

  it('agrega asistentes y cupos correctamente por actividad', () => {
    const events = [
      makeEvent('Yoga', '2025-05-05', 10, 15),
      makeEvent('Yoga', '2025-05-12', 12, 15),
      makeEvent('Yoga', '2025-05-19', 11, 15),
    ];
    const stats = buildRunStats({ run: makeRun(1, '2025-05-01', '2025-05-31'), events, participants: [], warnings: [], days: [] });
    const yoga = stats.rawActivities.find((a) => a.name === 'Yoga');
    assert.ok(yoga, 'Yoga debe estar en rawActivities');
    assert.equal(yoga.attendees, 33, 'Debe sumar inscritos de todas las sesiones');
    assert.equal(yoga.capacity, 45, 'Debe sumar cupos de todas las sesiones');
    assert.equal(yoga.eventCount, 3, 'Debe contar las 3 sesiones');
  });

  it('registra la primera fecha de detección de cada actividad', () => {
    const events = [
      makeEvent('Fútbol Menores', '2025-05-20', 5, 10),
      makeEvent('Fútbol Menores', '2025-05-15', 6, 10),
      makeEvent('Fútbol Menores', '2025-05-27', 7, 10),
    ];
    const stats = buildRunStats({ run: makeRun(1, '2025-05-01', '2025-05-31'), events, participants: [], warnings: [], days: [] });
    const futbol = stats.rawActivities.find((a) => a.name === 'Fútbol Menores');
    assert.equal(futbol.firstDate, '2025-05-15', 'Debe registrar la fecha más temprana');
  });

  it('classChanges inicia como null hasta que se ejecuta computeMonthlyClassChanges', () => {
    const stats = buildRunStats({ run: makeRun(1, '2025-05-01', '2025-05-31'), events: [], participants: [], warnings: [], days: [] });
    assert.equal(stats.classChanges, null, 'classChanges debe ser null tras buildRunStats');
  });
});

describe('computeMonthlyClassChanges', () => {
  it('detecta una clase nueva incorporada en el mes siguiente', () => {
    const aprilStats = buildRunStats({
      run: makeRun(1, '2025-04-01', '2025-04-30'),
      events: [makeEvent('Spinning', '2025-04-05')],
      participants: [], warnings: [], days: []
    });
    const mayStats = buildRunStats({
      run: makeRun(2, '2025-05-01', '2025-05-31'),
      events: [
        makeEvent('Spinning', '2025-05-05'),
        makeEvent('Fútbol Menores', '2025-05-15'), // nueva en mayo
      ],
      participants: [], warnings: [], days: []
    });

    computeMonthlyClassChanges([aprilStats, mayStats]);

    const may = mayStats.classChanges;
    assert.ok(may, 'mayo debe tener classChanges');
    assert.ok(may.hasPreviousMonth, 'mayo debe reconocer que abril existe');
    assert.equal(may.newCount, 1, 'debe haber 1 clase nueva');
    assert.equal(may.newClasses[0].name, 'Fútbol Menores', 'la clase nueva debe ser Fútbol Menores');
    assert.equal(may.retiredCount, 0, 'no hay clases retiradas');
  });

  it('detecta una clase retirada que ya no aparece en el mes siguiente', () => {
    const juneStats = buildRunStats({
      run: makeRun(3, '2025-06-01', '2025-06-30'),
      events: [makeEvent('Spinning', '2025-06-05')],
      participants: [], warnings: [], days: []
    });
    const julyStats = buildRunStats({
      run: makeRun(4, '2025-07-01', '2025-07-31'),
      events: [], // Spinning ya no aparece
      participants: [], warnings: [], days: []
    });

    computeMonthlyClassChanges([juneStats, julyStats]);

    const july = julyStats.classChanges;
    assert.ok(july, 'julio debe tener classChanges');
    assert.equal(july.retiredCount, 1, 'debe haber 1 clase retirada');
    assert.equal(july.retiredClasses[0].name, 'Spinning', 'la clase retirada debe ser Spinning');
    assert.equal(july.newCount, 0, 'no hay clases nuevas');
  });

  it('no marca nada como nuevo cuando no hay mes anterior', () => {
    const stats = buildRunStats({
      run: makeRun(1, '2025-04-01', '2025-04-30'),
      events: [makeEvent('Yoga', '2025-04-05')],
      participants: [], warnings: [], days: []
    });

    computeMonthlyClassChanges([stats]);

    const april = stats.classChanges;
    assert.ok(april, 'debe tener classChanges');
    assert.equal(april.hasPreviousMonth, false, 'no debe reportar mes anterior');
    assert.equal(april.newCount, 0, 'sin mes anterior no hay nuevas');
    assert.equal(april.retiredCount, 0, 'sin mes anterior no hay retiradas');
    assert.equal(april.activeCount, 1, 'debe contar 1 clase activa');
  });

  it('detecta clase que desaparece temporalmente y regresa', () => {
    const aprilStats = buildRunStats({
      run: makeRun(1, '2025-04-01', '2025-04-30'),
      events: [makeEvent('Karate', '2025-04-10')],
      participants: [], warnings: [], days: []
    });
    const mayStats = buildRunStats({
      run: makeRun(2, '2025-05-01', '2025-05-31'),
      events: [], // Karate no detectado en mayo
      participants: [], warnings: [], days: []
    });
    const juneStats = buildRunStats({
      run: makeRun(3, '2025-06-01', '2025-06-30'),
      events: [makeEvent('Karate', '2025-06-10')], // Karate regresa en junio
      participants: [], warnings: [], days: []
    });

    computeMonthlyClassChanges([aprilStats, mayStats, juneStats]);

    assert.equal(mayStats.classChanges.retiredCount, 1, 'mayo debe reportar Karate como retirado');
    assert.equal(juneStats.classChanges.newCount, 1, 'junio debe reportar Karate como nueva (regresó)');
    assert.equal(juneStats.classChanges.newClasses[0].name, 'Karate', 'la clase que regresa debe identificarse correctamente');
  });

  it('un rescaneo del mismo mes no duplica ni pierde datos en la comparación', () => {
    // Si el mismo mes se escaneó dos veces, solo se usa el último (byMonth Map sobrescribe con el mismo key)
    const may1 = buildRunStats({
      run: makeRun(2, '2025-05-01', '2025-05-31'),
      events: [makeEvent('Spinning', '2025-05-05')],
      participants: [], warnings: [], days: []
    });
    const may2 = buildRunStats({
      run: makeRun(5, '2025-05-01', '2025-05-31'),
      events: [makeEvent('Spinning', '2025-05-05'), makeEvent('Fútbol Menores', '2025-05-15')],
      participants: [], warnings: [], days: []
    });
    const juneStats = buildRunStats({
      run: makeRun(3, '2025-06-01', '2025-06-30'),
      events: [makeEvent('Spinning', '2025-06-01')],
      participants: [], warnings: [], days: []
    });

    // may2 overwrites may1 in byMonth since they share the same monthKey
    computeMonthlyClassChanges([may1, may2, juneStats]);

    // June compares against whichever mayo run is indexed last
    const june = juneStats.classChanges;
    assert.ok(june, 'junio debe tener classChanges');
    assert.ok(june.hasPreviousMonth, 'junio reconoce que mayo existe');
    // Spinning existed in mayo → not new in june; Fútbol Menores was in may2 → retired in june
    assert.equal(june.newCount, 0, 'Spinning ya existía en mayo');
    assert.equal(june.retiredCount, 1, 'Fútbol Menores estaba en mayo pero no en junio');
  });

  it('un escaneo con consulta fallida (resultado incompleto) no elimina clases del historial', () => {
    // Even if the scan for July returns empty (failed), June's data must remain intact
    const juneStats = buildRunStats({
      run: makeRun(3, '2025-06-01', '2025-06-30'),
      events: [makeEvent('Squash', '2025-06-05')],
      participants: [], warnings: [], days: []
    });
    const julyPartial = buildRunStats({
      run: makeRun(4, '2025-07-01', '2025-07-31', 'partial'),
      events: [], // scan error — empty
      participants: [], warnings: [], days: []
    });

    computeMonthlyClassChanges([juneStats, julyPartial]);

    // June data untouched
    assert.equal(juneStats.rawActivities.length, 1, 'junio mantiene sus datos originales');
    assert.equal(juneStats.rawActivities[0].name, 'Squash', 'nombre de clase en junio intacto');
    // July shows retired but that is a data quality issue: the system should warn about this
    // The function itself just reflects what the data shows; it does not falsify history
    assert.equal(julyPartial.classChanges.hasPreviousMonth, true, 'julio reconoce junio');
  });
});
