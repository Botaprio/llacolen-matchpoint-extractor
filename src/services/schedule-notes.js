'use strict';

const path = require('node:path');
const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (value) => value.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
const attribute = (xml, name) => xml.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '';
function column(number) { let result = ''; for (; number; number = Math.floor((number - 1) / 26)) result = String.fromCharCode(65 + (number - 1) % 26) + result; return result; }
function issueLines(issue) {
  const identity = `${issue.date || 'Fecha ausente'} | ${issue.activity} | ID ${issue.eventId || 'sin ID'} | Inscritos: ${issue.attendees ?? 'sin dato'} | Cupo: ${issue.capacity ?? 'sin dato'}`;
  const movement = issue.status === 'APLICADO'
    ? `Registrado: ${issue.originalTime} → usado: ${issue.assignedTime} (${issue.delta > 0 ? '+' : ''}${issue.delta} min).`
    : `Registrado: ${issue.originalTime || 'sin hora'} → sin ajuste; excluido de las estadísticas.`;
  const targets = issue.targets.map((item) => `${item.workbook} / ${item.sheet}, fila ${item.row}, ${item.time}`).join('; ');
  return [identity, `${issue.status}: ${movement} ${issue.reason}${targets ? ` Destino${issue.status === 'APLICADO' ? '' : ' propuesto'}: ${targets}.` : ''}`];
}
function scheduleLog(dataset, run, selectedActivities = []) {
  const pending = dataset.scheduleIssues.length - dataset.adjustedCount;
  const lines = ['LLACOLÉN — REGISTRO DE INCONSISTENCIAS DE HORARIO',
    `Período: ${run.date_from} al ${run.date_to}`, `Generado: ${new Date().toISOString()}`,
    `Filtro: ${selectedActivities.length ? selectedActivities.join(', ') : 'Todas las actividades'}`,
    'Regla: misma actividad y día de semana; horario exacto primero; tolerancia máxima de 15 minutos.',
    'Los ajustes afectan únicamente la asignación en los informes. La hora original guardada y MatchPoint no se modifican.',
    `Ajustes aplicados: ${dataset.adjustedCount}. Pendientes o registros no reasignados: ${pending}.`,
    `Clases incluidas: ${dataset.accepted.length}. Registros excluidos: ${dataset.excluded.length}.`, ''];
  if (!dataset.scheduleIssues.length) lines.push('No se detectaron inconsistencias de horario en los registros comparables con las plantillas.');
  dataset.scheduleIssues.forEach((issue, index) => lines.push(`${index + 1}. ${issueLines(issue).join('\r\n')}`, ''));
  lines.push('Este registro describe los datos capturados; no certifica clases ausentes de la extracción ni cambios de horario autorizados.');
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
function appendStyle(xml, tag, fragment) {
  let index;
  const updated = xml.replace(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`), (_, attrs, content) => {
    index = Number(attribute(attrs, 'count'));
    return `<${tag}${attrs.replace(/count="\d+"/, `count="${index + 1}"`)}>${content}${fragment}</${tag}>`;
  });
  if (index === undefined) throw new Error(`No se encontró ${tag} en los estilos Excel.`);
  return [updated, index];
}
async function noteStyles(zip) {
  let xml = await zip.file('xl/styles.xml').async('string');
  let titleFont, bodyFont, titleFill, bodyFill, border, title, body;
  [xml, titleFont] = appendStyle(xml, 'fonts', '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>');
  [xml, bodyFont] = appendStyle(xml, 'fonts', '<font><sz val="10"/><color rgb="FF243746"/><name val="Calibri"/></font>');
  [xml, titleFill] = appendStyle(xml, 'fills', '<fill><patternFill patternType="solid"><fgColor rgb="FF243746"/><bgColor indexed="64"/></patternFill></fill>');
  [xml, bodyFill] = appendStyle(xml, 'fills', '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/><bgColor indexed="64"/></patternFill></fill>');
  [xml, border] = appendStyle(xml, 'borders', '<border><left style="thin"><color rgb="FFD6DDE3"/></left><right style="thin"><color rgb="FFD6DDE3"/></right><top style="thin"><color rgb="FFD6DDE3"/></top><bottom style="thin"><color rgb="FFD6DDE3"/></bottom><diagonal/></border>');
  const xf = (font, fill) => `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`;
  [xml, title] = appendStyle(xml, 'cellXfs', xf(titleFont, titleFill));
  [xml, body] = appendStyle(xml, 'cellXfs', xf(bodyFont, bodyFill));
  zip.file('xl/styles.xml', xml);
  return { title, body };
}
async function drawingBottom(zip, xmlPath, xml) {
  const id = attribute(xml.match(/<drawing\b[^>]*\/>/)?.[0] || '', 'r:id');
  if (!id) return 0;
  const relPath = path.posix.join(path.posix.dirname(xmlPath), '_rels', path.posix.basename(xmlPath) + '.rels');
  if (!zip.file(relPath)) return 0;
  const rels = await zip.file(relPath).async('string');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].find(([item]) => attribute(item, 'Id') === id)?.[0];
  if (!rel) return 0;
  const target = decode(attribute(rel, 'Target'));
  const drawingPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(xmlPath), target));
  if (!zip.file(drawingPath)) return 0;
  const drawing = await zip.file(drawingPath).async('string');
  return Math.max(0, ...[...drawing.matchAll(/<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/g)].map((item) => Number(item[1]) + 1));
}
async function appendScheduleNotes(zip, xmlPath, xml, sheet, issues, styles) {
  if (!issues.length) return { xml, lastRow: null };
  const used = Math.max(0, ...[...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((item) => Number(item[1])), await drawingBottom(zip, xmlPath, xml));
  let r = used + 3;
  const end = column(Math.max(...Object.values(sheet.metrics)));
  const rows = [], merges = [];
  const add = (text, title = false) => {
    // Filas combinadas de ancho completo; altura explícita para texto envuelto.
    const height = title ? 25 : Math.max(32, Math.ceil(text.length / 85) * 15 + 12);
    const cells = [];
    for (let c = 2; c <= Math.max(...Object.values(sheet.metrics)); c += 1) {
      const ref = `${column(c)}${r}`;
      cells.push(c === 2 ? `<c r="${ref}" s="${title ? styles.title : styles.body}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>` : `<c r="${ref}" s="${title ? styles.title : styles.body}"/>`);
    }
    rows.push(`<row r="${r}" ht="${Math.min(409, height)}" customHeight="1">${cells.join('')}</row>`);
    merges.push(`<mergeCell ref="B${r}:${end}${r}"/>`); r += 1;
  };
  add('Observaciones de horario', true);
  add('Inconsistencias del registro en MatchPoint. Tolerancia: hasta 15 minutos. Se conserva la hora original; sólo se ajusta la asignación estadística. Los casos pendientes no se suman.');
  for (const issue of issues) for (const text of issueLines(issue)) add(text);
  xml = xml.replace('</sheetData>', `${rows.join('')}</sheetData>`);
  if (/<mergeCells\b/.test(xml)) xml = xml.replace(/<mergeCells\b([^>]*)>([\s\S]*?)<\/mergeCells>/, (_, attrs, content) => `<mergeCells${attrs.replace(/count="(\d+)"/, (_m, n) => `count="${Number(n) + merges.length}"`)}>${content}${merges.join('')}</mergeCells>`);
  else xml = xml.replace('</sheetData>', `</sheetData><mergeCells count="${merges.length}">${merges.join('')}</mergeCells>`);
  xml = xml.replace(/<dimension ref="([^"]*)"\s*\/>/, (_, ref) => {
    const [first, last = first] = ref.split(':');
    return `<dimension ref="${first}:${last.replace(/\d+$/, String(r - 1))}"/>`;
  });
  return { xml, lastRow: r - 1 };
}
function expandPrintArea(workbookXml, sheetName, lastRow) {
  if (!lastRow) return workbookXml;
  return workbookXml.replace(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g, (whole, attrs, value) => {
    if (attribute(attrs, 'name') !== '_xlnm.Print_Area') return whole;
    const decoded = decode(value);
    if (!decoded.startsWith(`'${sheetName.replace(/'/g, "''")}'!`) && !decoded.startsWith(`${sheetName}!`)) return whole;
    const extended = value.replace(/(\$[A-Z]+\$)(\d+)(?=,|$)/g, (_, prefix, row) => prefix + Math.max(Number(row), lastRow));
    return `<definedName${attrs}>${extended}</definedName>`;
  });
}
module.exports = { issueLines, scheduleLog, noteStyles, appendScheduleNotes, expandPrintArea };
