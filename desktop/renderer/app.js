'use strict';
const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

const messages = $('messages');
let curAssistant = null, curReasoning = null, curTurn = null, lastTool = null;
let busy = false, activeSessionId = null;

function newTurn() {
  curTurn = el('div', 'turn');
  messages.appendChild(curTurn);
  curAssistant = null; curReasoning = null;
  return curTurn;
}
function ensureTurn() { return curTurn || newTurn(); }
function scrollDown() { messages.scrollTop = messages.scrollHeight; }

function addUser(text) {
  const t = newTurn();
  t.appendChild(el('div', 'msg-user', text));
  curTurn = null; // user turn closed; agent output starts a fresh turn
  scrollDown();
}
function assistantEl() {
  if (!curAssistant) { curAssistant = el('div', 'assistant-text'); curAssistant._t = ''; ensureTurn().appendChild(curAssistant); }
  return curAssistant;
}
function appendText(x) { const a = assistantEl(); a._t += x; a.textContent = a._t; scrollDown(); }
function appendReasoning(x) {
  if (!curReasoning) { curReasoning = el('div', 'reasoning'); curReasoning._t = ''; ensureTurn().appendChild(curReasoning); }
  curReasoning._t += x; curReasoning.textContent = '🧠 ' + curReasoning._t; scrollDown();
}
function breakBlocks() { curAssistant = null; curReasoning = null; }

function addTool(name, summary) {
  breakBlocks();
  const row = el('div', 'act');
  const spin = el('span', 'spin');
  const label = el('span', 'act-label');
  label.appendChild(el('span', 'name', name));
  label.appendChild(document.createTextNode(' '));
  label.appendChild(el('span', 'sum', summary || ''));
  const chev = el('span', 'chev', '›');
  row.appendChild(spin); row.appendChild(label); row.appendChild(chev);
  const body = el('div', 'act-body');
  ensureTurn().appendChild(row);
  ensureTurn().appendChild(body);
  row.onclick = () => { row.classList.toggle('open'); body.classList.toggle('open'); };
  row._spin = spin; row._body = body;
  scrollDown();
  return row;
}
function finishTool(row, isError, content) {
  if (!row) return;
  const mark = el('span', isError ? 'fail' : 'ok', isError ? '✗' : '✓');
  row.replaceChild(mark, row._spin);
  row._body.textContent = content || '(no output)';
}

function addHello() {
  const h = el('div', 'hello');
  h.appendChild(el('div', 'big', 'OxCode'));
  h.appendChild(el('div', null, 'Autonomous coding + offensive-security agent. Ask for a build, a fix, or a target to test.'));
  messages.appendChild(h);
}
function turnFoot() {
  if (!curTurn) return;
  const f = el('div', 'turn-foot');
  f.appendChild(el('span', null, new Date().toLocaleTimeString()));
  messages.appendChild(f);
  curTurn = null;
}

// ---- agent stream ----
window.ox.onEvent((ev) => {
  switch (ev.type) {
    case 'run-start': busy = true; setBusy(true); break;
    case 'text': appendText(ev.text); break;
    case 'reasoning': appendReasoning(ev.text); break;
    case 'tool-start': lastTool = addTool(ev.name, ev.summary); break;
    case 'tool-end': finishTool(lastTool, ev.isError, ev.content); breakBlocks(); break;
    case 'compact': { const i = el('div', 'assistant-text reasoning', `compacted ${ev.before} → ${ev.after} messages`); ensureTurn().appendChild(i); break; }
    case 'error': { const e = el('div', 'assistant-text err-line', ev.message); ensureTurn().appendChild(e); break; }
    case 'run-done':
      breakBlocks();
      if (ev.status && ev.status !== 'completed') { const e = el('div', 'assistant-text err-line', 'run ' + ev.status); ensureTurn().appendChild(e); }
      turnFoot();
      busy = false; setBusy(false);
      refreshSessions();
      break;
    case 'state': if (ev.state) renderState(ev.state); break;
  }
});

// ---- approvals ----
window.ox.onApproval((req) => {
  $('appr-summary').textContent = req.toolName + '  ·  ' + (req.summary || '');
  $('appr-reason').textContent = req.danger ? '⚠ ' + req.reason : req.reason;
  $('approval').hidden = false;
  const done = (r) => { $('approval').hidden = true; window.ox.approve(req.id, r); };
  $('appr-yes').onclick = () => done('yes');
  $('appr-session').onclick = () => done('yes-session');
  $('appr-no').onclick = () => done('no');
});

function setBusy(b) {
  $('btn-send').disabled = b;
  $('btn-stop').disabled = !b;
}

// ---- send ----
async function send() {
  const input = $('input');
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = ''; input.style.height = 'auto';
  addUser(text);
  await window.ox.send(text);
}
$('btn-send').onclick = send;
$('btn-stop').onclick = () => window.ox.stop();
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('input').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 200) + 'px'; });

// ---- state ----
function renderState(s) {
  if (!s || !s.ready) { $('cwd').textContent = 'open a project…'; $('title').textContent = 'OxCode'; return; }
  const name = s.cwd.split(/[\\/]/).pop() || s.cwd;
  $('cwd').textContent = name;
  $('title').textContent = name;
  document.title = 'OxCode — ' + name;
  $('btn-pentest').classList.toggle('on', s.pentest);
  $('btn-mrrobot').classList.toggle('on', s.mrRobot);
  document.body.classList.toggle('fsociety', s.mrRobot);
  const sel = $('model');
  if (sel.value !== s.model && [...sel.options].some((o) => o.value === s.model)) sel.value = s.model;
  if (s.permissionMode) $('perm-label').textContent = s.permissionMode;
  activeSessionId = s.sessionId;
  $('stats').textContent = `${s.model} · ${s.messages} msgs · in ${fmt(s.usage.in)} (${fmt(s.usage.cached)} cached) / out ${fmt(s.usage.out)}`;
}
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }

// ---- sidebar actions ----
$('btn-folder').onclick = async () => {
  const r = await window.ox.pickFolder();
  if (r.ok) { renderState(r.state); resetChat(); await refreshSessions(); }
  else if (r.error) alert(r.error);
};
$('btn-new').onclick = async () => {
  const r = await window.ox.newSession();
  if (r.ok) { resetChat(); renderState(r.state); await refreshSessions(); }
};
$('btn-pentest').onclick = async () => {
  const on = !$('btn-pentest').classList.contains('on');
  const r = await window.ox.setMode({ pentest: on }); if (r.ok) renderState(r.state);
};
$('btn-mrrobot').onclick = async () => {
  const on = !$('btn-mrrobot').classList.contains('on');
  const r = await window.ox.setMode({ mrRobot: on }); if (r.ok) renderState(r.state);
};
$('model').onchange = async () => { const r = await window.ox.setModel($('model').value); if (r.ok) renderState(r.state); };

function resetChat() { messages.innerHTML = ''; curTurn = null; curAssistant = null; curReasoning = null; addHello(); }

async function refreshSessions() {
  const r = await window.ox.listSessions();
  const host = $('session-list'); host.innerHTML = '';
  for (const s of (r.sessions || [])) {
    const row = el('div', 'srow' + (s.id === activeSessionId ? ' active' : ''));
    row.appendChild(el('div', 't', s.preview || '(empty session)'));
    row.appendChild(el('div', 'm', `${s.messageCount} msgs · ${timeAgo(s.updatedAt)}`));
    row.onclick = async () => {
      const lr = await window.ox.loadSession(s.id);
      if (!lr.ok) return;
      messages.innerHTML = ''; curTurn = null; curAssistant = null; curReasoning = null;
      for (const m of lr.messages || []) {
        if (m.role === 'user') addUser(m.content);
        else if (m.role === 'assistant') { const t = newTurn(); t.appendChild(el('div', 'assistant-text', m.content)); curTurn = null; }
      }
      renderState(lr.state); await refreshSessions(); scrollDown();
    };
    host.appendChild(row);
  }
}
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ---- boot ----
(async () => {
  const models = await window.ox.listModels();
  const sel = $('model');
  for (const m of (models.models || [])) { const o = el('option', null, m.note || m.id); o.value = m.id; sel.appendChild(o); }
  const init = await window.ox.init();
  resetChat();
  if (!init.ok) {
    const t = newTurn();
    t.appendChild(el('div', 'assistant-text err-line', 'Startup error: ' + init.error));
    t.appendChild(el('div', 'assistant-text', 'Set your API key in ~/.ox/settings.json, then reopen OxCode.'));
    curTurn = null;
    return;
  }
  renderState(init.state);
  await refreshSessions();
})();
