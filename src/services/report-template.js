'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE_DIR = path.join(__dirname, '..', 'assets', 'report-templates');
const CATALOG_PATH = path.join(TEMPLATE_DIR, 'template-catalog.json');
const CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

const MONTHS_ES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTime(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/\b(\d{1,2})\s*[:.]\s*(\d{2})(?:\d)?\b/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function normalizeDay(value) {
  const text = normalizeText(value);
  if (text === 'sabados') return 'sabado';
  return text;
}

function tokenSet(value) {
  const stop = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'para', 'clase', 'clases',
    'hrs', 'hr', 'anos', 'ano', 'adulto', 'adultos', 'menor', 'menores'
  ]);
  return new Set(normalizeText(value).split(' ').filter((token) => token.length > 1 && !stop.has(token)));
}


function matchTokenSet(value) {
  const stop = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'para', 'clase', 'clases',
    'hrs', 'hr', 'anos', 'ano', 'adulto', 'adultos', 'menor', 'menores'
  ]);
  return new Set(normalizeText(value).split(' ').filter((token) => token && !stop.has(token)));
}

function safeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function parseIsoDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3]) ? null : date;
}

function dayFromIsoDate(value) {
  const date = parseIsoDate(value);
  return date ? WEEKDAYS_ES[date.getUTCDay()] : '';
}

function monthLabel(month, year) {
  return `${MONTHS_ES[Number(month)]} ${Number(year)}`;
}

function periodLabel(dateFrom, dateTo) {
  const from = parseIsoDate(dateFrom);
  const to = parseIsoDate(dateTo);
  if (!from || !to) return '';
  const fromMonth = MONTHS_ES[from.getUTCMonth() + 1];
  const toMonth = MONTHS_ES[to.getUTCMonth() + 1];
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    return `Periodo desde el ${from.getUTCDate()} hasta el ${to.getUTCDate()} de ${toMonth} del ${to.getUTCFullYear()}.`;
  }
  return `Periodo desde el ${from.getUTCDate()} de ${fromMonth} del ${from.getUTCFullYear()} hasta el ${to.getUTCDate()} de ${toMonth} del ${to.getUTCFullYear()}.`;
}

function singleMonthInfo(run) {
  if (!run) throw new Error('No se encontró la extracción seleccionada.');
  const from = parseIsoDate(run.date_from);
  const to = parseIsoDate(run.date_to);
  if (!from || !to) throw new Error('La extracción tiene un rango de fechas inválido.');
  if (from.getUTCFullYear() !== to.getUTCFullYear() || from.getUTCMonth() !== to.getUTCMonth()) {
    throw new Error('Los Excel y el PowerPoint oficiales son informes mensuales. Selecciona una extracción contenida en un solo mes.');
  }
  return {
    month: from.getUTCMonth() + 1,
    year: from.getUTCFullYear(),
    label: monthLabel(from.getUTCMonth() + 1, from.getUTCFullYear()),
    period: periodLabel(run.date_from, run.date_to)
  };
}

const SHEET_HINTS = new Map(Object.entries({
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Baby Fútbol': ['baby futbol', 'futbol damas', 'super senior', 'senior honor'],
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Pádel': ['padel adulto', 'padel americanos', 'padel americano', 'padel pro', 'clases de padel'],
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Squash': ['squash adulto', 'squash adultos'],
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Tenis': ['tenis adulto', 'tenis adultos'],
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Básquetbol': ['basquetbol adulto', 'basquetbol senior', 'basquet senior', 'basquetbol honor'],
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Runners': ['running adulto', 'running'],
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Voleibol': ['voleibol adulto', 'voleibol'],
  'ACTIVIDADES DEPORTIVAS Lista.xlsx|Remo': ['remo iniciantes', 'remo adulto', 'remo'],

  'Actividades Fitness lista.xlsx|Musculación': ['musculacion', 'sala de musculacion'],
  'Actividades Fitness lista.xlsx|Spinning': ['spinning'],
  'Actividades Fitness lista.xlsx|Crossfit': ['crossfit'],
  'Actividades Fitness lista.xlsx|Preparación física': ['preparacion fisica'],
  'Actividades Fitness lista.xlsx|Baile entretenido': ['baile entretenido'],
  'Actividades Fitness lista.xlsx|Zumba': ['zumba'],
  'Actividades Fitness lista.xlsx|Gimnasia correctiva': ['gimnasia correctiva'],
  'Actividades Fitness lista.xlsx|GAM': ['gimnasia adulto mayor', 'grupo adulto mayor'],
  'Actividades Fitness lista.xlsx|Aerolocalizado': ['aerolocalizado'],
  'Actividades Fitness lista.xlsx|HIT': ['hiit', 'hit entrenamiento', 'intervalos de alta intensidad'],
  'Actividades Fitness lista.xlsx|Box': ['box', 'boxeo'],
  'Actividades Fitness lista.xlsx|TRX': ['trx', 'trx strong'],
  'Actividades Fitness lista.xlsx|Pilates': ['estudio pilates plus', 'pilates plus', 'pilates'],
  'Actividades Fitness lista.xlsx|Pilates sala 2': ['pilates sala 2', 'estudio pilates sala 2'],
  'Actividades Fitness lista.xlsx|Yoga': ['yoga'],
  'Actividades Fitness lista.xlsx|Flow': ['entrenamiento funcional flow', 'funcional flow', 'flow'],

  'Actividades Inclusivas lista.xlsx|Sicomotricidad': ['sicomotricidad inclusiva', 'psicomotricidad inclusiva'],

  'Actividades Menores lista.xlsx|Básquetbol': ['basquetbol menores', 'basquet menores', 'u7', 'u9', 'u11', 'u13', 'u15'],
  'Actividades Menores lista.xlsx|Hockey': ['hockey menores', 'hockey'],
  'Actividades Menores lista.xlsx|Squash': ['squash menores'],
  'Actividades Menores lista.xlsx|Tenis': ['tenis menores'],
  'Actividades Menores lista.xlsx|Pádel': ['padel menores'],
  'Actividades Menores lista.xlsx|Guardería': ['guarderia', 'psicomotricidad'],
  'Actividades Menores lista.xlsx|Running': ['running kid', 'running kids'],
  'Actividades Menores lista.xlsx|Natación': ['natacion menores'],
  'Actividades Menores lista.xlsx|Tarde entre': ['tardes entretenidas', 'tarde entretenida'],
  'Actividades Menores lista.xlsx|Karate': ['karate menores', 'karate'],
  'Actividades Menores lista.xlsx|Futbol Menores': ['futbol menores', 'futbol sub'],

  'Escuela de Invierno.xlsx|Esc de Invierno': ['escuela de invierno'],

  'Otras Actividades LISTA.xlsx|Cocina': ['taller de cocina', 'cocina'],
  'Otras Actividades LISTA.xlsx|Oleo': ['taller de oleo', 'oleo'],
  'Otras Actividades LISTA.xlsx|Manualidades': ['taller de manualidades', 'manualidades'],
  'Otras Actividades LISTA.xlsx|Fotografia': ['taller de fotografia', 'fotografia'],
  'Otras Actividades LISTA.xlsx|Baile Español': ['baile espanol'],
  'Otras Actividades LISTA.xlsx|Ceramica': ['taller de ceramica', 'ceramica'],

  'Piscina Temperada lista.xlsx|Acuaerobica': ['acuaerobica', 'acuarobica'],
  'Piscina Temperada lista.xlsx|Clases de natación': ['natacion adultos', 'clases de natacion', 'natacion adulto'],
  'Piscina Temperada lista.xlsx|Piscina Libre': ['piscina libre']
}));

const SHEETS = CATALOG.sheets.map((sheet) => ({
  ...sheet,
  key: `${sheet.workbook}|${sheet.sheet}`,
  normalizedHints: (SHEET_HINTS.get(`${sheet.workbook}|${sheet.sheet}`) || []).map(normalizeText),
  rows: sheet.rows.map((row) => ({ ...row, groupTokenSet: new Set(row.groupTokens || []), matchTokenSet: new Set(row.matchTokens || row.groupTokens || []) }))
}));

function protectFamilyCollision(sheet, eventNameNorm) {
  if (sheet.workbook === 'Actividades Menores lista.xlsx' && /(adulto|adultos|senior|honor)/.test(eventNameNorm)) return false;
  if (sheet.workbook === 'ACTIVIDADES DEPORTIVAS Lista.xlsx' && /(menores|\bkid\b|\bkids\b|sub 6|sub 8|sub 10|sub 12|sub 14|sub 16|\bu7\b|\bu9\b|\bu11\b|\bu13\b|\bu15\b)/.test(eventNameNorm)) return false;
  if (sheet.sheet === 'Pilates' && /sala 2/.test(eventNameNorm)) return false;
  if (sheet.sheet === 'Pilates sala 2' && !/sala 2/.test(eventNameNorm)) return false;
  if (sheet.workbook === 'Piscina Temperada lista.xlsx' && sheet.sheet === 'Clases de natación' && /menores/.test(eventNameNorm) && !/adultos?/.test(eventNameNorm)) return false;
  return true;
}

function familyCandidates(eventName) {
  const eventNameNorm = normalizeText(eventName);
  if (!eventNameNorm) return [];
  return SHEETS.filter((sheet) => {
    if (!protectFamilyCollision(sheet, eventNameNorm)) return false;
    if (sheet.normalizedHints.some((hint) => hint && (eventNameNorm.includes(hint) || hint.includes(eventNameNorm)))) return true;
    const familyNorm = normalizeText(sheet.rows[0]?.familyText || sheet.sheet);
    return Boolean(familyNorm && (eventNameNorm.includes(familyNorm) || familyNorm.includes(eventNameNorm)));
  });
}

function makeSourceRecord(raw) {
  return {
    raw,
    eventName: String(raw.activity_name ?? raw.event_name ?? raw.actividad ?? raw.activity ?? raw.nombre ?? raw.title ?? raw.evento ?? '').trim(),
    eventDate: String(raw.event_date ?? raw.date ?? raw.fecha ?? '').trim(),
    day: normalizeDay(raw.day ?? raw.dia ?? raw.weekday ?? dayFromIsoDate(raw.event_date ?? raw.date ?? raw.fecha)),
    time: normalizeTime(raw.start_time ?? raw.hora ?? raw.horario ?? raw.time ?? raw.inicio),
    attendees: safeInteger(raw.attendees ?? raw.inscritos ?? raw.asistentes ?? raw.participant_count ?? raw.participants ?? raw.enrolled, 0),
    capacity: safeInteger(raw.capacity ?? raw.cupo ?? raw.cupos ?? raw.plazas, 0),
    classCount: Math.max(1, safeInteger(raw.class_count ?? raw.cantidad_clases ?? raw.classes, 1)),
    contextText: [raw.activity_name, raw.view_names, raw.resource_name, raw.location].filter(Boolean).join(' ')
  };
}

function matchSourceRecord(raw) {
  const src = makeSourceRecord(raw);
  if (!src.eventName) return { matched: false, reason: 'NO_EVENT_NAME', source: src };
  if (!src.day || !src.time) return { matched: false, reason: 'NO_DAY_OR_TIME', source: src };

  const families = familyCandidates(src.eventName);
  if (!families.length) return { matched: false, reason: 'NOT_IN_TEMPLATE_FAMILIES', source: src };

  const sourceTokens = matchTokenSet(`${src.eventName} ${src.contextText}`);
  const scored = [];
  for (const sheet of families) {
    for (const row of sheet.rows) {
      if (row.day !== src.day || row.time !== src.time) continue;
      let overlap = 0;
      for (const token of sourceTokens) if (row.matchTokenSet.has(token)) overlap += 1;
      const union = new Set([...sourceTokens, ...row.matchTokenSet]).size;
      const score = 1 + overlap * 0.35 + overlap / Math.max(1, union);
      scored.push({ score, sheet, row });
    }
  }
  if (!scored.length) return { matched: false, reason: 'NO_TEMPLATE_ROW_FOR_DAY_TIME', source: src };

  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1 && Math.abs(scored[0].score - scored[1].score) < 0.15) {
    const first = [...scored[0].row.matchTokenSet].sort().join('|');
    const second = [...scored[1].row.matchTokenSet].sort().join('|');
    if (first !== second) return { matched: false, reason: 'AMBIGUOUS_TEMPLATE_ROW', source: src };
  }
  return { matched: true, source: src, sheet: scored[0].sheet, row: scored[0].row, score: scored[0].score };
}

// La hora original se conserva. Sólo cambia la asignación a la plantilla.
const TIME_TOLERANCE_MINUTES = 15;
function minutes(time) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
function templateKey(result) { return `${result.sheet.workbook}|${result.sheet.sheet}|${result.row.row}`; }
function nearTimeMatch(exact) {
  if (exact.reason !== 'NO_TEMPLATE_ROW_FOR_DAY_TIME') return exact;
  const src = exact.source;
  const tokens = matchTokenSet(`${src.eventName} ${src.contextText}`);
  const candidates = [];
  for (const sheet of familyCandidates(src.eventName)) {
    for (const row of sheet.rows) {
      if (row.day !== src.day) continue;
      const delta = minutes(row.time) - minutes(src.time);
      if (!delta || Math.abs(delta) > TIME_TOLERANCE_MINUTES) continue;
      const overlap = [...tokens].filter((token) => row.matchTokenSet.has(token)).length;
      const score = 1 + overlap * 0.35 + overlap / Math.max(1, new Set([...tokens, ...row.matchTokenSet]).size);
      candidates.push({ sheet, row, delta, score });
    }
  }
  if (!candidates.length) return { ...exact, candidates, reason: 'NO_NEARBY_TIME' };
  const bestScore = Math.max(...candidates.map((item) => item.score));
  const best = candidates.filter((item) => bestScore - item.score < 0.15)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  if (best.length > 1 && Math.abs(best[0].delta) === Math.abs(best[1].delta)) {
    return { ...exact, candidates: best, reason: 'AMBIGUOUS_NEARBY_TIME' };
  }
  if (!parseIsoDate(src.eventDate)) return { ...exact, candidates: best, reason: 'MISSING_EVENT_DATE' };
  return { matched: true, source: src, ...best[0], candidates: best, adjusted: true };
}

const TIME_REASONS = {
  NO_NEARBY_TIME: 'No hay un horario compatible del mismo día a 15 minutos o menos.',
  AMBIGUOUS_NEARBY_TIME: 'Hay horarios igualmente cercanos; se requiere revisión.',
  TIME_SLOT_OCCUPIED: 'Otra clase ya está asignada a esa fecha y fila; no se sumó otra vez.',
  COMPETING_TIME_RECORDS: 'Varias clases distintas compiten por la misma fecha y fila; se requiere revisión.',
  ALREADY_ASSIGNED: 'El mismo ID y fecha ya fueron contabilizados; se evitó duplicarlo.',
  CONFLICTING_TIME_RECORDS: 'El mismo ID y fecha tiene registros contradictorios; se requiere revisión.',
  MISSING_EVENT_DATE: 'Falta una fecha válida para comprobar que la clase no esté asignada.',
  NO_DAY_OR_TIME: 'Falta día u hora válida para asignar la clase.',
  AMBIGUOUS_TEMPLATE_ROW: 'Hay más de una correspondencia de actividad en la plantilla.'
};

function aggregateAllowedEvents(events, selectedActivities = []) {
  const selected = new Set((Array.isArray(selectedActivities) ? selectedActivities : []).filter(Boolean));
  const records = (events || []).map((raw, index) => ({ raw, index, result: matchSourceRecord(raw) }));
  const identity = (record) => record.raw.matchpoint_event_id != null && String(record.raw.matchpoint_event_id).trim() !== '' && record.result.source.eventDate
    ? `${record.result.source.eventDate}|${record.raw.matchpoint_event_id}` : `index:${record.index}`;
  const identities = new Map();
  for (const record of records) {
    const key = identity(record);
    if (!identities.has(key)) identities.set(key, []);
    identities.get(key).push(record);
  }
  for (const group of identities.values()) {
    if (group.length < 2) continue;
    const exact = group.find((record) => record.result.matched);
    const same = group.every((record) => ['activity_name', 'start_time', 'attendees', 'capacity'].every((key) => record.raw[key] === group[0].raw[key]));
    const winner = exact || (same ? group[0] : null);
    for (const record of group) if (record !== winner) {
      record.result = { ...record.result, matched: false, reason: winner ? 'ALREADY_ASSIGNED' : 'CONFLICTING_TIME_RECORDS',
        candidates: winner?.result.matched ? [winner.result] : [] };
    }
  }
  const occupied = new Set();
  const slotKey = (result) => `${result.source.eventDate}|${templateKey(result)}`;
  for (const record of records) if (record.result.matched) occupied.add(slotKey(record.result));
  const proposed = new Map();
  for (const record of records) {
    if (record.result.matched) continue;
    record.result = nearTimeMatch(record.result);
    if (!record.result.matched) continue;
    const key = slotKey(record.result);
    if (occupied.has(key)) record.result = { ...record.result, matched: false, reason: 'TIME_SLOT_OCCUPIED' };
    else {
      if (!proposed.has(key)) proposed.set(key, []);
      proposed.get(key).push(record);
    }
  }
  for (const group of proposed.values()) if (group.length > 1) {
    for (const record of group) record.result = { ...record.result, matched: false, reason: 'COMPETING_TIME_RECORDS' };
  }
  const accepted = [], excluded = [], scheduleIssues = [];
  const aggregates = new Map(), resolutions = new Map();
  for (const { raw, result } of records) {
    resolutions.set(raw, result);
    if (selected.size && !selected.has(raw.activity_name)) continue;
    if ((result.matched && result.adjusted) || (!result.matched && TIME_REASONS[result.reason] && familyCandidates(result.source.eventName).length)) {
      const targets = result.sheet ? [result] : result.candidates || [];
      scheduleIssues.push({ raw, status: result.matched ? 'APLICADO' : 'PENDIENTE', reason: result.matched
        ? 'Desfase de horario en MatchPoint. Se asignó al horario compatible más cercano de la plantilla.' : TIME_REASONS[result.reason],
        code: result.matched ? 'TIME_ADJUSTED' : result.reason,
        date: result.source.eventDate, activity: result.source.eventName,
        eventId: raw.matchpoint_event_id ?? raw.id ?? '', originalTime: result.source.time || String(raw.start_time ?? ''),
        assignedTime: result.matched ? result.row.time : '', delta: result.matched ? result.delta : null,
        attendees: raw.attendees ?? null, capacity: raw.capacity ?? null,
        targets: targets.map((item) => ({ workbook: item.sheet.workbook, sheet: item.sheet.sheet, row: item.row.row, time: item.row.time })),
        sheets: targets.length ? targets.map((item) => item.sheet.key) : familyCandidates(result.source.eventName).map((sheet) => sheet.key)
      });
    }
    if (!result.matched) { excluded.push({ ...raw, _exclude_reason: result.reason }); continue; }
    const key = templateKey(result);
    const current = aggregates.get(key) || { attendees: 0, capacity: 0, classes: 0 };
    current.attendees += Math.max(0, result.source.attendees);
    current.capacity += Math.max(0, result.source.capacity);
    current.classes += Math.max(1, result.source.classCount);
    aggregates.set(key, current);
    accepted.push({ ...raw, _template_workbook: result.sheet.workbook, _template_sheet: result.sheet.sheet,
      _template_row: result.row.row, _template_descriptor: result.row.descriptor,
      _template_time: result.row.time, _time_adjustment_minutes: result.adjusted ? result.delta : 0 });
  }
  scheduleIssues.sort((a, b) => a.date.localeCompare(b.date) || a.originalTime.localeCompare(b.originalTime) || String(a.eventId).localeCompare(String(b.eventId)));
  return { accepted, excluded, aggregates, resolutions, scheduleIssues,
    adjustedCount: scheduleIssues.filter((item) => item.status === 'APLICADO').length };
}

function filteredAnalysis(runData, selectedActivities = []) {
  if (!runData?.run) throw new Error('No se encontró la extracción.');
  const { accepted, excluded, adjustedCount, scheduleIssues } = aggregateAllowedEvents(runData.events, selectedActivities);
  const groups = new Map();
  for (const event of accepted) {
    const name = event.activity_name || event._template_sheet;
    const item = groups.get(name) || { activity_name: name, events: 0, attendees: 0, capacity: 0, occupancy_pct: 0 };
    item.events += 1;
    item.attendees += safeInteger(event.attendees, 0);
    item.capacity += Math.max(0, safeInteger(event.capacity, 0));
    groups.set(name, item);
  }
  const activities = [...groups.values()].map((item) => ({
    ...item,
    occupancy_pct: item.capacity ? 100 * item.attendees / item.capacity : 0
  })).sort((a, b) => b.attendees - a.attendees || a.activity_name.localeCompare(b.activity_name, 'es'));
  const totals = activities.reduce((acc, item) => ({
    events: acc.events + item.events,
    attendees: acc.attendees + item.attendees,
    capacity: acc.capacity + item.capacity
  }), { events: 0, attendees: 0, capacity: 0 });
  totals.occupancyPct = totals.capacity ? 100 * totals.attendees / totals.capacity : 0;
  return {
    run: runData.run,
    label: `${runData.run.date_from} al ${runData.run.date_to}`,
    totals,
    activities,
    acceptedCount: accepted.length,
    adjustedCount, scheduleIssues,
    excludedCount: excluded.length,
    excluded
  };
}

module.exports = {
  CATALOG,
  SHEETS,
  TEMPLATE_DIR,
  normalizeText,
  normalizeTime,
  monthLabel,
  periodLabel,
  singleMonthInfo,
  matchSourceRecord,
  TIME_TOLERANCE_MINUTES, TIME_REASONS,
  aggregateAllowedEvents,
  filteredAnalysis
};
