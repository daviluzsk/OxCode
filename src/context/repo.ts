import fs from 'node:fs';
import path from 'node:path';
import { gitBranch, isGitRepo } from '../tools/git.js';

/** Lightweight project profile detected at startup (lazy, no heavy indexing). */
export interface RepoProfile {
  kind: string;
  packageManager: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  gitBranch: string | null;
  isGit: boolean;
  markers: string[];
  fileCount: number | null;
}

function exists(cwd: string, name: string): boolean {
  try {
    fs.accessSync(path.join(cwd, name));
    return true;
  } catch {
    return false;
  }
}

function readJson(cwd: string, name: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, name), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Quick top-level file count with an early cap — never index everything. */
function quickFileCount(cwd: string, cap = 3000): number | null {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor', 'target', '__pycache__', '.venv']);
  let count = 0;
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 6) return true;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        if (!walk(path.join(dir, e.name), depth + 1)) return false;
      } else {
        count++;
        if (count >= cap) return false;
      }
    }
    return true;
  };
  const complete = walk(cwd, 0);
  return complete ? count : null; // null = "more than cap"
}

export async function detectRepoProfile(cwd: string): Promise<RepoProfile> {
  const markers: string[] = [];
  let kind = 'Generic project';
  let packageManager: string | null = null;
  let testCommand: string | null = null;
  let buildCommand: string | null = null;

  const pkg = readJson(cwd, 'package.json');
  if (pkg) {
    markers.push('package.json');
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const isTs = exists(cwd, 'tsconfig.json');
    if (isTs) markers.push('tsconfig.json');
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
    const frameworks = ['react', 'vue', 'svelte', 'next', 'express', 'fastify', 'ink'].filter((f) => deps[f]);
    kind = `${isTs ? 'TypeScript' : 'JavaScript'}${frameworks.length ? ` / ${frameworks.join(', ')}` : ''} project`;
    if (exists(cwd, 'pnpm-lock.yaml')) {
      packageManager = 'pnpm';
      markers.push('pnpm-lock.yaml');
    } else if (exists(cwd, 'yarn.lock')) {
      packageManager = 'yarn';
      markers.push('yarn.lock');
    } else if (exists(cwd, 'bun.lockb') || exists(cwd, 'bun.lock')) {
      packageManager = 'bun';
    } else if (exists(cwd, 'package-lock.json')) {
      packageManager = 'npm';
      markers.push('package-lock.json');
    } else {
      packageManager = 'npm';
    }
    if (scripts.test) testCommand = `${packageManager}${packageManager === 'npm' ? ' run' : ''} test`;
    if (scripts.build) buildCommand = `${packageManager}${packageManager === 'npm' ? ' run' : ''} build`;
  }
  if (exists(cwd, 'pyproject.toml')) {
    markers.push('pyproject.toml');
    if (!pkg) {
      kind = 'Python project';
      testCommand = 'pytest';
    }
  } else if (exists(cwd, 'requirements.txt')) {
    markers.push('requirements.txt');
    if (!pkg) {
      kind = 'Python project';
      testCommand = 'pytest';
    }
  }
  if (exists(cwd, 'Cargo.toml')) {
    markers.push('Cargo.toml');
    if (!pkg) {
      kind = 'Rust project';
      testCommand = 'cargo test';
      buildCommand = 'cargo build';
    }
  }
  if (exists(cwd, 'go.mod')) {
    markers.push('go.mod');
    if (!pkg) {
      kind = 'Go project';
      testCommand = 'go test ./...';
      buildCommand = 'go build ./...';
    }
  }
  if (exists(cwd, 'pom.xml')) markers.push('pom.xml');
  if (exists(cwd, 'build.gradle') || exists(cwd, 'build.gradle.kts')) markers.push('build.gradle');
  if (exists(cwd, 'Dockerfile')) markers.push('Dockerfile');
  if (exists(cwd, 'docker-compose.yml') || exists(cwd, 'compose.yml')) markers.push('docker-compose.yml');
  if (exists(cwd, 'README.md')) markers.push('README.md');

  const git = await isGitRepo(cwd);
  const branch = git ? await gitBranch(cwd) : null;
  if (git) markers.push('.git');

  return {
    kind,
    packageManager,
    testCommand,
    buildCommand,
    gitBranch: branch,
    isGit: git,
    markers,
    fileCount: quickFileCount(cwd),
  };
}

export function formatProfile(p: RepoProfile): string {
  const lines = [p.kind];
  if (p.packageManager) lines.push(`Package manager: ${p.packageManager}`);
  if (p.gitBranch) lines.push(`Git branch: ${p.gitBranch}`);
  if (p.testCommand) lines.push(`Test command: ${p.testCommand}`);
  if (p.buildCommand) lines.push(`Build command: ${p.buildCommand}`);
  return lines.join('\n');
}
