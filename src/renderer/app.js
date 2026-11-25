'use strict';

const elements = {
  sessionBadge: document.querySelector('#sessionBadge'),
  openSessionButton: document.querySelector('#openSessionButton'),
  checkSessionButton: document.querySelector('#checkSessionButton'),
  dateFrom: document.querySelector('#dateFrom'),
  dateTo: document.querySelector('#dateTo'),
  monthPicker: document.querySelector('#monthPicker'),
  concurrency: document.querySelector('#concurrency'),
  workerProgress: document.querySelector('#workerProgress'),
  startButton: document.querySelector('#startButton'),
  monthlyButton: document.querySelector('#monthlyButton'),
  quickMonthlyButton: document.querySelector('#quickMonthlyButton'),
  annualButton: document.querySelector('#annualButton'),
  cancelButton: document.querySelector('#cancelButton'),
  progressMessage: document.querySelector('#progressMessage'),
  progressPercent: document.querySelector('#progressPercent'),
  progressBar: document.querySelector('#progressBar'),
  metricDays: document.querySelector('#metricDays'),
  metricViews: document.querySelector('#metricViews'),
  metricEvents: document.querySelector('#metricEvents'),
  metricParticipants: document.querySelector('#metricParticipants'),
  metricWarnings: document.querySelector('#metricWarnings'),
  warningPanel: document.querySelector('#warningPanel'),
  analysisCard: document.querySelector('#analysisCard'), analysisLabel: document.querySelector('#analysisLabel'), analysisMetrics: document.querySelector('#analysisMetrics'), activitySelector: document.querySelector('#activitySelector'), chartCanvas: document.querySelector('#chartCanvas'), closeAnalysisButton: document.querySelector('#closeAnalysisButton'), downloadChartButton: document.querySelector('#downloadChartButton'), analysisExcelButton: document.querySelector('#analysisExcelButton'), analysisPdfButton: document.querySelector('#analysisPdfButton'), analysisPptButton: document.querySelector('#analysisPptButton'), analysisScheduleButton: document.querySelector('#analysisScheduleButton'),
  scheduleCard: document.querySelector('#scheduleCard'), scheduleLabel: document.querySelector('#scheduleLabel'), scheduleSearch: document.querySelector('#scheduleSearch'), scheduleStats: document.querySelector('#scheduleStats'), scheduleTimetable: document.querySelector('#scheduleTimetable'), scheduleActivityPills: document.querySelector('#scheduleActivityPills'), scheduleExcelButton: document.querySelector('#scheduleExcelButton'), schedulePdfButton: document.querySelector('#schedulePdfButton'), closeScheduleButton: document.querySelector('#closeScheduleButton'),
  monthFrom: document.querySelector('#monthFrom'),
  monthTo: document.querySelector('#monthTo'),
  multiMonthButton: document.querySelector('#multiMonthButton'),
  cancelMultiMonthButton: document.querySelector('#cancelMultiMonthButton'),
  defaultFolderDisplay: document.querySelector('#defaultFolderDisplay'),
  setFolderButton: document.querySelector('#setFolderButton'),
  openFolderButton: document.querySelector('#openFolderButton'),
  batchExportButton: document.querySelector('#batchExportButton'),
  runsBody: document.querySelector('#runsBody'),
  openDataButton: document.querySelector('#openDataButton'),
  deleteAllRunsButton: document.querySelector('#deleteAllRunsButton'),
  toast: document.querySelector('#toast')
};
for (const id of ['analysisAuditButton', 'auditCard', 'auditLabel', 'auditMetrics', 'auditCoverage',
  'auditSeverity', 'auditRule', 'auditSearch', 'auditBody', 'auditResultCount', 'refreshAuditButton',
  'closeAuditButton', 'auditPrevButton', 'auditNextButton',
  'openDashboardButton', 'openDashboardV2Button', 'openPresentationButton']) elements[id] = document.getElementById(id);

let authenticated = false;
let running = false;
let toastTimeout;
let activeAnalysis = null;
let activeAudit = null;
let activeSchedule = null;
let defaultFolderPath = null;
let multiMonthRunning = false;
let multiMonthCancelled = false;
let auditPage = 0;
let auditRequest = 0;
const AUDIT_PAGE_SIZE = 100;

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function monthRange(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue || '')) throw new Error('Selecciona un mes válido.');
  const [year, month] = monthValue.split('-').map(Number);
  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endOfMonth = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const today = todayIso();
  if (dateFrom > today) throw new Error('No puedes extraer un mes futuro.');
  return { dateFrom, dateTo: endOfMonth > today ? today : endOfMonth };
}

function currentYearRange() {
  const dateTo = todayIso();
  return { dateFrom: `${dateTo.slice(0, 4)}-01-01`, dateTo };
}

function showToast(message, isError = false) {
  clearTimeout(toastTimeout);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => elements.toast.classList.add('hidden'), 5500);
}

function setSessionStatus(status) {
  authenticated = Boolean(status?.authenticated);
  elements.sessionBadge.textContent = authenticated ? 'Sesión activa' : 'Sin iniciar sesión';
  elements.sessionBadge.className = `badge ${authenticated ? 'badge-online' : 'badge-offline'}`;
  updateButtons();
}

function updateButtons() {
  elements.startButton.disabled = !authenticated || running || !elements.dateFrom.value || !elements.dateTo.value;
  elements.monthlyButton.disabled = !authenticated || running || !elements.monthPicker.value;
  elements.quickMonthlyButton.disabled = !authenticated || running || !elements.monthPicker.value;
  elements.annualButton.disabled = !authenticated || running;
  elements.cancelButton.disabled = !running;
  elements.openSessionButton.disabled = running;
  elements.checkSessionButton.disabled = running;
  elements.deleteAllRunsButton.disabled = running;
  elements.concurrency.disabled = running;
  elements.multiMonthButton.disabled = !authenticated || running || !elements.monthFrom.value || !elements.monthTo.value;
  elements.batchExportButton.disabled = !defaultFolderPath || running;
  if (elements.openDashboardButton) elements.openDashboardButton.disabled = running;
  if (elements.openDashboardV2Button) elements.openDashboardV2Button.disabled = running;
  if (elements.openPresentationButton) elements.openPresentationButton.disabled = running;
}

function setRunning(value) {
  running = value;
  updateButtons();
}

function renderProgress(progress) {
  const counters = progress.counters || {};
  const dateTotal = progress.dateTotal || 1;
  const dateIndex = Math.max(0, (progress.dateIndex || 1) - 1);
  const viewTotal = progress.viewTotal || 29;
  const viewIndex = progress.viewIndex || 0;
  const completedUnits = dateIndex * viewTotal + viewIndex;
  const totalUnits = dateTotal * viewTotal;
  const percentage = Number.isFinite(progress.percentage) ? progress.percentage : progress.stage === 'complete'
    ? 100
    : Math.min(99, Math.round((completedUnits / Math.max(1, totalUnits)) * 100));

  elements.progressMessage.textContent = progress.message || 'Procesando…';
  elements.progressPercent.textContent = `${percentage}%`;
  elements.progressBar.style.width = `${percentage}%`;
  elements.metricDays.textContent = counters.processedDays || 0;
  elements.metricViews.textContent = counters.processedViews || 0;
  elements.metricEvents.textContent = counters.eventCount || 0;
  elements.metricParticipants.textContent = counters.attendeeCount || 0;
  elements.metricWarnings.textContent = counters.warningCount || 0;
  if (progress.workers) {
    const states = { waiting: 'Disponible', running: 'Procesando', done: 'Finalizada', failed: 'Revisar', cancelled: 'Cancelada' };
    elements.workerProgress.innerHTML = progress.workers.map((worker) => `<div class="worker worker-${escapeHtml(worker.status)}"><strong>Pestaña ${worker.id} · ${escapeHtml(states[worker.status] || worker.status)}</strong><small>${escapeHtml(worker.date || '')}</small><small>${escapeHtml(worker.message || '')}</small></div>`).join('');
  } else if (progress.stage === 'start') elements.workerProgress.innerHTML = '';
}

function statusLabel(status) {
  return {
    completed: 'Completada',
    failed: 'Fallida',
    partial: 'Parcial',
    cancelled: 'Cancelada',
    running: 'En curso'
  }[status] || status;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function loadRuns() {
  const runs = await window.matchpointApp.listRuns();
  const hasCompleted = runs.some((r) => r.status === 'completed' || r.status === 'partial');
  if (elements.openDashboardButton) elements.openDashboardButton.disabled = !hasCompleted || running;
  if (elements.openDashboardV2Button) elements.openDashboardV2Button.disabled = !hasCompleted || running;
  if (elements.openPresentationButton) elements.openPresentationButton.disabled = !hasCompleted || running;
  if (!runs.length) {
    elements.runsBody.innerHTML = '<tr><td colspan="7" class="empty">No hay extracciones guardadas.</td></tr>';
    return;
  }
  elements.runsBody.innerHTML = runs.map((run) => `
    <tr>
      <td>${run.id}</td>
      <td>${escapeHtml(run.date_from)} → ${escapeHtml(run.date_to)}</td>
      <td><span class="status status-${escapeHtml(run.status)}">${escapeHtml(statusLabel(run.status))}</span></td>
      <td>${run.event_count}</td>
      <td>${run.attendee_count || 0}</td>
      <td>${run.warning_count}</td>
      <td><div class="run-actions">${run.status !== 'running'
        ? `<button class="button button-secondary export-button" data-run-id="${run.id}">Excel oficiales</button><button class="button button-quiet analysis-button" data-run-id="${run.id}">Analizar</button><button class="button button-primary audit-button" data-run-id="${run.id}">Analizar Nuevo</button><button class="button button-quiet schedule-button" data-run-id="${run.id}">Horarios</button>`
        : ''}<button class="button button-danger delete-run-button" data-run-id="${run.id}" ${run.status === 'running' ? 'disabled' : ''}>Eliminar</button></div></td>
    </tr>
  `).join('');

  document.querySelectorAll('.export-button').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        button.disabled = true;
        const result = await window.matchpointApp.exportRun(Number(button.dataset.runId));
        if (!result.canceled) showToast(`7 Excel oficiales y registro TXT guardados en ${result.folderPath}. ${result.adjustedCount || 0} ajustes de horario. ${result.excludedCount || 0} eventos fuera de plantilla fueron excluidos.`);
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
  document.querySelectorAll('.analysis-button').forEach((button) => button.addEventListener('click', () => openAnalysis(Number(button.dataset.runId)).catch((error) => showToast(error.message, true))));
  document.querySelectorAll('.audit-button').forEach((button) => button.addEventListener('click', () => openAudit(Number(button.dataset.runId))));
  document.querySelectorAll('.schedule-button').forEach((button) => button.addEventListener('click', () => openSchedule(Number(button.dataset.runId)).catch((error) => showToast(error.message, true))));
  document.querySelectorAll('.delete-run-button').forEach((button) => button.addEventListener('click', async () => {
    const runId = Number(button.dataset.runId);
    if (!window.confirm(`¿Eliminar definitivamente la extracción #${runId} y todos sus datos?`)) return;
    try {
      await window.matchpointApp.deleteRun(runId);
      if (activeAnalysis?.runId === runId) {
        activeAnalysis = null;
        elements.analysisCard.classList.add('hidden');
      }
      if (activeAudit?.runId === runId) closeAudit();
      await loadRuns();
      showToast(`Extracción #${runId} eliminada.`);
    } catch (error) { showToast(error.message, true); }
  }));
}

function closeAudit() {
  auditRequest += 1;
  activeAudit = null;
  elements.auditCard.classList.add('hidden');
}

function renderAudit() {
  if (!activeAudit) return;
  const { summary: s, coverage } = activeAudit;
  elements.auditLabel.textContent = `Extracción #${activeAudit.runId} · ${activeAudit.label}`;
  elements.auditMetrics.innerHTML = [['Eventos revisados', s.events], ['Errores', s.error], ['Advertencias', s.warning], ['Clases con cupo 0', s.zeroCapacityCount]]
    .map(([label, value]) => `<div><span>${value}</span><small>${label}</small></div>`).join('');
  elements.auditCoverage.textContent = `${coverage.verified ? `${coverage.completed}/${coverage.total} días con cobertura completa.` : 'Cobertura por día no registrada en esta versión anterior.'} ${s.zeroEnrollmentCount} clases sin inscritos y con cupo disponible. ${s.missingCapacityCount} sin cupo leído. ${s.excludedCount} eventos fuera del informe oficial. ${s.adjustedCount || 0} ajustes de horario.`;
  const severity = elements.auditSeverity.value;
  const rule = elements.auditRule.value;
  const query = elements.auditSearch.value.trim().toLocaleLowerCase('es');
  const rows = activeAudit.findings.filter((row) =>
    (severity === 'all' || (severity === 'review' ? row.severity !== 'info' : row.severity === severity))
    && (rule === 'all' || row.code === rule)
    && (!query || [row.activity, row.date, row.time, row.message, row.viewNames, row.code].join(' ').toLocaleLowerCase('es').includes(query)));
  const pages = Math.max(1, Math.ceil(rows.length / AUDIT_PAGE_SIZE));
  auditPage = Math.min(auditPage, pages - 1);
  const start = auditPage * AUDIT_PAGE_SIZE;
  const severityNames = { error: 'Error', warning: 'Advertencia', info: 'Informativo' };
  elements.auditBody.innerHTML = rows.slice(start, start + AUDIT_PAGE_SIZE).map((row) => `<tr>
    <td><span class="status audit-${row.severity}">${severityNames[row.severity]}</span></td>
    <td>${escapeHtml(row.date || '—')}<br>${escapeHtml(row.time)}</td><td>${escapeHtml(row.activity)}</td>
    <td>${row.attendees ?? 'Sin dato'}</td><td>${row.capacity ?? 'Sin dato'}</td>
    <td>${escapeHtml(row.message)}<details><summary>Ver evidencia</summary><div class="evidence">ID MatchPoint: ${escapeHtml(row.matchpointEventId ?? 'No aplica')}<br>Cuadros: ${escapeHtml(row.viewNames || 'No registrado')}<br>Indicador original: ${escapeHtml(row.rawLabel || 'No disponible')}<br>Nombres del detalle: ${row.participantCount ?? 'Sin verificar'}<br>Ocupación: ${row.occupancyPct == null ? 'No calculable' : `${row.occupancyPct.toFixed(1)}%`}<br>Informe oficial: ${row.templateIncluded == null ? 'No aplica' : row.templateIncluded ? 'Incluido' : 'Excluido'}<br>Regla: ${escapeHtml(row.code)}</div></details></td>
  </tr>`).join('') || `<tr><td colspan="6" class="empty">${severity === 'review' && rule === 'all' && !query ? 'No se encontraron errores ni advertencias con los datos disponibles. Revisa también los hallazgos informativos.' : 'No hay hallazgos para estos filtros.'}</td></tr>`;
  elements.auditResultCount.textContent = `${rows.length ? `${start + 1}–${Math.min(start + AUDIT_PAGE_SIZE, rows.length)} de ${rows.length}` : '0'} hallazgos · ${s.info} informativos en total`;
  elements.auditPrevButton.disabled = auditPage === 0;
  elements.auditNextButton.disabled = auditPage >= pages - 1;
}

async function openAudit(runId, resetFilters = true) {
  const request = ++auditRequest;
  elements.refreshAuditButton.disabled = true;
  try {
    const result = await window.matchpointApp.auditRun(runId);
    if (request !== auditRequest) return;
    activeAudit = result;
    auditPage = 0;
    if (resetFilters) {
      elements.auditSeverity.value = 'review'; elements.auditRule.value = 'all'; elements.auditSearch.value = '';
    }
    renderAudit();
    elements.auditCard.classList.remove('hidden');
    elements.auditCard.scrollIntoView({ behavior: 'smooth' });
  } catch (error) { showToast(error.message, true); }
  finally { if (request === auditRequest) elements.refreshAuditButton.disabled = false; }
}

function selectedActivities() { return [...elements.activitySelector.querySelectorAll('input:checked')].map((input) => input.value); }
function drawChart(activities) { const c=elements.chartCanvas,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);const max=Math.max(1,...activities.flatMap(x=>[x.attendees,x.capacity]));const step=Math.max(34,(c.height-55)/Math.max(1,activities.length));ctx.font='12px Segoe UI';ctx.fillStyle='#526779';ctx.fillText('Cupo',190,13);ctx.fillStyle='#004a87';ctx.fillText('Asistentes',245,13);activities.forEach((x,i)=>{const y=24+i*step,available=c.width-215,wCap=available*x.capacity/max,wAtt=available*x.attendees/max;ctx.fillStyle='#cbd9e4';ctx.fillRect(190,y,wCap,10);ctx.fillStyle='#004a87';ctx.fillRect(190,y+12,wAtt,10);ctx.fillStyle='#173955';ctx.font='13px Segoe UI';ctx.fillText(x.activity_name.slice(0,24),8,y+17);ctx.fillStyle='#40556a';ctx.font='11px Segoe UI';ctx.fillText(`${x.attendees}/${x.capacity}`,Math.min(c.width-48,195+Math.max(wCap,wAtt)),y+18);}); }
async function refreshAnalysis() { if(!activeAnalysis)return;const a=await window.matchpointApp.getAnalysis(activeAnalysis.runId,selectedActivities());activeAnalysis.data=a;elements.analysisLabel.textContent=`${a.label} · ${a.adjustedCount||0} ajustes de horario · ${a.excludedCount||0} eventos fuera de plantilla excluidos`;elements.analysisMetrics.innerHTML=[['Eventos',a.totals.events],['Inscritos',a.totals.attendees],['Cupo',a.totals.capacity],['Ocupación',`${a.totals.occupancyPct.toFixed(1)}%`]].map(([l,v])=>`<div><span>${v}</span><small>${l}</small></div>`).join('');drawChart(a.activities); }
async function openAnalysis(runId) { const a=await window.matchpointApp.getAnalysis(runId,[]);activeAnalysis={runId,data:a};elements.activitySelector.innerHTML=a.activities.map(x=>`<label><input type="checkbox" value="${escapeHtml(x.activity_name)}" checked> ${escapeHtml(x.activity_name)}</label>`).join('');elements.activitySelector.querySelectorAll('input').forEach(x=>x.addEventListener('change',refreshAnalysis));elements.analysisCard.classList.remove('hidden');await refreshAnalysis();elements.analysisCard.scrollIntoView({behavior:'smooth'}); }

elements.openSessionButton.addEventListener('click', async () => {
  try {
    const status = await window.matchpointApp.openSession();
    setSessionStatus(status);
    showToast(status.authenticated
      ? 'La sesión de MatchPoint ya está activa.'
      : 'Inicia sesión en Edge y luego pulsa “Comprobar acceso”.');
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.checkSessionButton.addEventListener('click', async () => {
  try {
    const status = await window.matchpointApp.checkSession();
    setSessionStatus(status);
    showToast(status.authenticated ? 'Acceso comprobado correctamente.' : 'Todavía no se detecta una sesión iniciada.', !status.authenticated);
  } catch (error) {
    showToast(error.message, true);
  }
});

async function startExtraction({ dateFrom, dateTo, extractionMode = 'complete' }) {
  if (dateFrom > dateTo) {
    showToast('La fecha inicial no puede ser posterior a la final.', true);
    return;
  }
  setRunning(true);
  elements.warningPanel.classList.add('hidden');
  renderProgress({ stage: 'start', message: 'Preparando la extracción…', counters: {} });
  try {
    const result = await window.matchpointApp.startExtraction({
      dateFrom,
      dateTo,
      extractionMode,
      concurrency: Number(elements.concurrency.value)
    });
    if (result.status === 'completed') {
      renderProgress({ stage: 'complete', message: 'Extracción completada.', counters: result.counters });
      if (result.counters.warningCount > 0) elements.warningPanel.classList.remove('hidden');
      showToast('Extracción completada. Ya puedes exportarla a Excel.');
    } else if (result.status === 'partial') {
      elements.warningPanel.classList.remove('hidden');
      showToast(result.errorMessage || 'Extracción parcial. Revisa los días pendientes en Analizar Nuevo.', true);
    } else {
      elements.warningPanel.classList.remove('hidden');
      showToast('La extracción fue cancelada. Los datos alcanzados quedaron guardados.');
    }
  } catch (error) {
    showToast(error.message, true);
    elements.progressMessage.textContent = `Error: ${error.message}`;
  } finally {
    setRunning(false);
    await loadRuns();
  }
}

elements.startButton.addEventListener('click', () => startExtraction({ dateFrom: elements.dateFrom.value, dateTo: elements.dateTo.value }));
elements.monthlyButton.addEventListener('click', () => {
  try { startExtraction(monthRange(elements.monthPicker.value)); } catch (error) { showToast(error.message, true); }
});
elements.quickMonthlyButton.addEventListener('click', () => {
  try {
    startExtraction({ ...monthRange(elements.monthPicker.value), extractionMode: 'quick' });
  } catch (error) { showToast(error.message, true); }
});
elements.annualButton.addEventListener('click', () => startExtraction(currentYearRange()));

elements.cancelButton.addEventListener('click', async () => {
  await window.matchpointApp.cancelExtraction();
  elements.cancelButton.disabled = true;
  elements.progressMessage.textContent = 'Cancelando al terminar el elemento actual…';
});

elements.openDataButton.addEventListener('click', () => window.matchpointApp.openDataDirectory());
elements.deleteAllRunsButton.addEventListener('click', async () => {
  if (!window.confirm('¿Eliminar definitivamente TODAS las extracciones guardadas, eventos, participantes y alertas?')) return;
  try {
    const result = await window.matchpointApp.deleteAllRuns();
    activeAnalysis = null;
    closeAudit();
    elements.analysisCard.classList.add('hidden');
    await loadRuns();
    showToast(`${result.deletedCount} extracciones eliminadas.`);
  } catch (error) { showToast(error.message, true); }
});
elements.closeAnalysisButton.addEventListener('click',()=>{activeAnalysis=null;elements.analysisCard.classList.add('hidden');});
elements.analysisScheduleButton.addEventListener('click',()=>{ if(activeAnalysis) openSchedule(activeAnalysis.runId).catch(e=>showToast(e.message,true)); });
elements.downloadChartButton.addEventListener('click',()=>{const link=document.createElement('a');link.href=elements.chartCanvas.toDataURL('image/png');link.download='grafico_llacolen.png';link.click();});
elements.analysisExcelButton.addEventListener('click',async()=>{if(!activeAnalysis)return;try{const r=await window.matchpointApp.exportRun(activeAnalysis.runId,selectedActivities());if(!r.canceled)showToast(`7 Excel oficiales y registro TXT guardados en ${r.folderPath}. ${r.adjustedCount || 0} ajustes de horario. ${r.excludedCount||0} eventos fuera de plantilla fueron excluidos.`);}catch(error){showToast(error.message,true);}});
elements.analysisPdfButton.addEventListener('click',async()=>{if(!activeAnalysis)return;try{const r=await window.matchpointApp.exportPdf(activeAnalysis.runId,selectedActivities());if(!r.canceled)showToast(`PDF guardado en ${r.filePath}. ${r.excludedCount||0} eventos fuera de plantilla fueron excluidos.`);}catch(error){showToast(error.message,true);}});
elements.analysisPptButton.addEventListener('click',async()=>{if(!activeAnalysis)return;try{const r=await window.matchpointApp.exportPresentation(activeAnalysis.runId,selectedActivities());if(!r.canceled)showToast(`PowerPoint guardado en ${r.filePath}. ${r.excludedCount||0} eventos fuera de plantilla fueron excluidos.`);}catch(error){showToast(error.message,true);}});
elements.monthFrom.addEventListener('change', updateButtons);
elements.monthTo.addEventListener('change', updateButtons);

function enumerateMonths(from, to) {
  if (!from || !to || from > to) return [];
  const months = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    if (m === 12) { y++; m = 1; } else m++;
  }
  return months;
}

async function startMultiMonthExtraction() {
  const fromMonth = elements.monthFrom.value;
  const toMonth = elements.monthTo.value;
  if (!fromMonth || !toMonth) { showToast('Selecciona el mes inicial y final.', true); return; }
  if (fromMonth > toMonth) { showToast('El mes inicial debe ser anterior o igual al final.', true); return; }
  const months = enumerateMonths(fromMonth, toMonth);
  multiMonthRunning = true;
  multiMonthCancelled = false;
  setRunning(true);
  elements.cancelMultiMonthButton.disabled = false;
  elements.warningPanel.classList.add('hidden');
  let completed = 0;
  let withWarnings = 0;
  try {
    for (const month of months) {
      if (multiMonthCancelled) break;
      let range;
      try { range = monthRange(month); } catch (e) { showToast(`${month}: ${e.message}`, true); continue; }
      renderProgress({
        stage: 'running',
        message: `${month} (${completed + 1}/${months.length}) — extrayendo rápido…`,
        counters: {},
        percentage: Math.round(completed / months.length * 100)
      });
      const result = await window.matchpointApp.startExtraction({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        extractionMode: 'quick',
        concurrency: Number(elements.concurrency.value)
      });
      if (result.status === 'cancelled') { multiMonthCancelled = true; break; }
      completed++;
      if ((result.counters?.warningCount || 0) > 0) withWarnings++;
      await loadRuns();
    }
  } finally {
    multiMonthRunning = false;
    setRunning(false);
    elements.cancelMultiMonthButton.disabled = true;
  }
  const msg = multiMonthCancelled
    ? `Período cancelado. ${completed} de ${months.length} mes(es) completados.`
    : `Período completado: ${completed}/${months.length} mes(es)${withWarnings ? `, ${withWarnings} con alertas` : ''}.`;
  renderProgress({ stage: 'complete', message: msg, counters: {}, percentage: 100 });
  showToast(msg, withWarnings > 0 && !multiMonthCancelled);
}

elements.multiMonthButton.addEventListener('click', () => startMultiMonthExtraction().catch((e) => showToast(e.message, true)));
elements.cancelMultiMonthButton.addEventListener('click', async () => {
  multiMonthCancelled = true;
  await window.matchpointApp.cancelExtraction();
  elements.cancelMultiMonthButton.disabled = true;
  elements.progressMessage.textContent = 'Cancelando período…';
});

function updateFolderDisplay(folderPath) {
  defaultFolderPath = folderPath;
  elements.defaultFolderDisplay.textContent = folderPath
    || 'Sin carpeta predeterminada. Confígura una para habilitar la descarga.';
  elements.openFolderButton.disabled = !folderPath;
  updateButtons();
}

async function initDefaultFolder() {
  const result = await window.matchpointApp.getDefaultFolder();
  updateFolderDisplay(result.folderPath);
}

elements.setFolderButton.addEventListener('click', async () => {
  try {
    const result = await window.matchpointApp.setDefaultFolder();
    if (!result.canceled) updateFolderDisplay(result.folderPath);
  } catch (e) { showToast(e.message, true); }
});

elements.openFolderButton.addEventListener('click', () => window.matchpointApp.openDefaultFolder());

elements.batchExportButton.addEventListener('click', async () => {
  const runs = await window.matchpointApp.listRuns();
  const exportable = runs.filter((r) => r.status === 'completed' || r.status === 'partial');
  if (!exportable.length) { showToast('No hay extracciones completadas para exportar.', true); return; }
  if (!window.confirm(`¿Exportar Excel oficiales y PowerPoint para cada mes en la carpeta predeterminada?\nSe creará una subcarpeta por mes y se sobreescribirán archivos existentes.`)) return;
  try {
    elements.batchExportButton.disabled = true;
    showToast('Generando archivos… puede tardar varios minutos.');
    const result = await window.matchpointApp.exportBatch();
    const ok = result.results.filter((r) => r.success).length;
    const err = result.results.filter((r) => !r.success).length;
    showToast(`${ok} mes(es) exportados en ${result.folderPath}.${err > 0 ? ` ${err} fallaron.` : ''}`, err > 0);
  } catch (e) { showToast(e.message, true); }
  finally { elements.batchExportButton.disabled = !defaultFolderPath || running; }
});

if (elements.openDashboardButton) {
  elements.openDashboardButton.addEventListener('click', async () => {
    try {
      elements.openDashboardButton.disabled = true;
      elements.openDashboardButton.textContent = '⏳ Generando…';
      const result = await window.matchpointApp.generateDashboard();
      showToast(`Dashboard generado con ${result.runCount} período(s). Se abrirá en el navegador.`);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      elements.openDashboardButton.textContent = '📊 Abrir Dashboard';
      elements.openDashboardButton.disabled = false;
    }
  });
}

if (elements.openDashboardV2Button) {
  elements.openDashboardV2Button.addEventListener('click', async () => {
    try {
      elements.openDashboardV2Button.disabled = true;
      elements.openDashboardV2Button.textContent = '⏳ Generando…';
      const result = await window.matchpointApp.generateDashboardV2();
      showToast(`Dashboard generado con ${result.runCount} período(s). Se abrirá en el navegador.`);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      elements.openDashboardV2Button.textContent = '📊 Generar Dashboard';
      elements.openDashboardV2Button.disabled = false;
    }
  });
}

if (elements.openPresentationButton) {
  elements.openPresentationButton.addEventListener('click', async () => {
    try {
      elements.openPresentationButton.disabled = true;
      elements.openPresentationButton.textContent = '⏳ Generando…';
      const result = await window.matchpointApp.generatePresentation();
      showToast(`Presentación generada con ${result.runCount} período(s). Se abrirá en el navegador.`);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      elements.openPresentationButton.textContent = '🎯 Modo Presentación';
      elements.openPresentationButton.disabled = false;
    }
  });
}
elements.dateFrom.addEventListener('change', updateButtons);
elements.dateTo.addEventListener('change', updateButtons);
elements.monthPicker.addEventListener('change', updateButtons);
elements.analysisAuditButton.addEventListener('click', () => { if (activeAnalysis) openAudit(activeAnalysis.runId); });
elements.refreshAuditButton.addEventListener('click', () => { if (activeAudit) openAudit(activeAudit.runId, false); });
elements.closeAuditButton.addEventListener('click', closeAudit);
elements.auditPrevButton.addEventListener('click', () => { auditPage -= 1; renderAudit(); });
elements.auditNextButton.addEventListener('click', () => { auditPage += 1; renderAudit(); });
elements.auditSeverity.addEventListener('change', () => { auditPage = 0; renderAudit(); });
elements.auditRule.addEventListener('change', () => {
  auditPage = 0;
  if (['ZERO_ENROLLMENT', 'EXCLUDED_FROM_REPORT'].includes(elements.auditRule.value)) elements.auditSeverity.value = 'all';
  renderAudit();
});
elements.auditSearch.addEventListener('input', () => { auditPage = 0; renderAudit(); });

// ── Inspector de Horarios ────────────────────────────────────────────────

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(s || ''); }

const ACTIVITY_COLORS = [
  { bg:'#dbeafe', border:'#2563eb' }, { bg:'#dcfce7', border:'#16a34a' },
  { bg:'#fce7f3', border:'#db2777' }, { bg:'#fed7aa', border:'#ea580c' },
  { bg:'#ede9fe', border:'#7c3aed' }, { bg:'#d1fae5', border:'#059669' },
  { bg:'#fef3c7', border:'#d97706' }, { bg:'#cffafe', border:'#0891b2' },
  { bg:'#fee2e2', border:'#dc2626' }, { bg:'#e0e7ff', border:'#4338ca' },
  { bg:'#fdf4ff', border:'#9333ea' }, { bg:'#f0fdf4', border:'#166534' },
  { bg:'#fff1f2', border:'#e11d48' }, { bg:'#f0f9ff', border:'#0369a1' },
  { bg:'#fefce8', border:'#ca8a04' }, { bg:'#f7fee7', border:'#4d7c0f' },
];
const TIMETABLE_DAYS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
const TIMETABLE_DAY_LABELS = { lunes:'Lunes', martes:'Martes', 'miércoles':'Miércoles', jueves:'Jueves', viernes:'Viernes', sábado:'Sábado', domingo:'Domingo' };

function buildActivityColorMap(allRows) {
  const acts = [...new Set(allRows.map((r) => r.activity))].sort((a, b) => a.localeCompare(b, 'es'));
  const map = new Map();
  acts.forEach((act, i) => map.set(act, ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]));
  return map;
}

function renderSchedulePills(colorMap) {
  const query = elements.scheduleSearch.value.trim().toLocaleLowerCase('es');
  const selected = activeSchedule.selectedActivity;
  const visible = [...new Set(activeSchedule.rows
    .filter((r) => !query || r.activity.toLocaleLowerCase('es').includes(query))
    .map((r) => r.activity))].sort((a, b) => a.localeCompare(b, 'es'));

  let html = `<button class="activity-pill${!selected ? ' pill-active' : ''}" data-activity="">Todas las actividades</button>`;
  for (const act of visible) {
    const c = colorMap.get(act) || ACTIVITY_COLORS[0];
    const active = act === selected;
    const style = active ? `background:${c.border};border-color:${c.border}` : '';
    html += `<button class="activity-pill${active ? ' pill-active' : ''}" data-activity="${escapeHtml(act)}" style="${style}">${escapeHtml(act)}</button>`;
  }
  elements.scheduleActivityPills.innerHTML = html;
  elements.scheduleActivityPills.querySelectorAll('.activity-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      activeSchedule.selectedActivity = pill.dataset.activity || null;
      renderSchedule();
    });
  });
}

function renderTimetableGrid(rows, colorMap) {
  if (!rows.length) {
    elements.scheduleTimetable.innerHTML = '<p class="schedule-empty">Sin actividades para los filtros seleccionados.</p>';
    return;
  }
  const daySet = new Set(rows.map((r) => r.day));
  const timeSet = new Set(rows.map((r) => r.time));
  const days = TIMETABLE_DAYS.filter((d) => daySet.has(d));
  const times = [...timeSet].sort();
  const cellMap = new Map();
  for (const r of rows) {
    const key = `${r.time}|${r.day}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key).push(r);
  }

  const viewMode = (activeSchedule && activeSchedule.viewMode) || 'detailed';
  let html = `<div class="view-toggle"><button class="view-toggle-btn${viewMode === 'detailed' ? ' vtb-active' : ''}" data-mode="detailed">Detallado</button><button class="view-toggle-btn${viewMode === 'compact' ? ' vtb-active' : ''}" data-mode="compact">Compacto</button></div>`;
  html += `<div class="timetable-scroll${viewMode === 'compact' ? ' compact-view' : ''}"><table class="timetable"><thead><tr><th>Hora</th>`;
  for (const d of days) html += `<th>${escapeHtml(TIMETABLE_DAY_LABELS[d] || d)}</th>`;
  html += '</tr></thead><tbody>';

  for (const time of times) {
    html += `<tr><td class="time-cell">${escapeHtml(time)}</td>`;
    for (const day of days) {
      const cellRows = cellMap.get(`${time}|${day}`) || [];
      if (cellRows.length) {
        const slots = cellRows.map((r) => {
          const c = colorMap.get(r.activity) || ACTIVITY_COLORS[0];
          const rangeStr = r.endTime ? ` – ${r.endTime}` : '';
          const tip = `${r.activity}\n${time}${rangeStr}\n${r.sessions} clase${r.sessions !== 1 ? 's' : ''} · ${r.avgAttendees}/${r.avgCapacity} (${r.occupancyPct}%)`;
          const meta = viewMode !== 'compact' ? `<span class="slot-meta">${r.avgAttendees}/${r.avgCapacity} · ${r.occupancyPct}%</span>` : '';
          return `<div class="timetable-slot" style="background:${c.bg};border-left-color:${c.border}" title="${escapeHtml(tip)}"><span class="slot-name">${escapeHtml(r.activity)}</span>${meta}</div>`;
        }).join('');
        html += `<td class="timetable-cell">${slots}</td>`;
      } else {
        html += '<td class="timetable-cell timetable-empty"></td>';
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  elements.scheduleTimetable.innerHTML = html;

  elements.scheduleTimetable.querySelectorAll('.view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (activeSchedule) activeSchedule.viewMode = btn.dataset.mode;
      renderSchedule();
    });
  });
}

function renderSchedule() {
  if (!activeSchedule) return;
  const query = elements.scheduleSearch.value.trim().toLocaleLowerCase('es');
  const selected = activeSchedule.selectedActivity;

  let rows = activeSchedule.rows;
  if (selected) rows = rows.filter((r) => r.activity === selected);
  if (query) rows = rows.filter((r) => r.activity.toLocaleLowerCase('es').includes(query));

  const uniqueActs = new Set(rows.map((r) => r.activity)).size;
  elements.scheduleStats.textContent = rows.length
    ? `${rows.length} franja${rows.length !== 1 ? 's' : ''} · ${uniqueActs} actividad${uniqueActs !== 1 ? 'es' : ''}`
    : '';

  const colorMap = buildActivityColorMap(activeSchedule.rows);
  renderSchedulePills(colorMap);
  renderTimetableGrid(rows, colorMap);
}

async function openSchedule(runId) {
  const result = await window.matchpointApp.getSchedule(runId);
  activeSchedule = { runId, rows: result.rows, selectedActivity: null, viewMode: 'detailed' };
  elements.scheduleLabel.textContent = result.label;
  elements.scheduleSearch.value = '';
  renderSchedule();
  elements.scheduleCard.classList.remove('hidden');
  elements.scheduleCard.scrollIntoView({ behavior: 'smooth' });
}

elements.closeScheduleButton.addEventListener('click', () => { activeSchedule = null; elements.scheduleCard.classList.add('hidden'); });

elements.scheduleSearch.addEventListener('input', renderSchedule);

elements.scheduleExcelButton.addEventListener('click', async () => {
  if (!activeSchedule) return;
  try {
    elements.scheduleExcelButton.disabled = true;
    const r = await window.matchpointApp.exportScheduleExcel(activeSchedule.runId);
    if (!r.canceled) showToast(`Excel de estructura horaria guardado en ${r.filePath}.`);
  } catch (error) { showToast(error.message, true); }
  finally { elements.scheduleExcelButton.disabled = false; }
});

elements.schedulePdfButton.addEventListener('click', async () => {
  if (!activeSchedule) return;
  try {
    elements.schedulePdfButton.disabled = true;
    const r = await window.matchpointApp.exportSchedulePdf(activeSchedule.runId);
    if (!r.canceled) showToast(`PDF de estructura horaria guardado en ${r.filePath}.`);
  } catch (error) { showToast(error.message, true); }
  finally { elements.schedulePdfButton.disabled = false; }
});

window.matchpointApp.onProgress(renderProgress);

async function initialize() {
  const today = todayIso();
  elements.dateFrom.value = today;
  elements.dateTo.value = today;
  elements.monthPicker.value = today.slice(0, 7);
  elements.monthFrom.value = today.slice(0, 7);
  elements.monthTo.value = today.slice(0, 7);
  try {
    setSessionStatus(await window.matchpointApp.checkSession());
    await loadRuns();
    await initDefaultFolder();
  } catch (error) {
    showToast(error.message, true);
  }
  updateButtons();
}

initialize();
