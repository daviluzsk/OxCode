import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Create a fresh temporary workspace directory; returns its path. */
export function makeTempDir(prefix = 'oxcode-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFile(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

export function readFile(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

export function cleanup(dir: string): void {
  // Windows may briefly hold handles to files of recently-exited processes.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (attempt === 4) throw e;
      const waitUntil = Date.now() + 300;
      while (Date.now() < waitUntil) {
        /* brief spin before retry */
      }
    }
  }
}
