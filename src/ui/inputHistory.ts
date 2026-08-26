import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { historyDir } from '../utils/paths.js';

function historyFile(cwd: string): string {
  const key = crypto.createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  return path.join(historyDir(), `${key}.json`);
}

export function loadInputHistory(cwd: string): string[] {
  try {
    const raw = fs.readFileSync(historyFile(cwd), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveInputHistory(cwd: string, entries: string[]): void {
  try {
    fs.mkdirSync(historyDir(), { recursive: true });
    fs.writeFileSync(historyFile(cwd), JSON.stringify(entries.slice(-200)), 'utf8');
  } catch {
    /* history is best-effort */
  }
}
