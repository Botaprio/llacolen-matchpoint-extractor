'use strict';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseAttendanceLabel(label) {
  const raw = normalizeWhitespace(label);
  const match = raw.match(/\((\d+)\s*\/\s*(\d+)\s*p\)/i);

  if (!match) {
    return {
      raw,
      attendees: null,
      capacity: null,
      status: 'missing_indicator'
    };
  }

  const attendees = Number(match[1]);
  const capacity = Number(match[2]);
  let status = 'ok';
  if (capacity === 0) status = 'zero_capacity';
  else if (attendees > capacity) status = 'over_capacity';

  return { raw, attendees, capacity, status };
}

function occupancyPercentage(attendees, capacity) {
  if (!Number.isFinite(attendees) || !Number.isFinite(capacity) || capacity <= 0) {
    return null;
  }
  return Number(((attendees / capacity) * 100).toFixed(2));
}

function buildWarnings(event, participantCount) {
  const warnings = [];
  if (event.attendanceStatus === 'missing_indicator') {
    warnings.push({
      code: 'MISSING_ATTENDANCE_INDICATOR',
      message: 'La actividad no muestra el indicador (inscritos/cupo).'
    });
  }
  if (event.capacity === 0) {
    warnings.push({
      code: 'ZERO_CAPACITY',
      message: 'La actividad informa cupo 0; debe revisarse en MatchPoint.'
    });
  }
  if (
    Number.isFinite(event.attendees) &&
    Number.isFinite(event.capacity) &&
    event.capacity > 0 &&
    event.attendees > event.capacity
  ) {
    warnings.push({
      code: 'OVER_CAPACITY',
      message: `Los inscritos (${event.attendees}) superan el cupo (${event.capacity}).`
    });
  }
  if (Number.isFinite(event.attendees) && Number.isFinite(participantCount) && event.attendees !== participantCount) {
    warnings.push({
      code: 'PARTICIPANT_COUNT_MISMATCH',
      message: `El cuadro informa ${event.attendees} inscritos, pero el detalle contiene ${participantCount} nombres.`
    });
  }
  return warnings;
}

function parseDetailText(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const oneLine = normalizeWhitespace(normalized);
  const location = oneLine.match(/Lugar:\s*(.+?)\s+Fecha y Horario:/i)?.[1] || null;
  const monitor = oneLine.match(/Monitor:\s*(.+?)\s+Niveles/i)?.[1] || null;
  return {
    location: location ? normalizeWhitespace(location) : null,
    monitor: monitor ? normalizeWhitespace(monitor) : null
  };
}

module.exports = {
  buildWarnings,
  normalizeWhitespace,
  occupancyPercentage,
  parseAttendanceLabel,
  parseDetailText
};
