import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChatMessage, UsageInfo } from '../api/types.js';
import { sessionsDir } from '../utils/paths.js';

export interface SessionMeta {
  id: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** First user message, for display in session pickers. */
  preview: string;
}

export interface SessionData {
  version: 1;
  id: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; requests: number };
  /** Compaction events, for transparency. */
  compactions: number;
}

/** Runtime session state (in-memory) with usage accumulation. */
export class Session {
  data: SessionData;

  constructor(cwd: string, model: string, id?: string) {
    const now = new Date().toISOString();
    this.data = {
      version: 1,
      id: id ?? crypto.randomUUID(),
      cwd,
      model,
      createdAt: now,
      updatedAt: now,
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 },
      compactions: 0,
    };
  }

  static fromData(data: SessionData): Session {
    const s = new Session(data.cwd, data.model, data.id);
    s.data = data;
    return s;
  }

  get messages(): ChatMessage[] {
    return this.data.messages;
  }

  addUsage(u: UsageInfo): void {
    this.data.usage.inputTokens += u.inputTokens;
    this.data.usage.outputTokens += u.outputTokens;
    this.data.usage.cachedTokens = (this.data.usage.cachedTokens ?? 0) + (u.cachedTokens ?? 0);
    this.data.usage.requests += 1;
  }

  touch(): void {
    this.data.updatedAt = new Date().toISOString();
  }

  preview(): string {
    const first = this.data.messages.find((m) => m.role === 'user');
    const text = typeof first?.content === 'string' ? first.content : '';
    return text.replace(/\s+/g, ' ').slice(0, 80);
  }
}

/** JSON-file session persistence under ~/.ox/sessions. Never stores API keys. */
export class SessionStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? sessionsDir();
  }

  private fileFor(id: string): string {
    // ids are UUIDs; guard against traversal anyway
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid session id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  save(session: Session): void {
    session.touch();
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.fileFor(session.data.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(session.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.fileFor(session.data.id));
  }

  load(id: string): Session | null {
    try {
      const raw = fs.readFileSync(this.fileFor(id), 'utf8');
      const data = JSON.parse(raw) as SessionData;
      if (data.version !== 1 || !Array.isArray(data.messages)) return null;
      return Session.fromData(data);
    } catch {
      return null;
    }
  }

  list(filterCwd?: string): SessionMeta[] {
    let files: string[];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as SessionData;
        if (data.version !== 1) continue;
        if (filterCwd && path.resolve(data.cwd) !== path.resolve(filterCwd)) continue;
        const s = Session.fromData(data);
        metas.push({
          id: data.id,
          cwd: data.cwd,
          model: data.model,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          messageCount: data.messages.length,
          preview: s.preview(),
        });
      } catch {
        // skip corrupt session files
      }
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  latest(cwd: string): Session | null {
    const metas = this.list(cwd);
    const first = metas[0];
    return first ? this.load(first.id) : null;
  }
}
