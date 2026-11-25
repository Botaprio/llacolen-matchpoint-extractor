'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const fs = require('node:fs');

function xmlEsc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(s || ''); }

function colLetter(n) {
  let t = '';
  let x = n;
  while (x > 0) { const r = (x - 1) % 26; t = String.fromCharCode(65 + r) + t; x = Math.floor((x - 1) / 26); }
  return t;
}

// ── Estilos OOXML ──────────────────────────────────────────────────────────
// Índices:  0=normal  1=título  2=encabezado(blanco/navy)  3=dato par  4=dato impar  5=número par  6=número impar
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><color rgb="FF0b2941"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF1c2b36"/><name val="Calibri"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0b2941"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFffffff"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFeef3f5"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFf6c900"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom><color rgb="FFd8e1e7"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
</styleSheet>`;

const DAY_ORDER_EXP = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
const DAY_LABELS_EXP = { lunes:'Lunes', martes:'Martes', 'miércoles':'Miércoles', jueves:'Jueves', viernes:'Viernes', sábado:'Sábado', domingo:'Domingo' };

async function buildScheduleXlsx(rows, label) {
  const JSZip = require('jszip');
  const zip = new JSZip();

  const strings = [];
  const si = new Map();
  function ss(v) {
    const s = String(v ?? '');
    if (!si.has(s)) { si.set(s, strings.length); strings.push(s); }
    return si.get(s);
  }

  // ── Hoja 1: Grilla horaria (tiempo × día) ────────────────────────────────
  ss(label);
  const HORA_LABEL = 'Hora'; ss(HORA_LABEL);

  const daySet = new Set(rows.map((r) => r.day));
  const timeSet = new Set(rows.map((r) => r.time));
  const days = DAY_ORDER_EXP.filter((d) => daySet.has(d));
  const times = [...timeSet].sort();

  const cellMap = new Map();
  for (const r of rows) {
    const key = `${r.time}|${r.day}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key).push(r.activity);
    ss(r.activity);
  }
  for (const d of days) ss(DAY_LABELS_EXP[d] || d);
  for (const t of times) ss(t);
  const combinedMap = new Map();
  for (const [key, acts] of cellMap) {
    const combined = [...new Set(acts)].join(' / ');
    ss(combined);
    combinedMap.set(key, combined);
  }

  const gridRows = [];
  let rn = 1;
  gridRows.push(`<row r="${rn}"><c r="${colLetter(1)}${rn}" s="1" t="s"><v>${si.get(label)}</v></c></row>`);
  rn++;
  gridRows.push(`<row r="${rn}"/>`);
  rn++;

  const hdrCells = [`<c r="${colLetter(1)}${rn}" s="2" t="s"><v>${si.get(HORA_LABEL)}</v></c>`];
  for (let i = 0; i < days.length; i++) {
    hdrCells.push(`<c r="${colLetter(i + 2)}${rn}" s="2" t="s"><v>${si.get(DAY_LABELS_EXP[days[i]] || days[i])}</v></c>`);
  }
  gridRows.push(`<row r="${rn}">${hdrCells.join('')}</row>`);
  rn++;

  let rowColor = 0;
  for (const time of times) {
    const s = rowColor % 2 === 0 ? 3 : 4;
    rowColor++;
    const cells = [`<c r="${colLetter(1)}${rn}" s="2" t="s"><v>${si.get(time)}</v></c>`];
    for (let i = 0; i < days.length; i++) {
      const combined = combinedMap.get(`${time}|${days[i]}`);
      cells.push(combined
        ? `<c r="${colLetter(i + 2)}${rn}" s="${s}" t="s"><v>${si.get(combined)}</v></c>`
        : `<c r="${colLetter(i + 2)}${rn}" s="${s}"/>`);
    }
    gridRows.push(`<row r="${rn}">${cells.join('')}</row>`);
    rn++;
  }

  let colsGrid = `<col min="1" max="1" width="10" customWidth="1"/>`;
  for (let i = 2; i <= days.length + 1; i++) colsGrid += `<col min="${i}" max="${i}" width="30" customWidth="1"/>`;

  const gridXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetView workbookViewId="0"><selection/></sheetView>
<cols>${colsGrid}</cols>
<sheetData>${gridRows.join('')}</sheetData>
</worksheet>`;

  // ── Hoja 2: Detalle (lista plana) ────────────────────────────────────────
  const HEADERS = ['Actividad', 'Día', 'Horario', 'Clases', 'Inscritos prom.', 'Cupo prom.', 'Ocupación %'];
  for (const h of HEADERS) ss(h);
  for (const r of rows) { ss(cap(r.day)); ss(r.time + (r.endTime ? ` – ${r.endTime}` : '')); }

  const listRows = [];
  rn = 1;
  listRows.push(`<row r="${rn}"><c r="A${rn}" s="1" t="s"><v>${si.get(label)}</v></c></row>`);
  rn++;
  listRows.push(`<row r="${rn}"/>`);
  rn++;
  listRows.push(`<row r="${rn}">${HEADERS.map((h, i) => `<c r="${colLetter(i + 1)}${rn}" s="${i < 3 ? 2 : 7}" t="s"><v>${si.get(h)}</v></c>`).join('')}</row>`);
  rn++;

  let lc = 0;
  for (const r of rows) {
    const even = lc % 2 === 0;
    const ts = even ? 3 : 4; const ns = even ? 5 : 6;
    lc++;
    const tl = r.time + (r.endTime ? ` – ${r.endTime}` : '');
    listRows.push(`<row r="${rn}"><c r="A${rn}" s="${ts}" t="s"><v>${si.get(r.activity)}</v></c><c r="B${rn}" s="${ts}" t="s"><v>${si.get(cap(r.day))}</v></c><c r="C${rn}" s="${ts}" t="s"><v>${si.get(tl)}</v></c><c r="D${rn}" s="${ns}"><v>${r.sessions}</v></c><c r="E${rn}" s="${ns}"><v>${r.avgAttendees}</v></c><c r="F${rn}" s="${ns}"><v>${r.avgCapacity}</v></c><c r="G${rn}" s="${ns}"><v>${r.occupancyPct}</v></c></row>`);
    rn++;
  }

  const listXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetView workbookViewId="0"><selection/></sheetView>
<cols><col min="1" max="1" width="38" customWidth="1" bestFit="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/><col min="4" max="7" width="14" customWidth="1"/></cols>
<sheetData>${listRows.join('')}</sheetData>
</worksheet>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('\n')}
</sst>`;

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Horario" sheetId="1" r:id="rId1"/><sheet name="Detalle" sheetId="2" r:id="rId2"/></sheets>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`);
  zip.file('xl/styles.xml', STYLES_XML);
  zip.file('xl/sharedStrings.xml', sharedStringsXml);
  zip.file('xl/worksheets/sheet1.xml', gridXml);
  zip.file('xl/worksheets/sheet2.xml', listXml);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

function scheduleHtmlDoc(rows, label) {
  let logoTag = '';
  try {
    const b64 = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo-llacolen.jpg')).toString('base64');
    logoTag = `<img src="data:image/jpeg;base64,${b64}" alt="">`;
  } catch { /* logo optional */ }

  const PALETTE = [
    ['#dbeafe','#2563eb'],['#dcfce7','#16a34a'],['#fce7f3','#db2777'],['#fed7aa','#ea580c'],
    ['#ede9fe','#7c3aed'],['#d1fae5','#059669'],['#fef3c7','#d97706'],['#cffafe','#0891b2'],
    ['#fee2e2','#dc2626'],['#e0e7ff','#4338ca'],['#fdf4ff','#9333ea'],['#f0fdf4','#166534'],
    ['#fff1f2','#e11d48'],['#f0f9ff','#0369a1'],['#fefce8','#ca8a04'],['#f7fee7','#4d7c0f'],
  ];

  const actList = [...new Set(rows.map((r) => r.activity))].sort((a, b) => a.localeCompare(b, 'es'));
  const colorMap = new Map();
  actList.forEach((act, i) => colorMap.set(act, PALETTE[i % PALETTE.length]));

  // Timetable grid
  const daySet = new Set(rows.map((r) => r.day));
  const timeSet = new Set(rows.map((r) => r.time));
  const days = DAY_ORDER_EXP.filter((d) => daySet.has(d));
  const times = [...timeSet].sort();
  const cellMap = new Map();
  for (const r of rows) {
    const key = `${r.time}|${r.day}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key).push(r);
  }

  let ttHtml = `<table class="tt"><thead><tr><th class="tc">Hora</th>${days.map((d) => `<th>${xmlEsc(DAY_LABELS_EXP[d] || d)}</th>`).join('')}</tr></thead><tbody>`;
  for (const time of times) {
    ttHtml += `<tr><td class="tc">${xmlEsc(time)}</td>`;
    for (const day of days) {
      const cellRows = cellMap.get(`${time}|${day}`) || [];
      if (cellRows.length) {
        const slots = cellRows.map((r) => {
          const [bg, bd] = colorMap.get(r.activity) || PALETTE[0];
          const range = r.endTime ? ` – ${r.endTime}` : '';
          return `<div class="slot" style="background:${bg};border-left:3px solid ${bd}"><strong>${xmlEsc(r.activity)}</strong><span>${xmlEsc(time)}${xmlEsc(range)} · ${r.avgAttendees}/${r.avgCapacity} (${r.occupancyPct}%)</span></div>`;
        }).join('');
        ttHtml += `<td class="tc2">${slots}</td>`;
      } else {
        ttHtml += '<td class="tc3"></td>';
      }
    }
    ttHtml += '</tr>';
  }
  ttHtml += '</tbody></table>';

  // Per-activity detail sections
  const byActivity = new Map();
  for (const r of rows) {
    if (!byActivity.has(r.activity)) byActivity.set(r.activity, []);
    byActivity.get(r.activity).push(r);
  }
  const sections = [...byActivity.entries()].map(([activity, actRows]) => {
    const [bg, bd] = colorMap.get(activity) || PALETTE[0];
    const trs = actRows.map((r) => `<tr><td>${xmlEsc(cap(r.day))}</td><td>${xmlEsc(r.time)}${r.endTime ? ` – ${xmlEsc(r.endTime)}` : ''}</td><td class="num">${r.sessions}</td><td class="num">${r.avgAttendees}</td><td class="num">${r.avgCapacity}</td><td class="num">${r.occupancyPct}%</td></tr>`).join('');
    return `<div class="act" style="background:${bg};border-left:4px solid ${bd}"><h3 style="color:${bd}">${xmlEsc(activity)}</h3><table><thead><tr><th>Día</th><th>Horario</th><th>Clases</th><th>Inscritos prom.</th><th>Cupo prom.</th><th>Ocupación</th></tr></thead><tbody>${trs}</tbody></table></div>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Inspector de Horarios – ${xmlEsc(label)}</title><style>
body{font-family:Arial,sans-serif;color:#123b5d;margin:28px;font-size:11px}
header{border-bottom:6px solid #f6c900;padding-bottom:12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
header img{width:72px;height:72px;object-fit:contain}
h1{margin:0 0 3px;font-size:18px;color:#004a87}
.sub{margin:0;font-size:11px;color:#657581}
.sec{font-size:13px;font-weight:700;color:#0b2941;margin:22px 0 10px;padding-bottom:5px;border-bottom:2px solid #f6c900}
.tt{border-collapse:collapse;width:100%;margin-bottom:6px;table-layout:auto}
.tt th{background:#0b2941;color:#fff;padding:6px 10px;font-size:10px;text-align:center}
.tt th.tc{background:#1c3b57;min-width:52px}
.tc{background:#f2f6f8;font-size:10px;font-weight:700;padding:4px 8px;text-align:center;border-right:2px solid #d0dce5;border-bottom:1px solid #d8e1e7;white-space:nowrap;vertical-align:middle}
.tc2{padding:3px;border-right:1px solid #e8eff3;border-bottom:1px solid #d8e1e7;vertical-align:top;min-width:100px}
.tc3{border-right:1px solid #e8eff3;border-bottom:1px solid #d8e1e7;background:#fafcfd}
.slot{padding:4px 6px;border-radius:4px;margin-bottom:2px}
.slot strong{display:block;font-size:9px;font-weight:700}
.slot span{display:block;font-size:9px;opacity:.7}
.act{margin-bottom:10px;page-break-inside:avoid;border-radius:5px;padding:8px 10px}
h3{margin:0 0 6px;font-size:11px;font-weight:700}
table{border-collapse:collapse;width:100%}
th{background:#f2f6f8;color:#0b2941;padding:4px 7px;text-align:left;font-size:10px;border-bottom:2px solid #d8e1e7}
td{padding:4px 7px;border-bottom:1px solid #d8e1e7;font-size:10px}
tr:nth-child(even) td{background:rgba(255,255,255,.6)}
.num{text-align:right}
</style></head>
<body>
<header><div><h1>Inspector de Horarios</h1><p class="sub">${xmlEsc(label)}</p></div>${logoTag}</header>
<div class="sec">Grilla horaria semanal</div>
${ttHtml}
<div class="sec">Detalle por actividad</div>
${sections}
</body></html>`;
}

async function exportScheduleExcel(rows, label, filePath) {
  const buf = await buildScheduleXlsx(rows, label);
  await fsp.writeFile(filePath, buf);
}

module.exports = { exportScheduleExcel, scheduleHtmlDoc };
