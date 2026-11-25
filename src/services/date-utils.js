'use strict';

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error(`Fecha inválida: ${value || '(vacía)'}`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Fecha inexistente: ${value}`);
  }
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatForMatchPoint(isoDate) {
  const date = parseIsoDate(isoDate);
  return [
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    date.getUTCFullYear()
  ].join('/');
}

function formatForDisplay(isoDate) {
  return formatForMatchPoint(isoDate).replaceAll('/', '-');
}

function enumerateDates(fromIso, toIso) {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (from > to) {
    throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  }

  const dates = [];
  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(toIsoDate(cursor));
  }
  return dates;
}

module.exports = {
  enumerateDates,
  formatForDisplay,
  formatForMatchPoint,
  parseIsoDate,
  toIsoDate
};
