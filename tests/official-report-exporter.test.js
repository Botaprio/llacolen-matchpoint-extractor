'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CATALOG } = require('../src/services/report-template');
const { exportOfficialExcelSet, exportOfficialPresentation, patchReportPeriod, cleanVisibleText, canonicalChartTitle } = require('../src/services/official-report-exporter');

const runData = {
  run: { date_from: '2026-08-01', date_to: '2026-08-31' },
  events: [
    { activity_name: 'ZUMBA', event_date: '2026-08-03', start_time: '07:30', attendees: 12, capacity: 30 },
    { activity_name: 'ACTIVIDAD INVENTADA NO AUTORIZADA', event_date: '2026-08-03', start_time: '12:34', attendees: 999, capacity: 999 }
  ]
};




test('corrige ortografía visible sin alterar la lógica interna del catálogo', () => {
  assert.equal(cleanVisibleText('Entrenamiento funcinal Flow'), 'Entrenamiento funcional Flow');
  assert.equal(cleanVisibleText('HIT entrenamiento de intervalos de alta intencidad'), 'HIIT: entrenamiento de intervalos de alta intensidad');
  assert.equal(cleanVisibleText('Miercoles Sabado Padel Futbol Basquetbol'), 'Miércoles Sábado Pádel Fútbol Básquetbol');
  assert.equal(cleanVisibleText('Sicomotricidad inlusiva'), 'Psicomotricidad inclusiva');
  assert.equal(cleanVisibleText('Taller de Fotografia - Reflex y Edicion Celuar'), 'Taller de Fotografía - Réflex y Edición Celular');
  assert.equal(cleanVisibleText('17:000 Hrs.'), '17:00 Hrs.');
  assert.equal(canonicalChartTitle('Ocupacion Entrenamiento funcinal Flow, Agosto 2026.', 'Agosto 2026'), 'Asistentes vs. cupos — Entrenamiento Funcional Flow, Agosto 2026');
});

test('reemplaza el mes/año aunque PowerPoint lo haya dividido en varios runs', () => {
  const xml = '<a:p><a:r><a:t>J</a:t></a:r><a:r><a:t>unio 2025</a:t></a:r></a:p>';
  const patched = patchReportPeriod(xml, 'Agosto 2026');
  const visible = patched.replace(/<[^>]+>/g, '');
  assert.equal(visible, 'Agosto 2026');
  assert.equal(/Junio\s+2025/i.test(visible), false);
});

test('genera los 7 Excel oficiales y el PPT sin dejar pasar eventos no autorizados', async () => {
  const JSZip = require('jszip');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llacolen-v15-'));
  try {
    const excel = await exportOfficialExcelSet({ runData, destinationDir: dir });
    assert.equal(excel.files.length, 7);
    assert.equal(excel.accepted.length, 1);
    assert.equal(excel.excluded.length, 1);
    assert.deepEqual(excel.files.map((x) => path.basename(x)).sort(), [...CATALOG.excelFiles].sort());

    const fitnessPath = path.join(dir, 'Actividades Fitness lista.xlsx');
    const fitnessZip = await JSZip.loadAsync(fs.readFileSync(fitnessPath));
    const worksheetXml = await fitnessZip.file('xl/worksheets/sheet6.xml').async('string');
    assert.equal(worksheetXml.includes('/ t="inlineStr"'), false);
    const chartXml = await fitnessZip.file(CATALOG.excelCharts.find((x) => x.workbook === 'Actividades Fitness lista.xlsx' && x.sheet === 'Zumba').chartPath).async('string');
    assert.match(chartXml, /<c:tx><c:v>Cupos<\/c:v><\/c:tx>/);
    assert.match(chartXml, /<c:tx><c:v>Asistentes<\/c:v><\/c:tx>/);

    // Todos los sharedStrings de todos los Excel deben mostrar el período real, nunca el de la plantilla.
    for (const excelFile of excel.files) {
      const excelZip = await JSZip.loadAsync(fs.readFileSync(excelFile));
      const ssEntry = excelZip.file('xl/sharedStrings.xml');
      if (!ssEntry) continue;
      const ssXml = await ssEntry.async('string');
      assert.ok(!ssXml.includes('Junio del 2025'), `${path.basename(excelFile)}: sharedStrings aún tiene fecha de plantilla`);
      assert.ok(ssXml.includes('Agosto del 2026'), `${path.basename(excelFile)}: sharedStrings no tiene el período real`);
    }

    const pptPath = path.join(dir, 'Estadística de Actividades Agosto 2026.pptx');
    const ppt = await exportOfficialPresentation({ runData, destination: pptPath });
    assert.equal(ppt.accepted.length, 1);
    assert.equal(ppt.excluded.length, 1);
    const pptZip = await JSZip.loadAsync(fs.readFileSync(pptPath));
    const slides = Object.keys(pptZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    const charts = Object.keys(pptZip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    assert.equal(slides.length, 62);
    assert.equal(charts.length, 54);

    // PowerPoint puede partir una fecha en varios runs (por ejemplo "J" +
    // "unio 2025"). El texto visible concatenado de TODAS las diapositivas
    // debe usar exclusivamente el mes/año que se está procesando.
    const monthYearRe = /(?:Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)\s+\d{4}/gi;
    const visibleMonthYears = [];
    for (const slideName of slides) {
      const slideXml = await pptZip.file(slideName).async('string');
      const visibleText = slideXml.replace(/<[^>]+>/g, '');
      visibleMonthYears.push(...(visibleText.match(monthYearRe) || []));
    }
    assert.ok(visibleMonthYears.length >= 8, 'la plantilla contiene varias leyendas mensuales visibles');
    assert.deepEqual([...new Set(visibleMonthYears.map((x) => x.toLowerCase()))], ['agosto 2026']);

    const visibleOfficeXml = [];
    for (const name of [...slides, ...charts]) visibleOfficeXml.push(await pptZip.file(name).async('string'));
    const joinedVisibleXml = visibleOfficeXml.join('\n');
    const visibleNodeText = [...joinedVisibleXml.matchAll(/<(?:a:t|c:v)(?:\s[^>]*)?>([\s\S]*?)<\/(?:a:t|c:v)>/g)]
      .map((match) => match[1])
      .join(' ');
    assert.equal(/funcinal|intencidad|inlusiva|celuar|Miercoles|Sabado|Padel|Futbol|Basquetbol|Guarderia|Sicomotricidad|Acuaerobica|Fotografia|Ceramica|Terapeutica|17:000|Ã|Â|�/.test(visibleNodeText), false);
    assert.match(visibleNodeText, /Entrenamiento Funcional Flow/);
    assert.match(visibleNodeText, /HIIT: entrenamiento de intervalos de alta intensidad/);
    assert.match(visibleNodeText, /Asistentes vs\. cupos —/);

    const flowPptChart = CATALOG.pptCharts.find((item) => item.excelChart?.workbook === 'Actividades Fitness lista.xlsx' && item.excelChart?.sheet === 'Flow');
    assert.ok(flowPptChart, 'debe existir el gráfico PPT de Flow');
    const flowChartXml = await pptZip.file(flowPptChart.chartPath).async('string');
    assert.equal(flowChartXml.includes('15,0'), false);
    assert.equal(flowChartXml.includes('17,0'), false);
    assert.equal(flowChartXml.includes('3,8'), false);
    assert.equal(flowChartXml.includes('4,3'), false);
    assert.match(flowChartXml, /Flow!\$A\$3:\$B\$4/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
