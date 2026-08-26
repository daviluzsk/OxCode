import fs from 'node:fs';
import path from 'node:path';

/** Directories that are always ignored during discovery/search. */
export const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '.turbo',
  '.cache',
  'out',
  '.ox/sessions',
];

/**
 * Parse the repository's .gitignore into simple patterns.
 * This is intentionally lightweight — it covers common cases
 * (plain names, globs, directory prefixes) without a full gitignore engine.
 */
export function loadGitignorePatterns(cwd: string): string[] {
  const patterns: string[] = [];
  try {
    const raw = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
      patterns.push(trimmed.replace(/^\//, '').replace(/\/$/, ''));
    }
  } catch {
    // no .gitignore — fine
  }
  return patterns;
}

/** Combined ignore list (defaults + .gitignore + user config). */
export function buildIgnoreList(cwd: string, extra: string[] = []): string[] {
  return [...DEFAULT_IGNORES, ...loadGitignorePatterns(cwd), ...extra];
}

/** Convert ignore entries into glob patterns usable by tinyglobby. */
export function toGlobIgnores(patterns: string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    if (p.includes('*')) {
      out.push(p, `**/${p}`, `${p}/**`, `**/${p}/**`);
    } else {
      out.push(`**/${p}/**`, p, `${p}/**`);
    }
  }
  return out;
}
