import path from 'node:path';
import os from 'node:os';

/** User-level OxCode data directory (~/.ox). */
export function userDataDir(): string {
  return path.join(os.homedir(), '.ox');
}

export function sessionsDir(): string {
  return path.join(userDataDir(), 'sessions');
}

export function historyDir(): string {
  return path.join(userDataDir(), 'history');
}

export function userSettingsPath(): string {
  return path.join(userDataDir(), 'settings.json');
}

/** Resolve a user-supplied path against the workspace cwd. */
export function resolveInCwd(cwd: string, p: string): string {
  const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(cwd, expanded);
}

/**
 * Check that a resolved absolute path stays inside the workspace root.
 * Returns true when inside (or equal to) the root.
 */
export function isInsideRoot(root: string, absolute: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(absolute));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Shorten a path for display, using ~ for home and ./ for cwd-relative. */
export function displayPath(cwd: string, absolute: string): string {
  const rel = path.relative(cwd, absolute);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  const home = os.homedir();
  if (absolute.startsWith(home)) return '~' + absolute.slice(home.length);
  return absolute;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
