import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { cleanup, makeTempDir } from './helpers.js';
import { Session, SessionStore } from '../src/sessions/store.js';

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

describe('session persistence', () => {
  it('saves and reloads a session', () => {
    dir = makeTempDir();
    const store = new SessionStore(path.join(dir, 'sessions'));
    const s = new Session(dir, 'stealth/ox-alpha');
    s.messages.push({ role: 'user', content: 'fix the bug' });
    s.messages.push({ role: 'assistant', content: 'done' });
    s.addUsage({ inputTokens: 10, outputTokens: 5 });
    store.save(s);

    const loaded = store.load(s.data.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.data.usage.inputTokens).toBe(10);
    expect(loaded!.data.model).toBe('stealth/ox-alpha');
  });

  it('lists sessions for a cwd, newest first, with preview', () => {
    dir = makeTempDir();
    const store = new SessionStore(path.join(dir, 'sessions'));
    const a = new Session(dir, 'm');
    a.messages.push({ role: 'user', content: 'first task' });
    store.save(a);
    const b = new Session(dir, 'm');
    b.messages.push({ role: 'user', content: 'second task' });
    b.data.updatedAt = new Date(Date.now() + 1000).toISOString();
    store.save(b);
    const other = new Session(path.join(dir, 'elsewhere'), 'm');
    store.save(other);

    const metas = store.list(dir);
    expect(metas).toHaveLength(2);
    expect(metas[0]!.id).toBe(b.data.id);
    expect(metas[1]!.preview).toBe('first task');
  });

  it('latest() returns the most recent session for the cwd', () => {
    dir = makeTempDir();
    const store = new SessionStore(path.join(dir, 'sessions'));
    const s = new Session(dir, 'm');
    s.messages.push({ role: 'user', content: 'hello' });
    store.save(s);
    expect(store.latest(dir)?.data.id).toBe(s.data.id);
    expect(store.latest(path.join(dir, 'nope'))).toBeNull();
  });

  it('survives corrupt session files when listing', () => {
    dir = makeTempDir();
    const sessionsDir = path.join(dir, 'sessions');
    const store = new SessionStore(sessionsDir);
    const s = new Session(dir, 'm');
    store.save(s);
    // corrupt one file
    const fs = require('node:fs');
    fs.writeFileSync(path.join(sessionsDir, 'broken.json'), '{ nope', 'utf8');
    const metas = store.list();
    expect(metas).toHaveLength(1);
  });

  it('never stores API keys in session data', () => {
    dir = makeTempDir();
    const store = new SessionStore(path.join(dir, 'sessions'));
    const s = new Session(dir, 'm');
    store.save(s);
    const raw = require('node:fs').readFileSync(path.join(dir, 'sessions', `${s.data.id}.json`), 'utf8');
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('OPENROUTER');
  });
});
