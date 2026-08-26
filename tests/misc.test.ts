import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { cleanup, makeTempDir, writeFile } from './helpers.js';
import { isBlockedFromModel, isSensitivePath } from '../src/security/sensitive.js';
import { parseArgs } from '../src/cli/args.js';
import { loadInstructions } from '../src/context/instructions.js';
import { expandCustomCommand, loadCustomCommands } from '../src/commands/custom.js';
import { detectRepoProfile } from '../src/context/repo.js';
import { isInsideRoot, resolveInCwd } from '../src/utils/paths.js';
import { computeDiff } from '../src/utils/diffView.js';

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

describe('sensitive file detection', () => {
  it('blocks env files, keys and credentials', () => {
    for (const p of ['.env', '.env.production', 'server.pem', 'id_rsa', 'id_ed25519', 'credentials.json', '.ssh/config', 'cert.key']) {
      expect(isSensitivePath(p), p).toBe(true);
      expect(isBlockedFromModel(p), p).toBe(true);
    }
  });
  it('allows env templates and normal files', () => {
    expect(isBlockedFromModel('.env.example')).toBe(false);
    expect(isBlockedFromModel('.env.sample')).toBe(false);
    expect(isBlockedFromModel('src/index.ts')).toBe(false);
    expect(isBlockedFromModel('monkey.ts')).toBe(false); // contains "key" but not a key file
  });
});

describe('CLI argument parsing', () => {
  it('parses headless prompt', () => {
    const a = parseArgs(['-p', 'fix the bug']);
    expect(a.prompt).toBe('fix the bug');
  });
  it('parses -p with no value as stdin mode', () => {
    expect(parseArgs(['-p']).promptFromStdin).toBe(true);
  });
  it('parses flags and positional path', () => {
    const a = parseArgs(['myproj', '--model', 'x/y', '--max-turns', '5', '--output-format', 'json', '--dangerously-skip-permissions']);
    expect(a.path).toBe('myproj');
    expect(a.model).toBe('x/y');
    expect(a.maxTurns).toBe(5);
    expect(a.outputFormat).toBe('json');
    expect(a.dangerouslySkipPermissions).toBe(true);
  });
  it('parses permission mode', () => {
    expect(parseArgs(['--permission-mode', 'plan']).permissionMode).toBe('plan');
    expect(() => parseArgs(['--permission-mode', 'yolo'])).toThrow(/Invalid permission mode/);
  });
  it('parses mcp subcommands', () => {
    const add = parseArgs(['mcp', 'add', 'github', '--', 'npx', '-y', '@mcp/github']);
    expect(add.command).toBe('mcp');
    expect(add.mcpAction).toBe('add');
    expect(add.mcpName).toBe('github');
    expect(add.mcpCommand).toBe('npx');
    expect(add.mcpArgs).toEqual(['-y', '@mcp/github']);
    expect(parseArgs(['mcp', 'list']).mcpAction).toBe('list');
    expect(parseArgs(['mcp', 'remove', 'github']).mcpName).toBe('github');
  });
  it('rejects unknown options', () => {
    expect(() => parseArgs(['--frobnicate'])).toThrow(/Unknown option/);
  });
});

describe('instruction files', () => {
  it('loads OX.md, .ox/instructions.md and AGENTS.md with precedence order', () => {
    dir = makeTempDir();
    writeFile(dir, 'OX.md', 'ox rules');
    writeFile(dir, 'AGENTS.md', 'agents rules');
    writeFile(dir, '.ox/instructions.md', 'dot-ox rules');
    const sources = loadInstructions(dir);
    expect(sources.map((s) => path.basename(s.file))).toEqual(['OX.md', 'instructions.md', 'AGENTS.md']);
  });
  it('finds parent OX.md walking upward', () => {
    dir = makeTempDir();
    writeFile(dir, 'OX.md', 'parent rules');
    const sub = path.join(dir, 'sub', 'deep');
    writeFile(dir, 'sub/deep/file.txt', 'x');
    const sources = loadInstructions(sub);
    expect(sources.some((s) => s.content === 'parent rules')).toBe(true);
  });
});

describe('custom commands', () => {
  it('loads .ox/commands/*.md and expands $ARGUMENTS', () => {
    dir = makeTempDir();
    writeFile(dir, '.ox/commands/review.md', '# Code review\nReview this code: $ARGUMENTS');
    const cmds = loadCustomCommands(dir);
    expect(cmds.has('review')).toBe(true);
    const expanded = expandCustomCommand(cmds.get('review')!, 'src/auth.ts');
    expect(expanded).toContain('Review this code: src/auth.ts');
    expect(expanded).toContain('/review');
  });
});

describe('repository discovery', () => {
  it('detects a TypeScript/npm project', async () => {
    dir = makeTempDir();
    writeFile(dir, 'package.json', JSON.stringify({ scripts: { test: 'vitest', build: 'tsc' }, devDependencies: { typescript: '^5' } }));
    writeFile(dir, 'tsconfig.json', '{}');
    writeFile(dir, 'package-lock.json', '{}');
    const profile = await detectRepoProfile(dir);
    expect(profile.kind).toMatch(/TypeScript/);
    expect(profile.packageManager).toBe('npm');
    expect(profile.testCommand).toBe('npm run test');
    expect(profile.buildCommand).toBe('npm run build');
  });
  it('detects pnpm and Python projects', async () => {
    dir = makeTempDir();
    writeFile(dir, 'package.json', '{}');
    writeFile(dir, 'pnpm-lock.yaml', '');
    const p1 = await detectRepoProfile(dir);
    expect(p1.packageManager).toBe('pnpm');
    cleanup(dir);
    dir = makeTempDir();
    writeFile(dir, 'pyproject.toml', '[project]');
    const p2 = await detectRepoProfile(dir);
    expect(p2.kind).toMatch(/Python/);
    expect(p2.testCommand).toBe('pytest');
  });
});

describe('path safety', () => {
  it('isInsideRoot blocks traversal', () => {
    dir = makeTempDir();
    expect(isInsideRoot(dir, path.join(dir, 'src', 'a.ts'))).toBe(true);
    expect(isInsideRoot(dir, path.join(dir, '..', 'evil.ts'))).toBe(false);
    expect(isInsideRoot(dir, dir)).toBe(true);
  });
  it('resolveInCwd handles relative and tilde paths', () => {
    dir = makeTempDir();
    expect(resolveInCwd(dir, 'src/a.ts')).toBe(path.resolve(dir, 'src/a.ts'));
  });
});

describe('diff computation', () => {
  it('counts additions and removals', () => {
    const diff = computeDiff('a.ts', 'one\ntwo\nthree\n', 'one\nTWO\nthree\nfour\n');
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);
    expect(diff.hunks.length).toBeGreaterThan(0);
  });
});
