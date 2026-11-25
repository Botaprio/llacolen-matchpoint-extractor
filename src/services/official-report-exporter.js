'use strict';

const fs = require('node:fs');
const { scheduleLog, noteStyles, appendScheduleNotes, expandPrintArea } = require('./schedule-notes');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  CATALOG,
  TEMPLATE_DIR,
  aggregateAllowedEvents,
  singleMonthInfo
} = require('./report-template');

function loadJsZip() {
  // exceljs already depends on JSZip, and v15 also declares it directly.
  // Lazy loading keeps filter/unit tests independent from the binary export path.
  return require('jszip');
}

function xmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlDecode(value) {
  return String(value ?? '')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function columnLetter(index) {
  let n = Number(index);
  let text = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function normalizeZipPath(base, target) {
  const clean = String(target || '').replace(/^\/+/, '');
  if (clean.startsWith('xl/') || clean.startsWith('ppt/')) return path.posix.normalize(clean);
  return path.posix.normalize(path.posix.join(base, clean));
}

function attr(source, name) {
  const match = String(source).match(new RegExp(`(?:^|\\s)${escapeRegExp(name)}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : '';
}

function workbookSheetPaths(workbookXml, relsXml) {
  const relationships = new Map();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    relationships.set(attr(match[1], 'Id'), attr(match[1], 'Target'));
  }
  const result = new Map();
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const name = attr(match[1], 'name');
    const relId = attr(match[1], 'r:id');
    const target = relationships.get(relId);
    if (name && target) result.set(name, normalizeZipPath('xl', target));
  }
  return result;
}

function replaceCell(xml, ref, innerXml, cellType = null) {
  const escaped = escapeRegExp(ref);
  const full = new RegExp(`<c\\b([^>]*\\br="${escaped}"[^>]*)>([\\s\\S]*?)<\\/c>`);
  const selfClosing = new RegExp(`<c\\b([^>]*\\br="${escaped}"[^>]*)\\/>`);
  const render = (attrs) => {
    let next = String(attrs).replace(/\s+t="[^"]*"/g, '');
    if (cellType) next += ` t="${cellType}"`;
    return `<c${next}>${innerXml}</c>`;
  };
  // Test self-closing cells first. Otherwise the full-cell regex could start at a
  // <c .../> cell and consume through a later </c>, corrupting the worksheet.
  if (selfClosing.test(xml)) return xml.replace(selfClosing, (_all, attrs) => render(attrs));
  if (full.test(xml)) return xml.replace(full, (_all, attrs) => render(attrs));
  throw new Error(`No se encontró la celda ${ref} en la plantilla oficial.`);
}

function setNumericCell(xml, ref, value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  return replaceCell(xml, ref, `<v>${numeric}</v>`);
}

function setFormulaCell(xml, ref, formula, cachedValue) {
  const numeric = Number.isFinite(Number(cachedValue)) ? Number(cachedValue) : 0;
  return replaceCell(xml, ref, `<f>${xmlEscape(String(formula).replace(/^=/, ''))}</f><v>${numeric}</v>`);
}

function setInlineStringCell(xml, ref, value) {
  return replaceCell(xml, ref, `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`, 'inlineStr');
}

function forceWorkbookRecalculation(xml) {
  const attrs = 'calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"';
  if (/<calcPr\b[^>]*\/>/.test(xml)) return xml.replace(/<calcPr\b[^>]*\/>/, `<calcPr ${attrs}/>`);
  if (/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/.test(xml)) return xml.replace(/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/, `<calcPr ${attrs}/>`);
  return xml.replace(/<\/workbook>/, `<calcPr ${attrs}/></workbook>`);
}

function seriesCache(values, formatCode = '0') {
  const count = values.length;
  // null marks a gap (cupo=0 y asistencia=0); no se emite <c:pt> para esa posición
  const points = values
    .map((value, index) => value === null ? '' : `<c:pt idx="${index}"><c:v>${Number(value) || 0}</c:v></c:pt>`)
    .join('');
  return `<c:numCache><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${count}"/>${points}</c:numCache>`;
}

function hideRow(xml, rowNumber) {
  const r = escapeRegExp(String(Number(rowNumber)));
  const re = new RegExp(`(<row\\b[^>]*?\\br="${r}"[^>]*?)(\/?>)`);
  return xml.replace(re, (all, attrs, close) => {
    if (/\bhidden="1"/.test(attrs)) return all;
    return `${attrs} hidden="1"${close}`;
  });
}

function patchSeries(seriesXml, { title, formula = null, values }) {
  let xml = seriesXml;
  const titleXml = `<c:tx><c:v>${xmlEscape(title)}</c:v></c:tx>`;
  if (/<c:tx>[\s\S]*?<\/c:tx>/.test(xml)) xml = xml.replace(/<c:tx>[\s\S]*?<\/c:tx>/, titleXml);

  const numRefMatch = xml.match(/<c:numRef>([\s\S]*?)<\/c:numRef>/);
  if (numRefMatch) {
    let inner = numRefMatch[1];
    if (formula) {
      if (/<c:f>[\s\S]*?<\/c:f>/.test(inner)) inner = inner.replace(/<c:f>[\s\S]*?<\/c:f>/, `<c:f>${xmlEscape(formula)}</c:f>`);
      else inner = `<c:f>${xmlEscape(formula)}</c:f>${inner}`;
    }
    if (/<c:numCache>[\s\S]*?<\/c:numCache>/.test(inner)) inner = inner.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, seriesCache(values));
    else inner += seriesCache(values);
    xml = xml.replace(/<c:numRef>[\s\S]*?<\/c:numRef>/, `<c:numRef>${inner}</c:numRef>`);
  }
  return xml;
}

function replaceFirstTwoSeries(chartXml, configs) {
  let index = 0;
  return chartXml.replace(/<c:ser>([\s\S]*?)<\/c:ser>/g, (all, inner) => {
    if (index >= 2) return all;
    const patched = patchSeries(`<c:ser>${inner}</c:ser>`, configs[index]);
    index += 1;
    return patched;
  });
}

/**
 * Elimina posiciones donde ambos arrays son null y devuelve los índices originales conservados.
 */
function compactNulls(capacities, attendees) {
  const keepIndices = [];
  const caps = [];
  const atts = [];
  for (let i = 0; i < capacities.length; i++) {
    if (capacities[i] !== null || attendees[i] !== null) {
      keepIndices.push(i);
      caps.push(capacities[i] ?? 0);
      atts.push(attendees[i] ?? 0);
    }
  }
  return { capacities: caps, attendees: atts, keepIndices };
}

/**
 * Filtra los <c:pt> de un bloque de categorías (strCache o multiLvlStrCache)
 * conservando sólo los índices en keepIndices y renumerándolos desde 0.
 */
function filterCatSection(xml, keepIndices) {
  if (!keepIndices || keepIndices.length === 0) {
    // Sin datos: vaciar cache pero mantener la referencia de fórmula
    return xml
      .replace(/<c:ptCount val="\d+"\//g, '<c:ptCount val="0"/')
      .replace(/<c:pt idx="\d+">[\s\S]*?<\/c:pt>/g, '');
  }
  const keepSet = new Set(keepIndices);
  const newCount = keepIndices.length;
  let result = xml.replace(/<c:ptCount val="\d+"\/>/g, `<c:ptCount val="${newCount}"/>`);
  if (/<c:lvl>/.test(result)) {
    // multiLvlStrCache: renumerar dentro de cada nivel por separado
    result = result.replace(/<c:lvl>([\s\S]*?)<\/c:lvl>/g, (_all, inner) => {
      let ni = 0;
      return '<c:lvl>' + inner.replace(/<c:pt idx="(\d+)">[\s\S]*?<\/c:pt>/g, (m, idx) => {
        if (!keepSet.has(Number(idx))) return '';
        return m.replace(/idx="\d+"/, `idx="${ni++}"`);
      }) + '</c:lvl>';
    });
  } else {
    // strCache plana
    let ni = 0;
    result = result.replace(/<c:pt idx="(\d+)">[\s\S]*?<\/c:pt>/g, (m, idx) => {
      if (!keepSet.has(Number(idx))) return '';
      return m.replace(/idx="\d+"/, `idx="${ni++}"`);
    });
  }
  return result;
}

const DAY_DISPLAY = new Map([
  ['lunes', 'LUNES'], ['martes', 'MARTES'], ['miercoles', 'MIÉRCOLES'],
  ['jueves', 'JUEVES'], ['viernes', 'VIERNES'], ['sabado', 'SÁBADO'],
  ['sabados', 'SÁBADOS'], ['domingo', 'DOMINGO'],
]);

/**
 * Reconstruye la sección de categorías del gráfico desde el catálogo
 * para que TODAS las barras muestren día + hora, sin depender del cache de la plantilla.
 * Preserva el formato multiLvlStrRef si el XML original lo usaba, emitiendo dos niveles
 * (día en el nivel superior, hora en el inferior) para compatibilidad con PowerPoint.
 */
function rebuildCatCache(catXml, sheet, chart, keepIndices) {
  const isMultiLvl = /<c:multiLvlStrRef\b/.test(catXml);
  const fMatch = catXml.match(/<c:f>([\s\S]*?)<\/c:f>/);
  const fXml = fMatch ? fMatch[0] : '';

  let count = 0;
  let dayPts = '';
  let timePts = '';
  let flatPts = '';

  if (sheet && chart.rowStart != null && keepIndices.length > 0) {
    const rowsByNumber = new Map(sheet.rows.map((r) => [r.row, r]));
    const entries = keepIndices.map((ki, ni) => {
      const row = rowsByNumber.get(chart.rowStart + ki);
      if (!row) return { ni, day: '', time: '' };
      const day = DAY_DISPLAY.get(String(row.day || '').toLowerCase()) || String(row.day || '').toUpperCase();
      const time = row.time ? `${row.time} Hrs.` : '';
      return { ni, day, time };
    });

    count = entries.length;

    if (isMultiLvl) {
      dayPts  = entries.map(({ ni, day })  => `<c:pt idx="${ni}"><c:v>${xmlEscape(day)}</c:v></c:pt>`).join('');
      timePts = entries.map(({ ni, time }) => `<c:pt idx="${ni}"><c:v>${xmlEscape(time)}</c:v></c:pt>`).join('');
    } else {
      flatPts = entries.map(({ ni, day, time }) =>
        `<c:pt idx="${ni}"><c:v>${xmlEscape(time ? `${day} ${time}` : day)}</c:v></c:pt>`
      ).join('');
    }
  }

  if (isMultiLvl) {
    return `<c:multiLvlStrRef>${fXml}<c:multiLvlStrCache>` +
      `<c:ptCount val="${count}"/>` +
      `<c:lvl>${dayPts}</c:lvl>` +
      `<c:lvl>${timePts}</c:lvl>` +
      `</c:multiLvlStrCache></c:multiLvlStrRef>`;
  }
  return `<c:strRef>${fXml}<c:strCache><c:ptCount val="${count}"/>${flatPts}</c:strCache></c:strRef>`;
}

/** Activa la opción de Excel de no trazar datos de filas ocultas. */
function ensurePlotVisOnly(xml) {
  if (/<c:plotVisOnly\b/.test(xml)) {
    return xml.replace(/<c:plotVisOnly\b[^/]*\/>/,  '<c:plotVisOnly val="1"/>');
  }
  return xml.replace(/<c:plotArea>/, '<c:plotVisOnly val="1"/><c:plotArea>');
}

/** Convierte bar3DChart a barChart 2D y suprime las líneas separadoras del eje de categorías. */
function patchBarChartDimension(xml) {
  if (!/<c:bar3DChart\b/.test(xml)) return xml;

  let result = xml
    .replace(/<c:bar3DChart\b/g, '<c:barChart')
    .replace(/<\/c:bar3DChart>/g, '</c:barChart>')
    .replace(/<c:view3D>[\s\S]*?<\/c:view3D>/g, '')
    .replace(/<c:backWall>[\s\S]*?<\/c:backWall>/g, '')
    .replace(/<c:sideWall>[\s\S]*?<\/c:sideWall>/g, '')
    .replace(/<c:floor>[\s\S]*?<\/c:floor>/g, '')
    .replace(/<c:shape\b[^>]*\/>/g, '');

  // <c:noMultiLvlLbl val="1"/> elimina las líneas verticales de agrupación del eje X
  result = result.replace(/(<c:catAx>)([\s\S]*?)(<\/c:catAx>)/g, (_all, open, inner, close) => {
    const patched = /<c:noMultiLvlLbl\b/.test(inner)
      ? inner.replace(/<c:noMultiLvlLbl\b[^/]*\/>/, '<c:noMultiLvlLbl val="1"/>')
      : `${inner}<c:noMultiLvlLbl val="1"/>`;
    return `${open}${patched}${close}`;
  });

  return result;
}

const REPORT_MONTH_YEAR_RE = /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+\d{4}\b/gi;


function caseAwareReplacement(match, replacement) {
  if (!match) return replacement;
  if (match === match.toUpperCase()) return replacement.toUpperCase();
  if (match === match.toLowerCase()) return replacement.toLowerCase();
  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
}

function replaceCaseAware(text, pattern, replacement) {
  return text.replace(pattern, (match) => caseAwareReplacement(match, replacement));
}

/**
 * Normaliza únicamente texto VISIBLE de los informes.
 *
 * Importante: los archivos XLSX/PPTX son OOXML y su XML ya está codificado en
 * UTF-8. Los acentos ausentes detectados en la plantilla no eran un problema de
 * codificación: estaban escritos sin tilde (o con errores ortográficos) en el
 * documento original. Esta función corrige esos textos al exportar, sin cambiar
 * los identificadores internos de hojas usados por el catálogo y el matcher.
 */
function cleanVisibleText(value) {
  let text = String(value ?? '').normalize('NFC');

  // Reparación defensiva por si en el futuro llega una cadena UTF-8 mal decodificada.
  const mojibake = new Map([
    ['Ã¡', 'á'], ['Ã©', 'é'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãº', 'ú'],
    ['Ã', 'Á'], ['Ã‰', 'É'], ['Ã', 'Í'], ['Ã“', 'Ó'], ['Ãš', 'Ú'],
    ['Ã±', 'ñ'], ['Ã‘', 'Ñ'], ['Â¿', '¿'], ['Â¡', '¡']
  ]);
  for (const [bad, good] of mojibake) text = text.replaceAll(bad, good);

  // Errores ortográficos inequívocos de las plantillas originales.
  text = replaceCaseAware(text, /\bfuncinal\b/gi, 'funcional');
  text = replaceCaseAware(text, /\bintencidad\b/gi, 'intensidad');
  text = replaceCaseAware(text, /\binlusiva\b/gi, 'inclusiva');
  text = replaceCaseAware(text, /\bceluar\b/gi, 'celular');

  // Tildes y grafías coherentes en español.
  text = replaceCaseAware(text, /\bmiercoles\b/gi, 'miércoles');
  text = replaceCaseAware(text, /\bsabados\b/gi, 'sábados');
  text = replaceCaseAware(text, /\bsabado\b/gi, 'sábado');
  text = replaceCaseAware(text, /\bfutbol\b/gi, 'fútbol');
  text = replaceCaseAware(text, /\bpadel\b/gi, 'pádel');
  text = replaceCaseAware(text, /\bbasquetbol\b/gi, 'básquetbol');
  text = replaceCaseAware(text, /\bguarderia\b/gi, 'guardería');
  text = replaceCaseAware(text, /\bsicomotricidad\b/gi, 'psicomotricidad');
  text = replaceCaseAware(text, /\bacuaerobica\b/gi, 'acuaeróbica');
  text = replaceCaseAware(text, /\bacuarobica\b/gi, 'acuaeróbica');
  text = replaceCaseAware(text, /\boleo\b/gi, 'óleo');
  text = replaceCaseAware(text, /\bfotografia\b/gi, 'fotografía');
  text = replaceCaseAware(text, /\bceramica\b/gi, 'cerámica');
  text = replaceCaseAware(text, /\bedicion\b/gi, 'edición');
  text = replaceCaseAware(text, /\bterapeutica\b/gi, 'terapéutica');
  text = replaceCaseAware(text, /\breflex\b/gi, 'réflex');
  text = replaceCaseAware(text, /\bmas\b/gi, 'más');

  // Siglas, marcas y nombres de actividades.
  text = text.replace(/\bHiit\b/gi, 'HIIT');
  text = text.replace(/\bHIT(?=\s+entrenamiento de intervalos de alta intensidad)/g, 'HIIT:');
  text = text.replace(/\bHIIT\s+entrenamiento de intervalos de alta intensidad\b/gi, 'HIIT: entrenamiento de intervalos de alta intensidad');
  text = text.replace(/HIIT:\s+entrenamiento/gi, 'HIIT: entrenamiento');
  text = text.replace(/\bcrossfit\b/gi, 'CrossFit');
  text = text.replace(/\btrx\b/gi, 'TRX');
  text = text.replace(/\bRunning\s+kids?\b/gi, 'Running Kids');
  text = text.replace(/\bHatha\s+yoga\b/gi, 'Hatha Yoga');
  text = text.replace(/\bFlow\s+yoga\b/gi, 'Flow Yoga');
  text = text.replace(/\bPower\s+Yoga\s+Para\s+Todos\b/g, 'Power Yoga para Todos');
  text = text.replace(/\bYoga\s+Para\s+Todos\b/g, 'Yoga para Todos');

  // Horarios y pequeños errores de digitación.
  text = text.replace(/\b17:000\s+Hrs\.?/g, '17:00 Hrs.');
  text = text.replace(/\b9:00\s+Hrs\.?/g, '09:00 Hrs.');
  text = text.replace(/\b(\d{2}:\d{2})\s+Hrs\b(?!\.)/g, '$1 Hrs.');

  // Capitalización de encabezados que venían mezclados en la plantilla.
  const trimmed = text.trim();
  const exact = new Map([
    ['Baby fútbol', 'Baby Fútbol'],
    ['Pádel adulto', 'Pádel Adulto'],
    ['americano y Pádel Pro', 'Americano y Pádel Pro'],
    ['Squash ADULTOS', 'Squash Adultos'],
    ['Tenis adulto', 'Tenis Adulto'],
    ['Básquetbol adulto', 'Básquetbol Adulto'],
    ['running', 'Running'],
    ['adulto', 'Adulto'],
    ['menores', 'Menores'],
    ['kids', 'Kids'],
    ['Voleibol adulto', 'Voleibol Adulto'],
    ['Remo Iniciantes adulto', 'Remo Iniciantes Adultos'],
    ['iniciantes adultos', 'Iniciantes Adultos'],
    ['GRUPO ADULTO Mayor', 'Grupo Adulto Mayor'],
    ['aerolocalizado', 'Aerolocalizado'],
    ['box', 'Box'],
    ['zumba', 'Zumba'],
    ['PILATES', 'Pilates'],
    ['PILATES sala 2', 'Pilates Sala 2'],
    ['YOGA', 'Yoga'],
    ['yoga', 'Yoga'],
    ['HIIT', 'HIIT:'],
    ['ENTRENAMIENTO FUNCIONAL FLOW', 'Entrenamiento Funcional Flow'],
    ['Preparación física', 'Preparación Física'],
    ['Baile entretenido', 'Baile Entretenido'],
    ['Gimnasia correctiva', 'Gimnasia Correctiva'],
    ['Básquetbol menores', 'Básquetbol Menores'],
    ['Hockey menores', 'Hockey Menores'],
    ['Squash MENORES', 'Squash Menores'],
    ['Tenis menores', 'Tenis Menores'],
    ['Pádel menores', 'Pádel Menores'],
    ['guardería', 'Guardería'],
    ['CLASES DE', 'Clases de'],
    ['NATACIÓN', 'Natación'],
    ['NATACIÓN menores', 'Natación Menores'],
    ['Tardes entretenidas', 'Tardes Entretenidas'],
    ['karate', 'Karate'],
    ['Fútbol menores', 'Fútbol Menores'],
    ['PSICOMOTRICIDAD INCLUSIVA', 'Psicomotricidad Inclusiva'],
    ['ACUAERÓBICA', 'Acuaeróbica'],
    ['Piscina libre', 'Piscina Libre'],
    ['cocina', 'Cocina'],
    ['Taller de manualidades', 'Taller de Manualidades'],
    ['Baile Español menores', 'Baile Español Menores'],
    ['Baile Español adultas', 'Baile Español Adultas'],
    ['cerámica', 'Cerámica'],
    ['Escuela de invierno', 'Escuela de Invierno']
  ]);
  if (exact.has(trimmed)) {
    const leading = text.match(/^\s*/)?.[0] || '';
    const trailing = text.match(/\s*$/)?.[0] || '';
    text = `${leading}${exact.get(trimmed)}${trailing}`;
  }

  text = text.replace(/\bPádel\s+pro\b/g, 'Pádel Pro');
  text = text.replace(/\bamericano y Pádel Pro\b/g, 'Americano y Pádel Pro');
  text = text.replace(/\bRemo iniciantes adultos\b/gi, 'Remo Iniciantes Adultos');
  text = text.replace(/\bTaller de óleo\b/gi, 'Taller de Óleo');
  text = text.replace(/\bTaller de fotografía\b/gi, 'Taller de Fotografía');
  text = text.replace(/\bTaller de cerámica\b/gi, 'Taller de Cerámica');
  text = text.replace(/\bBaile español\b/gi, 'Baile Español');
  text = text.replace(/\bBaile Español menores\b/g, 'Baile Español Menores');
  text = text.replace(/\bBaile Español adultas\b/g, 'Baile Español Adultas');
  text = text.replace(/\b7\s+Años\s+y\s+más\b/g, '7 años y más');

  return text.normalize('NFC');
}

function patchVisibleTextNodes(xml) {
  return String(xml).replace(/<(a:t|c:v|t)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (all, tag, attrs = '', rawText) => {
    const decoded = xmlDecode(rawText);
    const cleaned = cleanVisibleText(decoded);
    if (cleaned === decoded) return all;
    return `<${tag}${attrs}>${xmlEscape(cleaned)}</${tag}>`;
  });
}

function visibleDrawingText(xml) {
  const values = [];
  for (const match of String(xml).matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) values.push(xmlDecode(match[1]));
  return values.join('');
}

function canonicalChartTitle(rawTitle, label) {
  let text = cleanVisibleText(rawTitle).replace(/\s+/g, ' ').trim();
  text = text.replace(/^Ocupaci[oó]n\s+(?:(?:clases?\s+de|clase)\s+)?/i, '');
  text = text.replace(/^Ocupaci[oó]n\s+/i, '');
  text = text.replace(/^clases?\s+de\s+/i, '');
  text = text.replace(/^SALA DE MUSCULACIÓN/i, 'Sala de Musculación');
  if (text) text = text.charAt(0).toLocaleUpperCase('es-CL') + text.slice(1);
  text = text.replace(/^Básquetbol adultos\b/, 'Básquetbol Adultos');
  text = text.replace(/^Voleibol adultos\b/, 'Voleibol Adultos');
  text = text.replace(/^Preparación física\b/, 'Preparación Física');
  text = text.replace(/^Gimnasia correctiva\b/, 'Gimnasia Correctiva');
  text = text.replace(/^Entrenamiento funcional Flow\b/, 'Entrenamiento Funcional Flow');
  text = text.replace(/^Básquetbol menores\b/, 'Básquetbol Menores');
  text = text.replace(/^Hockey menores\b/, 'Hockey Menores');
  text = text.replace(/^Pádel menores\b/, 'Pádel Menores');
  text = text.replace(/^Tardes entretenidas\b/, 'Tardes Entretenidas');
  text = text.replace(/^Psicomotricidad inclusiva\b/, 'Psicomotricidad Inclusiva');
  text = text.replace(/\s+,/g, ',').replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim();

  // Deja una sola fecha al final y elimina puntuación heredada inconsistente.
  const period = new RegExp(`${escapeRegExp(label)}\\.?$`, 'i');
  if (period.test(text)) text = text.replace(period, label);
  else text = `${text.replace(/[,.\s]+$/, '')}, ${label}`;

  return `Asistentes vs. cupos — ${text}`;
}

function replaceTitleRuns(titleBlock, titleText) {
  let first = true;
  return String(titleBlock).replace(/<a:t(\s[^>]*)?>([\s\S]*?)<\/a:t>/g, (_all, attrs = '') => {
    const value = first ? titleText : '';
    first = false;
    return `<a:t${attrs}>${xmlEscape(value)}</a:t>`;
  });
}

function patchMonthYearAcrossTextRuns(xml, label) {
  return String(xml).replace(/<a:p\b[\s\S]*?<\/a:p>/g, (paragraph) => {
    const nodes = [];
    const textNodeRe = /<a:t(\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
    let match;
    let combined = '';

    while ((match = textNodeRe.exec(paragraph)) !== null) {
      const text = xmlDecode(match[2]);
      nodes.push({
        attrs: match[1] || '',
        text,
        start: combined.length,
        end: combined.length + text.length
      });
      combined += text;
    }

    if (!nodes.length) return paragraph;
    const occurrences = [...combined.matchAll(new RegExp(REPORT_MONTH_YEAR_RE.source, 'gi'))];
    if (!occurrences.length) return paragraph;

    const texts = nodes.map((node) => node.text);
    for (let occurrenceIndex = occurrences.length - 1; occurrenceIndex >= 0; occurrenceIndex -= 1) {
      const occurrence = occurrences[occurrenceIndex];
      const start = occurrence.index;
      const end = start + occurrence[0].length;
      const firstIndex = nodes.findIndex((node) => start >= node.start && start < node.end);
      const lastIndex = nodes.findIndex((node) => end - 1 >= node.start && end - 1 < node.end);
      if (firstIndex < 0 || lastIndex < 0) continue;

      const firstOffset = start - nodes[firstIndex].start;
      const lastOffset = end - nodes[lastIndex].start;
      if (firstIndex === lastIndex) {
        texts[firstIndex] = `${texts[firstIndex].slice(0, firstOffset)}${label}${texts[firstIndex].slice(lastOffset)}`;
        continue;
      }

      texts[firstIndex] = `${texts[firstIndex].slice(0, firstOffset)}${label}`;
      for (let index = firstIndex + 1; index < lastIndex; index += 1) texts[index] = '';
      texts[lastIndex] = texts[lastIndex].slice(lastOffset);
    }

    let nodeIndex = 0;
    return paragraph.replace(textNodeRe, (_all, attrs = '') => {
      const text = texts[nodeIndex] ?? '';
      nodeIndex += 1;
      return `<a:t${attrs}>${xmlEscape(text)}</a:t>`;
    });
  });
}

function patchReportPeriod(xml, label) {
  // Primero cubre los casos normales (un solo nodo XML) y luego los casos
  // donde PowerPoint partió el texto en varios runs, por ejemplo "J" +
  // "unio 2025". De esta forma no queda ninguna fecha visible heredada
  // de la plantilla, independientemente de cómo PowerPoint haya troceado el texto.
  const direct = String(xml).replace(new RegExp(REPORT_MONTH_YEAR_RE.source, 'gi'), label);
  return patchMonthYearAcrossTextRuns(direct, label);
}

function patchChartTitle(chartXml, label) {
  let xml = patchReportPeriod(chartXml, label);
  const titleMatch = xml.match(/<c:title>([\s\S]*?)<\/c:title>/);
  if (!titleMatch) return patchVisibleTextNodes(xml);

  const rawTitle = visibleDrawingText(titleMatch[1]);
  const titleText = canonicalChartTitle(rawTitle, label);
  const patchedBlock = replaceTitleRuns(titleMatch[1], titleText);
  xml = xml.replace(titleMatch[0], `<c:title>${patchedBlock}</c:title>`);
  return patchVisibleTextNodes(xml);
}


function patchKnownChartTemplateDefects(chartXml, chartRef) {
  const xml = String(chartXml);
  // La plantilla original de Flow tenía columnas de porcentaje/promedio (F y H)
  // mezcladas en el eje de categorías. rebuildCatCache ya reemplaza completamente
  // el eje con valores del catálogo, por lo que no se requiere parche adicional aquí.
  // Esta función se conserva para posibles correcciones futuras de otros gráficos.
  void chartRef; // parámetro reservado para comprobaciones futuras
  return xml;
}

function excelFormulaSheetName(sheetName) {
  return `'${String(sheetName).replaceAll("'", "''")}'`;
}

function chartValues(chart, aggregates) {
  const sheet = CATALOG.sheets.find((item) => item.workbook === chart.workbook && item.sheet === chart.sheet);
  if (!sheet || !chart.rowStart || !chart.rowEnd) return { capacities: [], attendees: [], sheet: null };
  const capacities = [];
  const attendees = [];
  for (let row = chart.rowStart; row <= chart.rowEnd; row += 1) {
    const key = `${chart.workbook}|${chart.sheet}|${row}`;
    const agg = aggregates.get(key) || { attendees: 0, capacity: 0, classes: 0 };
    const cap = Number(agg.capacity || 0);
    const att = Number(agg.attendees || 0);
    if (cap === 0 && att === 0) {
      capacities.push(null);
      attendees.push(null);
    } else {
      capacities.push(cap);
      attendees.push(att);
    }
  }
  return { capacities, attendees, sheet };
}

async function patchExcelTemplate(templatePath, destinationPath, workbookName, aggregates, info, scheduleIssues = []) {
  const JSZip = loadJsZip();
  const source = await fsp.readFile(templatePath);
  const zip = await JSZip.loadAsync(source);
  let workbookXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheetPaths = workbookSheetPaths(workbookXml, relsXml);
  const workbookIssues = scheduleIssues.filter((issue) => issue.sheets.some((key) => key.startsWith(workbookName + '|')));
  const styles = workbookIssues.length ? await noteStyles(zip) : null;

  for (const sheet of CATALOG.sheets.filter((item) => item.workbook === workbookName)) {
    const xmlPath = sheetPaths.get(sheet.sheet);
    if (!xmlPath || !zip.file(xmlPath)) throw new Error(`No se encontró la hoja ${sheet.sheet} dentro de ${workbookName}.`);
    let xml = await zip.file(xmlPath).async('string');
    if (/<c\b[^>]*\br="B1"/.test(xml)) xml = setInlineStringCell(xml, 'B1', info.period);
    const m = sheet.metrics;
    for (const row of sheet.rows) {
      const key = `${sheet.workbook}|${sheet.sheet}|${row.row}`;
      const agg = aggregates.get(key) || { attendees: 0, capacity: 0, classes: 0 };
      const r = Number(row.row);
      const attendees = Number(agg.attendees || 0);
      const capacity = Number(agg.capacity || 0);
      const classes = Number(agg.classes || 0);
      const attendeeCol = columnLetter(m.attendees);
      const capacityCol = columnLetter(m.capacity);
      const classesCol = columnLetter(m.classes);
      xml = setNumericCell(xml, `${attendeeCol}${r}`, attendees);
      xml = setNumericCell(xml, `${capacityCol}${r}`, capacity);
      xml = setNumericCell(xml, `${classesCol}${r}`, classes);
      xml = setFormulaCell(xml, `${columnLetter(m.occupancy)}${r}`, `IFERROR(${attendeeCol}${r}/${capacityCol}${r}*100,0)`, capacity ? attendees / capacity * 100 : 0);
      xml = setFormulaCell(xml, `${columnLetter(m.capacity_per_class)}${r}`, `IFERROR(${capacityCol}${r}/${classesCol}${r},0)`, classes ? capacity / classes : 0);
      xml = setFormulaCell(xml, `${columnLetter(m.avg_attendees)}${r}`, `IFERROR(${attendeeCol}${r}/${classesCol}${r},0)`, classes ? attendees / classes : 0);
      if (attendees === 0 && capacity === 0) xml = hideRow(xml, r);
    }
    xml = patchVisibleTextNodes(xml);
    const notes = await appendScheduleNotes(zip, xmlPath, xml, sheet, workbookIssues.filter((issue) => issue.sheets.includes(`${workbookName}|${sheet.sheet}`)), styles);
    workbookXml = expandPrintArea(workbookXml, sheet.sheet, notes.lastRow);
    zip.file(xmlPath, notes.xml);
  }

  // Corrige textos almacenados en sharedStrings/drawings de la plantilla sin
  // tocar los nombres internos de las hojas (que forman parte del contrato del catálogo).
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/(?:sharedStrings\.xml|drawings\/[^/]+\.xml)$/.test(name) || !zip.file(name)) continue;
    let xml = await zip.file(name).async('string');
    if (name === 'xl/sharedStrings.xml') {
      // Reemplaza cualquier variante del texto de período de la plantilla con el período real.
      // Cubre todas las hojas independientemente de en qué celda esté el encabezado.
      xml = xml.replace(/Periodo desde el [^<]*/gi, info.period);
    }
    zip.file(name, patchVisibleTextNodes(xml));
  }

  for (const chart of CATALOG.excelCharts.filter((item) => item.workbook === workbookName)) {
    if (!zip.file(chart.chartPath)) continue;
    const values = chartValues(chart, aggregates);
    if (!values.sheet) continue;
    const m = values.sheet.metrics;
    const quotedSheet = excelFormulaSheetName(chart.sheet);
    const capacitiesFormula = `${quotedSheet}!$${columnLetter(m.capacity)}$${chart.rowStart}:$${columnLetter(m.capacity)}$${chart.rowEnd}`;
    const attendeesFormula = `${quotedSheet}!$${columnLetter(m.attendees)}$${chart.rowStart}:$${columnLetter(m.attendees)}$${chart.rowEnd}`;
    let xml = await zip.file(chart.chartPath).async('string');
    xml = replaceFirstTwoSeries(xml, [
      { title: 'Cupos', formula: capacitiesFormula, values: values.capacities },
      { title: 'Asistentes', formula: attendeesFormula, values: values.attendees }
    ]);
    xml = patchKnownChartTemplateDefects(xml, chart);
    xml = patchChartTitle(xml, info.label);
    xml = ensurePlotVisOnly(xml);
    zip.file(chart.chartPath, xml);
  }

  workbookXml = forceWorkbookRecalculation(workbookXml);
  zip.file('xl/workbook.xml', workbookXml);
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await fsp.writeFile(destinationPath, output);
  return destinationPath;
}

function excelChartKey(ref) {
  return `${ref.workbook}|${ref.sheet}|${ref.index}`;
}

async function patchPowerPointTemplate(templatePath, destinationPath, aggregates, info) {
  const JSZip = loadJsZip();
  const source = await fsp.readFile(templatePath);
  const zip = await JSZip.loadAsync(source);
  const chartLookup = new Map(CATALOG.excelCharts.map((chart) => [excelChartKey(chart), chart]));

  for (const name of Object.keys(zip.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      let xml = await zip.file(name).async('string');
      xml = patchReportPeriod(xml, info.label);
      xml = patchVisibleTextNodes(xml);
      zip.file(name, xml);
    }
  }

  for (const pptChart of CATALOG.pptCharts) {
    if (!pptChart.excelChart || !zip.file(pptChart.chartPath)) continue;
    const excelChart = chartLookup.get(excelChartKey(pptChart.excelChart));
    if (!excelChart) continue;
    const values = chartValues(excelChart, aggregates);
    const { capacities, attendees, keepIndices } = compactNulls(values.capacities, values.attendees);
    let xml = await zip.file(pptChart.chartPath).async('string');
    xml = replaceFirstTwoSeries(xml, [
      { title: 'Cupos', values: capacities },
      { title: 'Asistentes', values: attendees }
    ]);
    xml = patchKnownChartTemplateDefects(xml, excelChart);
    // Reconstruye el eje de categorías desde el catálogo: día + hora completos en cada barra
    xml = xml.replace(/<c:cat>([\s\S]*?)<\/c:cat>/g, (_all, inner) => `<c:cat>${rebuildCatCache(inner, values.sheet, excelChart, keepIndices)}</c:cat>`);
    xml = patchChartTitle(xml, info.label);
    xml = patchBarChartDimension(xml);
    zip.file(pptChart.chartPath, xml);
  }

  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await fsp.writeFile(destinationPath, output);
  return destinationPath;
}

function prepareOfficialDataset(runData, selectedActivities = []) {
  const info = singleMonthInfo(runData?.run);
  const filtered = aggregateAllowedEvents(runData?.events || [], selectedActivities);
  return { info, ...filtered };
}

async function exportOfficialExcelSet({ runData, destinationDir, selectedActivities = [] }) {
  const dataset = prepareOfficialDataset(runData, selectedActivities);
  await fsp.mkdir(destinationDir, { recursive: true });
  const files = [];
  for (const fileName of CATALOG.excelFiles) {
    const templatePath = path.join(TEMPLATE_DIR, fileName);
    const destinationPath = path.join(destinationDir, fileName);
    await patchExcelTemplate(templatePath, destinationPath, fileName, dataset.aggregates, dataset.info, dataset.scheduleIssues);
    files.push(destinationPath);
  }
  const logPath = path.join(destinationDir, `Inconsistencias-horarios-${dataset.info.year}-${String(dataset.info.month).padStart(2, '0')}.txt`);
  await fsp.writeFile(logPath, scheduleLog(dataset, runData.run, selectedActivities), 'utf8');
  return { ...dataset, files, logPath };
}

async function exportOfficialPresentation({ runData, destination, selectedActivities = [] }) {
  const dataset = prepareOfficialDataset(runData, selectedActivities);
  const templatePath = path.join(TEMPLATE_DIR, CATALOG.powerPointTemplate);
  await patchPowerPointTemplate(templatePath, destination, dataset.aggregates, dataset.info);
  return { ...dataset, filePath: destination };
}

module.exports = {
  prepareOfficialDataset,
  exportOfficialExcelSet,
  exportOfficialPresentation,
  // exported for unit tests
  patchChartTitle,
  cleanVisibleText,
  patchVisibleTextNodes,
  canonicalChartTitle,
  patchKnownChartTemplateDefects,
  patchReportPeriod,
  patchMonthYearAcrossTextRuns,
  replaceFirstTwoSeries,
  chartValues
};
