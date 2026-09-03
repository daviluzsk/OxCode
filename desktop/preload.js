'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ox', {
  init: () => ipcRenderer.invoke('app:init'),
  state: () => ipcRenderer.invoke('app:state'),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  send: (text) => ipcRenderer.invoke('chat:send', text),
  stop: () => ipcRenderer.invoke('chat:stop'),
  approve: (id, response) => ipcRenderer.invoke('approval:respond', { id, response }),
  newSession: () => ipcRenderer.invoke('session:new'),
  listSessions: () => ipcRenderer.invoke('session:list'),
  loadSession: (id) => ipcRenderer.invoke('session:load', id),
  setModel: (model) => ipcRenderer.invoke('model:set', model),
  listModels: () => ipcRenderer.invoke('models:list'),
  setMode: (opts) => ipcRenderer.invoke('mode:set', opts),
  tree: (dir) => ipcRenderer.invoke('fs:tree', dir),
  readFile: (file) => ipcRenderer.invoke('fs:read', file),
  saveFile: (file, content) => ipcRenderer.invoke('fs:save', { file, content }),
  onEvent: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('agent:event', h);
    return () => ipcRenderer.removeListener('agent:event', h);
  },
  onApproval: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('approval:request', h);
    return () => ipcRenderer.removeListener('approval:request', h);
  },
});
