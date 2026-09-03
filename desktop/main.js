'use strict';
// OxCode Desktop — Electron main process.
// Drives the OxCode agent core (built to ../dist, ESM) and streams everything
// to the renderer over IPC. CommonJS main so we can dynamic-import the ESM core.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

/** Resolve a core module both in dev (../dist) and packaged (node_modules/oxcode/dist). */
async function core(rel) {
  const candidates = [];
  try { candidates.push(require.resolve('oxcode/dist/' + rel)); } catch { /* not installed as dep */ }
  candidates.push(path.join(__dirname, '..', 'dist', rel));
  candidates.push(path.join(process.resourcesPath || '', 'app', 'node_modules', 'oxcode', 'dist', rel));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return await import(pathToFileURL(c).href); } catch { /* try next */ }
  }
  // Last resort: let import throw a useful error.
  return import(pathToFileURL(candidates[candidates.length - 1]).href);
}

const os = require('node:os');
let win = null;
let runtime = null;
// Default to the user's home, not the app folder, so the title isn't "desktop".
let currentCwd = os.homedir();
let running = false;
let abortController = null;

// Pending approval requests: id -> resolve fn.
const approvals = new Map();
let approvalSeq = 0;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Approver that asks the renderer and waits for the user's click. */
function guiApprover(request) {
  return new Promise((resolve) => {
    const id = 'appr_' + ++approvalSeq;
    approvals.set(id, resolve);
    send('approval:request', { id, ...request });
  });
}

async function buildRuntime(cwd) {
  const { createRuntime } = await core('runtime.js');
  if (runtime) { try { runtime.dispose(); } catch { /* ignore */ } runtime = null; }
  runtime = await createRuntime({
    cwd,
    approver: guiApprover,
    connectMcp: false, // faster startup; MCP can be added later
  });
  currentCwd = cwd;
  return runtime;
}

function stateSnapshot() {
  if (!runtime) return { ready: false, cwd: currentCwd };
  const c = runtime.config;
  const u = runtime.session.data.usage;
  return {
    ready: true,
    cwd: c.cwd,
    model: c.model,
    pentest: !!c.pentest,
    mrRobot: !!c.mrRobot,
    permissionMode: c.permissionMode,
    sessionId: runtime.session.data.id,
    messages: runtime.session.messages.length,
    usage: { in: u.inputTokens, out: u.outputTokens, cached: u.cachedTokens ?? 0, requests: u.requests },
    running,
  };
}

function hooks() {
  return {
    onTextDelta: (text) => send('agent:event', { type: 'text', text }),
    onReasoning: (text) => send('agent:event', { type: 'reasoning', text }),
    onToolStart: (call, summary) => send('agent:event', { type: 'tool-start', name: call.name, summary }),
    onToolEnd: (call, result) =>
      send('agent:event', {
        type: 'tool-end',
        name: call.name,
        isError: !!result.isError,
        content: String(result.content || '').slice(0, 4000),
      }),
    onCompact: (before, after) => send('agent:event', { type: 'compact', before, after }),
    onError: (message) => { log('AGENT error:', String(message)); send('agent:event', { type: 'error', message: String(message) }); },
  };
}

const LOG_FILE = path.join(os.tmpdir(), 'oxcode-desktop.log');
function log(...a) {
  const line = `[${new Date().toISOString()}] ` + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('MAIN uncaughtException:', e && e.stack || String(e)));
process.on('unhandledRejection', (e) => log('MAIN unhandledRejection:', e && (e.stack || String(e))));

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0b0e14',
    title: 'OxCode',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    if (level >= 2) log('RENDERER console', `[${src}:${line}]`, message);
  });
  win.webContents.on('render-process-gone', (_e, details) => log('RENDERER gone:', JSON.stringify(details)));
  win.webContents.on('unresponsive', () => log('RENDERER unresponsive'));
}

// ---------- IPC ----------

ipcMain.handle('app:init', async () => {
  if (!runtime) {
    try { await buildRuntime(currentCwd); }
    catch (e) { return { ok: false, error: String(e && e.message || e), cwd: currentCwd }; }
  }
  return { ok: true, state: stateSnapshot() };
});

ipcMain.handle('app:state', async () => stateSnapshot());

ipcMain.handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    await buildRuntime(r.filePaths[0]);
    return { ok: true, state: stateSnapshot() };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('chat:send', async (_e, text) => {
  if (!runtime) return { ok: false, error: 'No project open.' };
  if (running) return { ok: false, error: 'Agent is busy.' };
  running = true;
  abortController = new AbortController();
  send('agent:event', { type: 'run-start' });
  try {
    const agent = runtime.makeAgent(hooks(), abortController.signal);
    const result = await agent.run(text);
    try { runtime.sessionStore.save(runtime.session); } catch { /* best effort */ }
    send('agent:event', { type: 'run-done', status: result.status, finalText: result.finalText, error: result.errorText });
    return { ok: true, status: result.status };
  } catch (e) {
    log('chat:send threw:', e && e.stack || String(e));
    send('agent:event', { type: 'error', message: String(e && e.message || e) });
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    running = false;
    abortController = null;
    send('agent:event', { type: 'state', state: stateSnapshot() });
  }
});

ipcMain.handle('chat:stop', async () => {
  if (abortController) abortController.abort();
  return { ok: true };
});

ipcMain.handle('approval:respond', async (_e, { id, response }) => {
  const resolve = approvals.get(id);
  if (resolve) { approvals.delete(id); resolve(response); return { ok: true }; }
  return { ok: false };
});

ipcMain.handle('session:new', async () => {
  if (!runtime) return { ok: false };
  const { Session } = await core('sessions/store.js');
  try { if (runtime.session.messages.length > 0) runtime.sessionStore.save(runtime.session); } catch { /* ignore */ }
  runtime.replaceSession(new Session(runtime.config.cwd, runtime.config.model));
  return { ok: true, state: stateSnapshot() };
});

ipcMain.handle('session:list', async () => {
  if (!runtime) return { ok: false, sessions: [] };
  const metas = runtime.sessionStore.list(runtime.config.cwd);
  return { ok: true, sessions: metas.map((m) => ({ id: m.id, preview: m.preview, messageCount: m.messageCount, updatedAt: m.updatedAt })) };
});

ipcMain.handle('session:load', async (_e, id) => {
  if (!runtime) return { ok: false };
  try { if (runtime.session.messages.length > 0) runtime.sessionStore.save(runtime.session); } catch { /* ignore */ }
  const s = runtime.sessionStore.load(id);
  if (!s) return { ok: false, error: 'Session not found.' };
  runtime.replaceSession(s);
  // Return the transcript so the renderer can rehydrate.
  const msgs = s.messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '[rich content]' }));
  return { ok: true, state: stateSnapshot(), messages: msgs };
});

ipcMain.handle('model:set', async (_e, model) => {
  if (!runtime) return { ok: false };
  runtime.setModel(model);
  return { ok: true, state: stateSnapshot() };
});

ipcMain.handle('mode:set', async (_e, { pentest, mrRobot, effort }) => {
  if (!runtime) return { ok: false };
  if (typeof pentest === 'boolean') runtime.config.pentest = pentest;
  if (typeof mrRobot === 'boolean') {
    runtime.config.mrRobot = mrRobot;
    if (mrRobot) runtime.config.pentest = true;
    runtime.swarm.fsociety = mrRobot;
  }
  if (effort !== undefined) runtime.config.reasoningEffort = effort || undefined;
  return { ok: true, state: stateSnapshot() };
});

ipcMain.handle('models:list', async () => {
  try {
    const { MODEL_PRESETS } = await core('commands/slash.js');
    return { ok: true, models: MODEL_PRESETS };
  } catch {
    return { ok: true, models: [{ id: 'minimax/minimax-m3:free', note: 'default' }] };
  }
});

// ---------- file tree / editor ----------

const IGNORE = new Set(['node_modules', '.git', 'dist', 'release', '.ox', '.cache', 'out', 'build']);

ipcMain.handle('fs:tree', async (_e, dir) => {
  const base = dir || currentCwd;
  async function walk(d, depth) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return []; }
    entries = entries.filter((en) => !en.name.startsWith('.') && !IGNORE.has(en.name));
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    const out = [];
    for (const en of entries.slice(0, 500)) {
      const full = path.join(d, en.name);
      if (en.isDirectory()) {
        out.push({ name: en.name, path: full, dir: true, children: depth > 0 ? await walk(full, depth - 1) : null });
      } else {
        out.push({ name: en.name, path: full, dir: false });
      }
    }
    return out;
  }
  return { ok: true, root: base, tree: await walk(base, 2) };
});

ipcMain.handle('fs:read', async (_e, file) => {
  try {
    const stat = await fsp.stat(file);
    if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'File too large to open (>2MB).' };
    const content = await fsp.readFile(file, 'utf8');
    return { ok: true, content, path: file };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('fs:save', async (_e, { file, content }) => {
  try { await fsp.writeFile(file, content, 'utf8'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// ---------- lifecycle ----------

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (runtime) { try { runtime.dispose(); } catch { /* ignore */ } }
  if (process.platform !== 'darwin') app.quit();
});
