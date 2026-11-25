'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('matchpointApp', {
  openSession: () => ipcRenderer.invoke('session:open'),
  checkSession: () => ipcRenderer.invoke('session:check'),
  startExtraction: (payload) => ipcRenderer.invoke('extraction:start', payload),
  cancelExtraction: () => ipcRenderer.invoke('extraction:cancel'),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  deleteRun: (runId) => ipcRenderer.invoke('run:delete', runId),
  deleteAllRuns: () => ipcRenderer.invoke('runs:delete-all'),
  exportRun: (runId, activities = []) => ipcRenderer.invoke('run:export', runId, activities),
  getAnalysis: (runId, activities) => ipcRenderer.invoke('analysis:get', runId, activities),
  auditRun: (runId) => ipcRenderer.invoke('analysis:audit', runId),
  exportPresentation: (runId, activities) => ipcRenderer.invoke('analysis:export-presentation', runId, activities),
  exportPdf: (runId, activities) => ipcRenderer.invoke('analysis:export-pdf', runId, activities),
  getSchedule: (runId) => ipcRenderer.invoke('schedule:get', runId),
  exportScheduleExcel: (runId) => ipcRenderer.invoke('schedule:export-excel', runId),
  exportSchedulePdf: (runId) => ipcRenderer.invoke('schedule:export-pdf', runId),
  getDefaultFolder: () => ipcRenderer.invoke('folder:get-default'),
  setDefaultFolder: () => ipcRenderer.invoke('folder:set-default'),
  openDefaultFolder: () => ipcRenderer.invoke('folder:open-default'),
  exportBatch: () => ipcRenderer.invoke('run:export-batch'),
  openDataDirectory: () => ipcRenderer.invoke('data:open-directory'),
  generateDashboard: (runIds) => ipcRenderer.invoke('dashboard:generate', runIds),
  generateDashboardV2: (runIds) => ipcRenderer.invoke('dashboard:generate-v2', runIds),
  listAllRuns: () => ipcRenderer.invoke('runs:list-all'),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('extraction:progress', handler);
    return () => ipcRenderer.removeListener('extraction:progress', handler);
  }
});
