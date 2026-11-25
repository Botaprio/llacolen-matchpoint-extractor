'use strict';

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunes…sábado, domingo al final

function runLabel(run) {
  if (!run) return '';
  return run.date_from === run.date_to ? run.date_from : `${run.date_from} — ${run.date_to}`;
}

/**
 * Agrupa los eventos de una extracción por (actividad, día de semana, hora de inicio)
 * y devuelve un array ordenado listo para mostrar o exportar.
 */
function buildScheduleStructure(events) {
  const groups = new Map();
  for (const event of (events || [])) {
    if (!event.event_date || !event.start_time) continue;
    const dayNum = new Date(event.event_date + 'T00:00:00Z').getUTCDay();
    const key = `${event.activity_name}\x00${dayNum}\x00${event.start_time}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        activity: event.activity_name,
        dayNum,
        day: DAY_NAMES[dayNum],
        time: event.start_time,
        endTime: event.end_time || null,
        sessions: 0,
        sumAttendees: 0,
        sumCapacity: 0,
      };
      groups.set(key, g);
    }
    g.sessions++;
    g.sumAttendees += Number(event.attendees) || 0;
    g.sumCapacity += Number(event.capacity) || 0;
    if (!g.endTime && event.end_time) g.endTime = event.end_time;
  }

  return [...groups.values()]
    .sort((a, b) => {
      const ac = a.activity.localeCompare(b.activity, 'es');
      if (ac !== 0) return ac;
      const di = DAY_ORDER.indexOf(a.dayNum) - DAY_ORDER.indexOf(b.dayNum);
      if (di !== 0) return di;
      return a.time.localeCompare(b.time);
    })
    .map((g) => ({
      activity: g.activity,
      day: g.day,
      time: g.time,
      endTime: g.endTime,
      sessions: g.sessions,
      avgAttendees: g.sessions ? Math.round(g.sumAttendees / g.sessions) : 0,
      avgCapacity: g.sessions ? Math.round(g.sumCapacity / g.sessions) : 0,
      occupancyPct: g.sumCapacity > 0 ? Math.round(g.sumAttendees / g.sumCapacity * 100) : 0,
    }));
}

module.exports = { buildScheduleStructure, runLabel };
