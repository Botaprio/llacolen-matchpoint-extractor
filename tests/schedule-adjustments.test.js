'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { aggregateAllowedEvents, filteredAnalysis, SHEETS } = require('../src/services/report-template');
const { auditRun } = require('../src/services/data-audit');
const { exportOfficialExcelSet } = require('../src/services/official-report-exporter');
const event = (time, more = {}) => ({ activity_name: 'SALA DE MUSCULACIÓN', event_date: '2026-03-20', start_time: time, end_time: '08:00', attendees: 12, capacity: 30, matchpoint_event_id: 'third-friday', ...more });
const march = { run: { date_from: '2026-03-01', date_to: '2026-03-31', status: 'completed', extraction_mode: 'quick' }, events: [6, 13, 20, 27].map((day) => event(day === 20 ? '06:25' : '06:30', { event_date: `2026-03-${String(day).padStart(2, '0')}`, matchpoint_event_id: `friday-${day}` })) };

test('marzo: recupera el tercer viernes sin cambiar la fuente; análisis y auditoría coinciden', () => {
  const before = JSON.stringify(march);
  const result = aggregateAllowedEvents(march.events);
  assert.equal(result.accepted.length, 4); assert.equal(result.adjustedCount, 1);
  assert.deepEqual(result.aggregates.get('Actividades Fitness lista.xlsx|Musculación|7'), { attendees: 48, capacity: 120, classes: 4 });
  assert.equal(result.scheduleIssues[0].originalTime, '06:25'); assert.equal(result.scheduleIssues[0].assignedTime, '06:30'); assert.equal(result.scheduleIssues[0].delta, 5);
  assert.equal(filteredAnalysis(march).totals.attendees, 48);
  const audit = auditRun(march);
  assert.equal(audit.summary.includedCount, 4); assert.equal(audit.summary.adjustedCount, 1);
  assert.equal(audit.findings.filter((item) => item.code === 'TIME_ADJUSTED').length, 1);
  assert.equal(audit.findings.some((item) => item.code === 'EXCLUDED_FROM_REPORT'), false);
  assert.equal(JSON.stringify(march), before);
});

test('tolera adelantos y atrasos de hasta 15 minutos; 16 minutos no se asignan', () => {
  for (const offset of [-16, -15, -10, -5, -2, 2, 5, 10, 15, 16]) {
    const result = aggregateAllowedEvents([event(`06:${String(30 + offset).padStart(2, '0')}`)]);
    assert.equal(result.accepted.length, Math.abs(offset) <= 15 ? 1 : 0, `desfase ${offset}`);
    if (Math.abs(offset) <= 15) assert.equal(result.scheduleIssues[0].delta, -offset);
    else assert.equal(result.excluded[0]._exclude_reason, 'NO_NEARBY_TIME');
  }
  assert.equal(aggregateAllowedEvents([event('25:30')]).accepted.length, 0);
  assert.equal(aggregateAllowedEvents([event('06:65')]).accepted.length, 0);
  assert.equal(aggregateAllowedEvents([event('06:25', { event_date: '2026-03-21' })]).accepted.length, 0);
});

test('prioriza horario exacto sin duplicar el mismo ID en cualquier orden', () => {
  const anonymous = aggregateAllowedEvents([event('06:30', { matchpoint_event_id: '' }), event('06:30', { matchpoint_event_id: '' })]);
  assert.equal(anonymous.accepted.length, 2, 'un ID vacío no demuestra que dos clases sean la misma');
  const shifted = event('06:25'); const exact = event('06:30');
  for (const inputs of [[shifted, exact], [exact, shifted]]) {
    const result = aggregateAllowedEvents(inputs);
    assert.equal(result.accepted.length, 1); assert.equal(result.adjustedCount, 0);
    assert.equal(result.accepted[0].start_time, '06:30');
    assert.equal(result.excluded[0]._exclude_reason, 'ALREADY_ASSIGNED');
  }
});

test('no ocupa una fila ya usada ni resuelve conflictos según el orden de llegada', () => {
  const shifted = event('06:25'); const exact = event('06:30', { matchpoint_event_id: 'other' });
  for (const inputs of [[shifted, exact], [exact, shifted]]) {
    const result = aggregateAllowedEvents(inputs);
    assert.equal(result.accepted.length, 1); assert.equal(result.excluded[0]._exclude_reason, 'TIME_SLOT_OCCUPIED');
  }
  const competing = aggregateAllowedEvents([shifted, event('06:35', { matchpoint_event_id: 'other' })]);
  assert.equal(competing.accepted.length, 0);
  assert.ok(competing.excluded.every((item) => item._exclude_reason === 'COMPETING_TIME_RECORDS'));
  const conflicting = aggregateAllowedEvents([shifted, event('06:35')]);
  assert.equal(conflicting.accepted.length, 0);
  assert.ok(conflicting.excluded.every((item) => item._exclude_reason === 'CONFLICTING_TIME_RECORDS'));
});

test('filtrar actividades no vuelve a contar una clase asignada con otro nombre', () => {
  const result = aggregateAllowedEvents([event('06:25'), event('06:30', { activity_name: 'MUSCULACIÓN' })], ['SALA DE MUSCULACIÓN']);
  assert.equal(result.accepted.length, 0); assert.equal(result.excluded[0]._exclude_reason, 'ALREADY_ASSIGNED');
});

test('elige la hora más cercana y deja los empates pendientes', () => {
  // Catálogo temporal controlado: dos clases de la misma familia con 30 minutos entre ellas.
  const sheet = SHEETS.find((item) => item.sheet === 'Musculación');
  const added = { ...sheet.rows.find((row) => row.day === 'viernes'), row: 999, time: '07:00' };
  sheet.rows.push(added);
  try {
    assert.equal(aggregateAllowedEvents([event('06:45')]).excluded[0]._exclude_reason, 'AMBIGUOUS_NEARBY_TIME');
    assert.equal(aggregateAllowedEvents([event('06:44')]).accepted[0]._template_time, '06:30');
    assert.equal(aggregateAllowedEvents([event('06:46')]).accepted[0]._template_time, '07:00');
  } finally { sheet.rows.pop(); }
});

test('exporta siete Excel con cuadro bajo estadísticas/gráfico y TXT con ajustes y pendientes', async () => {
  const JSZip = require('jszip');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llacolen-schedule-'));
  try {
    const result = await exportOfficialExcelSet({ runData: { ...march, events: [...march.events, event('06:14', { matchpoint_event_id: 'outside' })] }, destinationDir: dir });
    assert.equal(result.files.length, 7);
    const log = fs.readFileSync(result.logPath, 'utf8');
    assert.match(log, /Ajustes aplicados: 1/); assert.match(log, /PENDIENTE/); assert.match(log, /06:25 → usado: 06:30 \(\+5 min\)/); assert.match(log, /2026-03-20/); assert.match(log, /friday-20/); assert.match(log, /06:14/);
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'Actividades Fitness lista.xlsx')));
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(xml, /<c r="D7"[^>]*><v>48<\/v>/); assert.match(xml, /<c r="F7"[^>]*><v>4<\/v>/);
    assert.match(xml, /Observaciones de horario/); assert.match(xml, /06:25 → usado: 06:30 \(\+5 min\)/); assert.match(xml, /PENDIENTE/);
    const noteRow = Number(xml.match(/<row r="(\d+)"[^>]*><c[^>]*><is><t[^>]*>Observaciones de horario/)?.[1]);
    assert.ok(noteRow > 17, `cuadro debajo del gráfico, fila ${noteRow}`);
    const styles = await zip.file('xl/styles.xml').async('string');
    for (const tag of ['fonts', 'fills', 'borders', 'cellXfs']) {
      const block = styles.match(new RegExp(`<${tag} count="(\\d+)"[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      const child = { fonts: 'font', fills: 'fill', borders: 'border', cellXfs: 'xf' }[tag];
      assert.equal([...block[2].matchAll(new RegExp(`<${child}\\b`, 'g'))].length, Number(block[1]));
    }
    if (process.env.LLACOLEN_SCHEDULE_PREVIEW) fs.cpSync(dir, process.env.LLACOLEN_SCHEDULE_PREVIEW, { recursive: true });
    const noIssues = await exportOfficialExcelSet({ runData: { ...march, events: [] }, destinationDir: dir });
    assert.match(fs.readFileSync(noIssues.logPath, 'utf8'), /No se detectaron inconsistencias/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('añade observaciones en todas las hojas oficiales sin cruzar familias de actividades', async () => {
  const JSZip = require('jszip');
  const dates = { lunes: '2026-03-02', martes: '2026-03-03', miercoles: '2026-03-04', jueves: '2026-03-05', viernes: '2026-03-06', sabado: '2026-03-07', domingo: '2026-03-01' };
  const events = SHEETS.map((sheet, i) => {
    const row = sheet.rows[0];
    const [hour, minute] = row.time.split(':').map(Number);
    const time = hour * 60 + minute + 2;
    return event(`${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`, {
      activity_name: row.descriptor.split('|').slice(0, -2).join(' '), event_date: dates[row.day], matchpoint_event_id: `all-sheets-${i}`
    });
  });
  const resolved = aggregateAllowedEvents(events);
  assert.equal(resolved.adjustedCount, SHEETS.length);
  SHEETS.forEach((sheet, i) => {
    assert.equal(resolved.accepted[i]._template_workbook, sheet.workbook);
    assert.equal(resolved.accepted[i]._template_sheet, sheet.sheet);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llacolen-all-notes-'));
  try {
    const result = await exportOfficialExcelSet({ runData: { ...march, events }, destinationDir: dir });
    for (const file of result.files) {
      const zip = await JSZip.loadAsync(fs.readFileSync(file));
      let noted = 0;
      for (const name of Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) {
        const xml = await zip.file(name).async('string');
        if (xml.includes('Observaciones de horario')) {
          noted += 1;
          assert.match(xml, /\(-2 min\)/);
          const lastRow = Math.max(...[...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((item) => Number(item[1])));
          assert.equal(Number(xml.match(/<dimension ref="[^:"]+:[A-Z]+(\d+)"/)?.[1]), lastRow);
        }
      }
      assert.equal(noted, SHEETS.filter((sheet) => sheet.workbook === path.basename(file)).length);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
