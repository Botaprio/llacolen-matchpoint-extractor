'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { AppDatabase } = require('./services/database');
const { BrowserSession } = require('./services/browser-session');
const { exportOfficialExcelSet, exportOfficialPresentation } = require('./services/official-report-exporter');
const { filteredAnalysis, singleMonthInfo } = require('./services/report-template');
const { buildScheduleStructure, runLabel } = require('./services/schedule-structure');
const { exportScheduleExcel, scheduleHtmlDoc } = require('./services/schedule-exporter');
const { ParallelExtractor, validateConcurrency } = require('./services/parallel-extractor');
const { auditRun } = require('./services/data-audit');
const { enumerateDates } = require('./services/date-utils');
const { buildRunStats, computeMonthlyClassChanges, generateDashboardHtml, generateDashboardHtmlV2 } = require('./services/dashboard-generator');
const fsp = require('node:fs/promises');

let mainWindow;
let database;
let browserSession;
let activeExtraction = null;
let dataDirectory;
let configPath;
let quitting = false;
let shutdownPromise = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: 'Llacolén MatchPoint Estadísticas',
    backgroundColor: '#eef3f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extraction:progress', payload);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function analysisHtml(analysis) {
  const logo = require('node:fs').readFileSync(path.join(__dirname, 'assets', 'logo-llacolen.jpg')).toString('base64');
  const rows = analysis.activities.map((item) => `<tr><td>${escapeHtml(item.activity_name)}</td><td>${item.events}</td><td>${item.attendees}</td><td>${item.capacity}</td><td>${Number(item.occupancy_pct || 0).toFixed(1)}%</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;color:#173955;margin:40px}header{border-bottom:8px solid #f6c900;padding-bottom:16px;display:flex;justify-content:space-between;align-items:center}header img{width:115px}h1{color:#004a87;margin:0}h2{color:#004a87;margin-top:34px}.cards{display:flex;gap:12px;margin:24px 0}.card{flex:1;background:#edf5fa;padding:18px;border-radius:8px}.value{font-size:25px;font-weight:bold;color:#004a87}table{border-collapse:collapse;width:100%}th{background:#004a87;color:#fff;padding:10px;text-align:left}td{padding:9px;border-bottom:1px solid #c9dce9}</style></head><body><header><div><h1>Informe de ocupación mensual</h1><p>${escapeHtml(analysis.label)}</p></div><img src="data:image/jpeg;base64,${logo}"></header><div class="cards"><div class="card"><div class="value">${analysis.totals.events}</div>Eventos</div><div class="card"><div class="value">${analysis.totals.attendees}</div>Inscritos</div><div class="card"><div class="value">${analysis.totals.capacity}</div>Cupo total</div><div class="card"><div class="value">${analysis.totals.occupancyPct.toFixed(1)}%</div>Ocupación</div></div><h2>Detalle por actividad</h2><table><thead><tr><th>Actividad</th><th>Eventos</th><th>Inscritos</th><th>Cupo</th><th>Ocupación</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function readConfig() {
  const fs = require('node:fs');
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { return {}; }
}
function writeConfig(data) {
  require('node:fs').writeFileSync(configPath, JSON.stringify(data), 'utf8');
}

function registerHandlers() {
  ipcMain.handle('session:open', async () => browserSession.open());
  ipcMain.handle('session:check', async () => browserSession.status());
  ipcMain.handle('runs:list', async () => database.listRuns());
  ipcMain.handle('run:delete', async (_event, runId) => {
    const run = database.getRun(Number(runId));
    if (!run) return { deleted: false };
    if (run.status === 'running') throw new Error('No se puede eliminar una extracción en curso.');
    return { deleted: database.deleteRun(Number(runId)) };
  });
  ipcMain.handle('runs:delete-all', async () => {
    if (activeExtraction) throw new Error('Cancela la extracción en curso antes de eliminar el historial.');
    return { deletedCount: database.deleteAllRuns() };
  });
  ipcMain.handle('data:open-directory', async () => shell.openPath(dataDirectory));
  ipcMain.handle('analysis:get', async (_event, runId, activities) => filteredAnalysis(database.getRunData(Number(runId)), activities));
  ipcMain.handle('analysis:audit', async (_event, runId) => auditRun(database.getRunData(Number(runId))));

  ipcMain.handle('schedule:get', async (_event, runId) => {
    const runData = database.getRunData(Number(runId));
    if (!runData.run) throw new Error('No se encontró la extracción.');
    return { rows: buildScheduleStructure(runData.events), label: runLabel(runData.run) };
  });

  ipcMain.handle('schedule:export-excel', async (_event, runId) => {
    const runData = database.getRunData(Number(runId));
    if (!runData.run) throw new Error('No se encontró la extracción.');
    const label = runLabel(runData.run);
    const rows = buildScheduleStructure(runData.events);
    const safe = label.replace(/[/\\:*?"<>|]/g, '-');
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar estructura horaria en Excel',
      defaultPath: path.join(app.getPath('documents'), `Estructura_Horaria_${safe}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    await exportScheduleExcel(rows, label, selection.filePath);
    return { canceled: false, filePath: selection.filePath };
  });

  ipcMain.handle('schedule:export-pdf', async (_event, runId) => {
    const runData = database.getRunData(Number(runId));
    if (!runData.run) throw new Error('No se encontró la extracción.');
    const label = runLabel(runData.run);
    const rows = buildScheduleStructure(runData.events);
    const safe = label.replace(/[/\\:*?"<>|]/g, '-');
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar estructura horaria en PDF',
      defaultPath: path.join(app.getPath('documents'), `Estructura_Horaria_${safe}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const html = scheduleHtmlDoc(rows, label);
    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', marginsType: 1 });
    require('node:fs').writeFileSync(selection.filePath, pdf);
    printWindow.destroy();
    return { canceled: false, filePath: selection.filePath };
  });

  ipcMain.handle('extraction:cancel', async () => {
    if (activeExtraction) activeExtraction.cancelled = true;
    return { cancelled: Boolean(activeExtraction) };
  });

  ipcMain.handle('extraction:start', async (_event, payload) => {
    if (activeExtraction) throw new Error('Ya existe una extracción en curso.');
    const { dateFrom, dateTo, extractionMode = 'complete', concurrency = 4 } = payload || {};
    const workerCount = validateConcurrency(concurrency);
    if (!['quick', 'complete'].includes(extractionMode)) throw new Error('Modo de extracción inválido.');
    const dates = enumerateDates(dateFrom, dateTo);
    if (dates.length > 366) {
      throw new Error('Por seguridad, cada ejecución puede abarcar como máximo 366 días.');
    }
    const fastMode = extractionMode === 'quick';
    const cancellationToken = { cancelled: false };
    let finish;
    cancellationToken.done = new Promise((resolve) => { finish = resolve; });
    // Reservar antes del primer await evita dos extracciones por doble clic.
    activeExtraction = cancellationToken;
    let runId = null;
    const extractor = new ParallelExtractor({
      browserSession,
      database,
      onProgress: (progress) => sendProgress({ runId, ...progress })
    });
    let counters = {
      processedDays: 0,
      processedViews: 0,
      eventCount: 0,
      attendeeCount: 0,
      participantCount: 0,
      warningCount: 0
    };

    try {
      await browserSession.requireAuthenticatedPage();
      runId = database.createRun(dateFrom, dateTo, fastMode ? 'quick' : 'complete');
      const result = await extractor.run({ runId, dateFrom, dateTo, cancellationToken, fastMode, concurrency: workerCount });
      counters = result.counters;
      database.completeRun(runId, result.status, counters, result.errorMessage);
      return { runId, ...result };
    } catch (error) {
      counters = runId ? database.getRunCounters(runId) : counters;
      const cancelled = cancellationToken.cancelled;
      if (runId) database.completeRun(runId, cancelled ? 'cancelled' : 'failed', counters, error.message);
      if (cancelled) return { runId, status: 'cancelled', counters };
      throw error;
    } finally {
      activeExtraction = null;
      finish();
    }
  });

  ipcMain.handle('run:export', async (_event, runId, activities = []) => {
    const runData = database.getRunData(Number(runId));
    if (!runData.run) throw new Error('No se encontró la extracción.');
    const info = singleMonthInfo(runData.run);
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: `Carpeta para los 7 Excel oficiales y el registro TXT — ${info.label}`,
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (selection.canceled || !selection.filePaths?.[0]) return { canceled: true };
    const result = await exportOfficialExcelSet({ runData, destinationDir: selection.filePaths[0], selectedActivities: activities });
    return {
      canceled: false,
      folderPath: selection.filePaths[0],
      filePaths: result.files,
      logFilePath: result.logPath,
      adjustedCount: result.adjustedCount,
      acceptedCount: result.accepted.length,
      excludedCount: result.excluded.length
    };
  });

  ipcMain.handle('analysis:export-presentation', async (_event, runId, activities) => {
    const runData = database.getRunData(Number(runId));
    const info = singleMonthInfo(runData.run);
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar presentación PowerPoint oficial',
      defaultPath: path.join(app.getPath('documents'), `Estadística de Actividades ${info.label}.pptx`),
      filters: [{ name: 'Presentación PowerPoint', extensions: ['pptx'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const result = await exportOfficialPresentation({ runData, destination: selection.filePath, selectedActivities: activities });
    return { canceled: false, filePath: selection.filePath, acceptedCount: result.accepted.length, excludedCount: result.excluded.length };
  });

  ipcMain.handle('analysis:export-pdf', async (_event, runId, activities) => {
    const analysis = filteredAnalysis(database.getRunData(Number(runId)), activities);
    const selection = await dialog.showSaveDialog(mainWindow, { title: 'Guardar informe PDF', defaultPath: path.join(app.getPath('documents'), `informe_llacolen_${analysis.run.date_from}_${analysis.run.date_to}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(analysisHtml(analysis))}`);
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', marginsType: 1 });
    require('node:fs').writeFileSync(selection.filePath, pdf);
    printWindow.destroy();
    return { canceled: false, filePath: selection.filePath, acceptedCount: analysis.acceptedCount, excludedCount: analysis.excludedCount };
  });

  ipcMain.handle('folder:get-default', async () => ({ folderPath: readConfig().defaultFolder || null }));

  ipcMain.handle('folder:set-default', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar carpeta de exportación',
      defaultPath: readConfig().defaultFolder || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (selection.canceled || !selection.filePaths?.[0]) return { canceled: true };
    writeConfig({ ...readConfig(), defaultFolder: selection.filePaths[0] });
    return { canceled: false, folderPath: selection.filePaths[0] };
  });

  ipcMain.handle('folder:open-default', async () => {
    const { defaultFolder } = readConfig();
    if (defaultFolder) shell.openPath(defaultFolder);
    return { opened: !!defaultFolder };
  });

  ipcMain.handle('run:export-batch', async () => {
    const { defaultFolder } = readConfig();
    if (!defaultFolder) throw new Error('No hay carpeta predeterminada. Confígurala primero.');
    const runs = database.listRuns().filter((r) => r.status === 'completed' || r.status === 'partial');
    const fs = require('node:fs');
    const results = [];
    for (const run of runs) {
      const runData = database.getRunData(run.id);
      let info;
      try { info = singleMonthInfo(runData.run); } catch { continue; }
      const monthDir = path.join(defaultFolder, info.label);
      fs.mkdirSync(monthDir, { recursive: true });
      try {
        await exportOfficialExcelSet({ runData, destinationDir: monthDir });
        await exportOfficialPresentation({ runData, destination: path.join(monthDir, `Estadística de Actividades ${info.label}.pptx`) });
        results.push({ label: info.label, success: true });
      } catch (error) {
        results.push({ label: info.label, success: false, error: error.message });
      }
    }
    return { results, folderPath: defaultFolder };
  });

  ipcMain.handle('dashboard:generate', async (_event, runIds) => {
    const fs = require('node:fs');
    const os = require('node:os');

    const allRuns = database.listRuns(100).filter((r) => r.status === 'completed' || r.status === 'partial');
    const selected = runIds && runIds.length
      ? allRuns.filter((r) => runIds.includes(r.id))
      : allRuns;

    if (!selected.length) throw new Error('No hay extracciones completadas para mostrar en el dashboard.');

    const logoPath = path.join(__dirname, 'assets', 'logo-llacolen.jpg');
    const logoBase64 = fs.existsSync(logoPath) ? fs.readFileSync(logoPath).toString('base64') : '';

    const runsStats = selected.map((run) => {
      try {
        const runData = database.getRunData(run.id);
        return buildRunStats(runData);
      } catch { return null; }
    }).filter(Boolean);

    const html = generateDashboardHtml(runsStats, logoBase64);

    const tmpPath = path.join(os.tmpdir(), `llacolen-dashboard-${Date.now()}.html`);
    fs.writeFileSync(tmpPath, html, 'utf8');
    await shell.openPath(tmpPath);
    return { filePath: tmpPath, runCount: runsStats.length };
  });

  ipcMain.handle('dashboard:generate-v2', async (_event, runIds) => {
    const fs = require('node:fs');
    const os = require('node:os');

    const allRuns = database.listRuns(100).filter((r) => r.status === 'completed' || r.status === 'partial');
    const selected = runIds && runIds.length
      ? allRuns.filter((r) => runIds.includes(r.id))
      : allRuns;

    if (!selected.length) throw new Error('No hay extracciones completadas para mostrar en el dashboard.');

    const logoPath = path.join(__dirname, 'assets', 'logo-llacolen.jpg');
    const logoBase64 = fs.existsSync(logoPath) ? fs.readFileSync(logoPath).toString('base64') : '';

    const runsStats = selected.map((run) => {
      try {
        const runData = database.getRunData(run.id);
        return buildRunStats(runData);
      } catch { return null; }
    }).filter(Boolean);

    computeMonthlyClassChanges(runsStats);
    const html = generateDashboardHtmlV2(runsStats, logoBase64);

    const tmpPath = path.join(os.tmpdir(), `llacolen-dashboard-v2-${Date.now()}.html`);
    fs.writeFileSync(tmpPath, html, 'utf8');
    await shell.openPath(tmpPath);
    return { filePath: tmpPath, runCount: runsStats.length };
  });

  ipcMain.handle('runs:list-all', async () => database.listRuns(1000));
}

app.whenReady().then(() => {
  dataDirectory = path.join(app.getPath('userData'), 'data');
  configPath = path.join(dataDirectory, 'config.json');
  const fs = require('node:fs');
  fs.mkdirSync(dataDirectory, { recursive: true });
  database = new AppDatabase(path.join(dataDirectory, 'matchpoint.sqlite'));
  database.recoverInterruptedRuns();
  const cfg = readConfig();
  if (!cfg.loginUsername) {
    cfg.loginUsername = 'jp';
    cfg.loginPassword = '1234';
    writeConfig(cfg);
  }
  browserSession = new BrowserSession(
    path.join(app.getPath('userData'), 'edge-profile'),
    { username: cfg.loginUsername, password: cfg.loginPassword }
  );
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (shutdownPromise) return;
  const pending = activeExtraction;
  if (pending) pending.cancelled = true;
  // Termina/cancela todas las pestañas antes de cerrar SQLite.
  shutdownPromise = Promise.resolve(pending?.done).then(async () => {
    await browserSession?.close().catch(() => {});
    database?.close();
    quitting = true;
    app.quit();
  });
});
