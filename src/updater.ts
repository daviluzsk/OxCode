import { execa } from 'execa';

/**
 * Self-update support. OxCode is distributed as a git clone, so updating means
 * pulling the latest commit and rebuilding. Used by the startup auto-update
 * check and the /update command. Everything is best-effort and offline-safe.
 */

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function git(cwd: string, argv: string[], timeout = 15_000) {
  return execa('git', argv, { cwd, reject: false, all: true, timeout });
}

export async function isGitClone(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.exitCode === 0 && (r.stdout ?? '').trim() === 'true';
}

async function upstreamRef(cwd: string): Promise<string> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return r.exitCode === 0 && (r.stdout ?? '').trim() ? (r.stdout ?? '').trim() : 'origin/main';
}

export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['status', '--porcelain']);
  return r.exitCode === 0 && (r.stdout ?? '').trim() === '';
}

export interface UpdateInfo {
  behind: number;
  latest: string;
  upstream: string;
}

/** How many commits behind the tracked upstream we are (null if not a clone / offline). */
export async function checkForUpdate(cwd: string): Promise<UpdateInfo | null> {
  if (!(await isGitClone(cwd))) return null;
  const up = await upstreamRef(cwd);
  const slash = up.indexOf('/');
  const remote = slash > 0 ? up.slice(0, slash) : 'origin';
  const branch = slash > 0 ? up.slice(slash + 1) : 'main';
  const fetched = await git(cwd, ['fetch', '--quiet', remote, branch], 20_000);
  if (fetched.exitCode !== 0) return null; // offline or no remote
  const count = await git(cwd, ['rev-list', '--count', `HEAD..${up}`]);
  const behind = Number((count.stdout ?? '0').trim()) || 0;
  const sha = await git(cwd, ['rev-parse', '--short', up]);
  return { behind, latest: (sha.stdout ?? '').trim(), upstream: up };
}

export interface UpdateResult {
  ok: boolean;
  log: string;
}

/** Pull the latest commit, reinstall deps and rebuild. */
export async function applyUpdate(cwd: string, onLog: (line: string) => void = () => {}): Promise<UpdateResult> {
  const pull = await git(cwd, ['pull', '--ff-only'], 120_000);
  onLog(`git pull → exit ${pull.exitCode}`);
  if (pull.exitCode !== 0) return { ok: false, log: `git pull failed:\n${(pull.all ?? '').slice(-1200)}` };

  const install = await execa(NPM, ['install'], { cwd, reject: false, all: true, timeout: 600_000 });
  onLog(`npm install → exit ${install.exitCode}`);
  if (install.exitCode !== 0) return { ok: false, log: `npm install failed:\n${(install.all ?? '').slice(-1200)}` };

  const build = await execa(NPM, ['run', 'build'], { cwd, reject: false, all: true, timeout: 300_000 });
  onLog(`npm run build → exit ${build.exitCode}`);
  if (build.exitCode !== 0) return { ok: false, log: `build failed:\n${(build.all ?? '').slice(-1200)}` };

  return { ok: true, log: 'Pulled latest, reinstalled deps and rebuilt.' };
}
