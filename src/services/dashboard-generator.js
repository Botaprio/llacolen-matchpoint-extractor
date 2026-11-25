'use strict';

const { CATALOG, aggregateAllowedEvents } = require('./report-template');

const WORKBOOK_META = {
  'ACTIVIDADES DEPORTIVAS Lista.xlsx': { label: 'Actividades Deportivas', color: '#004a87', bg: '#e8f0f8' },
  'Actividades Fitness lista.xlsx':    { label: 'Fitness',                color: '#1a7abf', bg: '#e8f3fa' },
  'Actividades Inclusivas lista.xlsx': { label: 'Inclusivas',             color: '#5b9bd5', bg: '#eef4fc' },
  'Actividades Menores lista.xlsx':    { label: 'Actividades Menores',    color: '#2d9e6b', bg: '#e8f6ef' },
  'Escuela de Invierno.xlsx':          { label: 'Escuela de Invierno',    color: '#1c7c3e', bg: '#e6f5ec' },
  'Otras Actividades LISTA.xlsx':      { label: 'Otras Actividades',      color: '#9c5e00', bg: '#faf3e5' },
  'Piscina Temperada lista.xlsx':      { label: 'Piscina Temperada',      color: '#0077b6', bg: '#e5f3fa' },
};

const DAY_LABELS = {
  lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue',
  viernes: 'Vie', sabado: 'Sáb', sabados: 'Sáb', domingo: 'Dom'
};
const DAY_FULL = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', sabados: 'Sábados', domingo: 'Domingo'
};
const MONTHS_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function monthKey(dateFrom) {
  if (!dateFrom || dateFrom.length < 7) return null;
  const [y, m] = dateFrom.split('-');
  return `${y}-${m}`;
}

function monthLabel(dateFrom) {
  if (!dateFrom || dateFrom.length < 7) return dateFrom || '?';
  const [y, m] = dateFrom.split('-').map(Number);
  return `${MONTHS_ES[m] || m} ${y}`;
}

function escHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function occupancyClass(pct) {
  if (pct >= 90) return 'occ-high';
  if (pct >= 70) return 'occ-mid';
  if (pct >= 40) return 'occ-low';
  return 'occ-empty';
}

function passwordGateFrag() {
  return `<style>
#_pg{position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#0b2941 0%,#1a4a6b 100%);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;}
#_pb{background:#fff;border-radius:18px;padding:44px 40px 36px;width:340px;max-width:92vw;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.45);}
#_pb h2{color:#004a87;font-size:1.15rem;font-weight:700;margin:0 0 6px;}
#_pb p{color:#4a6280;font-size:.88rem;margin:0 0 22px;line-height:1.45;}
#_pi{width:100%;padding:12px 14px;border:1.5px solid #c8d8e2;border-radius:9px;font-size:1rem;color:#1c2b36;outline:none;box-sizing:border-box;transition:border-color .15s;}
#_pi:focus{border-color:#1a7abf;box-shadow:0 0 0 3px rgba(26,122,191,.15);}
#_pi.shake{animation:_shk .4s;}
@keyframes _shk{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
#_pbtn{margin-top:12px;width:100%;padding:12px;background:#004a87;color:#fff;border:none;border-radius:9px;font-size:1rem;font-weight:700;cursor:pointer;transition:background .15s;}
#_pbtn:hover{background:#1a7abf;}
#_pe{color:#b84343;font-size:.85rem;margin-top:10px;min-height:1.2em;}
#_pg.fade-out{animation:_fo .4s forwards;}
@keyframes _fo{to{opacity:0;pointer-events:none;}}
</style>
<div id="_pg">
  <div id="_pb">
    <h2>🔒 Dashboard Estadísticas</h2>
    <p>Llacolén Campos Deportivos<br>Ingresa la clave de acceso para continuar.</p>
    <input id="_pi" type="password" placeholder="Clave de acceso" autocomplete="current-password" autofocus>
    <button id="_pbtn">Ingresar</button>
    <div id="_pe"></div>
  </div>
</div>
<script>
(function(){
  var gate=document.getElementById('_pg'),inp=document.getElementById('_pi'),
      btn=document.getElementById('_pbtn'),err=document.getElementById('_pe');
  function unlock(){gate.classList.add('fade-out');setTimeout(function(){gate.remove();},420);}
  function tryPass(){
    if(inp.value==='vivaldi2026'){unlock();}
    else{
      err.textContent='Clave incorrecta.';
      inp.classList.remove('shake');void inp.offsetWidth;inp.classList.add('shake');
      inp.value='';inp.focus();
    }
  }
  btn.addEventListener('click',tryPass);
  inp.addEventListener('keydown',function(e){if(e.key==='Enter')tryPass();});
})();
<\/script>`;
}

/**
 * Extracts a human-readable division/group from a slot descriptor.
 * Descriptor format: "ACTIVITY | DIVISION | TIME | DAY" (pipe-delimited).
 * Returns '' when there is no division (e.g., simple activities like Spinning).
 */
function parseDescriptorDivision(descriptor) {
  if (!descriptor) return '';
  const parts = descriptor.split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return '';
  const isTime = s => /^\d{1,2}:\d{2}$/.test(s);
  const isDayName = s => /^(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bados?|domingo)$/i
    .test(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  // Skip first part (activity family) and collect non-time, non-day parts as division
  const divParts = parts.slice(1).filter(p => !isTime(p) && !isDayName(p));
  return divParts.join(' \xB7 ');
}

/**
 * Processes a single run's data into a structured stats object for the dashboard.
 */
function buildRunStats(runData) {
  const { run } = runData;
  if (!run) return null;

  const { aggregates } = aggregateAllowedEvents(runData.events || []);

  const categories = [];
  let totalAttendees = 0;
  let totalCapacity = 0;
  let totalClasses = 0;

  for (const workbook of CATALOG.excelFiles) {
    const meta = WORKBOOK_META[workbook] || { label: workbook, color: '#666', bg: '#f5f5f5' };
    const workbookSheets = CATALOG.sheets.filter((s) => s.workbook === workbook);
    if (!workbookSheets.length) continue;

    const activities = [];
    let catAtt = 0; let catCap = 0; let catCls = 0;

    for (const sheet of workbookSheets) {
      const slots = [];
      let actAtt = 0; let actCap = 0; let actCls = 0;

      for (const row of sheet.rows) {
        const key = `${workbook}|${sheet.sheet}|${row.row}`;
        const agg = aggregates.get(key);
        if (!agg || (agg.attendees === 0 && agg.capacity === 0)) continue;

        const att = Number(agg.attendees) || 0;
        const cap = Number(agg.capacity) || 0;
        const cls = Math.max(1, Number(agg.classes) || 1);
        const pct = cap > 0 ? Math.round(1000 * att / cap) / 10 : 0;

        slots.push({
          row: row.row,
          day: row.day || '',
          dayShort: DAY_LABELS[row.day] || (row.day || '').slice(0, 3),
          dayFull: DAY_FULL[row.day] || row.day || '',
          time: row.time || '',
          label: `${DAY_FULL[row.day] || row.day || ''} ${row.time || ''}`.trim(),
          descriptor: row.descriptor || '',
          division: parseDescriptorDivision(row.descriptor),
          attendees: att,
          capacity: cap,
          classes: cls,
          avgAttendees: Math.round(10 * att / cls) / 10,
          avgCapacity: Math.round(10 * cap / cls) / 10,
          occupancyPct: pct
        });
        actAtt += att; actCap += cap; actCls += cls;
      }

      if (!slots.length) continue;

      activities.push({
        sheet: sheet.sheet,
        label: sheet.sheet,
        totals: {
          attendees: actAtt, capacity: actCap, classes: actCls,
          occupancyPct: actCap > 0 ? Math.round(1000 * actAtt / actCap) / 10 : 0
        },
        slots
      });

      catAtt += actAtt; catCap += actCap; catCls += actCls;
    }

    if (!activities.length) continue;

    categories.push({
      workbook,
      label: meta.label,
      color: meta.color,
      bg: meta.bg,
      totals: {
        attendees: catAtt, capacity: catCap, classes: catCls,
        occupancyPct: catCap > 0 ? Math.round(1000 * catAtt / catCap) / 10 : 0
      },
      activities
    });

    totalAttendees += catAtt; totalCapacity += catCap; totalClasses += catCls;
  }

  // Raw activity list from ALL events — not filtered by CATALOG.
  // This ensures classes added after the initial template scan remain visible.
  const rawMap = new Map();
  for (const ev of (runData.events || [])) {
    const name = (ev.activity_name || '').trim() || '(sin nombre)';
    const cur = rawMap.get(name) || { name, attendees: 0, capacity: 0, eventCount: 0, firstDate: ev.event_date || '' };
    cur.attendees += (Number(ev.attendees) || 0);
    cur.capacity += (ev.capacity > 0 ? Number(ev.capacity) : 0);
    cur.eventCount += 1;
    if (ev.event_date && (!cur.firstDate || ev.event_date < cur.firstDate)) cur.firstDate = ev.event_date;
    rawMap.set(name, cur);
  }
  const rawActivities = [...rawMap.values()].map((a) => ({
    name: a.name,
    attendees: a.attendees,
    capacity: a.capacity,
    eventCount: a.eventCount,
    firstDate: a.firstDate,
    occupancyPct: a.capacity > 0 ? Math.round(1000 * a.attendees / a.capacity) / 10 : 0
  })).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return {
    id: run.id,
    label: monthLabel(run.date_from),
    monthKey: monthKey(run.date_from),
    dateFrom: run.date_from,
    dateTo: run.date_to,
    status: run.status,
    extractionMode: run.extraction_mode || 'complete',
    totals: {
      events: run.event_count || 0,
      attendees: totalAttendees,
      capacity: totalCapacity,
      classes: totalClasses,
      occupancyPct: totalCapacity > 0 ? Math.round(1000 * totalAttendees / totalCapacity) / 10 : 0
    },
    categories,
    rawActivities,
    classChanges: null
  };
}

/**
 * Returns true when a name looks like a real sports/fitness class.
 * Rejects: person names (First Last patterns), soccer match phases (VS, Fase de…),
 * event names (campeonato, halloween, etc.) and other non-class entries.
 */
const _CLASS_KEYWORDS = /acuaer[oó]b|spinning|pilates?|yoga|nataci[oó]n|zumba|m[uú]sculaci[oó]n|gimnasia|fitness|aer[oó]b|elongaci[oó]n|funcional|cardio|ciclo|kangoo|kick\s*box|boxeo?|dance|baile|meditaci[oó]n|relajaci[oó]n|stretching|tonificaci[oó]n|fullbody|f[uú]tbol|b[áa]sketbol|tenis|running|piscina|baby\s|infantil|adultos?|explorador|atletismo|voley|rugby|hatha|vinyasa|\barte\b|teatro|danza|hip\s*hop|ritmos?|pesas|fuerza|crossfit|hiit|trx|acuatico|expresi[oó]n|r[íi]tmica|circuit|triatleta|ciclospin|step\s|\d{1,2}\s*[ap]m|hockey|fotograf|sicomotricidad|psicomotricidad|karate|judo|taekwondo|esgrima|ajedrez|equitaci[oó]n|padel|paddel|rappel|escalada|waterpolo|softball|b[eé]isbol|squash|badminton|bowling|bocce?|boliche|calistenia|parkour|mindfulness|handball|baloncesto|bochas|biciclet|ciclismo|mountain|entrenamiento/i;

function isRealClassName(name) {
  if (!name || !name.trim()) return false;
  const n = name.trim();
  // Unnamed / placeholder
  if (/^\(sin\s+nombre\)$/i.test(n)) return false;
  if (/^\(actividad\s+sin\s+nombre\)$/i.test(n)) return false;
  // Match/game patterns
  if (/\bvs\.?\b/i.test(n)) return false;
  if (/^fase\s+(de\s+grupos?|inicial|regular|final)/i.test(n)) return false;
  // Tournaments, competitions, events, ceremonies, misc non-class terms
  if (/^(campeonato|copa\s|torneo|cuadrangular|competencia)\b/i.test(n)) return false;
  if (/^marat[oó]n\b/i.test(n)) return false;
  if (/hall[ao]w[e]?en{1,2}\b/i.test(n)) return false;
  if (/^americano\s+(halloween|mixto)\b/i.test(n)) return false;
  if (/^senior\s+entrenamiento\b/i.test(n)) return false;
  if (/^juegos?\s+(t[íi]picos?|populares?)\b/i.test(n)) return false;
  if (/^interclubes$/i.test(n)) return false;
  if (/^(mantencion(es)?|mantenci[oó]n)\b/i.test(n)) return false;
  if (/^runners?$/i.test(n)) return false;
  if (/^s\/p$/i.test(n)) return false;
  if (/^desayuno\s+running$/i.test(n)) return false;
  if (/^squash\s+camp$/i.test(n)) return false;
  if (/^master\s+class\b/i.test(n)) return false;
  if (/^(cerrado|montaje|premiaci[oó]n|premiacion)\b/i.test(n)) return false;
  if (/^(esquinazo|preparaci[oó]n\s+esquinazo)\b/i.test(n)) return false;
  if (/^(a\.?a\.?i\.?i\.?|n\.?a\.?)$/i.test(n)) return false;
  // Activity keywords → real class
  if (_CLASS_KEYWORDS.test(n)) return true;
  // Person name pattern: 2+ proper-noun words, only letters (no digits), no activity terms
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const connectors = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'a', 'o', 'con', 'en', 'para']);
    const significant = words.filter(w => !connectors.has(w.toLowerCase()));
    if (
      significant.length >= 2 &&
      significant.every(w => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]*$/.test(w)) &&
      !/\d/.test(n) &&
      !_CLASS_KEYWORDS.test(n)
    ) return false;
  }
  // Single-word person name: only letters, no digits, starts uppercase, not in keywords
  if (words.length === 1 && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+$/.test(n) && !/\d/.test(n)) return false;
  return true;
}

/**
 * Populates classChanges on each run stat by comparing sequential months using rawActivities.
 * A class is "new" if it appears in this run but not in the immediately preceding month.
 * A class is "retired" if it was in the preceding month but absent from this run.
 * Operates in-place; runs with no previous month get hasPreviousMonth = false.
 * @param {Array} runsStats - Array of buildRunStats() results (may be in any order)
 */
function computeMonthlyClassChanges(runsStats) {
  const valid = (runsStats || []).filter(Boolean);
  // Index by monthKey for O(1) lookup of the previous month's run.
  const byMonth = new Map();
  for (const run of valid) {
    if (run.monthKey) byMonth.set(run.monthKey, run);
  }
  for (const run of valid) {
    if (!run.monthKey) continue;
    const [y, m] = run.monthKey.split('-').map(Number);
    let prevY = y; let prevM = m - 1;
    if (prevM === 0) { prevM = 12; prevY--; }
    const prevKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
    const prevRun = byMonth.get(prevKey) || null;

    const currentNames = new Set((run.rawActivities || []).map((a) => a.name));
    const prevNames = prevRun ? new Set((prevRun.rawActivities || []).map((a) => a.name)) : null;

    // Only flag as "new" when a previous month actually exists; without one we
    // cannot distinguish a new class from "first month ever scanned".
    const newClasses = prevNames
      ? (run.rawActivities || []).filter((a) => !prevNames.has(a.name) && isRealClassName(a.name))
      : [];
    const retiredClasses = prevRun
      ? (prevRun.rawActivities || []).filter((a) => !currentNames.has(a.name) && isRealClassName(a.name))
      : [];

    run.classChanges = {
      activeCount: currentNames.size,
      newCount: newClasses.length,
      retiredCount: retiredClasses.length,
      newClasses: newClasses.map((a) => ({
        name: a.name,
        firstDate: a.firstDate,
        attendees: a.attendees,
        capacity: a.capacity,
        occupancyPct: a.occupancyPct
      })),
      retiredClasses: retiredClasses.map((a) => ({
        name: a.name,
        lastLabel: prevRun ? prevRun.label : ''
      })),
      hasPreviousMonth: !!prevRun,
      previousMonthLabel: prevRun ? prevRun.label : null
    };
  }
}

/**
 * Generates the self-contained HTML dashboard.
 * @param {Array} runsStats - Array of buildRunStats() results (ordered newest-first)
 * @param {string} logoBase64 - Base64-encoded logo image
 */
function generateDashboardHtml(runsStats, logoBase64) {
  const runs = runsStats.filter(Boolean);
  if (!runs.length) {
    return '<!doctype html><html><body><p>No hay extracciones disponibles para mostrar.</p></body></html>';
  }

  const dataJson = JSON.stringify(runs);
  const generatedAt = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  const logoSrc = logoBase64 ? `data:image/jpeg;base64,${logoBase64}` : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard Estadísticas · Llacolén Campos Deportivos</title>
<style>
:root {
  --blue-dark: #004a87; --blue-mid: #1a7abf; --blue-light: #e8f3fa;
  --yellow: #f6c900; --yellow-dark: #c9a100;
  --gray-1: #f7f9fc; --gray-2: #eef2f7; --gray-3: #d5e0ec; --gray-4: #8fa8c4;
  --text: #1a2c3d; --text-sub: #4a6280;
  --white: #fff;
  --radius: 10px; --shadow: 0 2px 12px rgba(0,74,135,.10);
  --transition: .2s ease;
  --occ-high: #1a9b4d; --occ-mid: #e07b00; --occ-low: #c0392b; --occ-empty: #9aaebd;
}
*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 15px; scroll-behavior: smooth; }
body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: var(--gray-1); color: var(--text); min-height: 100vh; }

/* HEADER */
.site-header { background: var(--blue-dark); color: var(--white); padding: 0 24px; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.site-header-inner { display: flex; align-items: center; gap: 16px; height: 64px; max-width: 1600px; margin: 0 auto; }
.site-logo { height: 40px; border-radius: 4px; flex-shrink: 0; }
.site-title { flex: 1; }
.site-title h1 { font-size: 1.1rem; font-weight: 700; letter-spacing: .01em; }
.site-title p { font-size: .75rem; opacity: .7; }
.generated-at { font-size: .7rem; opacity: .55; text-align: right; white-space: nowrap; }

/* LAYOUT */
.page { max-width: 1600px; margin: 0 auto; padding: 20px 20px 60px; }

/* RUN SELECTOR */
.runs-bar { background: var(--white); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 20px; margin-bottom: 20px; }
.runs-bar h2 { font-size: .85rem; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 12px; }
.runs-tabs { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.run-tab { padding: 7px 16px; border-radius: 20px; border: 2px solid var(--gray-3); background: var(--white); cursor: pointer; font-size: .85rem; color: var(--text-sub); font-weight: 500; transition: var(--transition); }
.run-tab:hover { border-color: var(--blue-mid); color: var(--blue-dark); }
.run-tab.active-primary { background: var(--blue-dark); border-color: var(--blue-dark); color: var(--white); }
.run-tab.active-compare { background: var(--yellow-dark); border-color: var(--yellow-dark); color: var(--white); }
.compare-controls { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.btn { padding: 7px 16px; border-radius: 20px; border: 2px solid transparent; cursor: pointer; font-size: .83rem; font-weight: 600; transition: var(--transition); }
.btn-primary { background: var(--blue-dark); color: var(--white); border-color: var(--blue-dark); }
.btn-primary:hover { background: var(--blue-mid); border-color: var(--blue-mid); }
.btn-secondary { background: var(--white); color: var(--blue-dark); border-color: var(--blue-dark); }
.btn-secondary:hover { background: var(--blue-light); }
.btn-yellow { background: var(--yellow); color: var(--text); border-color: var(--yellow-dark); }
.btn-yellow:hover { background: var(--yellow-dark); color: var(--white); }
.btn-ghost { background: transparent; color: var(--text-sub); border-color: var(--gray-3); }
.btn-ghost:hover { background: var(--gray-2); }
.btn[disabled] { opacity: .4; cursor: not-allowed; }

/* COMPARE BANNER */
.compare-banner { display: none; background: linear-gradient(90deg,#fff8e0,#fffdf0); border: 1.5px solid var(--yellow); border-radius: var(--radius); padding: 12px 20px; margin-bottom: 16px; align-items: center; gap: 12px; flex-wrap: wrap; }
.compare-banner.visible { display: flex; }
.compare-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 12px; font-size: .83rem; font-weight: 600; }
.badge-primary { background: var(--blue-dark); color: var(--white); }
.badge-compare { background: var(--yellow-dark); color: var(--white); }
.compare-banner p { font-size: .85rem; color: var(--text-sub); }

/* KPIs */
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
.kpi-card { background: var(--white); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px 16px; }
.kpi-label { font-size: .73rem; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
.kpi-value { font-size: 1.8rem; font-weight: 700; color: var(--blue-dark); line-height: 1; }
.kpi-unit { font-size: .7rem; color: var(--text-sub); margin-top: 2px; }
.kpi-delta { font-size: .78rem; font-weight: 600; margin-top: 6px; }
.delta-pos { color: var(--occ-high); }
.delta-neg { color: var(--occ-low); }
.delta-neu { color: var(--text-sub); }
.kpi-card.kpi-occ .kpi-value { color: var(--occ-mid); }
.kpi-card.kpi-occ.high .kpi-value { color: var(--occ-high); }
.kpi-card.kpi-occ.low .kpi-value { color: var(--occ-low); }

/* SECTION HEADERS */
.section-header { display: flex; align-items: center; gap: 10px; margin: 24px 0 12px; }
.section-header h2 { font-size: 1.1rem; color: var(--blue-dark); font-weight: 700; }
.section-line { flex: 1; height: 2px; background: var(--gray-3); border-radius: 1px; }
.section-tag { padding: 3px 10px; border-radius: 10px; font-size: .72rem; font-weight: 600; color: var(--white); }

/* OVERVIEW CHART */
.overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
@media (max-width: 860px) { .overview-grid { grid-template-columns: 1fr; } }
.chart-card { background: var(--white); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px; }
.chart-card h3 { font-size: .88rem; color: var(--text-sub); font-weight: 600; margin-bottom: 14px; }
.chart-wrap { position: relative; }

/* CATEGORY SECTIONS */
.cat-section { background: var(--white); border-radius: var(--radius); box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden; }
.cat-header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; cursor: pointer; user-select: none; border-bottom: 1px solid transparent; }
.cat-header:hover { background: var(--gray-1); }
.cat-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.cat-title { font-size: 1rem; font-weight: 700; flex: 1; }
.cat-totals { display: flex; gap: 16px; font-size: .8rem; color: var(--text-sub); }
.cat-totals strong { color: var(--text); }
.cat-occ { font-weight: 700; padding: 2px 8px; border-radius: 8px; font-size: .8rem; }
.cat-expand { font-size: 1.2rem; color: var(--text-sub); transition: transform var(--transition); }
.cat-expand.open { transform: rotate(180deg); }
.cat-body { border-top: 2px solid var(--gray-2); }

/* ACTIVITY ROW */
.act-panel { border-bottom: 1px solid var(--gray-2); }
.act-panel:last-child { border-bottom: none; }
.act-row { display: flex; align-items: center; gap: 12px; padding: 12px 20px; cursor: pointer; }
.act-row:hover { background: var(--gray-1); }
.act-name { font-size: .9rem; font-weight: 600; flex: 1; }
.act-stat { text-align: right; font-size: .8rem; color: var(--text-sub); }
.act-stat strong { font-size: .95rem; color: var(--text); }
.act-expand { font-size: .9rem; color: var(--text-sub); transition: transform var(--transition); }
.act-expand.open { transform: rotate(180deg); }
.act-detail { display: none; padding: 0 20px 20px; background: var(--gray-1); }
.act-detail.open { display: block; }
.act-chart-wrap { margin: 12px 0 8px; }

/* OCCUPANCY BAR INLINE */
.occ-bar-wrap { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.occ-bar-track { flex: 1; height: 6px; background: var(--gray-3); border-radius: 3px; overflow: hidden; }
.occ-bar-fill { height: 100%; border-radius: 3px; transition: width var(--transition); }
.occ-pct { font-size: .78rem; font-weight: 700; min-width: 38px; text-align: right; }
.occ-high { color: var(--occ-high); }
.occ-mid { color: var(--occ-mid); }
.occ-low { color: var(--occ-low); }
.occ-empty { color: var(--occ-empty); }

/* SLOT TABLE */
.slot-table { width: 100%; border-collapse: collapse; font-size: .82rem; margin-top: 8px; }
.slot-table th { background: var(--gray-2); color: var(--text-sub); text-transform: uppercase; font-size: .7rem; letter-spacing: .06em; padding: 7px 10px; text-align: left; position: sticky; top: 0; }
.slot-table td { padding: 7px 10px; border-bottom: 1px solid var(--gray-2); }
.slot-table tr:last-child td { border-bottom: none; }
.slot-table tr:hover td { background: #f0f5fa; }
.slot-day { font-weight: 600; }
.slot-time { color: var(--text-sub); }

/* SUMMARY TABLE */
.summary-table-wrap { background: var(--white); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; margin-bottom: 24px; }
.summary-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.summary-table th { background: var(--blue-dark); color: var(--white); padding: 10px 14px; text-align: left; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
.summary-table td { padding: 9px 14px; border-bottom: 1px solid var(--gray-2); }
.summary-table tr:last-child td { border-bottom: none; }
.summary-table tr:hover td { background: #f0f5fa; }
.summary-table .cat-row td { background: var(--blue-light); font-weight: 700; color: var(--blue-dark); border-top: 2px solid var(--blue-dark); }
.summary-table .total-row td { background: var(--blue-dark); color: var(--white); font-weight: 700; border-top: 3px solid var(--yellow); }
.occ-pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-weight: 700; font-size: .78rem; }
.pill-high { background: #d4f0e2; color: var(--occ-high); }
.pill-mid { background: #fce8d0; color: var(--occ-mid); }
.pill-low { background: #fad4d4; color: var(--occ-low); }
.pill-empty { background: var(--gray-2); color: var(--occ-empty); }

/* LEGEND */
.chart-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: .78rem; color: var(--text-sub); margin-top: 10px; }
.legend-item { display: flex; align-items: center; gap: 6px; }
.legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

/* NAV PILLS */
.cat-nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.cat-nav-pill { padding: 5px 14px; border-radius: 16px; font-size: .78rem; font-weight: 600; cursor: pointer; border: 2px solid transparent; transition: var(--transition); }
.cat-nav-pill:hover { opacity: .8; }

/* TOOLTIP via title is a fallback; real ones from Chart.js */
.chart-empty { color: var(--text-sub); font-size: .85rem; text-align: center; padding: 24px 0; }

/* Print */
@media print {
  .site-header { position: relative; }
  .runs-bar, .compare-controls, .cat-header, .compare-banner { break-inside: avoid; }
  .act-detail { display: block !important; }
}
</style>
</head>
<body>

<header class="site-header">
  <div class="site-header-inner">
    ${logoSrc ? `<img class="site-logo" src="${logoSrc}" alt="Llacolén">` : ''}
    <div class="site-title">
      <h1>Dashboard Estadísticas MatchPoint</h1>
      <p>Campos Deportivos Llacolén</p>
    </div>
    <div class="generated-at">Generado el ${escHtml(generatedAt)}</div>
  </div>
</header>

<div class="page">

  <!-- RUN SELECTOR -->
  <div class="runs-bar">
    <h2>Seleccionar período</h2>
    <div class="runs-tabs" id="runsTabs">
      <!-- filled by JS -->
      <div class="compare-controls">
        <button class="btn btn-secondary" id="btnCompareMode">⇄ Comparar meses</button>
        <button class="btn btn-yellow" id="btnYoY" title="Comparar con el mismo mes del año anterior">↔ Mismo mes año anterior</button>
        <button class="btn btn-ghost" id="btnClearCompare" style="display:none">✕ Quitar comparación</button>
      </div>
    </div>
  </div>

  <!-- COMPARE BANNER -->
  <div class="compare-banner" id="compareBanner">
    <span class="compare-badge badge-primary" id="compareBadge1">—</span>
    <span style="font-weight:700;font-size:1rem;">vs</span>
    <span class="compare-badge badge-compare" id="compareBadge2">—</span>
    <p id="compareBannerMsg"></p>
  </div>

  <!-- KPIs -->
  <div class="kpis" id="kpisSection"><!-- filled by JS --></div>

  <!-- OVERVIEW CHARTS -->
  <div class="section-header">
    <h2>Resumen por categoría</h2>
    <div class="section-line"></div>
  </div>
  <div class="overview-grid">
    <div class="chart-card">
      <h3>Inscritos y cupos por categoría</h3>
      <div class="chart-wrap"><canvas id="chartOverview" height="280"></canvas></div>
      <div class="chart-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#004a87"></span>Cupos</span>
        <span class="legend-item"><span class="legend-dot" style="background:#f6c900"></span>Inscritos</span>
      </div>
    </div>
    <div class="chart-card">
      <h3>Ocupación % por categoría</h3>
      <div class="chart-wrap"><canvas id="chartOccupancy" height="280"></canvas></div>
    </div>
  </div>

  <!-- TREND CHART (shown when comparing) -->
  <div id="trendSection" style="display:none">
    <div class="section-header">
      <h2>Comparación directa</h2>
      <div class="section-line"></div>
    </div>
    <div class="chart-card" style="margin-bottom:24px">
      <h3>Inscritos por categoría — comparación de períodos</h3>
      <div class="chart-wrap"><canvas id="chartCompareCat" height="260"></canvas></div>
    </div>
  </div>

  <!-- SUMMARY TABLE -->
  <div class="section-header">
    <h2>Tabla resumen de actividades</h2>
    <div class="section-line"></div>
  </div>
  <div class="summary-table-wrap">
    <table class="summary-table" id="summaryTable"><!-- filled by JS --></table>
  </div>

  <!-- DETAIL BY CATEGORY -->
  <div class="section-header">
    <h2>Detalle por actividad</h2>
    <div class="section-line"></div>
  </div>
  <div class="cat-nav" id="catNav"><!-- filled by JS --></div>
  <div id="categorySections"><!-- filled by JS --></div>

</div><!-- /page -->

<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
/* eslint-disable */
// ─── EMBEDDED DATA ────────────────────────────────────────────────────────
const ALL_RUNS = ${dataJson};

// ─── STATE ────────────────────────────────────────────────────────────────
let primaryIdx  = 0;
let compareIdxs = [];    // ordered array of compare month indices
let compareMode = false;
const CMP_PALETTE = [
  { bg: 'rgba(246,201,0,.82)', border: '#c9a100' },
  { bg: 'rgba(220,80,60,.78)', border: '#c0392b' },
  { bg: 'rgba(52,168,83,.78)', border: '#1a7a3e' },
  { bg: 'rgba(130,80,190,.78)', border: '#7b3fa0' },
  { bg: 'rgba(0,150,150,.78)', border: '#006b6b' },
];

// ─── CHART INSTANCES ──────────────────────────────────────────────────────
const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────
function pct(val) { return (Math.round(10 * val) / 10).toFixed(1) + '%'; }
function num(val)  { return Number(val).toLocaleString('es-CL'); }

function occPillClass(p) {
  if (p >= 90) return 'pill-high';
  if (p >= 70) return 'pill-mid';
  if (p >= 40) return 'pill-low';
  return 'pill-empty';
}
function occBarColor(p) {
  if (p >= 90) return 'var(--occ-high)';
  if (p >= 70) return 'var(--occ-mid)';
  if (p >= 40) return 'var(--blue-mid)';
  return 'var(--occ-empty)';
}

function delta(v1, v2) {
  if (v2 === 0) return null;
  const d = Math.round(10 * (v1 - v2) / v2 * 100) / 10;
  return d;
}

function deltaHtml(v1, v2, unit = '') {
  if (compareIdxs.length !== 1 || v2 == null || v2 === 0) return '';
  const d = delta(v1, v2); if (d === null) return '';
  const sign = d > 0 ? '+' : '';
  const cls = d > 0 ? 'delta-pos' : d < 0 ? 'delta-neg' : 'delta-neu';
  return '<span class="kpi-delta ' + cls + '">' + sign + d + unit + ' vs. ' + ALL_RUNS[compareIdxs[0]].label + '</span>';
}

// ─── RUN TABS ──────────────────────────────────────────────────────────────
function renderTabs() {
  const container = document.getElementById('runsTabs');
  const controls = container.querySelector('.compare-controls');
  [...container.querySelectorAll('.run-tab')].forEach(el => el.remove());
  ALL_RUNS.forEach((run, i) => {
    const tab = document.createElement('button');
    const cmpPos = compareIdxs.indexOf(i);
    tab.className = 'run-tab' + (i === primaryIdx ? ' active-primary' : '') + (cmpPos >= 0 ? ' active-compare' : '');
    if (cmpPos >= 0) {
      const pal = CMP_PALETTE[cmpPos % CMP_PALETTE.length];
      tab.style.background = pal.border;
      tab.style.borderColor = pal.border;
      tab.style.color = '#fff';
    }
    tab.textContent = run.label + (compareIdxs.length > 1 && cmpPos >= 0 ? ' (' + (cmpPos + 1) + ')' : '');
    tab.title = run.dateFrom + ' → ' + run.dateTo;
    tab.onclick = () => onTabClick(i);
    container.insertBefore(tab, controls);
  });
}

function onTabClick(idx) {
  if (!compareMode) { primaryIdx = idx; compareIdxs = []; }
  else {
    if (idx === primaryIdx) return;
    const pos = compareIdxs.indexOf(idx);
    if (pos >= 0) { compareIdxs.splice(pos, 1); } else { compareIdxs.push(idx); }
  }
  refresh();
}

// ─── COMPARE BUTTONS ───────────────────────────────────────────────────────
document.getElementById('btnCompareMode').onclick = () => {
  compareMode = !compareMode;
  if (!compareMode) { compareIdxs = []; }
  document.getElementById('btnCompareMode').textContent = compareMode ? '…selecciona meses' : '⇄ Comparar meses';
  refresh();
};

document.getElementById('btnClearCompare').onclick = () => {
  compareIdxs = []; compareMode = false;
  document.getElementById('btnCompareMode').textContent = '⇄ Comparar meses';
  refresh();
};

document.getElementById('btnYoY').onclick = () => {
  const primary = ALL_RUNS[primaryIdx];
  if (!primary || !primary.monthKey) return;
  const [y, m] = primary.monthKey.split('-').map(Number);
  const prevKey = (y - 1) + '-' + String(m).padStart(2, '0');
  const prevIdx = ALL_RUNS.findIndex(r => r.monthKey === prevKey);
  if (prevIdx < 0) {
    alert('No hay datos del mismo mes del año anterior (' + prevKey + ').');
    return;
  }
  if (compareIdxs.indexOf(prevIdx) < 0) compareIdxs.push(prevIdx);
  compareMode = false;
  document.getElementById('btnCompareMode').textContent = '⇄ Comparar meses';
  refresh();
};

// ─── MAIN REFRESH ──────────────────────────────────────────────────────────
function refresh() {
  renderTabs();
  const primary = ALL_RUNS[primaryIdx];
  const compareRuns = compareIdxs.map(i => ALL_RUNS[i]);
  const btnCmp = document.getElementById('btnCompareMode');
  if (compareMode) btnCmp.textContent = compareIdxs.length ? '✓ Listo (' + compareIdxs.length + ')' : '…selecciona meses';
  const banner = document.getElementById('compareBanner');
  if (compareRuns.length) {
    banner.classList.add('visible');
    document.getElementById('compareBadge1').textContent = primary.label;
    document.getElementById('compareBadge2').textContent = compareRuns.map(r => r.label).join(' · ');
    document.getElementById('compareBannerMsg').textContent =
      'Comparando ' + (compareRuns.length + 1) + ' período(s). Deltas vs. el 1.º mes seleccionado.';
    document.getElementById('btnClearCompare').style.display = '';
    document.getElementById('trendSection').style.display = '';
  } else {
    banner.classList.remove('visible');
    document.getElementById('btnClearCompare').style.display = 'none';
    document.getElementById('trendSection').style.display = 'none';
  }
  renderKpis(primary, compareRuns);
  try { renderOverviewCharts(primary, compareRuns); } catch(e) { showChartError('chartOverview'); showChartError('chartOccupancy'); }
  if (compareRuns.length) { try { renderCompareChart(primary, compareRuns); } catch(e) { showChartError('chartCompareCat'); } }
  renderSummaryTable(primary, compareRuns);
  renderCategorySections(primary, compareRuns);
}

function showChartError(canvasId) {
  const el = document.getElementById(canvasId);
  if (el && el.parentNode) {
    el.style.display = 'none';
    const msg = document.createElement('p');
    msg.className = 'chart-empty';
    msg.textContent = 'Gráfico no disponible (se requiere conexión a internet para cargar Chart.js).';
    el.parentNode.insertBefore(msg, el);
  }
}

// ─── KPIs ──────────────────────────────────────────────────────────────────
function renderKpis(primary, compareRuns) {
  const t  = primary.totals;
  const tc = compareRuns.length === 1 ? compareRuns[0].totals : null;

  const occ = t.occupancyPct;
  const occCls = occ >= 90 ? 'high' : occ < 50 ? 'low' : '';

  function kpi(label, val, unit, cmpVal, extraCls = '') {
    const d = tc != null ? deltaHtml(val, cmpVal, unit === '%' ? ' pp' : '') : '';
    return '<div class="kpi-card ' + extraCls + '"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + (unit === '%' ? pct(val).replace('%','') : num(val)) + '</div>' +
      '<div class="kpi-unit">' + unit + '</div>' + d + '</div>';
  }

  document.getElementById('kpisSection').innerHTML =
    kpi('Eventos totales',   t.events,       'eventos',  tc?.events) +
    kpi('Inscritos',         t.attendees,    'personas', tc?.attendees) +
    kpi('Cupo total',        t.capacity,     'cupos',    tc?.capacity) +
    kpi('Clases realizadas', t.classes,      'clases',   tc?.classes) +
    kpi('Ocupación',         t.occupancyPct, '%',        tc?.occupancyPct, 'kpi-occ ' + occCls);
}

// ─── OVERVIEW CHARTS ───────────────────────────────────────────────────────
function renderOverviewCharts(primary, compareRuns) {
  // Chart 1: Attendees vs Capacity by category (horizontal grouped bar)
  destroyChart('overview');
  const cats   = primary.categories;
  const labels = cats.map(c => c.label);
  const attData = cats.map(c => c.totals.attendees);
  const capData = cats.map(c => c.totals.capacity);

  const datasets = [
    {
      label: 'Cupos',
      data: capData,
      backgroundColor: cats.map(c => hexToRgba(c.color, .25)),
      borderColor:     cats.map(c => c.color),
      borderWidth: 2,
      borderRadius: 4,
    },
    {
      label: 'Inscritos ' + primary.label,
      data: attData,
      backgroundColor: cats.map(c => hexToRgba(c.color, .85)),
      borderColor:     cats.map(c => c.color),
      borderWidth: 0,
      borderRadius: 4,
    }
  ];

  compareRuns.forEach((cmp, ci) => {
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    const cAtt = labels.map(l => { const c = cmp.categories.find(x => x.label === l); return c ? c.totals.attendees : 0; });
    datasets.push({ label: 'Inscritos ' + cmp.label, data: cAtt, backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 0, borderRadius: 4 });
  });

  charts.overview = new Chart(document.getElementById('chartOverview'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 14 } },
        tooltip: {
          callbacks: {
            afterLabel(ctx) {
              if (ctx.datasetIndex === 1) {
                const cap = capData[ctx.dataIndex];
                return 'Ocupación: ' + pct(cap > 0 ? 100 * ctx.parsed.x / cap : 0);
              }
              return '';
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: '#eef2f7' }, ticks: { font: { size: 11 } } },
        y: { ticks: { font: { size: 11 } } }
      }
    }
  });

  // Chart 2: Occupancy % by category
  destroyChart('occupancy');
  const occData = cats.map(c => c.totals.occupancyPct);

  const occDatasets = [{
    label: 'Ocupación % ' + primary.label,
    data: occData,
    backgroundColor: occData.map(p => p >= 90 ? 'rgba(26,155,77,.8)' : p >= 70 ? 'rgba(224,123,0,.8)' : p >= 40 ? 'rgba(26,122,191,.7)' : 'rgba(154,174,189,.5)'),
    borderRadius: 4,
    borderWidth: 0,
  }];

  compareRuns.forEach((cmp, ci) => {
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    const occCData = labels.map(l => { const c = cmp.categories.find(x => x.label === l); return c ? c.totals.occupancyPct : 0; });
    occDatasets.push({ label: 'Ocupación % ' + cmp.label, data: occCData, backgroundColor: pal.bg, borderRadius: 4, borderWidth: 0 });
  });

  charts.occupancy = new Chart(document.getElementById('chartOccupancy'), {
    type: 'bar',
    data: { labels, datasets: occDatasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 14 } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + pct(ctx.parsed.x) } }
      },
      scales: {
        x: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: '#eef2f7' } },
        y: { ticks: { font: { size: 11 } } }
      }
    }
  });
}

// ─── COMPARE TREND CHART ───────────────────────────────────────────────────
function renderCompareChart(primary, compareRuns) {
  destroyChart('compareCat');
  const labels = primary.categories.map(c => c.label);
  const datasets = [{ label: primary.label, data: primary.categories.map(c => c.totals.attendees), backgroundColor: 'rgba(0,74,135,.8)', borderRadius: 4, borderWidth: 0 }];
  compareRuns.forEach((cmp, ci) => {
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    datasets.push({ label: cmp.label, data: labels.map(l => { const c = cmp.categories.find(x => x.label === l); return c ? c.totals.attendees : 0; }), backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 1, borderRadius: 4 });
  });
  charts.compareCat = new Chart(document.getElementById('chartCompareCat'), {
    type: 'bar', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 14 } } }, scales: { x: { ticks: { font: { size: 11 } } }, y: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#eef2f7' } } } }
  });
}

// ─── SUMMARY TABLE ─────────────────────────────────────────────────────────
function renderSummaryTable(primary, compareRuns) {
  const head = '<thead><tr>' +
    '<th>Actividad</th>' +
    '<th>Inscritos ' + primary.label + '</th>' +
    compareRuns.map(r => '<th>Inscritos ' + r.label + '</th>').join('') +
    '<th>Cupos</th><th>Clases</th><th>Prom. inscritos</th><th>Ocupación</th></tr></thead>';

  let body = '<tbody>';
  let grandAtt = 0; let grandCap = 0; let grandCls = 0;

  for (const cat of primary.categories) {
    body += '<tr class="cat-row"><td colspan="' + (6 + compareRuns.length) + '" style="color:' + cat.color + '">' + cat.label + '</td></tr>';

    for (const act of cat.activities) {
      const t = act.totals;
      const cmpAtt0 = compareRuns.length === 1 ? (() => { const catCmp = compareRuns[0].categories.find(c => c.label === cat.label); const cmpAct = catCmp ? catCmp.activities.find(a => a.label === act.label) : null; return cmpAct ? cmpAct.totals.attendees : null; })() : null;
      const d = cmpAtt0 != null ? delta(t.attendees, cmpAtt0) : null;
      const dHtml = d != null ? ' <span style="font-size:.75rem;font-weight:600;color:' + (d > 0 ? 'var(--occ-high)' : d < 0 ? 'var(--occ-low)' : '#888') + '">' + (d > 0 ? '+' : '') + d + '%</span>' : '';

      body += '<tr>' +
        '<td style="padding-left:28px">' + act.label + '</td>' +
        '<td>' + num(t.attendees) + dHtml + '</td>' +
        compareRuns.map(r => { const catCmp = r.categories.find(c => c.label === cat.label); const cmpAct = catCmp ? catCmp.activities.find(a => a.label === act.label) : null; return '<td>' + (cmpAct ? num(cmpAct.totals.attendees) : '—') + '</td>'; }).join('') +
        '<td>' + num(t.capacity) + '</td>' +
        '<td>' + num(t.classes) + '</td>' +
        '<td>' + (t.classes > 0 ? (Math.round(10 * t.attendees / t.classes) / 10) : '—') + '</td>' +
        '<td><span class="occ-pill ' + occPillClass(t.occupancyPct) + '">' + pct(t.occupancyPct) + '</span></td>' +
        '</tr>';
    }

    grandAtt += cat.totals.attendees; grandCap += cat.totals.capacity; grandCls += cat.totals.classes;
  }

  const grandOcc = grandCap > 0 ? Math.round(1000 * grandAtt / grandCap) / 10 : 0;
  body += '<tr class="total-row">' +
    '<td>TOTAL GENERAL</td>' +
    '<td>' + num(grandAtt) + '</td>' +
    compareRuns.map(() => '<td></td>').join('') +
    '<td>' + num(grandCap) + '</td>' +
    '<td>' + num(grandCls) + '</td>' +
    '<td>' + (grandCls > 0 ? Math.round(10 * grandAtt / grandCls) / 10 : '—') + '</td>' +
    '<td><span class="occ-pill ' + occPillClass(grandOcc) + '">' + pct(grandOcc) + '</span></td></tr>';

  body += '</tbody>';
  document.getElementById('summaryTable').innerHTML = head + body;
}

// ─── CATEGORY SECTIONS ─────────────────────────────────────────────────────
let actChartCount = 0;

function renderCategorySections(primary, compareRuns) {
  actChartCount = 0;
  Object.keys(charts).forEach(k => { if (k.startsWith('act_')) { charts[k].destroy(); delete charts[k]; } });

  // Nav pills — use data-idx, wire up after setting innerHTML
  const nav = document.getElementById('catNav');
  nav.innerHTML = primary.categories.map((cat, catIdx) =>
    '<span class="cat-nav-pill" style="background:' + cat.color + ';color:#fff;border-color:' + cat.color + '" data-idx="' + catIdx + '">' + cat.label + '</span>'
  ).join('');
  nav.querySelectorAll('[data-idx]').forEach(el => {
    const idx = +el.dataset.idx;
    el.addEventListener('click', () => {
      const sections = document.querySelectorAll('.cat-section');
      if (sections[idx]) sections[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const container = document.getElementById('categorySections');
  container.innerHTML = '';

  for (const cat of primary.categories) {
    const catCmps = compareRuns.map(r => r.categories.find(c => c.label === cat.label) || null);
    const section = buildCategorySection(cat, catCmps, primary, compareRuns);
    container.appendChild(section);
  }

  // Wire up act-row clicks via event delegation — avoids all onclick string escaping
  container.addEventListener('click', e => {
    const header = e.target.closest('.cat-header');
    if (header) { toggleCat(header); return; }
    const row = e.target.closest('.act-row[data-cid]');
    if (row) toggleAct(row, row.dataset.cid);
  });
}

function buildCategorySection(cat, catCmps, primary, compareRuns) {
  const sec = document.createElement('div');
  sec.className = 'cat-section';
  sec.id = 'cat-' + encodeURIComponent(cat.label);

  const occ = cat.totals.occupancyPct;
  const occCls = occ >= 90 ? 'pill-high' : occ >= 70 ? 'pill-mid' : occ >= 40 ? 'pill-low' : 'pill-empty';

  sec.innerHTML =
    '<div class="cat-header">' +
      '<div class="cat-dot" style="background:' + cat.color + '"></div>' +
      '<div class="cat-title">' + cat.label + '</div>' +
      '<div class="cat-totals">' +
        '<div><strong>' + num(cat.totals.attendees) + '</strong> inscritos</div>' +
        '<div><strong>' + num(cat.totals.capacity) + '</strong> cupos</div>' +
        '<div><strong>' + num(cat.totals.classes) + '</strong> clases</div>' +
      '</div>' +
      '<span class="occ-pill ' + occCls + '">' + pct(occ) + '</span>' +
      '<span class="cat-expand">▼</span>' +
    '</div>' +
    '<div class="cat-body">' +
      cat.activities.map(act => buildActivityPanel(act, catCmps, cat.color, primary, compareRuns)).join('') +
    '</div>';

  return sec;
}

function buildActivityPanel(act, catCmps, catColor, primary, compareRuns) {
  const actCmps = catCmps.map(cc => cc ? cc.activities.find(a => a.label === act.label) : null);
  const actCmp0 = actCmps.length === 1 ? actCmps[0] : null;
  const t = act.totals;
  const occ = t.occupancyPct;
  const chartId = 'act_' + (actChartCount++);

  const occ2 = actCmp0 ? actCmp0.totals.occupancyPct : null;
  const d = occ2 != null ? (Math.round(10 * (occ - occ2)) / 10) : null;
  const dHtml = d != null ? ' <span style="font-size:.75rem;font-weight:600;color:' + (d > 0 ? 'var(--occ-high)' : d < 0 ? 'var(--occ-low)' : '#888') + '">' + (d > 0 ? '+' : '') + d + ' pp</span>' : '';

  const slotRows = act.slots.map(s => {
    const cmpSlots = actCmps.map(ac => ac ? ac.slots.find(x => x.day === s.day && x.time === s.time) : null);
    const sd = actCmps.length === 1 && cmpSlots[0] ? delta(s.attendees, cmpSlots[0].attendees) : null;
    const sdHtml = sd != null ? '<span style="font-size:.72rem;color:' + (sd > 0 ? 'var(--occ-high)' : sd < 0 ? 'var(--occ-low)' : '#888') + '">' + (sd > 0 ? '+' : '') + sd + '%</span>' : '';
    return '<tr>' +
      '<td class="slot-day">' + s.dayFull + '</td>' +
      '<td class="slot-time">' + s.time + ' Hrs.</td>' +
      '<td>' + num(s.attendees) + ' ' + sdHtml + '</td>' +
      cmpSlots.map(cs => '<td>' + (cs ? num(cs.attendees) : '—') + '</td>').join('') +
      '<td>' + num(s.capacity) + '</td>' +
      '<td>' + s.classes + '</td>' +
      '<td><div class="occ-bar-wrap"><div class="occ-bar-track"><div class="occ-bar-fill" style="width:' + Math.min(100, s.occupancyPct) + '%;background:' + occBarColor(s.occupancyPct) + '"></div></div><span class="occ-pct ' + occClass(s.occupancyPct) + '">' + pct(s.occupancyPct) + '</span></div></td>' +
    '</tr>';
  }).join('');

  const compareSlotHeader = compareRuns.map(r => '<th>' + r.label + '</th>').join('');

  // data-cid instead of onclick attribute to avoid quote escaping in template literals
  return '<div class="act-panel">' +
    '<div class="act-row" data-cid="' + chartId + '">' +
      '<div class="act-name">' + act.label + '</div>' +
      '<div class="act-stat"><strong>' + num(t.attendees) + '</strong><br><span style="font-size:.75rem">inscritos</span></div>' +
      '<div class="act-stat"><strong>' + num(t.capacity) + '</strong><br><span style="font-size:.75rem">cupos</span></div>' +
      '<div class="act-stat"><strong>' + pct(occ) + '</strong>' + dHtml + '<br><span style="font-size:.75rem">ocupación</span></div>' +
      '<span class="act-expand">▼</span>' +
    '</div>' +
    '<div class="act-detail" id="detail-' + chartId + '">' +
      '<div class="act-chart-wrap"><canvas id="' + chartId + '" height="' + Math.min(180, 60 + act.slots.length * 28) + '"></canvas></div>' +
      '<div class="chart-legend" id="legend-' + chartId + '"></div>' +
      '<div style="overflow-x:auto;margin-top:8px">' +
      '<table class="slot-table">' +
        '<thead><tr><th>Día</th><th>Hora</th><th>Inscritos</th>' + compareSlotHeader + '<th>Cupos</th><th>Clases</th><th>Ocupación</th></tr></thead>' +
        '<tbody>' + slotRows + '</tbody>' +
      '</table></div>' +
    '</div>' +
  '</div>';
}

function occClass(p) {
  return p >= 90 ? 'occ-high' : p >= 70 ? 'occ-mid' : p >= 40 ? '' : 'occ-empty';
}
function occBarColor(p) {
  return p >= 90 ? 'var(--occ-high)' : p >= 70 ? 'var(--occ-mid)' : p >= 40 ? 'var(--blue-mid)' : 'var(--occ-empty)';
}

// ─── TOGGLE ────────────────────────────────────────────────────────────────
function toggleCat(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector('.cat-expand');
  const isOpen = body.style.display !== 'none' && body.style.display !== '';
  if (isOpen) {
    body.style.display = 'none';
    arrow.classList.remove('open');
  } else {
    body.style.display = '';
    arrow.classList.add('open');
  }
}

function toggleAct(row, chartId) {
  const detail = document.getElementById('detail-' + chartId);
  const arrow  = row.querySelector('.act-expand');
  const isOpen = detail.classList.contains('open');
  if (isOpen) {
    detail.classList.remove('open');
    arrow.classList.remove('open');
  } else {
    detail.classList.add('open');
    arrow.classList.add('open');
    if (!charts[chartId]) buildActivityChart(chartId);
  }
}

// ─── ACTIVITY CHART (slot-level, like PowerPoint) ──────────────────────────
function buildActivityChart(chartId) {
  const primary  = ALL_RUNS[primaryIdx];
  const compareRuns = compareIdxs.map(i => ALL_RUNS[i]);

  // Find activity by matching chart id
  // We use the order in which activities were rendered
  const chartIdx = parseInt(chartId.replace('act_', ''), 10);
  let actIdx = 0;
  let actData = null; let catColor = '#004a87';

  outer:
  for (const cat of primary.categories) {
    for (const act of cat.activities) {
      if (actIdx === chartIdx) { actData = act; catColor = cat.color; break outer; }
      actIdx++;
    }
  }

  if (!actData) return;

  const labels = actData.slots.map(s => s.dayFull + '\\n' + s.time);
  const capData = actData.slots.map(s => s.capacity);
  const attData = actData.slots.map(s => s.attendees);

  const hexRgba = (hex, a) => hexToRgba(hex, a);

  const datasets = [
    {
      label: 'Cupos',
      data: capData,
      backgroundColor: hexRgba(catColor, .22),
      borderColor: catColor,
      borderWidth: 1.5,
      borderRadius: 4,
      order: 2 + compareRuns.length
    },
    {
      label: 'Inscritos ' + primary.label,
      data: attData,
      backgroundColor: hexRgba(catColor, .78),
      borderColor: catColor,
      borderWidth: 0,
      borderRadius: 4,
      order: 0
    }
  ];

  compareRuns.forEach((cmp, ci) => {
    let actCmpData = null;
    for (const cat of cmp.categories) {
      const found = cat.activities.find(a => a.label === actData.label);
      if (found) { actCmpData = found; break; }
    }
    if (!actCmpData) return;
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    const cmpByKey = new Map(actCmpData.slots.map(s => [s.day + '|' + s.time, s]));
    const cmpAtt = actData.slots.map(s => { const c = cmpByKey.get(s.day + '|' + s.time); return c ? c.attendees : 0; });
    datasets.push({ label: 'Inscritos ' + cmp.label, data: cmpAtt, backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 0, borderRadius: 4, order: ci + 1 });
  });

  const ctx = document.getElementById(chartId);
  if (!ctx) return;

  try {
    charts[chartId] = new Chart(ctx, {
      type: 'bar',
      data: { labels: actData.slots.map(s => [s.dayFull, s.time + ' Hrs.']), datasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title(items) { return items[0].label; },
              afterLabel(ctx2) {
                const slotIdx = ctx2.dataIndex;
                if (slotIdx >= actData.slots.length) return '';
                const slot = actData.slots[slotIdx];
                return ctx2.datasetIndex === 1
                  ? 'Ocupación: ' + slot.occupancyPct.toFixed(1) + '%  ·  ' + slot.classes + ' clase(s)'
                  : '';
              }
            }
          }
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 30 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 10 } }, grid: { color: '#eef2f7' } }
        }
      }
    });
  } catch(e) { showChartError(chartId); }
}

// ─── UTILITY ───────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ─── INIT ──────────────────────────────────────────────────────────────────
refresh();
</script>
${passwordGateFrag()}
</body>
</html>`;
}

/**
 * Generates the improved V2 self-contained HTML dashboard.
 * Key improvements over V1:
 *  - Correct month labels on all chart datasets
 *  - Sticky activity navigation pills (always visible when scrolling)
 *  - Collapsible sections to reduce scrolling (Summary Table starts collapsed)
 *  - "Gráficos por actividad" gallery showing PowerPoint-style charts per activity
 */
function generateDashboardHtmlV2(runsStats, logoBase64) {
  const runs = runsStats.filter(Boolean);
  if (!runs.length) {
    return '<!doctype html><html><body style="font-family:sans-serif;padding:40px"><p>No hay extracciones disponibles para mostrar en el dashboard.</p></body></html>';
  }

  const dataJson = JSON.stringify(runs);
  const generatedAt = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  const logoSrc = logoBase64 ? `data:image/jpeg;base64,${logoBase64}` : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard Estadísticas · Llacolén</title>
<style>
:root {
  --blue-dark:#004a87;--blue-mid:#1a7abf;--blue-light:#e8f3fa;
  --yellow:#f6c900;--yellow-dark:#c9a100;
  --gray-1:#f7f9fc;--gray-2:#eef2f7;--gray-3:#d5e0ec;--gray-4:#8fa8c4;
  --text:#1a2c3d;--text-sub:#4a6280;--white:#fff;
  --radius:10px;--shadow:0 2px 12px rgba(0,74,135,.10);--transition:.2s ease;
  --occ-high:#1a9b4d;--occ-mid:#e07b00;--occ-low:#c0392b;--occ-empty:#9aaebd;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{font-size:15px;scroll-behavior:smooth;}
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--gray-1);color:var(--text);min-height:100vh;}
.site-header{background:var(--blue-dark);color:var(--white);padding:0 24px;position:sticky;top:0;z-index:200;box-shadow:0 2px 8px rgba(0,0,0,.25);}
.site-header-inner{display:flex;align-items:center;gap:16px;height:64px;max-width:1600px;margin:0 auto;}
.site-logo{height:40px;border-radius:4px;flex-shrink:0;}
.site-title{flex:1;}.site-title h1{font-size:1.1rem;font-weight:700;}.site-title p{font-size:.75rem;opacity:.7;}
.generated-at{font-size:.7rem;opacity:.55;text-align:right;white-space:nowrap;}
.page{max-width:1600px;margin:0 auto;padding:20px 20px 60px;}
/* RUNS BAR */
.runs-bar{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 20px;margin-bottom:20px;}
.runs-bar h2{font-size:.85rem;color:var(--text-sub);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;}
.runs-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.run-tab{padding:7px 16px;border-radius:20px;border:2px solid var(--gray-3);background:var(--white);cursor:pointer;font-size:.85rem;color:var(--text-sub);font-weight:500;transition:var(--transition);}
.run-tab:hover{border-color:var(--blue-mid);color:var(--blue-dark);}
.run-tab.active-primary{background:var(--blue-dark);border-color:var(--blue-dark);color:var(--white);}
.run-tab.active-compare{background:var(--yellow-dark);border-color:var(--yellow-dark);color:var(--white);}
.compare-controls{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;}
.btn{padding:7px 16px;border-radius:20px;border:2px solid transparent;cursor:pointer;font-size:.83rem;font-weight:600;transition:var(--transition);}
.btn-primary{background:var(--blue-dark);color:var(--white);border-color:var(--blue-dark);}
.btn-primary:hover{background:var(--blue-mid);border-color:var(--blue-mid);}
.btn-secondary{background:var(--white);color:var(--blue-dark);border-color:var(--blue-dark);}
.btn-secondary:hover{background:var(--blue-light);}
.btn-yellow{background:var(--yellow);color:var(--text);border-color:var(--yellow-dark);}
.btn-yellow:hover{background:var(--yellow-dark);color:var(--white);}
.btn-ghost{background:transparent;color:var(--text-sub);border-color:var(--gray-3);}
.btn-ghost:hover{background:var(--gray-2);}
/* COMPARE BANNER */
.compare-banner{display:none;background:linear-gradient(90deg,#fff8e0,#fffdf0);border:1.5px solid var(--yellow);border-radius:var(--radius);padding:12px 20px;margin-bottom:16px;align-items:center;gap:12px;flex-wrap:wrap;}
.compare-banner.visible{display:flex;}
.compare-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:12px;font-size:.83rem;font-weight:600;}
.badge-primary{background:var(--blue-dark);color:var(--white);}
.badge-compare{background:var(--yellow-dark);color:var(--white);}
.compare-banner p{font-size:.85rem;color:var(--text-sub);}
/* KPIs */
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px;}
.kpi-card{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 16px;}
.kpi-label{font-size:.73rem;color:var(--text-sub);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}
.kpi-value{font-size:1.8rem;font-weight:700;color:var(--blue-dark);line-height:1;}
.kpi-unit{font-size:.7rem;color:var(--text-sub);margin-top:2px;}
.kpi-delta{font-size:.78rem;font-weight:600;margin-top:6px;}
.delta-pos{color:var(--occ-high);}.delta-neg{color:var(--occ-low);}.delta-neu{color:var(--text-sub);}
.kpi-card.kpi-occ .kpi-value{color:var(--occ-mid);}
.kpi-card.kpi-occ.high .kpi-value{color:var(--occ-high);}
.kpi-card.kpi-occ.low .kpi-value{color:var(--occ-low);}
/* SECTION HEADERS */
.section-header{display:flex;align-items:center;gap:10px;margin:24px 0 12px;}
.section-header h2{font-size:1.1rem;color:var(--blue-dark);font-weight:700;}
.section-line{flex:1;height:2px;background:var(--gray-3);border-radius:1px;}
.section-tag{padding:3px 10px;border-radius:10px;font-size:.72rem;font-weight:600;color:var(--white);}
/* COLLAPSIBLE SECTION TOGGLE */
.sec-toggle{padding:4px 14px;border-radius:14px;border:1.5px solid var(--gray-3);background:var(--white);cursor:pointer;font-size:.75rem;font-weight:600;color:var(--text-sub);transition:var(--transition);white-space:nowrap;}
.sec-toggle:hover{background:var(--gray-2);border-color:var(--blue-mid);color:var(--blue-dark);}
.sec-toggle.open{background:var(--blue-light);border-color:var(--blue-mid);color:var(--blue-dark);}
/* CHARTS */
.overview-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}
@media(max-width:860px){.overview-grid{grid-template-columns:1fr;}}
.chart-card{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px;}
.chart-card h3{font-size:.88rem;color:var(--text-sub);font-weight:600;margin-bottom:14px;}
.chart-wrap{position:relative;}
.chart-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:.78rem;color:var(--text-sub);margin-top:10px;}
.legend-item{display:flex;align-items:center;gap:6px;}
.legend-dot{width:10px;height:10px;border-radius:2px;flex-shrink:0;}
/* SUMMARY TABLE */
.summary-table-wrap{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;margin-bottom:20px;}
.summary-table{width:100%;border-collapse:collapse;font-size:.82rem;}
.summary-table th{background:var(--blue-dark);color:var(--white);padding:10px 14px;text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;}
.summary-table td{padding:9px 14px;border-bottom:1px solid var(--gray-2);}
.summary-table tr:last-child td{border-bottom:none;}
.summary-table tr:hover td{background:#f0f5fa;}
.summary-table .cat-row td{background:var(--blue-light);font-weight:700;color:var(--blue-dark);border-top:2px solid var(--blue-dark);}
.summary-table .total-row td{background:var(--blue-dark);color:var(--white);font-weight:700;border-top:3px solid var(--yellow);}
/* OCC PILLS */
.occ-pill{display:inline-block;padding:2px 8px;border-radius:10px;font-weight:700;font-size:.78rem;}
.pill-high{background:#d4f0e2;color:var(--occ-high);}
.pill-mid{background:#fce8d0;color:var(--occ-mid);}
.pill-low{background:#fad4d4;color:var(--occ-low);}
.pill-empty{background:var(--gray-2);color:var(--occ-empty);}
/* CHARTS GALLERY */
.gallery-cat-label{font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 8px;padding-left:2px;}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:8px;}
.gallery-card{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;transition:box-shadow var(--transition);}
.gallery-card:hover{box-shadow:0 4px 20px rgba(0,74,135,.16);}
.gallery-card-head{display:flex;align-items:flex-start;gap:10px;padding:14px 14px 10px;}
.gallery-cat-stripe{width:4px;min-height:40px;border-radius:3px;flex-shrink:0;margin-top:2px;}
.gallery-act-info{flex:1;min-width:0;}
.gallery-act-name{font-weight:700;font-size:.86rem;color:var(--text);margin-bottom:5px;line-height:1.3;}
.gallery-act-stats{display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
.gallery-act-stat{font-size:.74rem;color:var(--text-sub);}
.gallery-act-stat strong{color:var(--text);font-weight:700;}
.gallery-chart-btn{padding:5px 12px;border-radius:14px;border:1.5px solid var(--gray-3);background:var(--white);cursor:pointer;font-size:.74rem;font-weight:600;color:var(--blue-dark);transition:var(--transition);white-space:nowrap;flex-shrink:0;align-self:flex-start;margin-top:2px;}
.gallery-chart-btn:hover{background:var(--blue-light);border-color:var(--blue-mid);}
.gallery-chart-btn.open{background:var(--blue-dark);color:var(--white);border-color:var(--blue-dark);}
/* EXPORT BAR */
.export-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:10px 16px;margin-bottom:16px;}
.export-bar-label{font-size:.78rem;color:var(--text-sub);font-weight:600;white-space:nowrap;}
/* DETAIL SIDEBAR LAYOUT */
.detail-layout{display:flex;gap:16px;align-items:flex-start;}
.detail-sidebar{width:250px;flex-shrink:0;position:sticky;top:70px;max-height:calc(100vh - 90px);overflow-y:auto;background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);}
.detail-panel{flex:1;min-width:0;}
.sidebar-cat{border-bottom:1px solid var(--gray-2);}
.sidebar-cat:last-child{border-bottom:none;}
.sidebar-cat-hdr{display:flex;align-items:center;gap:7px;padding:10px 14px 8px;font-size:.73rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--white);z-index:1;border-bottom:1px solid var(--gray-2);}
.sidebar-cat-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.sidebar-act{display:block;width:100%;text-align:left;padding:7px 14px 7px 28px;font-size:.83rem;border:none;background:none;cursor:pointer;color:var(--text);transition:background var(--transition),color var(--transition);border-left:3px solid transparent;}
.sidebar-act:hover{background:var(--gray-1);}
.sidebar-act.active{background:var(--blue-light);color:var(--blue-dark);font-weight:600;border-left-color:var(--blue-dark);}
.detail-placeholder{display:flex;align-items:center;justify-content:center;min-height:200px;color:var(--text-sub);font-size:.95rem;background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:40px;text-align:center;}
.detail-act-card{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;}
.detail-act-hdr{padding:18px 20px;border-bottom:2px solid var(--gray-2);}
.detail-act-title{font-size:1.1rem;font-weight:700;margin-bottom:10px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.detail-act-cat{font-size:.8rem;color:var(--text-sub);font-weight:400;}
.detail-act-kpis{display:flex;gap:24px;flex-wrap:wrap;margin-top:10px;}
.detail-kpi{text-align:center;}
.detail-kpi-val{font-size:1.3rem;font-weight:700;color:var(--blue-dark);line-height:1.1;}
.detail-kpi-lbl{font-size:.7rem;color:var(--text-sub);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;}
.detail-kpi-sub{font-size:.75rem;color:var(--text-sub);margin-top:2px;}
.detail-chart-section{padding:16px 20px;border-bottom:1px solid var(--gray-2);}
.detail-chart-btns{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;}
.detail-slot-section{padding:16px 20px;overflow-x:auto;}
/* CHART MODAL */
.chart-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;}
.chart-modal.open{display:flex;}
.chart-modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.65);}
.chart-modal-content{position:relative;background:var(--white);border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.35);width:92vw;max-width:1100px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;}
.chart-modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--gray-2);flex-shrink:0;}
.chart-modal-title{font-size:1rem;font-weight:700;color:var(--blue-dark);}
.chart-modal-close{padding:6px 14px;border-radius:14px;border:1.5px solid var(--gray-3);background:var(--white);cursor:pointer;font-size:.83rem;font-weight:600;color:var(--text-sub);}
.chart-modal-close:hover{background:var(--gray-2);}
.modal-sort-btns{display:flex;gap:6px;flex-wrap:wrap;}
.modal-sort-btn{padding:5px 13px;border-radius:14px;border:1.5px solid var(--gray-3);background:var(--white);cursor:pointer;font-size:.78rem;font-weight:600;color:var(--text-sub);transition:var(--transition);}
.modal-sort-btn:hover{background:var(--gray-2);border-color:var(--blue-mid);color:var(--blue-dark);}
.modal-sort-btn.active{background:var(--blue-dark);border-color:var(--blue-dark);color:var(--white);}
/* Day filter buttons */
.day-filter-row{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding:4px 0 0;}
.day-filter-btn{padding:3px 11px;border-radius:12px;border:1.5px solid var(--gray-3);background:var(--white);cursor:pointer;font-size:.73rem;font-weight:600;color:var(--text-sub);transition:var(--transition);white-space:nowrap;}
.day-filter-btn:hover{background:var(--gray-2);border-color:var(--blue-mid);color:var(--blue-dark);}
.day-filter-btn.active{background:var(--blue-dark);border-color:var(--blue-dark);color:var(--white);}
.day-filter-label{font-size:.72rem;color:var(--text-sub);margin-right:2px;white-space:nowrap;}
.modal-day-row{padding:7px 20px;border-bottom:1px solid var(--gray-2);display:flex;gap:5px;flex-wrap:wrap;align-items:center;background:var(--gray-1);flex-shrink:0;}
.chart-modal-body{flex:1;padding:20px;overflow:auto;display:flex;align-items:center;justify-content:center;}
.chart-modal-body canvas{max-height:65vh;width:100%!important;}
.slot-table{width:100%;border-collapse:collapse;font-size:.8rem;}
.slot-table th{background:var(--gray-2);padding:7px 10px;text-align:left;font-size:.73rem;text-transform:uppercase;letter-spacing:.04em;}
.slot-table td{padding:7px 10px;border-bottom:1px solid var(--gray-2);}
.slot-table tr:last-child td{border-bottom:none;}
.occ-bar-wrap{display:flex;align-items:center;gap:8px;}
.occ-bar-track{flex:1;height:8px;background:var(--gray-2);border-radius:4px;overflow:hidden;}
.occ-bar-fill{height:100%;border-radius:4px;}
.occ-pct{font-size:.75rem;font-weight:700;min-width:42px;}
.occ-high{color:var(--occ-high);}.occ-mid{color:var(--occ-mid);}.occ-low{color:var(--occ-low);}.occ-empty{color:var(--occ-empty);}
.slot-day{font-weight:600;}.slot-time{color:var(--text-sub);}.slot-div{color:var(--text-sub);font-size:.78rem;}
/* Scrollable chart container */
.chart-scroll-section{position:relative;}
.chart-scroll-wrap{overflow-x:hidden;overflow-y:visible;position:relative;border-radius:6px;}
.chart-nav-btn{position:absolute;top:50%;transform:translateY(-50%);z-index:5;background:rgba(0,74,135,.82);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:19px;line-height:30px;text-align:center;padding:0;transition:opacity .2s,background .15s;box-shadow:0 2px 8px rgba(0,0,0,.25);}
.chart-nav-btn:hover{background:rgba(0,74,135,1);}
.chart-nav-prev{left:4px;}.chart-nav-next{right:4px;}
.chart-scroll-hint{font-size:.7rem;color:var(--text-sub);text-align:right;margin-top:3px;opacity:.7;}
.chart-empty{color:var(--text-sub);font-size:.85rem;text-align:center;padding:24px 0;}
@media(max-width:760px){.detail-layout{flex-direction:column;}.detail-sidebar{width:100%;position:relative;max-height:220px;top:0;}}
/* TENDENCIAS */
.btn-trend{background:linear-gradient(135deg,#0b3d6e,#1a7abf);color:var(--white);border-color:#0b3d6e;}
.btn-trend:hover{background:linear-gradient(135deg,#1a7abf,#0b3d6e);}
.trends-section{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px;margin-bottom:20px;}
.trend-period-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.trend-period-btn{padding:5px 14px;border-radius:16px;border:1.5px solid var(--gray-3);background:var(--white);cursor:pointer;font-size:.8rem;font-weight:600;color:var(--text-sub);transition:var(--transition);}
.trend-period-btn:hover{background:var(--gray-2);border-color:var(--blue-mid);}
.trend-period-btn.active{background:var(--blue-dark);border-color:var(--blue-dark);color:var(--white);}
.trend-custom-row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;padding:12px 16px;background:var(--gray-1);border-radius:8px;border:1px solid var(--gray-3);}
.trend-custom-row label{font-size:.8rem;font-weight:700;color:var(--text-sub);display:flex;flex-direction:column;gap:4px;}
.trend-custom-row input{padding:7px 10px;border:1.5px solid var(--gray-3);border-radius:7px;font-size:.85rem;color:var(--text);}
.trend-metrics{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;}
.trend-metric{background:var(--gray-1);border-radius:8px;padding:10px 14px;text-align:center;flex:1;min-width:100px;}
.trend-metric .t-val{font-size:1.2rem;font-weight:700;color:var(--blue-dark);line-height:1;}
.trend-metric .t-lbl{font-size:.7rem;color:var(--text-sub);text-transform:uppercase;letter-spacing:.04em;margin-top:3px;}
.trend-charts-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:860px){.trend-charts-grid{grid-template-columns:1fr;}}
.gallery-trend-btn{padding:5px 12px;border-radius:14px;border:1.5px solid #c8e0f0;background:#e8f3fa;cursor:pointer;font-size:.74rem;font-weight:600;color:var(--blue-dark);transition:var(--transition);white-space:nowrap;flex-shrink:0;align-self:flex-start;margin-top:2px;}
.gallery-trend-btn:hover{background:var(--blue-light);border-color:var(--blue-mid);}
.gallery-card-btns{display:flex;flex-direction:column;gap:6px;flex-shrink:0;align-self:flex-start;margin-top:2px;}
.trend-modal-empty{color:var(--text-sub);text-align:center;padding:32px;font-size:.92rem;}
/* ── DARK MODE ──────────────────────────────────────────────────────────── */
html.dark{
  color-scheme:dark;
  --blue-dark:#004a87;--blue-mid:#3da8e0;--blue-light:#0c2035;
  --yellow:#f6c900;--yellow-dark:#c9a100;
  --gray-1:#0d1822;--gray-2:#121e2d;--gray-3:#1b3048;--gray-4:#3a6070;
  --text:#cfe3f5;--text-sub:#5e8eb0;--white:#172436;
  --shadow:0 4px 24px rgba(0,0,0,.55);--transition:.2s ease;
  --occ-high:#27c76a;--occ-mid:#e8920a;--occ-low:#e05555;--occ-empty:#4a7a99;
}
html.dark body{background:var(--gray-1);color:var(--text);}
html.dark .site-header{background:#071422;box-shadow:0 2px 12px rgba(0,0,0,.6);}
html.dark .runs-bar,html.dark .chart-card,html.dark .gallery-card,html.dark .export-bar,html.dark .summary-table-wrap,html.dark .detail-sidebar,html.dark .detail-act-card,html.dark .kpi-card,html.dark .chart-modal-content,html.dark .trends-section{background:var(--white);}
html.dark .run-tab{background:var(--white);color:var(--text-sub);border-color:var(--gray-3);}
html.dark .run-tab:hover{color:var(--blue-mid);border-color:var(--blue-mid);}
html.dark .btn-secondary{background:var(--white);color:var(--blue-mid);border-color:var(--blue-mid);}
html.dark .btn-secondary:hover{background:var(--blue-light);}
html.dark .btn-ghost{color:var(--text-sub);border-color:var(--gray-3);}
html.dark .btn-ghost:hover{background:var(--gray-2);}
html.dark .btn-trend{background:linear-gradient(135deg,#003060,#004a87);border-color:#003060;}
html.dark .compare-banner{background:linear-gradient(90deg,#1a1300,#1c1a00);border-color:var(--yellow-dark);}
html.dark .kpi-value{color:var(--blue-mid);}
html.dark .section-header h2{color:var(--blue-mid);}
html.dark .sec-toggle{background:var(--white);color:var(--text-sub);border-color:var(--gray-3);}
html.dark .sec-toggle:hover{background:var(--gray-2);}
html.dark .sec-toggle.open{background:var(--blue-light);color:var(--blue-mid);border-color:var(--blue-mid);}
html.dark .summary-table th{background:#071422;color:var(--text);}
html.dark .summary-table td{border-color:var(--gray-3);}
html.dark .summary-table tr:hover td{background:var(--gray-2);}
html.dark .summary-table .cat-row td{background:var(--blue-light);color:var(--blue-mid);border-color:var(--gray-3);}
html.dark .summary-table .total-row td{background:#004a87;color:#fff;}
html.dark .slot-table th{background:var(--gray-2);color:var(--text-sub);}
html.dark .slot-table td{border-color:var(--gray-3);}
html.dark .slot-table tr:hover td{background:var(--gray-2);}
html.dark .modal-sort-btn{background:var(--white);color:var(--text-sub);border-color:var(--gray-3);}
html.dark .modal-sort-btn:hover{background:var(--gray-2);color:var(--text);}
html.dark .modal-sort-btn.active{background:#004a87;color:#fff;border-color:#004a87;}
html.dark .day-filter-btn{background:var(--white);color:var(--text-sub);border-color:var(--gray-3);}
html.dark .day-filter-btn.active{background:#004a87;color:#fff;border-color:#004a87;}
html.dark .modal-day-row{background:var(--gray-2);}
html.dark .chart-modal-header{border-color:var(--gray-3);}
html.dark .chart-modal-close{background:var(--white);color:var(--text-sub);border-color:var(--gray-3);}
html.dark .chart-modal-close:hover{background:var(--gray-2);}
html.dark .chart-modal-backdrop{background:rgba(0,0,0,.82);}
html.dark .act-row:hover{background:var(--gray-2);}
html.dark .act-panel{border-color:var(--gray-3);}
html.dark .detail-act-hdr{border-color:var(--gray-3);}
html.dark .detail-chart-section{border-color:var(--gray-3);}
html.dark .detail-kpi-val{color:var(--blue-mid);}
html.dark .gallery-act-name{color:var(--text);}
html.dark .gallery-trend-btn{background:var(--blue-light);border-color:var(--gray-3);color:var(--blue-mid);}
html.dark .gallery-trend-btn:hover{background:var(--gray-2);border-color:var(--blue-mid);}
html.dark .sidebar-act:hover{background:var(--gray-2);}
html.dark .sidebar-act.active{background:var(--blue-light);color:var(--blue-mid);border-left-color:var(--blue-mid);}
html.dark .sidebar-cat-hdr{background:var(--white);border-color:var(--gray-3);}
html.dark .occ-bar-track{background:var(--gray-3);}
html.dark input[type="month"]{background:var(--gray-2);border-color:var(--gray-3);color:var(--text);}
html.dark .trend-period-btn{background:var(--white);border-color:var(--gray-3);color:var(--text-sub);}
html.dark .trend-period-btn:hover{background:var(--gray-2);}
html.dark .trend-period-btn.active{background:#004a87;color:#fff;border-color:#004a87;}
html.dark .trend-custom-row{background:var(--gray-2);border-color:var(--gray-3);}
html.dark .trend-metric{background:var(--gray-2);}
html.dark .trend-metric .t-val{color:var(--blue-mid);}
html.dark .cat-section{background:var(--white);}
html.dark .cat-header:hover{background:var(--gray-2);}
html.dark .gallery-chart-btn{background:var(--white);border-color:var(--gray-3);color:var(--blue-mid);}
html.dark .gallery-chart-btn:hover{background:var(--blue-light);border-color:var(--blue-mid);}
html.dark .gallery-chart-btn.open{background:#004a87;color:#fff;border-color:#004a87;}
/* ── THEME TOGGLE BUTTON ─────────────────────────────────────────────────── */
.theme-toggle{background:rgba(255,255,255,.12);border:1.5px solid rgba(255,255,255,.2);border-radius:20px;padding:5px 14px;cursor:pointer;color:#fff;font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:7px;transition:background .2s,border-color .2s;white-space:nowrap;flex-shrink:0;}
.theme-toggle:hover{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.4);}
/* ── MONTHLY CLASS CHANGES ──────────────────────────────────────────────── */
.badge-nueva{display:inline-block;padding:1px 7px;border-radius:10px;font-size:.64rem;font-weight:800;background:#1a9b4d;color:#fff;letter-spacing:.04em;text-transform:uppercase;vertical-align:middle;margin-left:5px;line-height:1.6;}
.gallery-card.card-new{outline:2px solid #1a9b4d;}
.sidebar-act .badge-nueva{font-size:.58rem;padding:0px 5px;line-height:1.5;}
.changes-section{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 20px;margin-bottom:4px;}
.changes-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}
@media(max-width:600px){.changes-kpis{grid-template-columns:1fr;}}
.change-kpi{padding:14px 12px;border-radius:8px;text-align:center;}
.change-kpi-active{background:var(--blue-light);border:1px solid #c0d8f0;}
.change-kpi-new{background:#e8f6ef;border:1px solid #a8d8ba;}
.change-kpi-retired{background:var(--gray-2);border:1px solid var(--gray-3);}
.change-kpi-val{font-size:1.6rem;font-weight:700;line-height:1;}
.change-kpi-lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;margin-top:4px;color:var(--text-sub);}
.change-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.change-item{padding:4px 11px;border-radius:12px;font-size:.8rem;font-weight:500;border:1px solid;}
.change-item-new{background:#e8f6ef;color:#1a7a3e;border-color:#a8d8ba;}
.change-item-retired{background:var(--gray-2);color:var(--text-sub);border-color:var(--gray-3);text-decoration:line-through;}
.change-subhead{font-size:.8rem;font-weight:700;margin:10px 0 5px;}
html.dark .changes-section{background:var(--white);}
html.dark .change-kpi-active{background:var(--blue-light);border-color:var(--gray-3);}
html.dark .change-kpi-new{background:var(--blue-light);border-color:var(--gray-3);}
html.dark .change-kpi-retired{background:var(--gray-2);border-color:var(--gray-3);}
html.dark .change-item-new{background:rgba(26,155,77,.15);color:var(--occ-high);border-color:rgba(26,155,77,.3);}
html.dark .change-item-retired{background:var(--gray-2);color:var(--text-sub);border-color:var(--gray-3);}
html.dark .gallery-card.card-new{outline-color:var(--occ-high);}
@media print{.site-header{position:relative;}.chart-modal{display:none!important;}}
</style>
</head>
<body>

<header class="site-header">
  <div class="site-header-inner">
    ${logoSrc ? `<img class="site-logo" src="${logoSrc}" alt="Llacolén">` : ''}
    <div class="site-title">
      <h1>Dashboard Estadísticas MatchPoint</h1>
      <p>Campos Deportivos Llacolén</p>
    </div>
    <div class="generated-at">Generado el ${escHtml(generatedAt)}</div>
    <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()" title="Cambiar modo claro/oscuro">
      <span id="themeIcon">🌙</span><span id="themeLabel">Oscuro</span>
    </button>
  </div>
</header>

<div class="page">

  <div class="runs-bar">
    <h2>Seleccionar período</h2>
    <div class="runs-tabs" id="runsTabs">
      <div class="compare-controls">
        <button class="btn btn-secondary" id="btnCompareMode">⇄ Comparar meses</button>
        <button class="btn btn-yellow" id="btnYoY" title="Comparar con el mismo mes del año anterior">↔ Año anterior</button>
        <button class="btn btn-ghost" id="btnClearCompare" style="display:none">✕ Quitar</button>
        <button class="btn btn-trend" id="btnTrends">📈 Tendencias</button>
      </div>
    </div>
  </div>

  <!-- TENDENCIAS HISTÓRICAS -->
  <div id="trendsSection" class="trends-section" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h2 style="font-size:1.1rem;color:var(--blue-dark);font-weight:700;margin:0">📈 Tendencias históricas</h2>
      <button class="btn btn-ghost" style="padding:5px 14px;font-size:.78rem" onclick="closeTrendsView()">✕ Cerrar</button>
    </div>
    <div class="trend-period-row" id="trendPeriodBtns">
      <button class="trend-period-btn active" data-tp="6m">6 últimos meses</button>
      <button class="trend-period-btn" data-tp="year">Todo el año</button>
      <button class="trend-period-btn" data-tp="all">Todo</button>
      <button class="trend-period-btn" data-tp="custom">Personalizado</button>
    </div>
    <div id="trendCustomRow" class="trend-custom-row" style="display:none">
      <label>Desde<input type="month" id="trendFrom"></label>
      <label>Hasta<input type="month" id="trendTo"></label>
      <button class="btn btn-primary" style="padding:7px 16px;font-size:.82rem" onclick="applyTrendCustom()">Aplicar</button>
    </div>
    <div id="trendMetrics" class="trend-metrics"></div>
    <div class="trend-charts-grid">
      <div class="chart-card" style="box-shadow:none;border:1px solid var(--gray-3)">
        <h3 style="font-size:.85rem;color:var(--text-sub);font-weight:600;margin-bottom:12px">Inscritos por mes</h3>
        <div class="chart-wrap"><canvas id="trendChartAtt" height="240"></canvas></div>
      </div>
      <div class="chart-card" style="box-shadow:none;border:1px solid var(--gray-3)">
        <h3 style="font-size:.85rem;color:var(--text-sub);font-weight:600;margin-bottom:12px">Ocupación % por mes</h3>
        <div class="chart-wrap"><canvas id="trendChartOcc" height="240"></canvas></div>
      </div>
    </div>
  </div>

  <div class="compare-banner" id="compareBanner">
    <span class="compare-badge badge-primary" id="compareBadge1">—</span>
    <span style="font-weight:700;font-size:1rem;">vs</span>
    <span class="compare-badge badge-compare" id="compareBadge2">—</span>
    <p id="compareBannerMsg"></p>
  </div>

  <!-- BARRA DE EXPORTACIÓN -->
  <div class="export-bar">
    <span class="export-bar-label">Exportar per\xEDodo seleccionado:</span>
    <button class="btn btn-secondary" style="padding:5px 14px;font-size:.78rem" onclick="exportExcel()">\uD83D\uDCE5 Excel</button>
    <button class="btn btn-secondary" style="padding:5px 14px;font-size:.78rem" onclick="exportPdf()">\uD83D\uDCC4 PDF (imprimir)</button>
    <button class="btn btn-secondary" style="padding:5px 14px;font-size:.78rem" onclick="exportPptx()">\uD83D\uDCCA PowerPoint</button>
    <button class="btn btn-yellow" style="padding:5px 14px;font-size:.78rem;font-weight:700" onclick="exportPptxV2()">\u2728 PowerPoint 2.0</button>
  </div>

  <!-- INDICADORES CLAVE -->
  <div class="section-header">
    <h2>Indicadores clave</h2>
    <div class="section-line"></div>
    <button class="sec-toggle open" id="toggleKpis" onclick="toggleSection('kpisContent','toggleKpis')">▼ Ocultar</button>
  </div>
  <div id="kpisContent">
    <div class="kpis" id="kpisSection"></div>
  </div>

  <!-- CAMBIOS MENSUALES DE CLASES -->
  <div class="section-header">
    <h2>Cambios de clases del mes</h2>
    <div class="section-line"></div>
    <button class="sec-toggle open" id="toggleChanges" onclick="toggleSection('changesContent','toggleChanges')">▼ Ocultar</button>
  </div>
  <div id="changesContent">
    <div id="classChangesSection"></div>
  </div>

  <!-- RESUMEN POR CATEGORÍA -->
  <div class="section-header">
    <h2>Resumen por categoría</h2>
    <div class="section-line"></div>
    <button class="sec-toggle open" id="toggleOverview" onclick="toggleSection('overviewContent','toggleOverview')">▼ Ocultar</button>
  </div>
  <div id="overviewContent">
    <div class="overview-grid">
      <div class="chart-card">
        <h3 id="chartOverviewTitle">Inscritos y cupos por categoría</h3>
        <div class="chart-wrap"><canvas id="chartOverview" height="280"></canvas></div>
        <div class="chart-legend" id="legendOverview"></div>
      </div>
      <div class="chart-card">
        <h3>Ocupación % por categoría</h3>
        <div class="chart-wrap"><canvas id="chartOccupancy" height="280"></canvas></div>
      </div>
    </div>
  </div>

  <!-- COMPARACIÓN DIRECTA (sólo en modo comparar) -->
  <div id="trendSection" style="display:none">
    <div class="section-header">
      <h2>Comparación directa</h2>
      <div class="section-line"></div>
      <button class="gallery-chart-btn" onclick="openCompareModal()">\uD83D\uDCCA Ver comparaci\xF3n</button>
    </div>
  </div>

  <!-- TABLA RESUMEN (inicia colapsada) -->
  <div class="section-header">
    <h2>Tabla resumen de actividades</h2>
    <div class="section-line"></div>
    <button class="sec-toggle" id="toggleSummary" onclick="toggleSection('summaryContent','toggleSummary')">▶ Mostrar</button>
  </div>
  <div id="summaryContent" style="display:none">
    <div class="summary-table-wrap">
      <table class="summary-table" id="summaryTable"></table>
    </div>
  </div>

  <!-- GRÁFICOS POR ACTIVIDAD (estilo PowerPoint) -->
  <div class="section-header">
    <h2>Gráficos por actividad</h2>
    <div class="section-line"></div>
    <span class="section-tag" style="background:var(--blue-mid)">PowerPoint</span>
    <button class="sec-toggle open" id="toggleGallery" onclick="toggleSection('galleryContent','toggleGallery')">▼ Ocultar</button>
  </div>
  <div id="galleryContent">
    <div id="chartsGallery"></div>
  </div>

  <!-- DETALLE POR ACTIVIDAD - menú lateral fijo -->
  <div class="section-header">
    <h2>Detalle por actividad</h2>
    <div class="section-line"></div>
  </div>
  <div class="detail-layout">
    <div class="detail-sidebar" id="detailSidebar"></div>
    <div class="detail-panel" id="detailPanel">
      <div class="detail-placeholder"><p>👈 Selecciona una actividad del menú lateral para ver su estadística</p></div>
    </div>
  </div>

</div>

<!-- MODAL GRÁFICO AMPLIADO -->
<div class="chart-modal" id="chartModal">
  <div class="chart-modal-backdrop" id="chartModalBackdrop"></div>
  <div class="chart-modal-content">
    <div class="chart-modal-header">
      <span class="chart-modal-title" id="chartModalTitle">Gráfico</span>
      <div class="modal-sort-btns" id="modalSortBtns">
        <button class="modal-sort-btn active" id="sortByHour">\u23F1 Por hora</button>
        <button class="modal-sort-btn" id="sortByDay">\uD83D\uDCC5 Por d\xEDa</button>
        <button class="modal-sort-btn" id="sortByTrend">\uD83D\uDCC8 Tendencia</button>
      </div>
      <button class="chart-modal-close" id="chartModalClose">✕ Cerrar</button>
    </div>
    <div id="modalDayBtns" class="modal-day-row" style="display:none"></div>
    <div class="chart-modal-body">
      <canvas id="chartModalCanvas"></canvas>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"></script>
<script>
const ALL_RUNS = ${dataJson};
// Sort oldest → newest so tabs read left-to-right chronologically
ALL_RUNS.sort((a, b) => (a.monthKey || '').localeCompare(b.monthKey || ''));
let primaryIdx = ALL_RUNS.length > 0 ? ALL_RUNS.length - 1 : 0; // default: most recent
let compareIdxs = []; let compareMode = false;
let yearFilter = null; // null = all years visible
const CMP_PALETTE = [
  { bg: 'rgba(246,201,0,.82)', border: '#c9a100' },
  { bg: 'rgba(220,80,60,.78)', border: '#c0392b' },
  { bg: 'rgba(52,168,83,.78)', border: '#1a7a3e' },
  { bg: 'rgba(130,80,190,.78)', border: '#7b3fa0' },
  { bg: 'rgba(0,150,150,.78)', border: '#006b6b' },
];
const charts = {};

function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
function pct(val) { return (Math.round(10 * val) / 10).toFixed(1) + '%'; }
function num(val) { return Number(val).toLocaleString('es-CL'); }
function occPillClass(p) { return p >= 90 ? 'pill-high' : p >= 70 ? 'pill-mid' : p >= 40 ? 'pill-low' : 'pill-empty'; }
function occBarColor(p) { return p >= 90 ? 'var(--occ-high)' : p >= 70 ? 'var(--occ-mid)' : p >= 40 ? 'var(--blue-mid)' : 'var(--occ-empty)'; }
function occClass(p) { return p >= 90 ? 'occ-high' : p >= 70 ? 'occ-mid' : p >= 40 ? '' : 'occ-empty'; }
function delta(v1, v2) { if (!v2) return null; return Math.round(10 * (v1 - v2) / v2 * 100) / 10; }
function deltaHtml(v1, v2, unit) {
  if (compareIdxs.length !== 1 || v2 == null || v2 === 0) return '';
  const d = delta(v1, v2); if (d === null) return '';
  const cls = d > 0 ? 'delta-pos' : d < 0 ? 'delta-neg' : 'delta-neu';
  return '<span class="kpi-delta ' + cls + '">' + (d > 0 ? '+' : '') + d + (unit || '') + ' vs. ' + ALL_RUNS[compareIdxs[0]].label + '</span>';
}
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/* SECTION TOGGLE */
function toggleSection(contentId, btnId) {
  const el = document.getElementById(contentId);
  const btn = document.getElementById(btnId);
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : '';
  if (btn) {
    btn.textContent = isOpen ? '▶ Mostrar' : '▼ Ocultar';
    isOpen ? btn.classList.remove('open') : btn.classList.add('open');
  }
}

/* RUN TABS */
function getAvailableYears() {
  const y = new Set();
  ALL_RUNS.forEach(r => { if (r.monthKey) y.add(r.monthKey.slice(0, 4)); });
  return [...y].sort();
}

function renderYearFilters() {
  const runsBar = document.querySelector('.runs-bar');
  if (!runsBar) return;
  let yearRow = document.getElementById('yearFilterRow');
  if (!yearRow) {
    yearRow = document.createElement('div');
    yearRow.id = 'yearFilterRow';
    yearRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--gray-3)';
    const h2 = runsBar.querySelector('h2');
    if (h2) h2.after(yearRow); else runsBar.prepend(yearRow);
  }
  const years = getAvailableYears();
  if (years.length <= 1) { yearRow.style.display = 'none'; return; }
  yearRow.style.display = 'flex';
  yearRow.innerHTML =
    '<span style="font-size:.72rem;color:var(--text-sub);font-weight:600;margin-right:2px">A\xF1o:</span>' +
    years.map(y =>
      '<button class="run-tab year-tab' + (yearFilter === y ? ' active-primary' : '') + '" data-y="' + y + '" style="padding:5px 14px;border-radius:14px;font-size:.8rem">' + y + '</button>'
    ).join('');
  yearRow.querySelectorAll('.year-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const y = btn.dataset.y;
      yearFilter = (yearFilter === y) ? null : y;
      renderYearFilters();
      renderTabs();
    });
  });
}

function renderTabs() {
  const container = document.getElementById('runsTabs');
  const controls = container.querySelector('.compare-controls');
  [...container.querySelectorAll('.run-tab:not(.year-tab)')].forEach(el => el.remove());
  const visible = ALL_RUNS
    .map((run, i) => ({ run, i }))
    .filter(({ run }) => !yearFilter || (run.monthKey && run.monthKey.startsWith(yearFilter)));
  visible.forEach(({ run, i }) => {
    const tab = document.createElement('button');
    const cmpPos = compareIdxs.indexOf(i);
    tab.className = 'run-tab' + (i === primaryIdx ? ' active-primary' : '') + (cmpPos >= 0 ? ' active-compare' : '');
    if (cmpPos >= 0) {
      const pal = CMP_PALETTE[cmpPos % CMP_PALETTE.length];
      tab.style.background = pal.border; tab.style.borderColor = pal.border; tab.style.color = '#fff';
    }
    tab.textContent = run.label + (compareIdxs.length > 1 && cmpPos >= 0 ? ' (' + (cmpPos + 1) + ')' : '');
    tab.title = run.dateFrom + ' \u2192 ' + run.dateTo;
    tab.onclick = () => onTabClick(i);
    container.insertBefore(tab, controls);
  });
}
function onTabClick(idx) {
  if (!compareMode) { primaryIdx = idx; compareIdxs = []; }
  else {
    if (idx === primaryIdx) return;
    const pos = compareIdxs.indexOf(idx);
    if (pos >= 0) { compareIdxs.splice(pos, 1); } else { compareIdxs.push(idx); }
  }
  refresh();
}
document.getElementById('btnCompareMode').onclick = () => {
  compareMode = !compareMode; if (!compareMode) { compareIdxs = []; }
  document.getElementById('btnCompareMode').textContent = compareMode ? '\u2026selecciona meses' : '\u21c4 Comparar meses';
  refresh();
};
document.getElementById('btnClearCompare').onclick = () => {
  compareIdxs = []; compareMode = false;
  document.getElementById('btnCompareMode').textContent = '\u21c4 Comparar meses';
  refresh();
};
document.getElementById('btnYoY').onclick = () => {
  const primary = ALL_RUNS[primaryIdx];
  if (!primary || !primary.monthKey) return;
  const [y, m] = primary.monthKey.split('-').map(Number);
  const prevKey = (y - 1) + '-' + String(m).padStart(2, '0');
  const prevIdx = ALL_RUNS.findIndex(r => r.monthKey === prevKey);
  if (prevIdx < 0) { alert('No hay datos del mismo mes del a\xF1o anterior (' + prevKey + ').'); return; }
  if (compareIdxs.indexOf(prevIdx) < 0) compareIdxs.push(prevIdx);
  compareMode = false;
  document.getElementById('btnCompareMode').textContent = '\u21c4 Comparar meses';
  refresh();
};

/* KPIs */
function renderKpis(primary, compareRuns) {
  const t = primary.totals, tc = compareRuns.length === 1 ? compareRuns[0].totals : null;
  const occ = t.occupancyPct, occCls = occ >= 90 ? 'high' : occ < 50 ? 'low' : '';
  function kpi(label, val, unit, cmpVal, extraCls) {
    const d = tc != null ? deltaHtml(val, cmpVal, unit === '%' ? ' pp' : '') : '';
    return '<div class="kpi-card ' + (extraCls || '') + '"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + (unit === '%' ? pct(val).replace('%', '') : num(val)) + '</div>' +
      '<div class="kpi-unit">' + unit + '</div>' + d + '</div>';
  }
  document.getElementById('kpisSection').innerHTML =
    kpi('Eventos totales', t.events, 'eventos', tc && tc.events) +
    kpi('Inscritos', t.attendees, 'personas', tc && tc.attendees) +
    kpi('Cupo total', t.capacity, 'cupos', tc && tc.capacity) +
    kpi('Clases realizadas', t.classes, 'clases', tc && tc.classes) +
    kpi('Ocupaci\xF3n', t.occupancyPct, '%', tc && tc.occupancyPct, 'kpi-occ ' + occCls);
}

/* OVERVIEW CHARTS — with correct month labels on every dataset */
function renderOverviewCharts(primary, compareRuns) {
  destroyChart('overview');
  const cats = primary.categories;
  const labels = cats.map(c => c.label);
  const attData = cats.map(c => c.totals.attendees);
  const capData = cats.map(c => c.totals.capacity);
  const datasets = [
    { label: 'Cupos', data: capData, backgroundColor: cats.map(c => hexToRgba(c.color, .25)), borderColor: cats.map(c => c.color), borderWidth: 2, borderRadius: 4 },
    { label: 'Inscritos ' + primary.label, data: attData, backgroundColor: cats.map(c => hexToRgba(c.color, .85)), borderColor: cats.map(c => c.color), borderWidth: 0, borderRadius: 4 }
  ];
  compareRuns.forEach((cmp, ci) => {
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    const cAtt = labels.map(l => { const c = cmp.categories.find(x => x.label === l); return c ? c.totals.attendees : 0; });
    datasets.push({ label: 'Inscritos ' + cmp.label, data: cAtt, backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 0, borderRadius: 4 });
  });
  const legendEl = document.getElementById('legendOverview');
  if (legendEl) {
    legendEl.innerHTML =
      '<span class="legend-item"><span class="legend-dot" style="background:#d5e0ec;border:2px solid #8fa8c4"></span>Cupos</span>' +
      '<span class="legend-item"><span class="legend-dot" style="background:var(--blue-dark)"></span>Inscritos ' + primary.label + '</span>' +
      compareRuns.map((cmp, ci) => { const pal = CMP_PALETTE[ci % CMP_PALETTE.length]; return '<span class="legend-item"><span class="legend-dot" style="background:' + pal.border + '"></span>Inscritos ' + cmp.label + '</span>'; }).join('');
  }
  charts.overview = new Chart(document.getElementById('chartOverview'), {
    type: 'bar', data: { labels, datasets },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 14 } },
        tooltip: { callbacks: { afterLabel(ctx) { if (ctx.datasetIndex === 1) { const cap = capData[ctx.dataIndex]; return 'Ocupaci\xF3n: ' + pct(cap > 0 ? 100 * ctx.parsed.x / cap : 0); } return ''; } } }
      },
      scales: { x: { beginAtZero: true, grid: { color: gc() }, ticks: { font: { size: 11 } } }, y: { ticks: { font: { size: 11 } } } }
    }
  });
  destroyChart('occupancy');
  const occData = cats.map(c => c.totals.occupancyPct);
  const occDS = [{ label: 'Ocupaci\xF3n % ' + primary.label, data: occData, backgroundColor: occData.map(p => p >= 90 ? 'rgba(26,155,77,.8)' : p >= 70 ? 'rgba(224,123,0,.8)' : p >= 40 ? 'rgba(26,122,191,.7)' : 'rgba(154,174,189,.5)'), borderRadius: 4, borderWidth: 0 }];
  compareRuns.forEach((cmp, ci) => {
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    const occCData = labels.map(l => { const c = cmp.categories.find(x => x.label === l); return c ? c.totals.occupancyPct : 0; });
    occDS.push({ label: 'Ocupaci\xF3n % ' + cmp.label, data: occCData, backgroundColor: pal.bg, borderRadius: 4, borderWidth: 0 });
  });
  charts.occupancy = new Chart(document.getElementById('chartOccupancy'), {
    type: 'bar', data: { labels, datasets: occDS },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 14 } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + pct(ctx.parsed.x) } } },
      scales: { x: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: gc() } }, y: { ticks: { font: { size: 11 } } } }
    }
  });
}

/* COMPARE TREND */
function renderCompareChart(primary, compareRuns) {
  destroyChart('compareCat');
  const labels = primary.categories.map(c => c.label);
  const datasets = [{ label: primary.label, data: primary.categories.map(c => c.totals.attendees), backgroundColor: 'rgba(0,74,135,.8)', borderRadius: 4, borderWidth: 0 }];
  compareRuns.forEach((cmp, ci) => {
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    datasets.push({ label: cmp.label, data: labels.map(l => { const c = cmp.categories.find(x => x.label === l); return c ? c.totals.attendees : 0; }), backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 1, borderRadius: 4 });
  });
  charts.compareCat = new Chart(document.getElementById('chartCompareCat'), {
    type: 'bar', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 14 } } }, scales: { x: { ticks: { font: { size: 11 } } }, y: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: gc() } } } }
  });
}

/* SUMMARY TABLE */
function renderSummaryTable(primary, compareRuns) {
  const head = '<thead><tr><th>Actividad</th><th>Inscritos ' + primary.label + '</th>' +
    compareRuns.map(r => '<th>Inscritos ' + r.label + '</th>').join('') +
    '<th>Cupos</th><th>Clases</th><th>Prom.</th><th>Ocupaci\xF3n</th></tr></thead>';
  let body = '<tbody>', grandAtt = 0, grandCap = 0, grandCls = 0;
  for (const cat of primary.categories) {
    body += '<tr class="cat-row"><td colspan="' + (6 + compareRuns.length) + '" style="color:' + cat.color + '">' + cat.label + '</td></tr>';
    for (const act of cat.activities) {
      const t = act.totals;
      const cmpAtt0 = compareRuns.length === 1 ? (() => { const catCmp = compareRuns[0].categories.find(c => c.label === cat.label); const cmpAct = catCmp ? catCmp.activities.find(a => a.label === act.label) : null; return cmpAct ? cmpAct.totals.attendees : null; })() : null;
      const d = cmpAtt0 != null ? delta(t.attendees, cmpAtt0) : null;
      const dHtml = d != null ? ' <span style="font-size:.75rem;font-weight:600;color:' + (d > 0 ? 'var(--occ-high)' : d < 0 ? 'var(--occ-low)' : '#888') + '">' + (d > 0 ? '+' : '') + d + '%</span>' : '';
      body += '<tr><td style="padding-left:28px">' + act.label + '</td><td>' + num(t.attendees) + dHtml + '</td>' +
        compareRuns.map(r => { const catCmp = r.categories.find(c => c.label === cat.label); const cmpAct = catCmp ? catCmp.activities.find(a => a.label === act.label) : null; return '<td>' + (cmpAct ? num(cmpAct.totals.attendees) : '\u2014') + '</td>'; }).join('') +
        '<td>' + num(t.capacity) + '</td><td>' + num(t.classes) + '</td>' +
        '<td>' + (t.classes > 0 ? Math.round(10 * t.attendees / t.classes) / 10 : '\u2014') + '</td>' +
        '<td><span class="occ-pill ' + occPillClass(t.occupancyPct) + '">' + pct(t.occupancyPct) + '</span></td></tr>';
    }
    grandAtt += cat.totals.attendees; grandCap += cat.totals.capacity; grandCls += cat.totals.classes;
  }
  const grandOcc = grandCap > 0 ? Math.round(1000 * grandAtt / grandCap) / 10 : 0;
  body += '<tr class="total-row"><td>TOTAL GENERAL</td><td>' + num(grandAtt) + '</td>' +
    compareRuns.map(() => '<td></td>').join('') +
    '<td>' + num(grandCap) + '</td><td>' + num(grandCls) + '</td>' +
    '<td>' + (grandCls > 0 ? Math.round(10 * grandAtt / grandCls) / 10 : '\u2014') + '</td>' +
    '<td><span class="occ-pill ' + occPillClass(grandOcc) + '">' + pct(grandOcc) + '</span></td></tr></tbody>';
  document.getElementById('summaryTable').innerHTML = head + body;
}

/* CHARTS GALLERY — each card opens chart directly in modal */
let galleryCount = 0;
const galleryData = [];

function buildGallery(primary, compareRuns) {
  galleryCount = 0;
  galleryData.length = 0;
  const container = document.getElementById('chartsGallery');
  container.innerHTML = '';
  const newActivityKeys = getNewCatalogActivities(primary);
  for (const cat of primary.categories) {
    const catCmps = compareRuns.map(r => r.categories.find(c => c.label === cat.label) || null);
    const catLbl = document.createElement('div');
    catLbl.className = 'gallery-cat-label';
    catLbl.style.color = cat.color;
    catLbl.textContent = '\u25C6 ' + cat.label;
    container.appendChild(catLbl);
    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    container.appendChild(grid);
    for (const act of cat.activities) {
      const idx = galleryCount++;
      galleryData.push({ act, actCmps: catCmps.map(cc => cc ? cc.activities.find(a => a.label === act.label) : null), catColor: cat.color, catLabel: cat.label, primary, compareRuns });
      const occCls = occPillClass(act.totals.occupancyPct);
      const actKey = cat.label + '|' + act.label;
      const isNew = newActivityKeys.has(actKey);
      const card = document.createElement('div');
      card.className = 'gallery-card' + (isNew ? ' card-new' : '');
      card.style.cursor = 'pointer';
      const newBadge = isNew ? ' <span class="badge-nueva">NUEVA</span>' : '';
      card.innerHTML =
        '<div class="gallery-card-head">' +
          '<div class="gallery-cat-stripe" style="background:' + cat.color + '"></div>' +
          '<div class="gallery-act-info">' +
            '<div class="gallery-act-name">' + act.label + newBadge + '</div>' +
            '<div class="gallery-act-stats">' +
              '<span class="gallery-act-stat"><strong>' + num(act.totals.attendees) + '</strong> inscritos</span>' +
              '<span class="gallery-act-stat"><strong>' + num(act.totals.capacity) + '</strong> cupos</span>' +
              '<span class="occ-pill ' + occCls + '" style="font-size:.7rem;padding:1px 7px">' + pct(act.totals.occupancyPct) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="gallery-card-btns">' +
            '<button class="gallery-chart-btn">\uD83D\uDCCA Ver gr\xE1fico</button>' +
            '<button class="gallery-trend-btn">\uD83D\uDCC8 Tendencia</button>' +
          '</div>' +
        '</div>';
      grid.appendChild(card);
      (function(i) {
        card.querySelector('.gallery-chart-btn').addEventListener('click', function(e) {
          e.stopPropagation();
          openChartModal(galleryData[i]);
        });
        card.querySelector('.gallery-trend-btn').addEventListener('click', function(e) {
          e.stopPropagation();
          openActivityTrendModal(galleryData[i]);
        });
        card.addEventListener('click', function() { openChartModal(galleryData[i]); });
      })(idx);
    }
  }
}

/* SIDEBAR NAVIGATION + DETAIL PANEL */
let _currentDetailData = null;

function buildSidebarNav(primary, compareRuns) {
  destroyChart('detailAct');
  const sidebar = document.getElementById('detailSidebar');
  sidebar.innerHTML = '';
  document.getElementById('detailPanel').innerHTML =
    '<div class="detail-placeholder"><p>\uD83D\uDC48 Selecciona una actividad del men\xFA lateral para ver su estad\xEDstica</p></div>';

  const newActivityKeys = getNewCatalogActivities(primary);
  for (const cat of primary.categories) {
    const catCmps = compareRuns.map(r => r.categories.find(c => c.label === cat.label) || null);
    const catDiv = document.createElement('div');
    catDiv.className = 'sidebar-cat';
    const hdr = document.createElement('div');
    hdr.className = 'sidebar-cat-hdr';
    hdr.style.color = cat.color;
    hdr.innerHTML = '<div class="sidebar-cat-dot" style="background:' + cat.color + '"></div>' + cat.label;
    catDiv.appendChild(hdr);
    for (const act of cat.activities) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-act';
      const actKey = cat.label + '|' + act.label;
      const isNew = newActivityKeys.has(actKey);
      if (isNew) {
        btn.innerHTML = act.label + ' <span class="badge-nueva" style="font-size:.62rem">NUEVA</span>';
      } else {
        btn.textContent = act.label;
      }
      btn.dataset.key = actKey;
      const actCmps = catCmps.map(cc => cc ? cc.activities.find(a => a.label === act.label) : null);
      btn.addEventListener('click', () => showActivityDetail(cat, act, actCmps, primary, compareRuns));
      catDiv.appendChild(btn);
    }
    sidebar.appendChild(catDiv);
  }
}

function showActivityDetail(cat, act, actCmps, primary, compareRuns) {
  document.querySelectorAll('.sidebar-act').forEach(b => {
    b.classList.toggle('active', b.dataset.key === (cat.label + '|' + act.label));
  });
  destroyChart('detailAct');
  _currentDetailData = { act, actCmps, catColor: cat.color, catLabel: cat.label, primary, compareRuns };
  _detailDayFilter = null;

  const t = act.totals, occ = t.occupancyPct;
  const occCls = occPillClass(occ);
  const actCmp0 = compareRuns.length === 1 ? actCmps[0] : null;
  const d = actCmp0 ? Math.round(10 * (occ - actCmp0.totals.occupancyPct)) / 10 : null;
  const dHtml = d != null ? ' <span style="font-size:.8rem;font-weight:600;color:' + (d > 0 ? 'var(--occ-high)' : d < 0 ? 'var(--occ-low)' : '#888') + '">' + (d > 0 ? '+' : '') + d + ' pp vs. ' + compareRuns[0].label + '</span>' : '';

  const hasDivisions = act.slots.some(s => s.division);
  const slotRows = act.slots.map(s => {
    const actCmp0 = compareRuns.length === 1 ? actCmps[0] : null;
    const cmpSlot0 = actCmp0 ? (actCmp0.slots.find(x => x.day === s.day && x.time === s.time && (x.division||'') === (s.division||'')) || actCmp0.slots.find(x => x.day === s.day && x.time === s.time)) : null;
    const sd = cmpSlot0 ? delta(s.attendees, cmpSlot0.attendees) : null;
    const sdHtml = sd != null ? ' <span style="font-size:.72rem;color:' + (sd > 0 ? 'var(--occ-high)' : sd < 0 ? 'var(--occ-low)' : '#888') + '">' + (sd > 0 ? '+' : '') + sd + '%</span>' : '';
    return '<tr>' +
      (hasDivisions ? '<td class="slot-div">' + (s.division || '\u2014') + '</td>' : '') +
      '<td class="slot-day">' + s.dayFull + '</td><td class="slot-time">' + s.time + ' Hrs.</td>' +
      '<td>' + num(s.attendees) + sdHtml + '</td>' +
      actCmps.map((ac) => {
        const cmpSlot = ac ? (ac.slots.find(x => x.day === s.day && x.time === s.time && (x.division||'') === (s.division||'')) || ac.slots.find(x => x.day === s.day && x.time === s.time)) : null;
        return '<td>' + (cmpSlot ? num(cmpSlot.attendees) : '\u2014') + '</td>';
      }).join('') +
      '<td>' + num(s.capacity) + '</td><td>' + s.classes + '</td>' +
      '<td><div class="occ-bar-wrap"><div class="occ-bar-track"><div class="occ-bar-fill" style="width:' + Math.min(100, s.occupancyPct) + '%;background:' + occBarColor(s.occupancyPct) + '"></div></div><span class="occ-pct ' + occClass(s.occupancyPct) + '">' + pct(s.occupancyPct) + '</span></div></td></tr>';
  }).join('');
  const cmpSlotHeader = compareRuns.map(r => '<th>Inscritos ' + r.label + '</th>').join('');
  const divHeader = hasDivisions ? '<th>Divisi\xF3n</th>' : '';
  const canvasH = Math.min(230, 60 + act.slots.length * 28);
  const initSort = hasDivisions ? 'division' : 'hour';

  // Day filter buttons (only shown when activity spans multiple days)
  const uniqueDays = [...new Set(act.slots.map(s => s.day))]
    .sort((a, b) => (DAY_ORDER[a] || 99) - (DAY_ORDER[b] || 99));
  const dayFilterHtml = uniqueDays.length > 1
    ? '<div class="day-filter-row">' +
      '<span class="day-filter-label">D\xEDa:</span>' +
      '<button class="day-filter-btn active" data-detail-day="" onclick="setDetailDayFilter(this.dataset.detailDay)">Todos</button>' +
      uniqueDays.map(function(dd) {
        const full = act.slots.find(function(s) { return s.day === dd; }).dayFull;
        return '<button class="day-filter-btn" data-detail-day="' + dd + '" onclick="setDetailDayFilter(this.dataset.detailDay)">' + full + '</button>';
      }).join('') +
      '</div>'
    : '';

  document.getElementById('detailPanel').innerHTML =
    '<div class="detail-act-card">' +
      '<div class="detail-act-hdr" style="border-left:4px solid ' + cat.color + '">' +
        '<div class="detail-act-title">' +
          '<span style="color:' + cat.color + '">' + act.label + '</span>' +
          '<span class="detail-act-cat">' + cat.label + '</span>' +
        '</div>' +
        '<div class="detail-act-kpis">' +
          '<div class="detail-kpi">' +
            '<div class="detail-kpi-val" style="color:var(--blue-dark)">' + num(t.attendees) + '</div>' +
            '<div class="detail-kpi-lbl">Inscritos ' + primary.label + '</div>' +
            compareRuns.map((r, ci) => actCmps[ci] ? '<div class="detail-kpi-sub">' + num(actCmps[ci].totals.attendees) + ' en ' + r.label + '</div>' : '').join('') +
          '</div>' +
          '<div class="detail-kpi"><div class="detail-kpi-val">' + num(t.capacity) + '</div><div class="detail-kpi-lbl">Cupos</div></div>' +
          '<div class="detail-kpi"><div class="detail-kpi-val">' + num(t.classes) + '</div><div class="detail-kpi-lbl">Clases</div></div>' +
          '<div class="detail-kpi"><div class="detail-kpi-val"><span class="occ-pill ' + occCls + '">' + pct(occ) + '</span>' + dHtml + '</div><div class="detail-kpi-lbl">Ocupaci\xF3n</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-chart-section chart-scroll-section">' +
        '<div class="detail-chart-btns">' +
          '<button class="sec-toggle open" id="detailChartToggle" onclick="toggleDetailChart()">\u25BC Ocultar gr\xE1fico</button>' +
          '<span style="font-size:.72rem;color:var(--text-sub);margin:0 4px 0 auto">Ordenar:</span>' +
          '<button class="sec-toggle' + (initSort==='division'?' open':'') + '" data-detail-sort="division" onclick="setDetailSort(this.dataset.detailSort)">\uD83C\uDFF7 Divisi\xF3n</button>' +
          '<button class="sec-toggle' + (initSort==='hour'?' open':'') + '" data-detail-sort="hour" onclick="setDetailSort(this.dataset.detailSort)">\u23F1 Hora</button>' +
          '<button class="sec-toggle" data-detail-sort="day" onclick="setDetailSort(this.dataset.detailSort)">\uD83D\uDCC5 D\xEDa</button>' +
          '<button class="gallery-chart-btn" onclick="openChartModal()">\uD83D\uDD0D Agrandar</button>' +
          '<button class="gallery-trend-btn" onclick="openDetailTrend()">\uD83D\uDCC8 Tendencia</button>' +
        '</div>' +
        dayFilterHtml +
        '<div id="detailChartWrap" class="chart-scroll-wrap"><canvas id="detailActCanvas" height="' + canvasH + '"></canvas></div>' +
      '</div>' +
      '<div class="detail-slot-section">' +
        '<table class="slot-table"><thead><tr>' + divHeader + '<th>D\xEDa</th><th>Hora</th>' +
        '<th>Inscritos ' + primary.label + '</th>' + cmpSlotHeader +
        '<th>Cupos</th><th>Clases</th><th>Ocupaci\xF3n</th></tr></thead>' +
        '<tbody>' + slotRows + '</tbody></table>' +
      '</div>' +
    '</div>';

  buildDetailChart(act, actCmps, cat.color, primary, compareRuns, initSort);
}

function toggleDetailChart() {
  const wrap = document.getElementById('detailChartWrap');
  const btn = document.getElementById('detailChartToggle');
  if (!wrap || !btn) return;
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : '';
  btn.textContent = isOpen ? '\u25B6 Mostrar gr\xE1fico' : '\u25BC Ocultar gr\xE1fico';
  isOpen ? btn.classList.remove('open') : btn.classList.add('open');
}

let _detailSortOrder = 'hour';
let _detailDayFilter = null;

function buildDetailChart(act, actCmps, catColor, primary, compareRuns, sortOrder) {
  const order = sortOrder !== undefined ? sortOrder : _detailSortOrder;
  _detailSortOrder = order;
  const allSorted = sortedSlots(act.slots, order);
  const sorted = _detailDayFilter ? allSorted.filter(s => s.day === _detailDayFilter) : allSorted;
  const hasDivisions = sorted.some(s => s.division);

  const capData = sorted.map(s => s.capacity);
  const attData = sorted.map(s => s.attendees);
  const datasets = [
    { label: 'Cupos', data: capData, backgroundColor: hexToRgba(catColor, .22), borderColor: catColor, borderWidth: 1.5, borderRadius: 4, order: 2 + compareRuns.length },
    { label: 'Inscritos ' + primary.label, data: attData, backgroundColor: hexToRgba(catColor, .78), borderColor: catColor, borderWidth: 0, borderRadius: 4, order: 0 }
  ];
  compareRuns.forEach((cmp, ci) => {
    const actCmpData = actCmps[ci];
    if (!actCmpData) return;
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    const cmpLookup = s => actCmpData.slots.find(x => x.day === s.day && x.time === s.time && (x.division||'') === (s.division||''))
      || actCmpData.slots.find(x => x.day === s.day && x.time === s.time);
    const cmpAtt = sorted.map(s => { const c = cmpLookup(s); return c ? c.attendees : 0; });
    datasets.push({ label: 'Inscritos ' + cmp.label, data: cmpAtt, backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 0, borderRadius: 4, order: ci + 1 });
  });

  const labels = sorted.map(s => s.division ? [s.division, s.dayFull, s.time + ' Hrs.'] : [s.dayFull, s.time + ' Hrs.']);

  const wrap = document.getElementById('detailChartWrap');
  const canvas = document.getElementById('detailActCanvas');
  if (!wrap || !canvas) return;

  const isLarge = sorted.length > 10;
  const SLOT_PX = 58;

  // Clean up previous nav buttons and scroll state
  wrap.parentElement.querySelectorAll('.chart-nav-btn').forEach(b => b.remove());
  wrap.parentElement.querySelectorAll('.chart-scroll-hint').forEach(b => b.remove());
  wrap.style.overflowX = '';
  canvas.removeAttribute('style');
  canvas.removeAttribute('width');
  canvas.removeAttribute('height');

  if (isLarge) {
    const totalW = sorted.length * SLOT_PX + 80;
    wrap.style.overflowX = 'hidden';
    canvas.style.width = totalW + 'px';
    canvas.style.height = '220px';
    canvas.width = totalW;
    canvas.height = 220;

    const navL = document.createElement('button');
    navL.className = 'chart-nav-btn chart-nav-prev';
    navL.innerHTML = '\u2039';
    navL.title = 'Ver anteriores';
    navL.onclick = () => wrap.scrollBy({ left: -(wrap.clientWidth * 0.75), behavior: 'smooth' });

    const navR = document.createElement('button');
    navR.className = 'chart-nav-btn chart-nav-next';
    navR.innerHTML = '\u203A';
    navR.title = 'Ver siguientes';
    navR.onclick = () => wrap.scrollBy({ left: wrap.clientWidth * 0.75, behavior: 'smooth' });

    wrap.parentElement.style.position = 'relative';
    wrap.parentElement.insertBefore(navL, wrap);
    wrap.parentElement.appendChild(navR);

    const hint = document.createElement('p');
    hint.className = 'chart-scroll-hint';
    hint.textContent = sorted.length + ' horarios \u2014 usa las flechas o arrastra para navegar';
    wrap.parentElement.appendChild(hint);

    const updateNav = () => {
      navL.style.opacity = wrap.scrollLeft > 2 ? '1' : '0.25';
      navR.style.opacity = (wrap.scrollLeft + wrap.clientWidth) < (wrap.scrollWidth - 3) ? '1' : '0.25';
    };
    wrap.addEventListener('scroll', updateNav, { passive: true });
    setTimeout(updateNav, 150);
  }

  try {
    charts['detailAct'] = new Chart(canvas, {
      type: 'bar', data: { labels, datasets },
      options: {
        responsive: !isLarge, maintainAspectRatio: !isLarge,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: {
            title(items) { return items[0].label; },
            afterLabel(ctx2) {
              if (ctx2.datasetIndex === 1 && ctx2.dataIndex < sorted.length) {
                const s = sorted[ctx2.dataIndex];
                return 'Ocupaci\xF3n: ' + s.occupancyPct.toFixed(1) + '%  \xB7  ' + s.classes + ' clase(s)';
              }
              return '';
            }
          }}
        },
        scales: {
          x: { ticks: { font: { size: hasDivisions ? 9 : 10 }, maxRotation: hasDivisions ? 45 : 30 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 10 } }, grid: { color: gc() } }
        }
      }
    });
  } catch(e) {}
}

function setDetailSort(order) {
  if (!_currentDetailData) return;
  _detailSortOrder = order;
  document.querySelectorAll('[data-detail-sort]').forEach(b => b.classList.toggle('open', b.dataset.detailSort === order));
  destroyChart('detailAct');
  const d = _currentDetailData;
  buildDetailChart(d.act, d.actCmps, d.catColor, d.primary, d.compareRuns, order);
}

function setDetailDayFilter(day) {
  if (!_currentDetailData) return;
  _detailDayFilter = day || null;
  document.querySelectorAll('[data-detail-day]').forEach(b => {
    b.classList.toggle('active', (b.dataset.detailDay || null) === _detailDayFilter);
  });
  destroyChart('detailAct');
  const d = _currentDetailData;
  buildDetailChart(d.act, d.actCmps, d.catColor, d.primary, d.compareRuns, _detailSortOrder);
}

/* CHART MODAL */
function buildChartDatasets(act, actCmps, catColor, primary, compareRuns) {
  const capData = act.slots.map(s => s.capacity);
  const attData = act.slots.map(s => s.attendees);
  const datasets = [
    { label: 'Cupos', data: capData, backgroundColor: hexToRgba(catColor, .22), borderColor: catColor, borderWidth: 1.5, borderRadius: 6, order: 2 + compareRuns.length },
    { label: 'Inscritos ' + primary.label, data: attData, backgroundColor: hexToRgba(catColor, .80), borderColor: catColor, borderWidth: 0, borderRadius: 6, order: 0 }
  ];
  compareRuns.forEach((cmp, ci) => {
    const actCmpData = actCmps[ci];
    if (!actCmpData) return;
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    const cmpMap = new Map(actCmpData.slots.map(s => [s.day + '|' + s.time, s]));
    const cmpAtt = act.slots.map(s => { const c = cmpMap.get(s.day + '|' + s.time); return c ? c.attendees : 0; });
    datasets.push({ label: 'Inscritos ' + cmp.label, data: cmpAtt, backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 0, borderRadius: 6, order: ci + 1 });
  });
  return { datasets, labels: act.slots.map(s => [s.dayFull, s.time + ' Hrs.']) };
}

/* MODAL SORT */
const DAY_ORDER = { lunes:1, martes:2, miercoles:3, jueves:4, viernes:5, sabado:6, sabados:6, domingo:7 };
let _modalSortOrder = 'hour';
let _modalData = null;
let _modalDayFilter = null;

function parseTimeMin(t) {
  const p = (t || '').split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

function sortedSlots(slots, order) {
  const s = slots.slice();
  if (order === 'hour') {
    s.sort((a, b) => {
      const dt = parseTimeMin(a.time) - parseTimeMin(b.time);
      return dt !== 0 ? dt : (DAY_ORDER[a.day] || 99) - (DAY_ORDER[b.day] || 99);
    });
  } else if (order === 'division') {
    s.sort((a, b) => {
      const dc = (a.division || '').localeCompare(b.division || '', 'es');
      if (dc !== 0) return dc;
      const tc = parseTimeMin(a.time) - parseTimeMin(b.time);
      return tc !== 0 ? tc : (DAY_ORDER[a.day] || 99) - (DAY_ORDER[b.day] || 99);
    });
  } else {
    s.sort((a, b) => {
      const dd = (DAY_ORDER[a.day] || 99) - (DAY_ORDER[b.day] || 99);
      return dd !== 0 ? dd : parseTimeMin(a.time) - parseTimeMin(b.time);
    });
  }
  return s;
}

function setSortOrder(order) {
  _modalSortOrder = order;
  const btnH = document.getElementById('sortByHour');
  const btnD = document.getElementById('sortByDay');
  const btnT = document.getElementById('sortByTrend');
  if (btnH) btnH.classList.toggle('active', order === 'hour');
  if (btnD) btnD.classList.toggle('active', order === 'day');
  if (btnT) btnT.classList.toggle('active', order === 'trend');
  const dayRow = document.getElementById('modalDayBtns');
  if (dayRow) dayRow.style.display = order === 'trend' ? 'none' : '';
  if (order === 'trend') { if (_modalData) renderModalTrendChart(_modalData); return; }
  if (_modalData) renderModalChart(_modalData, order);
}

function renderModalChart(d, order) {
  const { act, actCmps, catColor, primary, compareRuns } = d;
  destroyChart('modalChart');
  const allSorted = sortedSlots(act.slots, order);
  const sorted = _modalDayFilter ? allSorted.filter(s => s.day === _modalDayFilter) : allSorted;
  const sortedLabels = sorted.map(s => s.division ? [s.division, s.dayFull, s.time + ' Hrs.'] : [s.dayFull, s.time + ' Hrs.']);
  const capData = sorted.map(s => s.capacity);
  const attData = sorted.map(s => s.attendees);
  const datasets = [
    { label: 'Cupos', data: capData, backgroundColor: hexToRgba(catColor, .22), borderColor: catColor, borderWidth: 1.5, borderRadius: 6, order: 2 + (compareRuns ? compareRuns.length : 0) },
    { label: 'Inscritos ' + primary.label, data: attData, backgroundColor: hexToRgba(catColor, .80), borderColor: catColor, borderWidth: 0, borderRadius: 6, order: 0 }
  ];
  if (actCmps && compareRuns) {
    compareRuns.forEach((cmp, ci) => {
      const actCmpData = actCmps[ci];
      if (!actCmpData) return;
      const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
      const cmpAtt = sorted.map(s => {
        const c = actCmpData.slots.find(x => x.day === s.day && x.time === s.time && (x.division||'') === (s.division||''))
          || actCmpData.slots.find(x => x.day === s.day && x.time === s.time);
        return c ? c.attendees : 0;
      });
      datasets.push({ label: 'Inscritos ' + cmp.label, data: cmpAtt, backgroundColor: pal.bg, borderColor: pal.border, borderWidth: 0, borderRadius: 6, order: ci + 1 });
    });
  }
  const ctx = document.getElementById('chartModalCanvas');
  if (!ctx) return;
  const hasDivisions = sorted.some(s => s.division);
  try {
    charts['modalChart'] = new Chart(ctx, {
      type: 'bar', data: { labels: sortedLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 13 }, boxWidth: 14 } },
          tooltip: { callbacks: {
            title(items) { return items[0].label; },
            afterLabel(ctx2) {
              if (ctx2.datasetIndex === 1) {
                const slot = sorted[ctx2.dataIndex];
                return slot ? 'Ocupaci\xF3n: ' + slot.occupancyPct.toFixed(1) + '%  \xB7  ' + slot.classes + ' clase(s)' : '';
              }
              return '';
            }
          }}
        },
        scales: {
          x: { ticks: { font: { size: hasDivisions ? 10 : 12 }, maxRotation: hasDivisions ? 45 : 30 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 12 } }, grid: { color: gc() } }
        }
      }
    });
  } catch(e) {}
}

function openChartModal(data) {
  const d = data || _currentDetailData;
  if (!d) return;
  _modalData = d;
  _modalDayFilter = null;
  document.getElementById('chartModalTitle').textContent = d.act.label;
  const sortBtns = document.getElementById('modalSortBtns');
  if (sortBtns) {
    sortBtns.style.display = '';
    document.getElementById('sortByHour').classList.toggle('active', _modalSortOrder === 'hour');
    document.getElementById('sortByDay').classList.toggle('active', _modalSortOrder === 'day');
  }
  // Populate day filter buttons
  const dayBtns = document.getElementById('modalDayBtns');
  if (dayBtns && d.act && d.act.slots) {
    const uniqueDays = [...new Set(d.act.slots.map(s => s.day))]
      .sort((a, b) => (DAY_ORDER[a] || 99) - (DAY_ORDER[b] || 99));
    if (uniqueDays.length > 1) {
      dayBtns.innerHTML =
        '<span class="day-filter-label">D\xEDa:</span>' +
        '<button class="modal-sort-btn day-filter-btn active" data-modal-day="" onclick="setModalDayFilter(this.dataset.modalDay)">Todos</button>' +
        uniqueDays.map(function(dd) {
          const full = d.act.slots.find(function(s) { return s.day === dd; }).dayFull;
          return '<button class="modal-sort-btn day-filter-btn" data-modal-day="' + dd + '" onclick="setModalDayFilter(this.dataset.modalDay)">' + full + '</button>';
        }).join('');
      dayBtns.style.display = '';
    } else {
      dayBtns.style.display = 'none';
    }
  }
  renderModalChart(d, _modalSortOrder);
  document.getElementById('chartModal').style.display = 'flex';
}

function openCompareModal() {
  const primary = ALL_RUNS[primaryIdx];
  const compareRuns = compareIdxs.map(i => ALL_RUNS[i]);
  if (!compareRuns.length) return;
  _modalData = null;
  document.getElementById('chartModalTitle').textContent = primary.label + ' vs ' + compareRuns.map(r => r.label).join(', ') + ' \u2014 Inscritos por categor\xEDa';
  const sortBtns = document.getElementById('modalSortBtns');
  if (sortBtns) sortBtns.style.display = 'none';
  destroyChart('modalChart');
  const labels = primary.categories.map(c => c.label);
  const datasets = [{ label: primary.label, data: primary.categories.map(c => c.totals.attendees), backgroundColor: 'rgba(0,74,135,.85)', borderRadius: 6, borderWidth: 0 }];
  compareRuns.forEach((cmp, ci) => {
    const pal = CMP_PALETTE[ci % CMP_PALETTE.length];
    datasets.push({ label: cmp.label, data: labels.map(l => { const c = cmp.categories.find(x => x.label === l); return c ? c.totals.attendees : 0; }), backgroundColor: pal.bg, borderRadius: 6, borderColor: pal.border, borderWidth: 1 });
  });
  const ctx = document.getElementById('chartModalCanvas');
  if (!ctx) return;
  try {
    charts['modalChart'] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 13 }, boxWidth: 14 } } },
        scales: {
          x: { ticks: { font: { size: 12 } } },
          y: { beginAtZero: true, ticks: { font: { size: 12 } }, grid: { color: gc() } }
        }
      }
    });
  } catch(e) {}
  document.getElementById('chartModal').style.display = 'flex';
}

function closeChartModal() {
  document.getElementById('chartModal').style.display = 'none';
  destroyChart('modalChart');
  _modalDayFilter = null;
}

function setModalDayFilter(day) {
  _modalDayFilter = day || null;
  document.querySelectorAll('[data-modal-day]').forEach(b => {
    b.classList.toggle('active', (b.dataset.modalDay || null) === _modalDayFilter);
  });
  if (_modalData) renderModalChart(_modalData, _modalSortOrder);
}

document.getElementById('sortByHour').addEventListener('click', function() { setSortOrder('hour'); });
document.getElementById('sortByDay').addEventListener('click', function() { setSortOrder('day'); });
document.getElementById('sortByTrend').addEventListener('click', function() { setSortOrder('trend'); });
document.getElementById('btnTrends').addEventListener('click', openTrendsView);
document.querySelectorAll('.trend-period-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { setTrendPeriod(this.dataset.tp); });
});
document.getElementById('chartModalBackdrop').addEventListener('click', closeChartModal);
document.getElementById('chartModalClose').addEventListener('click', closeChartModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChartModal(); });

/* EXPORTS */
/* ─── PPTX slot-page helpers ─── */
// Splits an array into K equitable chunks (no chunk is < half the average).
function pptxEquitableChunks(arr, mx) {
  if (arr.length <= mx) return [arr];
  const k = Math.ceil(arr.length / mx);
  const base = Math.floor(arr.length / k);
  const rem = arr.length % k;
  const out = [];
  let i = 0;
  for (let p = 0; p < k; p++) {
    const sz = p < rem ? base + 1 : base;
    out.push(arr.slice(i, i + sz));
    i += sz;
  }
  return out;
}

// Splits pre-sorted slots into slides.
// Primary strategy: keep each division together on the same slide.
// Fallback: equitable distribution when there are no divisions.
// Balance pass: if the last slide is thin, rescue it by moving the
// last whole-division group from the prior slide into it.
function buildPptxSlotPages(slots, maxPerPage) {
  if (slots.length <= maxPerPage) return [slots];
  if (!slots.some(s => s.division)) return pptxEquitableChunks(slots, maxPerPage);

  // Build ordered division groups from already-sorted slots
  const divMap = new Map();
  const divOrder = [];
  for (const s of slots) {
    const key = s.division || '';
    if (!divMap.has(key)) { divMap.set(key, []); divOrder.push(key); }
    divMap.get(key).push(s);
  }

  // Greedy packing: never split a division across slides when avoidable
  const pages = [];
  let cur = [];
  for (const key of divOrder) {
    const group = divMap.get(key);
    if (group.length > maxPerPage) {
      // Single division is oversized – flush and split it equitably
      if (cur.length) { pages.push(cur); cur = []; }
      pptxEquitableChunks(group, maxPerPage).forEach(p => pages.push(p));
    } else if (cur.length + group.length > maxPerPage) {
      pages.push(cur);
      cur = [...group];
    } else {
      cur.push(...group);
    }
  }
  if (cur.length) pages.push(cur);

  // Balance pass: rescue a thin last page by moving the last whole-division
  // group from the previous page into it (keeps division coherence intact).
  if (pages.length > 1) {
    const last = pages[pages.length - 1];
    const prev = pages[pages.length - 2];

    // Case A: last two slides together fit in one – merge them
    if (last.length + prev.length <= maxPerPage) {
      pages[pages.length - 2] = [...prev, ...last];
      pages.pop();
    } else if (last.length < maxPerPage * 0.4) {
      // Case B: last slide is thin – move the final division from prev into it
      const moveDivKey = (prev[prev.length - 1] || {}).division || '';
      const moveSlots = prev.filter(s => (s.division || '') === moveDivKey);
      const newPrev = prev.filter(s => (s.division || '') !== moveDivKey);
      if (moveSlots.length && newPrev.length > 0 && last.length + moveSlots.length <= maxPerPage) {
        pages[pages.length - 2] = newPrev;
        pages[pages.length - 1] = [...moveSlots, ...last];
      }
    }
  }

  return pages;
}

function lightenHex(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return [Math.round(r+(255-r)*.65), Math.round(g+(255-g)*.65), Math.round(b+(255-b)*.65)].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
}

function exportExcel() {
  if (typeof XLSX === 'undefined') { alert('Biblioteca Excel no disponible (requiere internet).'); return; }
  const primary = ALL_RUNS[primaryIdx];
  const wb = XLSX.utils.book_new();
  const sumRows = [['Categor\xEDa','Actividad','Inscritos','Cupos','Clases','Prom. inscritos','Ocupaci\xF3n %']];
  for (const cat of primary.categories) {
    for (const act of cat.activities) {
      const t = act.totals;
      sumRows.push([cat.label, act.label, t.attendees, t.capacity, t.classes, t.classes>0?Math.round(10*t.attendees/t.classes)/10:0, parseFloat(t.occupancyPct.toFixed(1))]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), 'Resumen');
  for (const cat of primary.categories) {
    const rows = [['Actividad','D\xEDa','Hora','Inscritos','Cupos','Clases','Ocupaci\xF3n %']];
    for (const act of cat.activities) {
      for (const s of act.slots) {
        rows.push([act.label, s.dayFull, s.time, s.attendees, s.capacity, s.classes, parseFloat(s.occupancyPct.toFixed(1))]);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), cat.label.slice(0,31));
  }
  XLSX.writeFile(wb, 'estadisticas-' + primary.label + '.xlsx');
}

/* PDF — informe ejecutivo en nueva ventana */
function exportPdf() {
  const primary = ALL_RUNS[primaryIdx];
  const compare = compareIdxs.length > 0 ? ALL_RUNS[compareIdxs[0]] : null;
  const logoEl = document.querySelector('.site-logo');
  const logoSrc = logoEl ? logoEl.src : '';
  const now = new Date().toLocaleDateString('es-CL', {day:'2-digit', month:'long', year:'numeric'});
  const totalCols = compare ? 7 : 6;

  let d = '<!doctype html><html lang="es"><head><meta charset="UTF-8">';
  d += '<title>Informe Estad\xEDsticas ' + primary.label + '</title>';
  d += '<style>';
  d += '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}';
  d += 'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#1a2c3d;background:#fff;}';
  d += '.cover{min-height:100vh;background:#004a87;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;page-break-after:always;}';
  d += '.cover img{height:90px;margin-bottom:28px;}';
  d += '.cover .eyebrow{font-size:11pt;letter-spacing:.15em;text-transform:uppercase;color:#bfd9f0;margin-bottom:10px;}';
  d += '.cover h1{font-size:32pt;font-weight:900;margin-bottom:6px;}';
  d += '.cover .period{font-size:22pt;font-weight:700;color:#F6C900;margin:4px 0 16px;}';
  d += '.cover .org{font-size:12pt;color:#bfd9f0;}';
  d += '.cover .cmp{font-size:10pt;color:#F6C900;margin-top:8px;}';
  d += '.cover .gen{font-size:8pt;color:#7fadc8;margin-top:40px;}';
  d += '.page{padding:14mm 15mm 18mm;}';
  d += '.phdr{display:flex;align-items:center;gap:12px;border-bottom:3px solid #004a87;padding-bottom:9px;margin-bottom:14px;}';
  d += '.phdr img{height:36px;}';
  d += '.phdr h2{color:#004a87;font-size:13pt;margin:0;flex:1;}';
  d += '.phdr .badge{background:#004a87;color:#fff;padding:3px 11px;border-radius:11px;font-size:8.5pt;font-weight:700;white-space:nowrap;}';
  d += '.kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:12px 0 16px;}';
  d += '.kpi{background:#f7f9fc;border:1px solid #d5e0ec;border-radius:5px;padding:9px 6px;text-align:center;}';
  d += '.kv{font-size:15pt;font-weight:900;color:#004a87;line-height:1;}';
  d += '.kl{font-size:7pt;color:#4a6280;text-transform:uppercase;letter-spacing:.04em;margin-top:3px;}';
  d += '.sec{font-size:11pt;font-weight:700;color:#004a87;border-left:4px solid #F6C900;padding-left:9px;margin:18px 0 8px;}';
  d += 'table{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:14px;}';
  d += 'th{background:#004a87;color:#fff;padding:5px 6px;text-align:left;font-size:7.5pt;text-transform:uppercase;letter-spacing:.04em;}';
  d += 'th.r,td.r{text-align:right;}';
  d += 'td{padding:4px 6px;border-bottom:1px solid #eef2f7;}';
  d += 'tr:nth-child(even) td{background:#f7f9fc;}';
  d += '.ch td{background:#e8f0f8!important;font-weight:700;color:#004a87;font-size:8.5pt;}';
  d += '.tr td{background:#1a2c3d!important;color:#fff!important;font-weight:700;}';
  d += '.act-hdr{font-weight:700;font-size:9pt;margin:10px 0 3px;}';
  d += '.ftr{position:fixed;bottom:7mm;left:15mm;right:15mm;border-top:1px solid #d5e0ec;padding-top:3px;font-size:7pt;color:#8fa8c4;display:flex;justify-content:space-between;}';
  d += '@page{margin:0;size:A4;}@page :not(:first){margin:14mm 15mm 20mm;}';
  d += '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}';
  d += '</style></head><body>';

  // Cover
  d += '<div class="cover">';
  if (logoSrc) d += '<img src="' + logoSrc + '" alt="Llacol\xE9n">';
  d += '<div class="eyebrow">Estad\xEDstica de Actividades</div>';
  d += '<div class="period">' + primary.label + '</div>';
  d += '<h1>Informe Ejecutivo</h1>';
  d += '<div class="org">Campos Deportivos Llacol\xE9n</div>';
  if (compare) d += '<div class="cmp">Incluye comparaci\xF3n con ' + compare.label + '</div>';
  d += '<div class="gen">Generado el ' + now + '</div>';
  d += '</div>';

  // Summary page
  const lg = logoSrc ? '<img src="' + logoSrc + '" alt="">' : '';
  d += '<div class="page">';
  d += '<div class="phdr">' + lg + '<h2>Estad\xEDsticas ' + primary.label + '</h2><span class="badge">Campos Deportivos Llacol\xE9n</span></div>';

  // KPIs
  const t = primary.totals;
  d += '<div class="kpi-row">';
  [['Eventos', t.events], ['Inscritos', t.attendees], ['Cupos', t.capacity], ['Clases', t.classes]].forEach(([l,v]) => {
    d += '<div class="kpi"><div class="kv">' + v.toLocaleString('es-CL') + '</div><div class="kl">' + l + '</div></div>';
  });
  d += '<div class="kpi"><div class="kv">' + t.occupancyPct.toFixed(1) + '%</div><div class="kl">Ocupaci\xF3n</div></div>';
  d += '</div>';

  // Summary table
  d += '<div class="sec">Resumen por actividad</div>';
  d += '<table><thead><tr><th>Categor\xEDa / Actividad</th><th class="r">Inscritos ' + primary.label + '</th>';
  if (compare) d += '<th class="r">Inscritos ' + compare.label + '</th>';
  d += '<th class="r">Cupos</th><th class="r">Clases</th><th class="r">Prom.</th><th class="r">Ocupaci\xF3n</th></tr></thead><tbody>';
  let gA = 0, gC = 0, gCl = 0;
  for (const cat of primary.categories) {
    const catCmp = compare ? compare.categories.find(c => c.label === cat.label) : null;
    d += '<tr class="ch"><td colspan="' + totalCols + '">' + cat.label + '</td></tr>';
    for (const act of cat.activities) {
      const tt = act.totals;
      const cmpAct = catCmp ? catCmp.activities.find(a => a.label === act.label) : null;
      const cmpAtt = cmpAct ? cmpAct.totals.attendees : null;
      const df = cmpAtt != null ? Math.round(10*(tt.attendees-cmpAtt)/cmpAtt*100)/10 : null;
      const ds = df != null ? ' <span style="font-size:7pt;color:' + (df>0?'#1a9b4d':df<0?'#c0392b':'#888') + '">(' + (df>0?'+':'') + df + '%)</span>' : '';
      d += '<tr><td style="padding-left:16px">' + act.label + '</td><td class="r">' + tt.attendees.toLocaleString('es-CL') + ds + '</td>';
      if (compare) d += '<td class="r">' + (cmpAtt!=null?cmpAtt.toLocaleString('es-CL'):'—') + '</td>';
      d += '<td class="r">' + tt.capacity.toLocaleString('es-CL') + '</td><td class="r">' + tt.classes + '</td>';
      d += '<td class="r">' + (tt.classes>0?Math.round(10*tt.attendees/tt.classes)/10:'—') + '</td>';
      d += '<td class="r">' + tt.occupancyPct.toFixed(1) + '%</td></tr>';
    }
    gA += cat.totals.attendees; gC += cat.totals.capacity; gCl += cat.totals.classes;
  }
  const gO = gC > 0 ? gA/gC*100 : 0;
  d += '<tr class="tr"><td>TOTAL GENERAL</td><td class="r">' + gA.toLocaleString('es-CL') + '</td>';
  if (compare) d += '<td class="r"></td>';
  d += '<td class="r">' + gC.toLocaleString('es-CL') + '</td><td class="r">' + gCl + '</td>';
  d += '<td class="r">' + (gCl>0?Math.round(10*gA/gCl)/10:'—') + '</td><td class="r">' + gO.toFixed(1) + '%</td></tr></tbody></table>';

  // Per-category detail pages
  for (const cat of primary.categories) {
    const catCmp = compare ? compare.categories.find(c => c.label === cat.label) : null;
    d += '<div style="page-break-before:always"></div>';
    d += '<div class="phdr" style="border-bottom-color:' + cat.color + '">' + lg + '<h2 style="color:' + cat.color + '">' + cat.label + '</h2><span class="badge" style="background:' + cat.color + '">' + primary.label + '</span></div>';
    for (const act of cat.activities) {
      const actCmp = catCmp ? catCmp.activities.find(a => a.label === act.label) : null;
      const tt = act.totals;
      d += '<div class="act-hdr" style="color:' + cat.color + '">' + act.label;
      d += '<span style="font-weight:400;font-size:8pt;color:#4a6280"> — Inscritos: ' + tt.attendees.toLocaleString('es-CL') + ' / Cupos: ' + tt.capacity.toLocaleString('es-CL') + ' / Ocupaci\xF3n: ' + tt.occupancyPct.toFixed(1) + '%</span></div>';
      d += '<table><thead><tr><th>D\xEDa</th><th>Hora</th><th class="r">Inscritos</th>';
      if (actCmp) d += '<th class="r">' + compare.label + '</th>';
      d += '<th class="r">Cupos</th><th class="r">Clases</th><th class="r">Ocupaci\xF3n</th></tr></thead><tbody>';
      for (const s of act.slots) {
        const cs = actCmp ? actCmp.slots.find(x => x.day===s.day && x.time===s.time) : null;
        d += '<tr><td>' + s.dayFull + '</td><td>' + s.time + ' hrs.</td><td class="r">' + s.attendees.toLocaleString('es-CL') + '</td>';
        if (actCmp) d += '<td class="r">' + (cs?cs.attendees.toLocaleString('es-CL'):'—') + '</td>';
        d += '<td class="r">' + s.capacity.toLocaleString('es-CL') + '</td><td class="r">' + s.classes + '</td><td class="r">' + s.occupancyPct.toFixed(1) + '%</td></tr>';
      }
      d += '</tbody></table>';
    }
  }
  d += '</div>';
  d += '<div class="ftr"><span>Campos Deportivos Llacol\xE9n \u2014 Informe Estad\xEDsticas ' + primary.label + '</span><span>' + now + '</span></div>';
  d += '<scr' + 'ipt>window.onload=function(){window.focus();window.print();};<\/scr' + 'ipt></body></html>';

  const w = window.open('', '_blank', 'width=920,height=740');
  if (!w) { alert('Habilita las ventanas emergentes para generar el PDF.'); return; }
  w.document.open(); w.document.write(d); w.document.close();
}

/* PowerPoint — formato institucional Llacolén */
function exportPptx() {
  const PptxClass = typeof PptxGenJS !== 'undefined' ? PptxGenJS : (typeof pptxgen !== 'undefined' ? pptxgen : null);
  if (!PptxClass) { alert('Biblioteca PowerPoint no disponible (requiere internet).'); return; }
  const primary = ALL_RUNS[primaryIdx];
  const compare = compareIdxs.length > 0 ? ALL_RUNS[compareIdxs[0]] : null;
  const logoEl = document.querySelector('.site-logo');
  const logoSrc = logoEl ? logoEl.src : '';

  const pptx = new PptxClass();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Estad\xEDsticas ' + primary.label + ' \u2014 Llacol\xE9n';
  pptx.subject = 'Informe de actividades ' + primary.label;
  pptx.company = 'Campos Deportivos Llacol\xE9n';

  function addLogoSmall(slide) {
    if (logoSrc) { try { slide.addImage({ data: logoSrc, x: 11.8, y: 0.1, w: 1.2, h: 0.58 }); } catch(e) {} }
  }
  function addHeaderBand(slide, title, subtitle, catColor) {
    const color = catColor || '004A87';
    slide.addTable([[{ text: '', options: { fill: color } }]], { x:0, y:0, w:13.33, h:0.72, border:{ pt:0 } });
    slide.addText(title, { x:0.4, y:0.05, w:10.5, h:0.55, fontSize:18, bold:true, color:'FFFFFF', valign:'middle' });
    if (subtitle) slide.addText(subtitle, { x:0.4, y:0.58, w:10.5, h:0.22, fontSize:8.5, color:'BFD9F0' });
    addLogoSmall(slide);
    // Yellow accent line
    slide.addTable([[{ text:'', options:{ fill:'F6C900' } }]], { x:0, y:0.72, w:13.33, h:0.06, border:{ pt:0 } });
  }
  function addFooter(slide) {
    slide.addTable([[{ text:'Campos Deportivos Llacol\xE9n', options:{ fill:'1A2C3D', color:'FFFFFF', fontSize:8, align:'center' } }]], { x:0, y:7.2, w:13.33, h:0.3, border:{ pt:0 } });
  }

  // SLIDE 1: Cover
  const ts = pptx.addSlide();
  ts.background = { color: '004A87' };
  // Decorative stripe
  ts.addTable([[{ text:'', options:{ fill:'F6C900' } }]], { x:0, y:5.7, w:13.33, h:0.12, border:{ pt:0 } });
  ts.addTable([[{ text:'', options:{ fill:'1A2C3D' } }]], { x:0, y:5.82, w:13.33, h:0.12, border:{ pt:0 } });
  if (logoSrc) { try { ts.addImage({ data: logoSrc, x: 5.2, y: 0.8, w: 2.9, h: 1.4 }); } catch(e) {} }
  ts.addText('ESTAD\xCDSTICA DE ACTIVIDADES', { x:0.5, y:2.55, w:12.3, h:0.65, fontSize:22, bold:true, color:'FFFFFF', align:'center', charSpacing:4 });
  ts.addText(primary.label, { x:0.5, y:3.25, w:12.3, h:0.95, fontSize:40, bold:true, color:'F6C900', align:'center' });
  ts.addText('Campos Deportivos Llacol\xE9n', { x:0.5, y:4.35, w:12.3, h:0.5, fontSize:14, color:'BFD9F0', align:'center' });
  if (compare) ts.addText('Comparaci\xF3n con ' + compare.label, { x:0.5, y:4.95, w:12.3, h:0.4, fontSize:11, color:'F6C900', align:'center', italic:true });
  ts.addText('Generado el ' + new Date().toLocaleDateString('es-CL', {day:'2-digit',month:'long',year:'numeric'}), { x:0.5, y:6.0, w:12.3, h:0.32, fontSize:9, color:'7FADC8', align:'center' });

  // SLIDE 2: Summary
  const ss = pptx.addSlide();
  addHeaderBand(ss, 'RESUMEN GENERAL', primary.label + (compare ? '  \u2014  vs. ' + compare.label : ''), null);
  addFooter(ss);
  const tbl = [[
    { text:'Categor\xEDa', options:{ bold:true, fill:'1A2C3D', color:'FFFFFF', fontSize:10 } },
    { text:'Inscritos', options:{ bold:true, fill:'1A2C3D', color:'FFFFFF', fontSize:10, align:'right' } },
    { text:'Cupos', options:{ bold:true, fill:'1A2C3D', color:'FFFFFF', fontSize:10, align:'right' } },
    { text:'Clases', options:{ bold:true, fill:'1A2C3D', color:'FFFFFF', fontSize:10, align:'right' } },
    { text:'Ocupaci\xF3n', options:{ bold:true, fill:'1A2C3D', color:'FFFFFF', fontSize:10, align:'right' } },
  ]];
  let sA = 0, sC = 0, sCl = 0;
  for (const cat of primary.categories) {
    const catH = cat.color.replace('#','') || '004A87';
    tbl.push([
      { text:cat.label, options:{ bold:true, fill:'E8F0F8', color:catH, fontSize:9.5 } },
      { text:cat.totals.attendees.toLocaleString('es-CL'), options:{ bold:true, fill:'E8F0F8', color:'004A87', fontSize:9.5, align:'right' } },
      { text:cat.totals.capacity.toLocaleString('es-CL'), options:{ fill:'E8F0F8', color:'1A2C3D', fontSize:9.5, align:'right' } },
      { text:String(cat.totals.classes), options:{ fill:'E8F0F8', color:'1A2C3D', fontSize:9.5, align:'right' } },
      { text:cat.totals.occupancyPct.toFixed(1)+'%', options:{ fill:'E8F0F8', color:'1A2C3D', fontSize:9.5, align:'right' } },
    ]);
    sA += cat.totals.attendees; sC += cat.totals.capacity; sCl += cat.totals.classes;
  }
  const sO = sC > 0 ? sA/sC*100 : 0;
  tbl.push([
    { text:'TOTAL GENERAL', options:{ bold:true, fill:'004A87', color:'FFFFFF', fontSize:10 } },
    { text:sA.toLocaleString('es-CL'), options:{ bold:true, fill:'004A87', color:'FFFFFF', fontSize:10, align:'right' } },
    { text:sC.toLocaleString('es-CL'), options:{ bold:true, fill:'004A87', color:'FFFFFF', fontSize:10, align:'right' } },
    { text:String(sCl), options:{ bold:true, fill:'004A87', color:'FFFFFF', fontSize:10, align:'right' } },
    { text:sO.toFixed(1)+'%', options:{ bold:true, fill:'004A87', color:'FFFFFF', fontSize:10, align:'right' } },
  ]);
  ss.addTable(tbl, { x:0.4, y:0.9, w:12.5, rowH:0.44, border:{ pt:1, color:'D5E0EC' } });

  // ACTIVITY SLIDES
  const PPTX_MAX_SLOTS = 12;

  for (const cat of primary.categories) {
    const catCmp = compare ? compare.categories.find(c => c.label === cat.label) : null;
    const catHex = cat.color.replace('#','');
    const lightHex = lightenHex(cat.color);

    for (const act of cat.activities) {
      const actCmp = catCmp ? catCmp.activities.find(a => a.label === act.label) : null;

      // Sort: division first, then time, then day
      const sortedActs = [...act.slots].sort((a, b) => {
        const dc = (a.division||'').localeCompare(b.division||'', 'es');
        if (dc !== 0) return dc;
        const tc = parseTimeMin(a.time) - parseTimeMin(b.time);
        return tc !== 0 ? tc : (DAY_ORDER[a.day]||99) - (DAY_ORDER[b.day]||99);
      });

      const slotPages = buildPptxSlotPages(sortedActs, PPTX_MAX_SLOTS);

      slotPages.forEach((pageSlots, pageIdx) => {
        const pageSfx = slotPages.length > 1 ? ' (' + (pageIdx+1) + '/' + slotPages.length + ')' : '';
        const pageDivs = [...new Set(pageSlots.map(s => s.division).filter(Boolean))].join(' \u00B7 ');
        const pageSubtitle = cat.label + ' \u00B7 ' + primary.label + (pageDivs ? '  \u2014  ' + pageDivs : '') + (compare ? '  vs. ' + compare.label : '');
        const slide = pptx.addSlide();
        addHeaderBand(slide, act.label.toUpperCase() + pageSfx, pageSubtitle, null);
        addFooter(slide);

        let chartY = 0.85;

        // KPI strip only on first page
        if (pageIdx === 0) {
          const kpis = [
            ['Inscritos ' + primary.label, act.totals.attendees.toLocaleString('es-CL')],
            ['Cupos', act.totals.capacity.toLocaleString('es-CL')],
            ['Clases', String(act.totals.classes)],
            ['Ocupaci\xF3n', act.totals.occupancyPct.toFixed(1) + '%'],
          ];
          if (actCmp) kpis.push(['Inscritos ' + compare.label, actCmp.totals.attendees.toLocaleString('es-CL')]);
          const kpiW = 12.5 / kpis.length;
          kpis.forEach((k, i) => {
            const bx = 0.4 + i*kpiW, by = 0.85;
            slide.addTable([[{ text:'', options:{ fill:'F7F9FC', line:{ color:'D5E0EC', pt:0.5 } } }]], { x:bx, y:by, w:kpiW-0.06, h:0.68, border:{ pt:0 } });
            slide.addText(k[1], { x:bx, y:by+0.02, w:kpiW-0.06, h:0.36, fontSize:16, bold:true, color:'004A87', align:'center' });
            slide.addText(k[0], { x:bx, y:by+0.38, w:kpiW-0.06, h:0.26, fontSize:7, color:'4A6280', align:'center' });
          });
          chartY = 1.62;
        }

        const slotLabels = pageSlots.map(s => s.division ? s.division + '\\n' + s.dayShort + ' ' + s.time : s.dayFull + '\\n' + s.time);
        const maxVal = Math.max(...pageSlots.map(s => s.capacity), 1);
        const roundedMax = Math.ceil(maxVal / 5) * 5 + 5;
        const chartData = [
          { name:'Cupos', labels:slotLabels, values:pageSlots.map(s=>s.capacity) },
          { name:'Inscritos ' + primary.label, labels:slotLabels, values:pageSlots.map(s=>s.attendees) }
        ];
        if (actCmp) {
          chartData.push({ name:'Inscritos ' + compare.label, labels:slotLabels, values:pageSlots.map(s=>{ const c=actCmp.slots.find(x=>x.day===s.day&&x.time===s.time&&(x.division||'')===(s.division||''))||actCmp.slots.find(x=>x.day===s.day&&x.time===s.time); return c?c.attendees:0; }) });
        }
        const chartColors = [lightHex, catHex];
        if (actCmp) chartColors.push('F6C900');
        const chartH = 7.2 - chartY - 0.3;
        try {
          slide.addChart('bar', chartData, {
            x:0.4, y:chartY, w:12.5, h:chartH,
            barGrouping:'clustered', barGapWidthPct:55,
            chartColors,
            catAxisLabelPos:'low', catAxisLabelFontSize:8, catAxisLabelRotate:0, catAxisLineShow:true,
            valAxisMaxVal:roundedMax, valAxisMinVal:0, valAxisLabelFontSize:9, valAxisLineShow:false,
            showLegend:true, legendPos:'b', legendFontSize:10,
            plotArea:{ fill:{ color:'FFFFFF' } }, chartArea:{ fill:{ color:'FFFFFF' }, border:{ pt:0 } }
          });
        } catch(e) {
          slide.addText('Gr\xE1fico no disponible', { x:2, y:chartY+1, w:9, h:1, fontSize:14, color:'888888', align:'center' });
        }
      });
    }
  }

  pptx.writeFile({ fileName:'estadisticas-' + primary.label + '.pptx' });
}

function exportPptxV2() {
  const PptxV2 = typeof PptxGenJS !== 'undefined' ? PptxGenJS : (typeof pptxgen !== 'undefined' ? pptxgen : null);
  if (!PptxV2) { alert('Biblioteca PowerPoint no disponible (requiere internet).'); return; }
  const primary = ALL_RUNS[primaryIdx];
  const compare = compareIdxs.length > 0 ? ALL_RUNS[compareIdxs[0]] : null;
  const logoEl = document.querySelector('.site-logo');
  const logoSrc = logoEl ? logoEl.src : '';
  const logoAspect = (logoEl && logoEl.naturalWidth > 0 && logoEl.naturalHeight > 0)
    ? logoEl.naturalWidth / logoEl.naturalHeight : 2.5;

  const pptx = new PptxV2();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Estad\xEDsticas ' + primary.label + ' \u2014 Llacol\xE9n';
  pptx.subject = 'Informe ejecutivo ' + primary.label;
  pptx.company = 'Campos Deportivos Llacol\xE9n';

  const W = 13.33, SH = 7.5;
  const C = { BLUE:'003F74', BLUE2:'004A87', GOLD:'F6C900', DARK:'1A2C3D', LIGHT:'E8F0F8', BG:'F7F9FC', BORDER:'D5E0EC', SUB:'4A6280' };
  const PPTX_MAX_SLOTS = 12;

  // Solid color rectangle using a 1-cell table (matches existing pattern)
  function band(sl, x, y, w, h, color) {
    sl.addTable([[{ text:'', options:{ fill:color } }]], { x:x, y:y, w:w, h:h, border:{ pt:0 } });
  }

  function occColor(pct) { return pct >= 70 ? '1A9B4D' : pct >= 40 ? 'E07B00' : 'C0392B'; }

  function hexLighten2(hex) {
    const h = hex.replace('#','');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
      .map(v => Math.round(v+(255-v)*.65).toString(16).padStart(2,'0')).join('').toUpperCase();
  }

  // Add logo preserving natural aspect ratio, centered within bounding box
  function addLogoFit(sl, x, y, maxW, maxH) {
    if (!logoSrc) return;
    try {
      let lw, lh;
      if (logoAspect > maxW / maxH) { lw = maxW; lh = maxW / logoAspect; }
      else { lh = maxH; lw = maxH * logoAspect; }
      sl.addImage({ data:logoSrc, x:x+(maxW-lw)/2, y:y+(maxH-lh)/2, w:lw, h:lh });
    } catch(e) {}
  }

  function addHeader(sl, title, sub, catColor) {
    const hex = (catColor || C.BLUE2).replace('#','');
    band(sl, 0, 0, W, 0.85, hex);
    band(sl, 0, 0.85, W, 0.05, C.GOLD);
    addLogoFit(sl, W-1.55, 0.08, 1.35, 0.69);
    sl.addText(title, { x:0.35, y:0.06, w:W-2.1, h:0.5, fontSize:19, bold:true, color:'FFFFFF', valign:'middle', fontFace:'Calibri', charSpacing:0.5 });
    if (sub) sl.addText(sub, { x:0.35, y:0.59, w:W-2.1, h:0.24, fontSize:9, color:'BFD9F0', fontFace:'Calibri' });
  }

  function addFooter(sl) {
    band(sl, 0, SH-0.33, W, 0.33, C.DARK);
    sl.addText('Campos Deportivos Llacol\xE9n  \u2014  Estad\xEDsticas ' + primary.label, { x:0.35, y:SH-0.3, w:W*.6, h:0.26, fontSize:7.5, color:'7FADC8', valign:'middle', fontFace:'Calibri' });
    sl.addText(new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'}), { x:W*.6, y:SH-0.3, w:W*.39, h:0.26, fontSize:7.5, color:'7FADC8', align:'right', valign:'middle', fontFace:'Calibri' });
  }

  /* ═══ PORTADA ═══ */
  const cover = pptx.addSlide();
  cover.background = { color: C.BLUE };
  band(cover, 0, 0, 0.14, SH, C.GOLD);
  band(cover, 0, SH-1.1, W, 0.1, C.GOLD);
  band(cover, 0, SH-1.0, W, 1.0, C.DARK);
  addLogoFit(cover, W/2-1.65, 0.6, 3.3, 1.65);
  cover.addText('ESTAD\xCDSTICA DE ACTIVIDADES', { x:0.5, y:2.5, w:W-1, h:0.6, fontSize:21, bold:true, color:'FFFFFF', align:'center', charSpacing:5, fontFace:'Calibri' });
  cover.addText(primary.label.toUpperCase(), { x:0.5, y:3.15, w:W-1, h:1.1, fontSize:52, bold:true, color:C.GOLD, align:'center', fontFace:'Calibri' });
  cover.addText('Campos Deportivos Llacol\xE9n', { x:0.5, y:4.35, w:W-1, h:0.5, fontSize:15, color:'BFD9F0', align:'center', fontFace:'Calibri' });
  if (compare) cover.addText('Comparaci\xF3n con ' + compare.label, { x:0.5, y:4.9, w:W-1, h:0.4, fontSize:12, color:C.GOLD, align:'center', italic:true, fontFace:'Calibri' });
  cover.addText('Generado el ' + new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'}), { x:0.5, y:5.65, w:W-1, h:0.3, fontSize:9, color:'7FADC8', align:'center', fontFace:'Calibri' });

  /* ═══ RESUMEN ═══ */
  const ss = pptx.addSlide();
  ss.background = { color: C.BG };
  addHeader(ss, 'RESUMEN GENERAL', primary.label + (compare ? '  \u2014  vs. ' + compare.label : ''), null);
  addFooter(ss);

  let totA = 0, totC = 0, totCl = 0;
  for (const ct of primary.categories) { totA += ct.totals.attendees; totC += ct.totals.capacity; totCl += ct.totals.classes; }
  const totO = totC > 0 ? totA / totC * 100 : 0;

  const kbW = (W-0.8)/4;
  [
    { l:'INSCRITOS', v:totA.toLocaleString('es-CL'), c:C.BLUE2 },
    { l:'CUPOS', v:totC.toLocaleString('es-CL'), c:'1A7ABF' },
    { l:'CLASES', v:totCl.toLocaleString('es-CL'), c:'2D9E6B' },
    { l:'OCUPACI\xD3N', v:totO.toFixed(1)+'%', c:occColor(totO) }
  ].forEach((k, i) => {
    const bx = 0.4 + i*kbW;
    band(ss, bx, 1.05, kbW-0.15, 0.06, k.c);
    band(ss, bx, 1.11, kbW-0.15, 1.15, 'FFFFFF');
    ss.addText(k.v, { x:bx, y:1.14, w:kbW-0.15, h:0.68, fontSize:28, bold:true, color:k.c, align:'center', fontFace:'Calibri' });
    ss.addText(k.l, { x:bx, y:1.82, w:kbW-0.15, h:0.35, fontSize:8, color:C.SUB, align:'center', charSpacing:0.5, fontFace:'Calibri' });
  });

  band(ss, 0.4, 2.44, W-0.8, 0.02, C.BORDER);

  const hRow = [
    { text:'Categor\xEDa', options:{ bold:true, fill:C.DARK, color:'FFFFFF', fontSize:9.5, fontFace:'Calibri' } },
    { text:'Inscritos', options:{ bold:true, fill:C.DARK, color:'FFFFFF', fontSize:9.5, align:'right', fontFace:'Calibri' } },
    { text:'Cupos', options:{ bold:true, fill:C.DARK, color:'FFFFFF', fontSize:9.5, align:'right', fontFace:'Calibri' } },
    { text:'Clases', options:{ bold:true, fill:C.DARK, color:'FFFFFF', fontSize:9.5, align:'right', fontFace:'Calibri' } },
    { text:'Ocupaci\xF3n', options:{ bold:true, fill:C.DARK, color:'FFFFFF', fontSize:9.5, align:'right', fontFace:'Calibri' } }
  ];
  const tRows = [hRow];
  primary.categories.forEach((ct, ri) => {
    const cHex = ct.color.replace('#','');
    const rbg = ri % 2 === 0 ? C.LIGHT : 'F0F5FC';
    tRows.push([
      { text:ct.label, options:{ bold:true, fill:rbg, color:cHex, fontSize:9.5, fontFace:'Calibri' } },
      { text:ct.totals.attendees.toLocaleString('es-CL'), options:{ bold:true, fill:rbg, color:C.BLUE2, fontSize:9.5, align:'right', fontFace:'Calibri' } },
      { text:ct.totals.capacity.toLocaleString('es-CL'), options:{ fill:rbg, color:C.DARK, fontSize:9.5, align:'right', fontFace:'Calibri' } },
      { text:String(ct.totals.classes), options:{ fill:rbg, color:C.DARK, fontSize:9.5, align:'right', fontFace:'Calibri' } },
      { text:ct.totals.occupancyPct.toFixed(1)+'%', options:{ bold:true, fill:rbg, color:occColor(ct.totals.occupancyPct), fontSize:9.5, align:'right', fontFace:'Calibri' } }
    ]);
  });
  tRows.push([
    { text:'TOTAL GENERAL', options:{ bold:true, fill:C.BLUE2, color:'FFFFFF', fontSize:10, fontFace:'Calibri' } },
    { text:totA.toLocaleString('es-CL'), options:{ bold:true, fill:C.BLUE2, color:C.GOLD, fontSize:10, align:'right', fontFace:'Calibri' } },
    { text:totC.toLocaleString('es-CL'), options:{ bold:true, fill:C.BLUE2, color:'FFFFFF', fontSize:10, align:'right', fontFace:'Calibri' } },
    { text:String(totCl), options:{ bold:true, fill:C.BLUE2, color:'FFFFFF', fontSize:10, align:'right', fontFace:'Calibri' } },
    { text:totO.toFixed(1)+'%', options:{ bold:true, fill:C.BLUE2, color:C.GOLD, fontSize:10, align:'right', fontFace:'Calibri' } }
  ]);
  const cWs = [4.2, 2.0, 2.0, 1.7, 2.1];
  ss.addTable(tRows, { x:0.4, y:2.52, w:cWs.reduce((a,b)=>a+b,0), colW:cWs, rowH:0.4, border:{ pt:0.75, color:C.BORDER } });

  /* ═══ DIAPOSITIVAS DE ACTIVIDAD ═══ */
  for (const cat of primary.categories) {
    const catCmp = compare ? compare.categories.find(c => c.label === cat.label) : null;
    const catHex = cat.color.replace('#','');
    const lightHex = hexLighten2(catHex);

    for (const act of cat.activities) {
      const actCmp = catCmp ? catCmp.activities.find(a => a.label === act.label) : null;

      // Sort: division first, then time, then day
      const sortedActs2 = [...act.slots].sort((a, b) => {
        const dc = (a.division||'').localeCompare(b.division||'', 'es');
        if (dc !== 0) return dc;
        const tc = parseTimeMin(a.time) - parseTimeMin(b.time);
        return tc !== 0 ? tc : (DAY_ORDER[a.day]||99) - (DAY_ORDER[b.day]||99);
      });

      const slotPages2 = buildPptxSlotPages(sortedActs2, PPTX_MAX_SLOTS);

      slotPages2.forEach((pageSlots, pageIdx) => {
        const pageSfx = slotPages2.length > 1 ? ' (' + (pageIdx+1) + '/' + slotPages2.length + ')' : '';
        const pageDivs2 = [...new Set(pageSlots.map(s => s.division).filter(Boolean))].join(' \xB7 ');
        const pageSubtitle2 = cat.label + ' \xB7 ' + primary.label + (pageDivs2 ? '  \u2014  ' + pageDivs2 : '') + (actCmp ? '  \u2014  vs. ' + compare.label : '');
        const sl = pptx.addSlide();
        sl.background = { color: C.BG };
        addHeader(sl, act.label.toUpperCase() + pageSfx, pageSubtitle2, cat.color);
        addFooter(sl);

        let v2ChartY = 1.06;

        if (pageIdx === 0) {
          const t = act.totals;
          const kpis = [
            { l:'INSCRITOS ' + primary.label.toUpperCase(), v:t.attendees.toLocaleString('es-CL'), c:catHex },
            { l:'CUPOS', v:t.capacity.toLocaleString('es-CL'), c:C.SUB },
            { l:'CLASES', v:String(t.classes), c:C.SUB },
            { l:'OCUPACI\xD3N', v:t.occupancyPct.toFixed(1)+'%', c:occColor(t.occupancyPct) }
          ];
          if (actCmp) kpis.push({ l:'INSCRITOS ' + compare.label.toUpperCase(), v:actCmp.totals.attendees.toLocaleString('es-CL'), c:'C9A100' });

          const kpW = (W-0.8) / kpis.length;
          kpis.forEach((k, i) => {
            const bx = 0.4 + i*kpW;
            band(sl, bx, 1.05, kpW-0.1, 0.05, k.c);
            band(sl, bx, 1.1, kpW-0.1, 1.0, 'FFFFFF');
            sl.addText(k.v, { x:bx, y:1.13, w:kpW-0.1, h:0.55, fontSize:22, bold:true, color:k.c, align:'center', fontFace:'Calibri' });
            sl.addText(k.l, { x:bx, y:1.67, w:kpW-0.1, h:0.35, fontSize:7, color:C.SUB, align:'center', charSpacing:0.3, fontFace:'Calibri' });
          });

          band(sl, 0.4, 2.22, W-0.8, 0.02, C.BORDER);
          v2ChartY = 2.3;
        }

        const v2ChartH = SH - v2ChartY - 0.45;
        band(sl, 0.3, v2ChartY - 0.08, W-0.6, v2ChartH + 0.08, 'FFFFFF');

        const slbls = pageSlots.map(s => s.division ? s.division + '\\n' + s.dayShort + ' ' + s.time : s.dayFull + '\\n' + s.time);
        const mv = Math.max(...pageSlots.map(s => s.capacity), 1);
        const cd = [
          { name:'Cupos', labels:slbls, values:pageSlots.map(s => s.capacity) },
          { name:'Inscritos ' + primary.label, labels:slbls, values:pageSlots.map(s => s.attendees) }
        ];
        if (actCmp) {
          cd.push({ name:'Inscritos ' + compare.label, labels:slbls, values:pageSlots.map(s => { const cv=actCmp.slots.find(x=>x.day===s.day&&x.time===s.time&&(x.division||'')===(s.division||''))||actCmp.slots.find(x=>x.day===s.day&&x.time===s.time); return cv?cv.attendees:0; }) });
        }
        const cc = [lightHex, catHex];
        if (actCmp) cc.push('F6C900');
        try {
          sl.addChart('bar', cd, {
            x:0.4, y:v2ChartY, w:W-0.8, h:v2ChartH,
            barGrouping:'clustered', barGapWidthPct:50,
            chartColors:cc,
            catAxisLabelPos:'low', catAxisLabelFontSize:8, catAxisLabelRotate:0, catAxisLineShow:true,
            valAxisMaxVal:Math.ceil(mv/5)*5+5, valAxisMinVal:0,
            valAxisLabelFontSize:9, valAxisLineShow:false,
            showLegend:true, legendPos:'t', legendFontSize:10,
            plotArea:{ fill:{ color:'FFFFFF' } }, chartArea:{ fill:{ color:'FFFFFF' }, border:{ pt:0 } }
          });
        } catch(e) {
          sl.addText('Gr\xE1fico no disponible', { x:2, y:v2ChartY+1.5, w:9, h:1, fontSize:14, color:'888888', align:'center', fontFace:'Calibri' });
        }
      });
    }
  }

  pptx.writeFile({ fileName:'estadisticas-ejecutivo-' + primary.label + '.pptx' });
}

function showChartError(canvasId) {
  const el = document.getElementById(canvasId);
  if (el && el.parentNode) {
    el.style.display = 'none';
    const msg = document.createElement('p');
    msg.className = 'chart-empty';
    msg.textContent = 'Gr\xE1fico no disponible (se requiere conexi\xF3n a internet para cargar Chart.js).';
    el.parentNode.insertBefore(msg, el);
  }
}

/* ─── TENDENCIAS ─────────────────────────────────────────────────────────── */
let _trendPeriod = '6m';
let _trendFromVal = '';
let _trendToVal = '';

function getTrendData(period, fromVal, toVal, catLabel, actLabel) {
  const today = new Date().toISOString().slice(0, 7);
  let f, t;
  if (period === '6m') {
    const d = new Date(); d.setMonth(d.getMonth() - 5);
    f = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); t = today;
  } else if (period === 'year') {
    f = today.slice(0, 4) + '-01'; t = today;
  } else if (period === 'all') {
    f = '0000-00'; t = '9999-99';
  } else {
    f = fromVal || '0000-00'; t = toVal || '9999-99';
  }
  return ALL_RUNS
    .filter(r => r.monthKey >= f && r.monthKey <= t)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map(r => {
      if (!catLabel) return { label: r.label, attendees: r.totals.attendees, capacity: r.totals.capacity, occupancyPct: r.totals.occupancyPct };
      const cat = (r.categories || []).find(c => c.label === catLabel);
      if (!cat) return null;
      if (!actLabel) return { label: r.label, attendees: cat.totals.attendees, capacity: cat.totals.capacity, occupancyPct: cat.totals.occupancyPct };
      const act = (cat.activities || []).find(a => a.label === actLabel);
      if (!act) return null;
      return { label: r.label, attendees: act.totals.attendees, capacity: act.totals.capacity, occupancyPct: act.totals.occupancyPct };
    })
    .filter(Boolean);
}

function openTrendsView() {
  const sec = document.getElementById('trendsSection');
  if (!sec) return;
  sec.style.display = '';
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  renderGlobalTrend();
}

function closeTrendsView() {
  const sec = document.getElementById('trendsSection');
  if (sec) sec.style.display = 'none';
  destroyChart('trendChartAtt');
  destroyChart('trendChartOcc');
}

function renderGlobalTrend() {
  const data = getTrendData(_trendPeriod, _trendFromVal, _trendToVal);
  const metricsEl = document.getElementById('trendMetrics');
  if (!data.length) {
    if (metricsEl) metricsEl.innerHTML = '<p style="color:var(--text-sub);font-size:.88rem">Sin datos para el período seleccionado.</p>';
    destroyChart('trendChartAtt'); destroyChart('trendChartOcc');
    return;
  }
  const totalAtt = data.reduce((s, d) => s + d.attendees, 0);
  const avgOcc = data.reduce((s, d) => s + d.occupancyPct, 0) / data.length;
  const maxMo = data.reduce((m, d) => d.attendees > m.attendees ? d : m, data[0]);
  if (metricsEl) metricsEl.innerHTML = [
    ['Total inscritos', num(totalAtt)],
    ['Promedio mensual', num(Math.round(totalAtt / data.length))],
    ['Ocupación promedio', pct(avgOcc)],
    ['Mejor mes', maxMo.label]
  ].map(([l, v]) => '<div class="trend-metric"><div class="t-val">' + v + '</div><div class="t-lbl">' + l + '</div></div>').join('');

  destroyChart('trendChartAtt'); destroyChart('trendChartOcc');
  const labels = data.map(d => d.label);
  const ctxAtt = document.getElementById('trendChartAtt');
  const ctxOcc = document.getElementById('trendChartOcc');
  if (!ctxAtt || !ctxOcc) return;
  try {
    charts['trendChartAtt'] = new Chart(ctxAtt, {
      data: {
        labels,
        datasets: [
          { type:'bar', label:'Inscritos', data:data.map(d=>d.attendees), backgroundColor:'rgba(0,74,135,.75)', borderRadius:6, order:2 },
          { type:'line', label:'Tendencia', data:data.map(d=>d.attendees), borderColor:'#f6c900', borderWidth:2.5, pointRadius:4, pointBackgroundColor:'#f6c900', tension:0.3, fill:false, order:1 }
        ]
      },
      options: { responsive:true, maintainAspectRatio:true,
        plugins:{ legend:{ position:'top', labels:{ font:{size:11}, boxWidth:12 } } },
        scales:{ x:{ ticks:{font:{size:10},maxRotation:35}, grid:{display:false} }, y:{ beginAtZero:true, ticks:{font:{size:11}}, grid:{color:gc()} } }
      }
    });
    charts['trendChartOcc'] = new Chart(ctxOcc, {
      type:'line',
      data:{ labels, datasets:[{ label:'Ocupación %', data:data.map(d=>d.occupancyPct), borderColor:'var(--occ-mid)', backgroundColor:'rgba(224,123,0,.1)', borderWidth:2.5, pointRadius:5, pointBackgroundColor:'var(--occ-mid)', tension:0.3, fill:true }] },
      options:{ responsive:true, maintainAspectRatio:true,
        plugins:{ legend:{ position:'top', labels:{ font:{size:11}, boxWidth:12 } } },
        scales:{ x:{ ticks:{font:{size:10},maxRotation:35}, grid:{display:false} }, y:{ beginAtZero:true, max:100, ticks:{font:{size:11}, callback:v=>v+'%'}, grid:{color:gc()} } }
      }
    });
  } catch(e) { console.error('trendChart', e); }
}

function setTrendPeriod(period) {
  _trendPeriod = period;
  document.querySelectorAll('.trend-period-btn').forEach(b => b.classList.toggle('active', b.dataset.tp === period));
  const cr = document.getElementById('trendCustomRow');
  if (cr) cr.style.display = period === 'custom' ? '' : 'none';
  if (period !== 'custom') renderGlobalTrend();
}

function applyTrendCustom() {
  const f = document.getElementById('trendFrom'); const t2 = document.getElementById('trendTo');
  _trendFromVal = f ? f.value : ''; _trendToVal = t2 ? t2.value : '';
  if (!_trendFromVal || !_trendToVal || _trendFromVal > _trendToVal) return;
  renderGlobalTrend();
}

function renderModalTrendChart(d) {
  destroyChart('modalChart');
  if (!d) return;
  const data = getTrendData('all', '', '', d.catLabel, d.act ? d.act.label : null);
  const ctx = document.getElementById('chartModalCanvas');
  if (!ctx) return;
  if (!data.length) {
    ctx.parentElement.innerHTML = '<p class="trend-modal-empty">Sin datos históricos disponibles para esta actividad en el dashboard actual.</p>';
    return;
  }
  const color = d.catColor || '#004a87';
  try {
    charts['modalChart'] = new Chart(ctx, {
      data:{
        labels: data.map(p=>p.label),
        datasets:[
          { type:'bar', label:'Inscritos', data:data.map(p=>p.attendees), backgroundColor:hexToRgba(color,.75), borderRadius:6, yAxisID:'y', order:2 },
          { type:'line', label:'Ocupación %', data:data.map(p=>p.occupancyPct), borderColor:'#f6c900', backgroundColor:'rgba(246,201,0,.1)', borderWidth:2.5, pointRadius:5, pointBackgroundColor:'#f6c900', pointBorderColor:'#fff', pointBorderWidth:1.5, tension:0.3, fill:false, yAxisID:'y2', order:1 }
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'top', labels:{ font:{size:13}, boxWidth:14 } } },
        scales:{
          x:{ ticks:{font:{size:12},maxRotation:35}, grid:{display:false} },
          y:{ beginAtZero:true, ticks:{font:{size:12}}, grid:{color:gc()}, title:{display:true,text:'Inscritos',font:{size:11}} },
          y2:{ position:'right', beginAtZero:true, max:100, ticks:{font:{size:12},callback:v=>v+'%'}, grid:{display:false}, title:{display:true,text:'Ocupación',font:{size:11}} }
        }
      }
    });
  } catch(e) { console.error('trendModal', e); }
}

function openActivityTrendModal(d) {
  if (!d) return;
  document.getElementById('chartModalTitle').textContent = (d.act ? d.act.label : '?') + ' — Evolución histórica';
  const sortBtns = document.getElementById('modalSortBtns');
  if (sortBtns) {
    sortBtns.querySelectorAll('.modal-sort-btn').forEach(b => b.classList.remove('active'));
    const btnT = document.getElementById('sortByTrend');
    if (btnT) btnT.classList.add('active');
  }
  _modalData = d;
  _modalSortOrder = 'trend';
  const dayBtns = document.getElementById('modalDayBtns');
  if (dayBtns) dayBtns.style.display = 'none';
  renderModalTrendChart(d);
  document.getElementById('chartModal').style.display = 'flex';
}

function openDetailTrend() {
  if (!_currentDetailData) return;
  openActivityTrendModal(_currentDetailData);
}

/* ─── THEME ──────────────────────────────────────────────────────────────── */
let _darkMode = (function(){try{return localStorage.getItem('llacolen-theme')==='dark';}catch(e){return false;}})();

function gc() { return _darkMode ? '#1b3048' : '#eef2f7'; }

function applyChartTheme(dark) {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = dark ? '#5e8eb0' : '#4a6280';
  Chart.defaults.borderColor = dark ? '#1b3048' : '#eef2f7';
}

function applyTheme(dark) {
  _darkMode = dark;
  document.documentElement.classList.toggle('dark', dark);
  const icon = document.getElementById('themeIcon');
  const lbl = document.getElementById('themeLabel');
  if (icon) icon.textContent = dark ? '☀️' : '🌙';
  if (lbl) lbl.textContent = dark ? 'Claro' : 'Oscuro';
  try { localStorage.setItem('llacolen-theme', dark ? 'dark' : 'light'); } catch(e) {}
  applyChartTheme(dark);
  refresh();
}

function toggleTheme() { applyTheme(!_darkMode); }

// Apply saved theme before first render
if (_darkMode) {
  document.documentElement.classList.add('dark');
  const icon = document.getElementById('themeIcon');
  const lbl = document.getElementById('themeLabel');
  if (icon) icon.textContent = '☀️';
  if (lbl) lbl.textContent = 'Claro';
}

/* MONTHLY CLASS CHANGES */
function getNewCatalogActivities(primary) {
  if (!primary || !primary.monthKey) return new Set();
  const [y, m] = primary.monthKey.split('-').map(Number);
  let prevY = y; let prevM = m - 1;
  if (prevM === 0) { prevM = 12; prevY--; }
  const prevKey = prevY + '-' + String(prevM).padStart(2, '0');
  const prevRun = ALL_RUNS.find(r => r.monthKey === prevKey);
  if (!prevRun) return new Set();
  const prevKeys = new Set();
  for (const cat of (prevRun.categories || [])) {
    for (const act of (cat.activities || [])) prevKeys.add(cat.label + '|' + act.label);
  }
  const newKeys = new Set();
  for (const cat of (primary.categories || [])) {
    for (const act of (cat.activities || [])) {
      const k = cat.label + '|' + act.label;
      if (!prevKeys.has(k)) newKeys.add(k);
    }
  }
  return newKeys;
}

function renderMonthlyChanges(primary) {
  const el = document.getElementById('classChangesSection');
  if (!el) return;
  const cc = primary && primary.classChanges;
  if (!cc) {
    el.innerHTML = '<p style="color:var(--text-sub);font-size:.85rem;padding:8px 0">Sin información de cambios para este período.</p>';
    return;
  }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  let h = '<div class="changes-section"><div class="changes-kpis">';
  h += '<div class="change-kpi change-kpi-active"><div class="change-kpi-val" style="color:var(--blue-dark)">' + cc.activeCount + '</div><div class="change-kpi-lbl">Clases activas</div></div>';
  if (cc.hasPreviousMonth) {
    h += '<div class="change-kpi change-kpi-new"><div class="change-kpi-val" style="color:var(--occ-high)">' + cc.newCount + '</div><div class="change-kpi-lbl" style="color:var(--occ-high)">Clases nuevas</div></div>';
    h += '<div class="change-kpi change-kpi-retired"><div class="change-kpi-val">' + cc.retiredCount + '</div><div class="change-kpi-lbl">Clases retiradas</div></div>';
  } else {
    h += '<div class="change-kpi change-kpi-new" style="grid-column:span 2;text-align:left"><p style="font-size:.82rem;color:var(--text-sub);margin:4px 0">Sin mes anterior registrado. Las comparaciones estarán disponibles al tener dos o más meses escaneados.</p></div>';
  }
  h += '</div>';
  if (cc.hasPreviousMonth) {
    h += '<div style="font-size:.78rem;color:var(--text-sub);margin-bottom:10px">Comparado con ' + esc(cc.previousMonthLabel) + '</div>';
    if (cc.newClasses.length) {
      h += '<div class="change-subhead" style="color:var(--occ-high)">\uD83D\uDFE2 Clases incorporadas este mes (' + cc.newClasses.length + ')</div>';
      h += '<div class="change-list">' + cc.newClasses.map(function(c) {
        const title = c.firstDate ? 'Primera detecci\xF3n: ' + esc(c.firstDate) : '';
        return '<span class="change-item change-item-new" title="' + title + '">' + esc(c.name) + '</span>';
      }).join('') + '</div>';
    } else {
      h += '<div style="font-size:.82rem;color:var(--text-sub);margin-bottom:8px">Sin clases nuevas este mes.</div>';
    }
    if (cc.retiredClasses.length) {
      h += '<div class="change-subhead" style="color:var(--text-sub);margin-top:12px">🗑️ Clases eliminadas (' + cc.retiredClasses.length + ')</div>';
      h += '<div style="font-size:.78rem;color:var(--text-sub);margin-bottom:6px">Estaban en ' + esc(cc.previousMonthLabel) + ' y ya no aparecen este mes.</div>';
      h += '<div class="change-list">' + cc.retiredClasses.map(function(c) {
        return '<span class="change-item change-item-retired" title="\xDAltimo mes: ' + esc(c.lastLabel) + '">' + esc(c.name) + '</span>';
      }).join('') + '</div>';
    }
  }
  h += '</div>';
  el.innerHTML = h;
}

/* MAIN REFRESH */
function refresh() {
  renderYearFilters();
  renderTabs();
  const primary = ALL_RUNS[primaryIdx];
  const compareRuns = compareIdxs.map(i => ALL_RUNS[i]);
  const btnCmp = document.getElementById('btnCompareMode');
  if (compareMode) btnCmp.textContent = compareIdxs.length ? '\u2713 Listo (' + compareIdxs.length + ')' : '\u2026selecciona meses';
  const banner = document.getElementById('compareBanner');
  if (compareRuns.length) {
    banner.classList.add('visible');
    document.getElementById('compareBadge1').textContent = primary.label;
    document.getElementById('compareBadge2').textContent = compareRuns.map(r => r.label).join(' \xB7 ');
    document.getElementById('compareBannerMsg').textContent = 'Comparando ' + (compareRuns.length + 1) + ' per\xEDodo(s). Deltas vs. el 1.\xBA mes seleccionado.';
    document.getElementById('btnClearCompare').style.display = '';
    document.getElementById('trendSection').style.display = '';
  } else {
    banner.classList.remove('visible');
    document.getElementById('btnClearCompare').style.display = 'none';
    document.getElementById('trendSection').style.display = 'none';
  }
  renderKpis(primary, compareRuns);
  renderMonthlyChanges(primary);
  try { renderOverviewCharts(primary, compareRuns); } catch(e) { showChartError('chartOverview'); showChartError('chartOccupancy'); }
  if (compareRuns.length) { try { renderCompareChart(primary, compareRuns); } catch(e) { showChartError('chartCompareCat'); } }
  renderSummaryTable(primary, compareRuns);
  buildGallery(primary, compareRuns);
  buildSidebarNav(primary, compareRuns);
}

applyChartTheme(_darkMode);
refresh();
</script>
${passwordGateFrag()}
</body>
</html>`;
}

/**
 * Generates a full-screen animated presentation HTML (v2).
 * Opens with a month/range selector screen before the slideshow begins.
 */
function generatePresentationHtml(runsStats, logoBase64) {
  const runs = runsStats.filter(Boolean);
  if (!runs.length) {
    return '<!doctype html><html><body style="font-family:sans-serif;padding:40px"><p>No hay datos disponibles.</p></body></html>';
  }
  const dataJson = JSON.stringify(runs);
  const logoSrc = logoBase64 ? `data:image/jpeg;base64,${logoBase64}` : '';
  const generatedAt = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Presentaci\xF3n · Llacol\xE9n</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{width:100%;height:100%;overflow:hidden;background:#010e1a;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#fff;}
@keyframes fadeInUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeInLeft{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:translateX(0)}}
@keyframes scaleIn{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}
@keyframes glowPulse{0%,100%{box-shadow:0 0 20px rgba(246,201,0,.3)}50%{box-shadow:0 0 42px rgba(246,201,0,.75)}}
/* SELECTOR */
#selector{position:fixed;inset:0;z-index:9999;background:linear-gradient(135deg,#010e1a 0%,#004a87 60%,#010e1a 100%);display:flex;align-items:center;justify-content:center;}
.sel-card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:24px;padding:48px 56px;width:620px;max-width:94vw;text-align:center;backdrop-filter:blur(20px);}
.sel-logo{height:clamp(70px,9vh,110px);border-radius:12px;margin-bottom:22px;}
.sel-h1{font-size:clamp(1.6rem,3.5vw,2.6rem);font-weight:800;color:#fff;margin-bottom:6px;}
.sel-inst{font-size:.95rem;color:#90caf9;margin-bottom:28px;}
.sel-tabs{display:flex;gap:8px;justify-content:center;margin-bottom:22px;}
.sel-tab{padding:9px 22px;border-radius:20px;border:1.5px solid rgba(255,255,255,.2);background:transparent;color:rgba(255,255,255,.65);cursor:pointer;font-size:.88rem;font-weight:600;transition:all .2s;}
.sel-tab:hover{background:rgba(255,255,255,.1);color:#fff;}
.sel-tab.active{background:#004a87;border-color:#1a7abf;color:#fff;}
.sel-panel{margin-bottom:26px;}
.sel-label{font-size:.75rem;color:#90caf9;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;}
.sel-select{width:100%;padding:12px 16px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.18);border-radius:12px;color:#fff;font-size:1rem;font-weight:600;outline:none;cursor:pointer;}
.sel-select option{background:#0d2340;color:#fff;}
.sel-range-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.sel-start-btn{width:100%;padding:14px;background:linear-gradient(135deg,#004a87,#1a7abf);border:none;border-radius:14px;color:#fff;font-size:1.05rem;font-weight:700;cursor:pointer;transition:all .2s;animation:glowPulse 2.5s infinite;}
.sel-start-btn:hover{background:linear-gradient(135deg,#1a7abf,#004a87);transform:translateY(-2px);}
/* PRESENTATION */
#pres{position:fixed;inset:0;display:none;}
#slides-wrap{width:100%;height:100%;position:relative;}
/* SLIDES */
.slide{position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;transform:translateX(100%);transition:opacity .55s cubic-bezier(.4,0,.2,1),transform .55s cubic-bezier(.4,0,.2,1);pointer-events:none;overflow:hidden;display:flex;flex-direction:column;}
.slide.active{opacity:1;transform:translateX(0);pointer-events:all;}
.slide.exit-left{opacity:0;transform:translateX(-110%);}
/* BACKGROUNDS */
.bg-title{background:linear-gradient(135deg,#010e1a 0%,#004a87 55%,#071a2d 100%);}
.bg-dark{background:#07192a;}
.bg-section{background:linear-gradient(135deg,#004a87 0%,#071a2d 100%);}
.bg-ranking{background:#050f1a;}
.bg-category{background:#07192a;}
/* LIGHT MODE overrides */
#pres.light .bg-dark,#pres.light .bg-ranking,#pres.light .bg-category{background:#e8f0f8;}
#pres.light .slide-hdr{border-bottom-color:rgba(0,74,135,.4);}
#pres.light .hdr-title{color:#004a87;}
#pres.light .hdr-sub{color:#2a5080;}
#pres.light .rank-name,#pres.light .cat-kpi-v{color:#1a2c3d;}
#pres.light .rank-cat,#pres.light .cat-kpi-l,#pres.light .kpi-pres-lbl,#pres.light .range-cmp-label{color:#2a5080;}
#pres.light .rank-num{color:#c9a100;}
#pres.light .rank-row,#pres.light .range-cmp-row{border-color:rgba(0,0,0,.08);}
#pres.light .rank-bar-track,#pres.light .range-cmp-bar-track{background:rgba(0,0,0,.12);}
#pres.light .cat-name{color:#1a2c3d;}
#pres.light .kpi-pres-card{background:rgba(0,74,135,.07);border-color:rgba(0,74,135,.18);}
#pres.light .chip-ret{background:rgba(0,0,0,.07);color:#2a5080;}
#pres.light .title-h1,#pres.light .sec-title{color:#fff;}
#pres.light .rank-val{color:#1a2c3d;}
#pres.light .occ-h{color:#1b5e20;}
#pres.light .occ-m{color:#bf360c;}
#pres.light .occ-l{color:#b71c1c;}
#pres.light .range-cmp-pct{color:#1a2c3d;}
#pres.light .kpi-pres-val{color:#004a87 !important;}
#pres.light .kpi-pres-icon{opacity:.85;}
/* SLIDE HEADER */
.slide-hdr{display:flex;align-items:center;justify-content:space-between;padding:16px 48px 12px;flex-shrink:0;border-bottom:2px solid rgba(246,201,0,.35);}
.hdr-title{font-size:clamp(1.3rem,2.8vw,2.2rem);font-weight:800;color:#f6c900;}
.hdr-sub{font-size:.88rem;color:#90caf9;}
/* SLIDE BODY */
.slide-body{flex:1;overflow:hidden;display:flex;flex-direction:column;padding:16px 48px 20px;min-height:0;}
/* TITLE SLIDE */
.title-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:40px 80px;text-align:center;}
.title-logo{height:clamp(80px,12vh,140px);border-radius:12px;margin-bottom:clamp(16px,3vh,32px);filter:drop-shadow(0 6px 24px rgba(0,0,0,.55));}
.title-inst{font-size:clamp(.9rem,1.8vw,1.2rem);color:#90caf9;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;animation:fadeInUp .7s .2s both;}
.title-h1{font-size:clamp(2.5rem,6vw,5rem);font-weight:900;color:#fff;line-height:1.05;animation:fadeInUp .7s .4s both;}
.title-line{width:100px;height:5px;background:#f6c900;border-radius:3px;margin:22px auto;animation:scaleIn .6s .6s both;}
.title-period{font-size:clamp(1.5rem,3.2vw,2.6rem);font-weight:600;color:#90caf9;animation:fadeInUp .7s .7s both;}
.title-date{font-size:clamp(.7rem,1.2vw,.9rem);color:rgba(255,255,255,.35);margin-top:16px;animation:fadeInUp .7s .9s both;}
/* KPI GRID */
.kpi-full-grid{flex:1;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:18px;min-height:0;}
.kpi-pres-card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px;transition:transform .2s;}
.kpi-pres-card:hover{transform:translateY(-2px);}
.kpi-pres-icon{font-size:clamp(1.8rem,3.5vw,2.8rem);}
.kpi-pres-val{font-size:clamp(2.2rem,5.5vw,4.5rem);font-weight:900;line-height:1;}
.kpi-pres-lbl{font-size:clamp(.72rem,1.1vw,.95rem);color:#90caf9;text-transform:uppercase;letter-spacing:.07em;text-align:center;}
/* SECTION DIVIDER */
.sec-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(14px,2.5vh,28px);padding:40px 60px;text-align:center;}
.sec-icon{font-size:clamp(4rem,8vw,7rem);animation:scaleIn .6s .1s both;}
.sec-title-row{display:flex;align-items:baseline;gap:20px;flex-wrap:wrap;justify-content:center;animation:fadeInUp .7s .2s both;}
.sec-title{font-size:clamp(2.5rem,6.5vw,5.5rem);font-weight:900;color:#fff;}
.sec-sub-badge{font-size:clamp(1.1rem,2.2vw,1.8rem);color:rgba(255,255,255,.65);font-weight:400;}
.sec-line{width:100px;height:5px;background:#f6c900;border-radius:3px;animation:scaleIn .6s .4s both;}
/* CHANGES */
.changes-body{flex:1;overflow-y:auto;display:flex;flex-wrap:wrap;align-content:flex-start;gap:10px;padding:4px 0;}
.chip{padding:10px 20px;border-radius:22px;font-size:clamp(.85rem,1.4vw,1.1rem);font-weight:600;}
.chip-new{background:rgba(76,175,80,.18);color:#81c784;border:1px solid rgba(76,175,80,.35);}
.chip-featured{background:rgba(246,201,0,.18);color:#f6c900;border:1.5px solid rgba(246,201,0,.5);animation:glowPulse 2.5s infinite;}
.chip-ret{background:rgba(255,255,255,.07);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.12);}
/* RANKINGS */
.rank-list{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;}
.rank-row{display:flex;align-items:center;gap:14px;flex:1;border-bottom:1px solid rgba(255,255,255,.06);padding:4px 2px;}
.rank-row:last-child{border-bottom:none;}
.rank-num{font-size:clamp(1.5rem,3vw,2.4rem);font-weight:800;color:#f6c900;width:clamp(32px,4.5vw,52px);text-align:center;flex-shrink:0;}
.rank-info{flex:1;min-width:0;}
.rank-name{font-size:clamp(.9rem,1.5vw,1.2rem);font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rank-cat{font-size:.78rem;color:#90caf9;margin-top:1px;}
.rank-bar-col{width:clamp(130px,20vw,280px);flex-shrink:0;}
.rank-bar-track{height:14px;background:rgba(255,255,255,.1);border-radius:7px;overflow:hidden;}
.rank-bar-fill{height:100%;border-radius:7px;}
.rank-val{font-size:clamp(1rem,1.6vw,1.3rem);font-weight:800;min-width:clamp(55px,6vw,75px);text-align:right;flex-shrink:0;}
/* CATEGORY */
.cat-hdr{display:flex;align-items:center;gap:14px;padding:14px 48px;flex-shrink:0;border-bottom:2px solid rgba(255,255,255,.08);}
.cat-icon-big{font-size:clamp(2rem,4vw,3.5rem);}
.cat-stripe{width:6px;height:50px;border-radius:3px;flex-shrink:0;}
.cat-name{flex:1;font-size:clamp(1.5rem,3.5vw,2.8rem);font-weight:900;color:#fff;}
.cat-kpis-row{display:flex;gap:clamp(16px,3vw,40px);padding:10px 48px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.07);}
.cat-kpi{text-align:center;}
.cat-kpi-v{font-size:clamp(1.4rem,3vw,2.4rem);font-weight:800;color:#fff;}
.cat-kpi-l{font-size:.75rem;color:#90caf9;text-transform:uppercase;letter-spacing:.06em;margin-top:3px;}
.cat-chart-wrap{flex:1;position:relative;padding:12px 48px 16px;min-height:0;}
.trend-chart-wrap{flex:1;position:relative;min-height:0;padding:12px 24px 16px;}
/* RANGE COMPARISON */
.range-cmp-list{flex:1;display:flex;flex-direction:column;min-height:0;}
.range-cmp-row{display:flex;align-items:center;gap:16px;flex:1;border-bottom:1px solid rgba(255,255,255,.06);padding:6px 2px;}
.range-cmp-row:last-child{border-bottom:none;}
.range-cmp-label{min-width:clamp(100px,12vw,160px);font-size:clamp(.9rem,1.5vw,1.2rem);font-weight:600;color:#fff;flex-shrink:0;}
.range-cmp-att{min-width:clamp(90px,10vw,140px);font-size:clamp(1.6rem,3.5vw,3rem);font-weight:900;color:#f6c900;text-align:right;flex-shrink:0;line-height:1;}
.range-cmp-unit{font-size:.5em;color:#90caf9;font-weight:400;margin-left:4px;}
.range-cmp-bar-wrap{flex:1;display:flex;align-items:center;gap:12px;min-width:0;}
.range-cmp-bar-track{flex:1;height:16px;background:rgba(255,255,255,.1);border-radius:8px;overflow:hidden;}
.range-cmp-pct{font-size:clamp(1rem,1.6vw,1.3rem);font-weight:800;min-width:clamp(50px,6vw,70px);text-align:right;flex-shrink:0;}
/* CLOSING */
.closing-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(12px,2.5vh,24px);padding:40px 60px;}
/* NAV — auto-hide */
#nav{position:fixed;bottom:clamp(14px,3vh,28px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.72);backdrop-filter:blur(14px);border-radius:36px;padding:10px 20px;border:1px solid rgba(255,255,255,.12);z-index:200;transition:opacity .4s ease;}
.nav-btn{width:40px;height:40px;border-radius:50%;border:1.5px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;transition:background .15s;}
.nav-btn:hover{background:rgba(255,255,255,.22);}
.nav-btn:disabled{opacity:.3;cursor:not-allowed;}
#slide-counter{color:rgba(255,255,255,.75);font-size:.88rem;font-weight:600;min-width:68px;text-align:center;}
#prog-wrap{position:fixed;bottom:0;left:0;width:100%;height:4px;background:rgba(255,255,255,.08);z-index:300;transition:opacity .4s ease;}
#prog-fill{height:100%;background:linear-gradient(90deg,#004a87,#f6c900);transition:width .45s ease;}
/* TOP-BAR — auto-hide */
#top-bar{position:fixed;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;z-index:200;background:linear-gradient(to bottom,rgba(0,0,0,.55),transparent);transition:opacity .4s ease;}
#pres.ui-hidden #top-bar{opacity:0;pointer-events:none;}
#pres.ui-hidden #nav{opacity:0;pointer-events:none;}
.ctrl-btn{padding:6px 14px;border-radius:18px;border:1.5px solid rgba(255,255,255,.2);background:rgba(0,0,0,.45);backdrop-filter:blur(8px);color:rgba(255,255,255,.8);cursor:pointer;font-size:.75rem;font-weight:600;transition:background .15s;white-space:nowrap;}
.ctrl-btn:hover{background:rgba(255,255,255,.18);}
.occ-h{color:#4caf50;}.occ-m{color:#ff9800;}.occ-l{color:#f44336;}
.anim-stagger{opacity:0;}
.anim-stagger.entered{animation:fadeInLeft .6s both;}
</style>
</head>
<body>
<div id="selector">
  <div class="sel-card">
    ${logoSrc ? `<img class="sel-logo" src="${logoSrc}" alt="Llacol\xE9n">` : ''}
    <h1 class="sel-h1">Estadísticas MatchPoint</h1>
    <p class="sel-inst">Campos Deportivos Llacolén</p>
    <div class="sel-tabs">
      <button class="sel-tab active" id="tabMonth" onclick="setMode('month')">📅 Mes específico</button>
      <button class="sel-tab" id="tabRange" onclick="setMode('range')">📊 Rango de meses</button>
    </div>
    <div class="sel-panel" id="panelMonth">
      <div class="sel-label">Selecciona el período a presentar</div>
      <select class="sel-select" id="selMonth"></select>
    </div>
    <div class="sel-panel" id="panelRange" style="display:none">
      <div class="sel-label">Selecciona el rango de meses</div>
      <div class="sel-range-row">
        <div><div class="sel-label">Desde</div><select class="sel-select" id="selFrom"></select></div>
        <div><div class="sel-label">Hasta</div><select class="sel-select" id="selTo"></select></div>
      </div>
    </div>
    <button class="sel-start-btn" onclick="startPresentation()">▶ Iniciar presentación</button>
  </div>
</div>
<div id="pres">
  <div id="slides-wrap"></div>
  <div id="prog-wrap"><div id="prog-fill" style="width:0%"></div></div>
  <nav id="nav">
    <button class="nav-btn" id="prevBtn" disabled>&#8249;</button>
    <div id="slide-counter">1 / 1</div>
    <button class="nav-btn" id="nextBtn">&#8250;</button>
  </nav>
  <div id="top-bar">
    <button class="ctrl-btn" onclick="showSelector()">↩ Volver</button>
    <div style="display:flex;gap:8px">
      <button class="ctrl-btn" onclick="toggleAutoPlay()" id="autoBtn">▶ Auto (7s)</button>
      <button class="ctrl-btn" onclick="toggleLightMode()" id="lightBtn">☀️ Modo claro</button>
      <button class="ctrl-btn" onclick="toggleFullscreen()">⛶ Pantalla completa</button>
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
const ALL_RUNS=${dataJson};
ALL_RUNS.sort((a,b)=>(a.monthKey||'').localeCompare(b.monthKey||''));
const LOGO='${logoSrc.replace(/'/g, "\\'")}';
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function num(v){return Number(v).toLocaleString('es-CL');}
function pct(v){return(Math.round(10*v)/10).toFixed(1)+'%';}
function occColor(p){return p>=90?'#4caf50':p>=70?'#ff9800':'#1a7abf';}
function occCls(p){return p>=90?'occ-h':p>=70?'occ-m':p<35&&p>0?'occ-l':'';}
function hex2rgb(hex,a){try{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return'rgba('+r+','+g+','+b+','+a+')';}catch(e){return'rgba(100,160,220,'+a+')';}}
function getCatIcon(l){const m={'Fitness':'🏋️','Piscina Temperada':'🏊','Inclusivas':'♿','Actividades Deportivas':'⚽','Actividades Menores':'👦','Otras Actividades':'🎨','Escuela de Invierno':'❄️'};return m[l]||'📋';}
function getAllActs(run){const r=[];for(const c of(run.categories||[]))for(const a of(c.activities||[]))r.push({name:a.label,category:c.label,catColor:c.color,...a.totals});return r;}
let presMode='month',selRunIdx=ALL_RUNS.length-1,selFrom=0,selTo=ALL_RUNS.length-1;
let currentSlide=0,slides=[],slideData={},presCharts={},autoPlay=false,autoTimer=null,hideTimer=null;
function logoImg(h){return LOGO?'<img src="'+LOGO+'" style="height:'+h+'px;border-radius:8px;opacity:.85" alt="">':'';}

/* ── SELECTOR ── */
function initSelector(){
  const sm=document.getElementById('selMonth'),sf=document.getElementById('selFrom'),st=document.getElementById('selTo');
  ALL_RUNS.forEach((r,i)=>{[sm,sf,st].forEach(el=>{const o=document.createElement('option');o.value=i;o.textContent=r.label;el.appendChild(o);});});
  sm.value=ALL_RUNS.length-1;sf.value=0;st.value=ALL_RUNS.length-1;
}
function setMode(m){presMode=m;['Month','Range'].forEach(x=>{document.getElementById('tab'+x).classList.toggle('active',m===x.toLowerCase());document.getElementById('panel'+x).style.display=m===x.toLowerCase()?'':'none';});}
function startPresentation(){
  selRunIdx=Number(document.getElementById('selMonth').value);
  selFrom=Number(document.getElementById('selFrom').value);
  selTo=Number(document.getElementById('selTo').value);
  document.getElementById('selector').style.display='none';
  document.getElementById('pres').style.display='block';
  buildAndRender();
  showUI();
}
function showSelector(){document.getElementById('pres').style.display='none';document.getElementById('selector').style.display='flex';if(autoPlay){autoPlay=false;clearInterval(autoTimer);document.getElementById('autoBtn').textContent='▶ Auto (7s)';}}

/* ── AUTO-HIDE UI ── */
function showUI(){
  document.getElementById('pres').classList.remove('ui-hidden');
  clearTimeout(hideTimer);
  hideTimer=setTimeout(()=>document.getElementById('pres').classList.add('ui-hidden'),2500);
}

/* ── LIGHT MODE ── */
function toggleLightMode(){
  const pres=document.getElementById('pres');
  const isLight=pres.classList.toggle('light');
  document.getElementById('lightBtn').textContent=isLight?'🌙 Modo oscuro':'☀️ Modo claro';
  // Re-render any active chart slide with updated colors
  const active=document.querySelector('.slide.active');
  if(active&&active.dataset.chartType){
    Object.values(presCharts).forEach(c=>{try{c.destroy();}catch(e){}});
    presCharts={};
    setTimeout(()=>renderChartOnSlide(active,slideData[currentSlide]),50);
  }
}

/* ── SLIDE BUILDERS ── */
function buildSlides(){return presMode==='range'&&selFrom!==selTo?buildRangeSlides():buildMonthSlides(selRunIdx);}
function buildMonthSlides(runIdx){
  const run=ALL_RUNS[runIdx];if(!run)return[];
  const s=[];
  s.push({type:'title',label:run.label,run});
  s.push({type:'month-kpis',run});
  s.push({type:'cat-overview',run});
  const cc=run.classChanges;
  if(cc&&cc.hasPreviousMonth){if(cc.newClasses.length)s.push({type:'new-classes',cc,run});if(cc.retiredClasses.length)s.push({type:'ret-classes',cc});}
  const allActs=getAllActs(run);
  if(allActs.length>=3){
    const withCap=allActs.filter(a=>a.capacity>0);
    s.push({type:'ranking',title:'🏆 Mayor Ocupación %',sub:'Actividades con más inscriptos vs cupo',acts:[...withCap].sort((a,b)=>b.occupancyPct-a.occupancyPct).slice(0,8),metric:'pct'});
    s.push({type:'ranking',title:'📉 Menor Ocupación %',sub:'Actividades con potencial de crecimiento',acts:[...withCap].filter(a=>a.occupancyPct>0).sort((a,b)=>a.occupancyPct-b.occupancyPct).slice(0,8),metric:'pct'});
    s.push({type:'ranking',title:'👥 Mayor Inscripción',sub:'Actividades con más inscritos',acts:[...allActs].sort((a,b)=>b.attendees-a.attendees).slice(0,8),metric:'att'});
    s.push({type:'ranking',title:'📊 Menor Inscripción',sub:'Actividades con menos inscritos',acts:[...allActs].filter(a=>a.attendees>0).sort((a,b)=>a.attendees-b.attendees).slice(0,8),metric:'att'});
  }
  for(const cat of(run.categories||[])){
    s.push({type:'section',title:cat.label,icon:getCatIcon(cat.label),color:cat.color,sub:num(cat.totals.attendees)+' inscritos · '+pct(cat.totals.occupancyPct)+' ocupación'});
    s.push({type:'category',cat,run});
  }
  s.push({type:'closing',run});
  return s;
}
function buildRangeSlides(){
  const rng=ALL_RUNS.slice(selFrom,selTo+1);if(!rng.length)return[];
  const s=[];
  const label=rng[0].label+(rng.length>1?' — '+rng[rng.length-1].label:'');
  s.push({type:'title',label,run:rng[rng.length-1],isRange:true});
  s.push({type:'range-overview',runs:rng});
  s.push({type:'section',title:'Tendencia de inscripción',icon:'📈',sub:rng.length+' períodos analizados'});
  s.push({type:'trend-att',runs:rng});
  s.push({type:'section',title:'Tendencia de ocupación',icon:'📊',sub:'Evolución mes a mes'});
  s.push({type:'trend-occ',runs:rng});
  s.push({type:'range-highlights',runs:rng});
  const lastRun=rng[rng.length-1];
  for(const cat of(lastRun.categories||[])){
    s.push({type:'section',title:cat.label+' — tendencia',icon:getCatIcon(cat.label),color:cat.color,sub:'Últimos '+rng.length+' períodos'});
    s.push({type:'range-category',cat,runs:rng});
  }
  s.push({type:'closing',run:lastRun});
  return s;
}

/* ── RENDER DISPATCHER ── */
function renderSlideHtml(s,idx){
  switch(s.type){
    case'title':return renderTitle(s);
    case'month-kpis':return renderMonthKpis(s,idx);
    case'cat-overview':return renderCatOverview(s,idx);
    case'section':return renderSection(s);
    case'new-classes':return renderNewClasses(s);
    case'ret-classes':return renderRetClasses(s);
    case'ranking':return renderRanking(s);
    case'category':return renderCategory(s,idx);
    case'range-overview':return renderRangeOverview(s,idx);
    case'trend-att':case'trend-occ':return renderTrend(s,idx);
    case'range-highlights':return renderRangeHighlights(s);
    case'range-category':return renderRangeCat(s,idx);
    case'closing':return renderClosing(s);
    default:return'<div class="slide bg-dark"><p style="padding:60px;color:#90caf9">Diapositiva no disponible</p></div>';
  }
}

/* ── INDIVIDUAL RENDERERS ── */
function renderTitle(s){
  const badge=s.isRange?'<span style="display:inline-block;padding:4px 14px;border-radius:12px;background:rgba(246,201,0,.15);border:1px solid rgba(246,201,0,.4);font-size:.82rem;font-weight:600;color:#f6c900;margin-bottom:14px">Rango de meses</span>':'';
  return'<div class="slide bg-title"><div class="title-wrap">'+(LOGO?'<img class="title-logo" src="'+LOGO+'" alt="">':'')+'<p class="title-inst">Campos Deportivos Llacolén</p>'+badge+'<h1 class="title-h1">Estadísticas MatchPoint</h1><div class="title-line"></div><p class="title-period">'+esc(s.label)+'</p><p class="title-date">Generado el ${escHtml(generatedAt)}</p></div></div>';
}
function renderMonthKpis(s,idx){
  const t=s.run.totals,occ=t.occupancyPct,cc=s.run.classChanges;
  const newCnt=cc&&cc.hasPreviousMonth?cc.newCount:null;
  const retCnt=cc&&cc.hasPreviousMonth?cc.retiredCount:null;
  return'<div class="slide bg-dark" data-idx="'+idx+'">'+'<div class="slide-hdr"><span class="hdr-title">Indicadores del Período</span><span class="hdr-sub">'+esc(s.run.label)+'</span>'+logoImg(68)+'</div><div class="slide-body"><div class="kpi-full-grid">'+
    kpiCard('👥',num(t.attendees),'#f6c900','Inscritos')+
    kpiCard('🏟️',num(t.capacity),'#90caf9','Cupos ofrecidos')+
    kpiCard('📊',pct(occ),occ>=90?'#4caf50':occ>=70?'#ff9800':'#f44336','Ocupación total')+
    kpiCard('📋',num(t.classes),'#ce93d8','Clases realizadas')+
    kpiCard('🆕',newCnt!=null?String(newCnt):'—','#81c784','Clases nuevas')+
    kpiCard('🗑️',retCnt!=null?String(retCnt):'—','#f48fb1','Clases eliminadas')+
  '</div>'+(cc&&cc.hasPreviousMonth&&cc.previousMonthLabel?'<p style="text-align:center;color:rgba(255,255,255,.3);font-size:.78rem;padding-top:8px">Comparado con '+esc(cc.previousMonthLabel)+'</p>':'')+'</div></div>';
}
function kpiCard(icon,val,color,label){return'<div class="kpi-pres-card anim-stagger"><div class="kpi-pres-icon">'+icon+'</div><div class="kpi-pres-val" style="color:'+color+'">'+val+'</div><div class="kpi-pres-lbl">'+label+'</div></div>';}
function renderCatOverview(s,idx){
  const cats=s.run.categories||[],totalAtt=cats.reduce((a,c)=>a+c.totals.attendees,0);
  return'<div class="slide bg-dark" data-idx="'+idx+'" data-chart-type="catbar" data-chart-id="cov-'+idx+'"><div class="slide-hdr"><span class="hdr-title">Distribución por Categoría</span><span class="hdr-sub">'+num(totalAtt)+' inscritos totales</span>'+logoImg(68)+'</div><div class="slide-body"><div class="cat-chart-wrap"><canvas id="cov-'+idx+'" style="max-height:100%;width:100%"></canvas></div></div></div>';
}
function renderSection(s){
  const bg=s.color?'background:linear-gradient(135deg,'+s.color+'ee 0%,#071a2d 100%)':'';
  return'<div class="slide bg-section" style="'+(bg||'')+'"><div class="sec-wrap"><div class="sec-icon">'+esc(s.icon||'📋')+'</div><div class="sec-title-row"><span class="sec-title">'+esc(s.title)+'</span>'+(s.sub?'<span class="sec-sub-badge">'+esc(s.sub)+'</span>':'')+'</div><div class="sec-line"></div></div></div>';
}
function renderNewClasses(s){
  const chips=s.cc.newClasses.map(c=>{const feat=/explorador/i.test(c.name);return'<span class="chip '+(feat?'chip-featured':'chip-new')+'">'+esc(c.name)+(feat?' ✨':'')+(c.occupancyPct>0?' <span style="font-size:.75em;opacity:.7">'+pct(c.occupancyPct)+'</span>':'')+'</span>';}).join('');
  return'<div class="slide bg-dark"><div class="slide-hdr"><span class="hdr-title">🟢 Clases Incorporadas</span><span class="hdr-sub">'+s.cc.newClasses.length+' nuevas vs. '+esc(s.cc.previousMonthLabel)+'</span>'+logoImg(68)+'</div><div class="slide-body"><div class="changes-body">'+chips+'</div></div></div>';
}
function renderRetClasses(s){
  const chips=s.cc.retiredClasses.map(c=>'<span class="chip chip-ret" title="Estaba en '+esc(c.lastLabel||'')+'">'+esc(c.name)+'</span>').join('');
  return'<div class="slide bg-dark"><div class="slide-hdr"><span class="hdr-title">🗑️ Clases Eliminadas</span><span class="hdr-sub">'+s.cc.retiredClasses.length+' que estaban en '+esc(s.cc.previousMonthLabel)+' ya no aparecen</span>'+logoImg(68)+'</div><div class="slide-body"><div class="changes-body">'+chips+'</div></div></div>';
}
function renderRanking(s){
  if(!s.acts||!s.acts.length)return'<div class="slide bg-ranking"><div class="slide-hdr"><span class="hdr-title">'+esc(s.title)+'</span></div><p style="padding:40px;color:#90caf9">Sin datos.</p></div>';
  const maxVal=s.metric==='pct'?100:(Math.max(...s.acts.map(a=>a.attendees))||1);
  const rows=s.acts.map((a,i)=>{
    const val=s.metric==='pct'?a.occupancyPct:a.attendees;
    const fillPct=Math.min(100,s.metric==='pct'?val:Math.round(val/maxVal*100));
    const color=s.metric==='pct'?occColor(val):'#1a7abf';
    const displayVal=s.metric==='pct'?pct(val):num(val);
    return'<div class="rank-row anim-stagger"><div class="rank-num">'+(i+1)+'</div><div class="rank-info"><div class="rank-name">'+esc(a.name)+'</div><div class="rank-cat">'+esc(a.category)+'</div></div><div class="rank-bar-col"><div class="rank-bar-track"><div class="rank-bar-fill" data-w="'+fillPct+'" style="width:0%;background:'+color+'"></div></div></div><div class="rank-val '+occCls(s.metric==='pct'?val:0)+'">'+displayVal+'</div></div>';
  }).join('');
  return'<div class="slide bg-ranking"><div class="slide-hdr"><span class="hdr-title">'+s.title+'</span><span class="hdr-sub">'+esc(s.sub||'')+'</span>'+logoImg(68)+'</div><div class="slide-body"><div class="rank-list">'+rows+'</div></div></div>';
}
function renderCategory(s,idx){
  const{cat,run}=s,t=cat.totals;
  return'<div class="slide bg-category" data-idx="'+idx+'" data-chart-type="catbar" data-chart-id="catd-'+idx+'"><div class="cat-hdr" style="border-bottom-color:'+cat.color+'55"><div class="cat-icon-big">'+getCatIcon(cat.label)+'</div><div class="cat-stripe" style="background:'+cat.color+'"></div><div class="cat-name">'+esc(cat.label)+'</div>'+logoImg(68)+'</div><div class="cat-kpis-row">'+catKpi(num(t.attendees),'Inscritos')+catKpi(num(t.capacity),'Cupos')+catKpi(num(t.classes),'Clases')+catKpi(pct(t.occupancyPct),'Ocupación',t.occupancyPct>=90?'#4caf50':t.occupancyPct>=70?'#ff9800':'#f44336')+'</div><div class="cat-chart-wrap"><canvas id="catd-'+idx+'" style="max-height:100%;width:100%"></canvas></div></div>';
}
function catKpi(v,l,c){return'<div class="cat-kpi"><div class="cat-kpi-v"'+(c?' style="color:'+c+'"':'')+'>'+v+'</div><div class="cat-kpi-l">'+l+'</div></div>';}
function renderRangeOverview(s,idx){
  const runs=s.runs,totAtt=runs.reduce((a,r)=>a+r.totals.attendees,0),totCls=runs.reduce((a,r)=>a+r.totals.classes,0);
  const avgOcc=Math.round(10*runs.reduce((a,r)=>a+r.totals.occupancyPct,0)/runs.length)/10;
  const best=runs.reduce((b,r)=>r.totals.attendees>b.totals.attendees?r:b);
  const worst=runs.reduce((b,r)=>r.totals.occupancyPct<b.totals.occupancyPct?r:b);
  return'<div class="slide bg-dark" data-idx="'+idx+'"><div class="slide-hdr"><span class="hdr-title">Resumen del Período</span><span class="hdr-sub">'+runs.length+' meses analizados</span>'+logoImg(68)+'</div><div class="slide-body"><div class="kpi-full-grid">'+kpiCard('📅',String(runs.length),'#90caf9','Meses analizados')+kpiCard('👥',num(totAtt),'#f6c900','Total inscritos')+kpiCard('📋',num(totCls),'#ce93d8','Total clases')+kpiCard('📊',pct(avgOcc),avgOcc>=90?'#4caf50':avgOcc>=70?'#ff9800':'#f44336','Ocupación promedio')+kpiCard('🏆',esc(best.label),'#81c784','Mejor mes (inscritos)')+kpiCard('📉',esc(worst.label),'#f48fb1','Mes menor ocupación')+'</div></div></div>';
}
function renderTrend(s,idx){
  const title=s.type==='trend-att'?'Inscritos por mes':'Ocupación % por mes';
  return'<div class="slide bg-dark" data-idx="'+idx+'" data-chart-type="'+s.type+'" data-chart-id="tr-'+idx+'"><div class="slide-hdr"><span class="hdr-title">'+title+'</span>'+logoImg(68)+'</div><div class="slide-body"><div class="trend-chart-wrap"><canvas id="tr-'+idx+'" style="max-height:100%;width:100%"></canvas></div></div></div>';
}
function renderRangeHighlights(s){
  const runs=s.runs;
  const rows=runs.map(r=>{const occ=r.totals.occupancyPct,fillW=Math.min(100,occ);return'<div class="range-cmp-row anim-stagger"><div class="range-cmp-label">'+esc(r.label)+'</div><div class="range-cmp-att">'+num(r.totals.attendees)+'<span class="range-cmp-unit">ins.</span></div><div class="range-cmp-bar-wrap"><div class="range-cmp-bar-track"><div class="rank-bar-fill" data-w="'+fillW+'" style="width:0%;background:'+occColor(occ)+'"></div></div><span class="range-cmp-pct '+occCls(occ)+'">'+pct(occ)+'</span></div></div>';}).join('');
  return'<div class="slide bg-ranking"><div class="slide-hdr"><span class="hdr-title">📊 Comparación de períodos</span><span class="hdr-sub">Inscritos y ocupación por mes</span>'+logoImg(68)+'</div><div class="slide-body"><div class="range-cmp-list">'+rows+'</div></div></div>';
}
function renderRangeCat(s,idx){
  return'<div class="slide bg-category" data-idx="'+idx+'" data-chart-type="cattrend" data-chart-id="rct-'+idx+'"><div class="cat-hdr" style="border-bottom-color:'+s.cat.color+'55"><div class="cat-icon-big">'+getCatIcon(s.cat.label)+'</div><div class="cat-stripe" style="background:'+s.cat.color+'"></div><div class="cat-name">'+esc(s.cat.label)+'</div>'+logoImg(68)+'</div><div class="cat-chart-wrap"><canvas id="rct-'+idx+'" style="max-height:100%;width:100%"></canvas></div></div>';
}
function renderClosing(s){
  return'<div class="slide bg-title"><div class="closing-wrap">'+(LOGO?'<img src="'+LOGO+'" style="height:clamp(70px,10vh,120px);border-radius:12px;">':'')+'<h2 style="font-size:clamp(2.5rem,6vw,4.5rem);font-weight:900;text-align:center;animation:fadeInUp .7s .2s both">¡Gracias!</h2><div style="width:100px;height:5px;background:#f6c900;border-radius:3px;animation:scaleIn .6s .4s both"></div><p style="font-size:clamp(1.1rem,2.2vw,1.7rem);color:#90caf9;text-align:center;animation:fadeInUp .7s .5s both">Campos Deportivos Llacolén</p><p style="font-size:.88rem;color:rgba(255,255,255,.35);text-align:center;animation:fadeInUp .7s .7s both">'+esc(s.run.label)+'</p></div></div>';
}

/* ── CHART RENDERING ── */
const TOOLTIP_OPTS={backgroundColor:'rgba(0,0,0,.9)',titleFont:{size:15,weight:'bold'},bodyFont:{size:13},padding:12,borderColor:'rgba(255,255,255,.2)',borderWidth:1};
function gc(){const l=document.getElementById('pres')&&document.getElementById('pres').classList.contains('light');return l?{grid:'rgba(0,0,0,.1)',tick:'#2a5080',text:'#1a2c3d',leg:'#2a5080'}:{grid:'rgba(255,255,255,.08)',tick:'#90caf9',text:'#fff',leg:'#90caf9'};}
function renderChartOnSlide(slideEl,data){
  const type=slideEl.dataset.chartType,cid=slideEl.dataset.chartId;
  if(!type||!cid)return;
  const canvas=document.getElementById(cid);if(!canvas)return;
  if(presCharts[cid]){presCharts[cid].destroy();delete presCharts[cid];}
  const idx=Number(slideEl.dataset.idx),sd=slideData[idx];if(!sd)return;
  const cc=gc();
  if(type==='catbar'){
    const isOv=cid.startsWith('cov-');
    const items=isOv?(sd.run&&sd.run.categories||[]):(sd.cat&&sd.cat.activities||[]);
    const labels=items.map(x=>x.label.length>28?x.label.slice(0,26)+'\u2026':x.label);
    const att=items.map(x=>x.totals.attendees),cap=items.map(x=>x.totals.capacity),occ=items.map(x=>x.totals.occupancyPct);
    const col=sd.cat&&sd.cat.color;
    const bgA=labels.map((_,i)=>col?hex2rgb(col,.85):hex2rgb(items[i].color||'#1a7abf',.85));
    const bgC=labels.map((_,i)=>col?hex2rgb(col,.2):hex2rgb(items[i].color||'#1a7abf',.2));
    presCharts[cid]=new Chart(canvas,{type:'bar',data:{labels,datasets:[{label:'Cupos',data:cap,backgroundColor:bgC,borderColor:bgA,borderWidth:1.5,borderRadius:4},{label:'Inscritos',data:att,backgroundColor:bgA,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:{duration:1200,easing:'easeOutQuart'},plugins:{legend:{position:'top',labels:{color:cc.leg,font:{size:14},boxWidth:14}},tooltip:{...TOOLTIP_OPTS,callbacks:{afterLabel(ctx){if(ctx.datasetIndex===1)return'Ocupación: '+pct(occ[ctx.dataIndex]);return'';}}}},scales:{x:{beginAtZero:true,ticks:{color:cc.tick,font:{size:13}},grid:{color:cc.grid}},y:{ticks:{color:cc.text,font:{size:15}},grid:{display:false}}}}});
  } else if(type==='trend-att'||type==='trend-occ'){
    const runs=sd.runs||[],labels=runs.map(r=>r.label),isOcc=type==='trend-occ';
    const palette=['#1a7abf','#f6c900','#4caf50','#ce93d8','#ff9800','#f44336','#90caf9'];
    const datasets=isOcc?[{label:'Ocupación %',data:runs.map(r=>r.totals.occupancyPct),borderColor:'#f6c900',backgroundColor:'rgba(246,201,0,.15)',fill:true,tension:.35,pointRadius:5,pointBackgroundColor:'#f6c900',borderWidth:2.5}]:
      [...new Set(runs.flatMap(r=>(r.categories||[]).map(c=>c.label)))].map((cn,i)=>({label:cn,data:runs.map(r=>{const c=(r.categories||[]).find(x=>x.label===cn);return c?c.totals.attendees:0;}),borderColor:palette[i%palette.length],backgroundColor:hex2rgb(palette[i%palette.length],.1),fill:false,tension:.35,pointRadius:4,pointBackgroundColor:palette[i%palette.length],borderWidth:2.5}));
    presCharts[cid]=new Chart(canvas,{type:'line',data:{labels,datasets},options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:1200,easing:'easeOutQuart'},
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',labels:{color:cc.leg,font:{size:14},boxWidth:14}},tooltip:{...TOOLTIP_OPTS,callbacks:{label(ctx){return' '+ctx.dataset.label+': '+(isOcc?pct(ctx.parsed.y):num(ctx.parsed.y));}}}},
      scales:{
        x:{ticks:{color:cc.tick,font:{size:13}},grid:{color:cc.grid}},
        y:{beginAtZero:true,max:isOcc?100:undefined,ticks:{color:cc.tick,font:{size:13},callback:isOcc?v=>v+'%':undefined},grid:{color:cc.grid}}
      }
    }});
  } else if(type==='cattrend'){
    const runs=sd.runs||[],catLabel=sd.cat&&sd.cat.label,color=sd.cat&&sd.cat.color,labels=runs.map(r=>r.label);
    const attData=runs.map(r=>{const c=(r.categories||[]).find(x=>x.label===catLabel);return c?c.totals.attendees:0;});
    const occData=runs.map(r=>{const c=(r.categories||[]).find(x=>x.label===catLabel);return c?c.totals.occupancyPct:0;});
    presCharts[cid]=new Chart(canvas,{type:'bar',data:{labels,datasets:[
      {type:'bar',label:'Inscritos',data:attData,backgroundColor:hex2rgb(color||'#1a7abf',.65),borderRadius:4,yAxisID:'y',order:2},
      {type:'line',label:'Ocupación %',data:occData,borderColor:'#f6c900',pointRadius:6,pointHoverRadius:9,pointBackgroundColor:'#f6c900',fill:false,tension:.35,yAxisID:'y2',order:1,borderWidth:2.5,pointStyle:'circle'}
    ]},options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:1200,easing:'easeOutQuart'},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{color:cc.leg,font:{size:14},boxWidth:14}},
        tooltip:{...TOOLTIP_OPTS,callbacks:{label(ctx){return' '+ctx.dataset.label+': '+(ctx.dataset.yAxisID==='y2'?pct(ctx.parsed.y):num(ctx.parsed.y));}}}
      },
      scales:{
        y:{beginAtZero:true,ticks:{color:cc.tick,font:{size:13}},grid:{color:cc.grid}},
        y2:{position:'right',beginAtZero:true,max:100,ticks:{color:'#f6c900',callback:v=>v+'%',font:{size:13}},grid:{display:false}},
        x:{ticks:{color:cc.tick,font:{size:13}},grid:{display:false}}
      }
    }});
  }
}

/* ── ANIMATE SLIDE ── */
function animateSlide(slideEl,data){
  slideEl.querySelectorAll('.anim-stagger').forEach((el,i)=>{el.classList.remove('entered');el.style.animationDelay=(0.08+i*0.09)+'s';setTimeout(()=>el.classList.add('entered'),20);});
  slideEl.querySelectorAll('[data-w]').forEach((el,i)=>{el.style.width='0%';setTimeout(()=>{el.style.transition='width 1.3s cubic-bezier(.4,0,.2,1)';el.style.width=el.dataset.w+'%';},150+i*70);});
  setTimeout(()=>renderChartOnSlide(slideEl,data),80);
}

/* ── BUILD & NAVIGATE ── */
function buildAndRender(){
  Object.values(presCharts).forEach(c=>{try{c.destroy();}catch(e){}});
  presCharts={};slideData={};slides=buildSlides();
  const wrap=document.getElementById('slides-wrap');wrap.innerHTML='';
  slides.forEach((s,i)=>{slideData[i]=s;const div=document.createElement('div');div.innerHTML=renderSlideHtml(s,i);wrap.appendChild(div.firstElementChild);});
  currentSlide=0;updateNav();showSlide(0,null);
}
function showSlide(toIdx,direction){
  const all=document.querySelectorAll('.slide'),from=document.querySelector('.slide.active'),target=all[toIdx];
  if(!target)return;
  if(from&&from!==target){from.classList.remove('active');if(direction==='next')from.classList.add('exit-left');else if(direction==='prev'){from.style.transform='translateX(110%)';setTimeout(()=>{from.style.transform='';},650);}setTimeout(()=>{from.classList.remove('exit-left');from.style.transform='';},650);}
  if(direction==='prev'){target.style.transform='translateX(-110%)';setTimeout(()=>{target.style.transition='transform .55s cubic-bezier(.4,0,.2,1)';target.style.transform='';},20);}else if(direction===null){target.style.transform='translateX(0)';target.style.transition='none';}
  target.classList.add('active');animateSlide(target,slideData[toIdx]);updateNav();
}
function next(){if(currentSlide<slides.length-1){currentSlide++;showSlide(currentSlide,'next');showUI();}}
function prev(){if(currentSlide>0){currentSlide--;showSlide(currentSlide,'prev');showUI();}}
function updateNav(){document.getElementById('slide-counter').textContent=(currentSlide+1)+' / '+slides.length;document.getElementById('prevBtn').disabled=currentSlide===0;document.getElementById('nextBtn').disabled=currentSlide>=slides.length-1;const p=slides.length>1?((currentSlide)/(slides.length-1)*100).toFixed(1):100;document.getElementById('prog-fill').style.width=p+'%';}
document.getElementById('nextBtn').addEventListener('click',next);
document.getElementById('prevBtn').addEventListener('click',prev);
document.getElementById('pres').addEventListener('mousemove',showUI);
document.getElementById('pres').addEventListener('click',showUI);
document.addEventListener('keydown',e=>{if(document.getElementById('selector').style.display!=='none')return;if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();next();}else if(e.key==='ArrowLeft'){e.preventDefault();prev();}else if(e.key==='Home'){currentSlide=0;showSlide(0,null);showUI();}else if(e.key==='End'){currentSlide=slides.length-1;showSlide(currentSlide,null);showUI();}});
function toggleFullscreen(){if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});else document.exitFullscreen().catch(()=>{});}
document.addEventListener('keydown',e=>{if(e.key==='F'||e.key==='f'){e.preventDefault();toggleFullscreen();}});
function toggleAutoPlay(){autoPlay=!autoPlay;document.getElementById('autoBtn').textContent=autoPlay?'⏸ Pausar':'▶ Auto (7s)';if(autoPlay){autoTimer=setInterval(()=>{if(currentSlide<slides.length-1){next();}else{autoPlay=false;clearInterval(autoTimer);document.getElementById('autoBtn').textContent='▶ Auto (7s)';}},7000);}else clearInterval(autoTimer);}
/* Init */
initSelector();
</script>
${passwordGateFrag()}
</body>
</html>`;
}

module.exports = { buildRunStats, computeMonthlyClassChanges, generateDashboardHtml, generateDashboardHtmlV2, generatePresentationHtml };