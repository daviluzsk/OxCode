import fs from 'node:fs';
import path from 'node:path';
import { userDataDir } from './paths.js';
import { redactSecrets } from './redact.js';

/**
 * Optional debug logger. Enabled with OX_DEBUG=1.
 * Writes redacted lines to ~/.ox/debug.log and never throws.
 */
export class Logger {
  private readonly enabled: boolean;
  private readonly logFile: string;
  private stream: fs.WriteStream | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const flag = env.OX_DEBUG;
    this.enabled = flag === '1' || flag === 'true';
    this.logFile = path.join(userDataDir(), 'debug.log');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private ensureStream(): fs.WriteStream | null {
    if (!this.enabled) return null;
    if (this.stream) return this.stream;
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    } catch {
      this.stream = null;
    }
    return this.stream;
  }

  log(event: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const s = this.ensureStream();
    if (!s) return;
    try {
      const payload = data ? ' ' + redactSecrets(JSON.stringify(data)) : '';
      s.write(`${new Date().toISOString()} ${event}${payload}\n`);
    } catch {
      // logging must never crash the app
    }
  }

  time<T>(event: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    return fn().then(
      (v) => {
        this.log(event, { ms: Date.now() - start, ok: true });
        return v;
      },
      (err: unknown) => {
        this.log(event, {
          ms: Date.now() - start,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      },
    );
  }

  close(): void {
    try {
      this.stream?.end();
    } catch {
      /* ignore */
    }
    this.stream = null;
  }
}

export const logger = new Logger();
