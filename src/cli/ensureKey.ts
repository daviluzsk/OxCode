import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { userSettingsPath } from '../utils/paths.js';
import { maskKey } from '../utils/redact.js';

/**
 * First-run API key setup. When no key is available from config/env and
 * we're in an interactive terminal, ask once and persist to
 * ~/.ox/settings.json so the user never has to set it again.
 */
export async function ensureApiKeyInteractive(): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;

  process.stdout.write(
    [
      'No OpenRouter API key found. Get one free at https://openrouter.ai/keys',
      'It will be saved to ~/.ox/settings.json — you only do this once.',
      '',
    ].join('\n'),
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('API key: ');
    const key = answer.trim();
    if (!key) return null;
    if (!/^sk-\S{8,}$/.test(key)) {
      process.stdout.write('That does not look like an OpenRouter key (expected sk-...). Not saved.\n');
      return null;
    }
    saveApiKey(key);
    process.stdout.write(`Saved ${maskKey(key)} to ${userSettingsPath()}\n\n`);
    return key;
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

/**
 * First-run NVIDIA API key setup — asked when the active model is NVIDIA-hosted
 * and no NVIDIA key is configured yet. Saved to ~/.ox/settings.json.
 */
export async function ensureNvidiaKeyInteractive(): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  process.stdout.write(
    [
      'This model runs on the NVIDIA API, but no NVIDIA key is set.',
      'Get one at https://build.nvidia.com (API Keys) — it looks like nvapi-...',
      'It will be saved to ~/.ox/settings.json — you only do this once.',
      '',
    ].join('\n'),
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('NVIDIA API key: ');
    const key = answer.trim();
    if (!key) return null;
    if (!/^nvapi-\S{8,}$/.test(key)) {
      process.stdout.write('That does not look like an NVIDIA key (expected nvapi-...). Not saved.\n');
      return null;
    }
    saveSetting('nvidiaApiKey', key);
    process.stdout.write(`Saved ${maskKey(key)} to ${userSettingsPath()}\n\n`);
    return key;
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

/** Merge the OpenRouter key into ~/.ox/settings.json without clobbering others. */
export function saveApiKey(key: string): void {
  saveSetting('apiKey', key);
}

/** Merge one field into ~/.ox/settings.json without clobbering other fields. */
export function saveSetting(field: string, value: string): void {
  const file = userSettingsPath();
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    /* file missing or invalid — start fresh */
  }
  settings[field] = value;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}
