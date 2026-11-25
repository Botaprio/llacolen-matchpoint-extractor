'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { auditRun } = require('../src/services/data-audit');

// Prueba de integración del controlador de interfaz y del contrato IPC.
// No sustituye una comprobación visual de Electron en Windows.
async function rendererHarness() {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const nodes = new Map();
  function node(id) {
    const callbacks = new Map();
    const classes = new Set();
    return { id, value: '', innerHTML: '', textContent: '', disabled: false, style: {}, dataset: {},
      classList: { add: (x) => classes.add(x), remove: (x) => classes.delete(x),
        toggle: (x, state) => state ? classes.add(x) : classes.delete(x), contains: (x) => classes.has(x) },
      addEventListener: (type, callback) => callbacks.set(type, callback),
      fire: async (type = 'click') => callbacks.get(type)?.(), scrollIntoView: () => {}, querySelectorAll: () => [],
      getContext: () => ({ clearRect() {}, fillRect() {}, fillText() {} }) };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], node(match[1]));
  nodes.get('concurrency').value = '4';
  const buttons = new Map();
  const document = {
    querySelector: (selector) => {
      assert.ok(nodes.has(selector.slice(1)), `Existe el elemento ${selector}`);
      return nodes.get(selector.slice(1));
    }, getElementById: (id) => nodes.get(id),
    querySelectorAll: (selector) => {
      const result = [];
      for (const match of nodes.get('runsBody').innerHTML.matchAll(/<button class="([^"]+)" data-run-id="(\d+)"/g)) {
        if (!match[1].split(' ').includes(selector.slice(1))) continue;
        const key = `${selector}|${match[2]}`;
        if (!buttons.has(key)) { const button = node(key); button.dataset.runId = match[2]; buttons.set(key, button); }
        result.push(buttons.get(key));
      }
      return result;
    }
  };
  const run = { id: 7, date_from: '2026-08-03', date_to: '2026-08-03', status: 'completed', event_count: 2, warning_count: 1 };
  const audit = auditRun({ run, events: [{ id: 1, matchpoint_event_id: 'cero', event_date: run.date_from,
    activity_name: 'Yoga <prueba>', start_time: '09:00', end_time: '10:00', capacity: 0, attendees: 0 }], days: [] });
  let progress;
  let payload;
  let requestedRun;
  const window = { matchpointApp: {
    checkSession: async () => ({ authenticated: true }), listRuns: async () => [run],
    auditRun: async (id) => { requestedRun = id; return audit; },
    startExtraction: async (value) => {
      payload = value;
      progress({ stage: 'complete', percentage: 100, counters: { processedDays: 1, eventCount: 2 },
        workers: [{ id: 1, date: run.date_from, status: 'done', message: 'Lista' }] });
      return { status: 'completed', counters: { processedDays: 1, eventCount: 2 } };
    }, onProgress: (callback) => { progress = callback; }
  } };
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8'), {
    document, window, Date, setTimeout: () => 0, clearTimeout: () => {}
  });
  return { nodes, buttons, get payload() { return payload; }, get requestedRun() { return requestedRun; } };
}

test('interfaz: Analizar Nuevo consulta la extracción elegida y permite filtrar cupo cero', async () => {
  const ui = await rendererHarness();
  await ui.buttons.get('.audit-button|7').fire();
  assert.equal(ui.requestedRun, 7);
  assert.match(ui.nodes.get('auditBody').innerHTML, /Clase declarada con cupo 0/);
  assert.match(ui.nodes.get('auditBody').innerHTML, /Yoga &lt;prueba&gt;/);
  ui.nodes.get('auditRule').value = 'ZERO_CAPACITY';
  await ui.nodes.get('auditRule').fire('change');
  assert.match(ui.nodes.get('auditResultCount').textContent, /1–1 de 1/);
  assert.equal(ui.nodes.get('auditPrevButton').disabled, true);
  assert.equal(ui.nodes.get('auditNextButton').disabled, true);
});

test('interfaz: enviar mes incluye concurrencia y muestra el resultado consolidado', async () => {
  const ui = await rendererHarness();
  ui.nodes.get('concurrency').value = '31';
  ui.nodes.get('monthPicker').value = '2026-08';
  await ui.nodes.get('monthlyButton').fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.payload.concurrency, 31);
  assert.equal(ui.payload.dateFrom, '2026-08-01');
  assert.equal(ui.payload.dateTo, '2026-08-31');
  assert.equal(ui.nodes.get('progressPercent').textContent, '100%');
  assert.match(ui.nodes.get('workerProgress').innerHTML, /Pestaña 1/);
});

test('preload: expone el análisis nuevo por un canal independiente', () => {
  let api;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (...args) => calls.push(args) } })
  });
  api.auditRun(7);
  assert.deepEqual(calls, [['analysis:audit', 7]]);
});
