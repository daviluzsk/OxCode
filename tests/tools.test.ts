import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { cleanup, makeTempDir, writeFile } from './helpers.js';
import { readFileTool } from '../src/tools/readFile.js';
import { listDirectoryTool } from '../src/tools/listDirectory.js';
import { globTool } from '../src/tools/globTool.js';
import { grepTool } from '../src/tools/grepTool.js';
import { writeFileTool } from '../src/tools/writeFile.js';
import { applyPatchTool } from '../src/tools/applyPatch.js';
import { deletePathTool, movePathTool } from '../src/tools/fileOps.js';
import { bashTool } from '../src/tools/bash.js';
import { validateArgs } from '../src/tools/types.js';

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

const ctx = () => ({ cwd: dir });

describe('read_file', () => {
  it('reads files with line numbers', async () => {
    dir = makeTempDir();
    writeFile(dir, 'a.txt', 'one\ntwo\nthree\n');
    const res = await readFileTool.execute({ path: 'a.txt' }, ctx());
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('1\tone');
    expect(res.content).toContain('2\ttwo');
  });

  it('supports ranged reads', async () => {
    dir = makeTempDir();
    writeFile(dir, 'a.txt', '1\n2\n3\n4\n5\n');
    const res = await readFileTool.execute({ path: 'a.txt', offset: 3, limit: 2 }, ctx());
    expect(res.content).toContain('3\t3');
    expect(res.content).toContain('4\t4');
    expect(res.content).not.toContain('5\t5');
  });

  it('errors on missing files', async () => {
    dir = makeTempDir();
    const res = await readFileTool.execute({ path: 'nope.txt' }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not found/);
  });

  it('refuses sensitive files', async () => {
    dir = makeTempDir();
    writeFile(dir, '.env', 'SECRET=x');
    const res = await readFileTool.execute({ path: '.env' }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/sensitive/i);
  });

  it('refuses path traversal outside the workspace', async () => {
    dir = makeTempDir();
    const res = await readFileTool.execute({ path: '../../outside.txt' }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/outside the workspace/);
  });

  it('detects binary files', async () => {
    dir = makeTempDir();
    const abs = path.join(dir, 'bin.dat');
    writeFile(dir, 'bin.dat', 'x');
    const buf = Buffer.from([0x50, 0x4b, 0x00, 0x00, 0x01]);
    await import('node:fs/promises').then((fs) => fs.writeFile(abs, buf));
    const res = await readFileTool.execute({ path: 'bin.dat' }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/binary/);
  });
});

describe('list_directory', () => {
  it('lists a bounded tree and skips node_modules', async () => {
    dir = makeTempDir();
    writeFile(dir, 'src/index.ts', 'x');
    writeFile(dir, 'node_modules/pkg/index.js', 'x');
    const res = await listDirectoryTool.execute({ path: '.', depth: 2 }, ctx());
    expect(res.content).toContain('src/');
    expect(res.content).toContain('index.ts');
    expect(res.content).not.toContain('node_modules');
  });
});

describe('glob', () => {
  it('finds files by pattern', async () => {
    dir = makeTempDir();
    writeFile(dir, 'src/a.ts', 'x');
    writeFile(dir, 'src/b.tsx', 'x');
    writeFile(dir, 'README.md', 'x');
    const res = await globTool.execute({ pattern: 'src/**/*.ts' }, ctx());
    expect(res.content).toContain('a.ts');
    expect(res.content).not.toContain('b.tsx');
    expect(res.content).not.toContain('README');
  });
});

describe('grep', () => {
  it('finds matching lines', { timeout: 60_000 }, async () => {
    dir = makeTempDir();
    writeFile(dir, 'src/a.ts', 'function authenticate() {}\nconst x = 1;\n');
    const res = await grepTool.execute({ query: 'authenticate' }, ctx());
    expect(res.content).toContain('authenticate');
    expect(res.content).toMatch(/a\.ts:1/);
  });

  it('respects case sensitivity option', { timeout: 60_000 }, async () => {
    dir = makeTempDir();
    writeFile(dir, 'a.txt', 'Hello\nhello\n');
    const ci = await grepTool.execute({ query: 'hello' }, ctx());
    const cs = await grepTool.execute({ query: 'hello', caseSensitive: true }, ctx());
    const ciCount = ci.content.split('\n').filter(Boolean).length;
    const csCount = cs.content.split('\n').filter(Boolean).length;
    expect(ciCount).toBeGreaterThan(csCount);
  });

  it('rejects invalid regex with a clear error', async () => {
    dir = makeTempDir();
    const res = await grepTool.execute({ query: '([unclosed' }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/Invalid regular expression/);
  });
});

describe('write_file', () => {
  it('creates files with parent directories', async () => {
    dir = makeTempDir();
    const res = await writeFileTool.execute({ path: 'deep/nested/new.ts', content: 'export const x = 1;\n' }, ctx());
    expect(res.isError).toBeFalsy();
    const res2 = await readFileTool.execute({ path: 'deep/nested/new.ts' }, ctx());
    expect(res2.content).toContain('export const x = 1;');
    expect(res.ui?.diff?.added).toBe(1);
  });

  it('refuses to overwrite without the flag', async () => {
    dir = makeTempDir();
    writeFile(dir, 'exists.ts', 'old');
    const res = await writeFileTool.execute({ path: 'exists.ts', content: 'new' }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/already exists/);
  });
});

describe('apply_patch tool', () => {
  it('patches a file and reports the diff', async () => {
    dir = makeTempDir();
    writeFile(dir, 'calc.ts', 'export function add(a: number, b: number) {\n  return a - b;\n}\n');
    const res = await applyPatchTool.execute(
      { path: 'calc.ts', edits: [{ old_text: 'return a - b;', new_text: 'return a + b;' }] },
      ctx(),
    );
    expect(res.isError).toBeFalsy();
    expect(res.ui?.diff?.added).toBe(1);
    expect(res.ui?.diff?.removed).toBe(1);
  });

  it('returns an error when anchor text is stale', async () => {
    dir = makeTempDir();
    writeFile(dir, 'calc.ts', 'const x = 1;\n');
    const res = await applyPatchTool.execute(
      { path: 'calc.ts', edits: [{ old_text: 'const y = 2;', new_text: 'const y = 3;' }] },
      ctx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not found/);
  });
});

describe('delete_path / move_path', () => {
  it('deletes a file', async () => {
    dir = makeTempDir();
    writeFile(dir, 'gone.txt', 'x');
    const res = await deletePathTool.execute({ path: 'gone.txt' }, ctx());
    expect(res.isError).toBeFalsy();
    const check = await readFileTool.execute({ path: 'gone.txt' }, ctx());
    expect(check.isError).toBe(true);
  });

  it('requires recursive for directories', async () => {
    dir = makeTempDir();
    writeFile(dir, 'sub/file.txt', 'x');
    const res = await deletePathTool.execute({ path: 'sub' }, ctx());
    expect(res.isError).toBe(true);
    const res2 = await deletePathTool.execute({ path: 'sub', recursive: true }, ctx());
    expect(res2.isError).toBeFalsy();
  });

  it('moves a file', async () => {
    dir = makeTempDir();
    writeFile(dir, 'old.ts', 'x');
    const res = await movePathTool.execute({ source: 'old.ts', destination: 'new.ts' }, ctx());
    expect(res.isError).toBeFalsy();
    const check = await readFileTool.execute({ path: 'new.ts' }, ctx());
    expect(check.isError).toBeFalsy();
  });
});

describe('bash', () => {
  it('captures stdout and exit code', async () => {
    dir = makeTempDir();
    const res = await bashTool.execute({ command: process.platform === 'win32' ? 'echo hello' : 'echo hello' }, ctx());
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('exit code: 0');
    expect(res.content).toContain('hello');
  });

  it('reports non-zero exit codes with stderr', async () => {
    dir = makeTempDir();
    const cmd = process.platform === 'win32' ? 'exit 3' : 'exit 3';
    const res = await bashTool.execute({ command: cmd }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toContain('exit code: 3');
  });

  it('times out long-running commands', async () => {
    dir = makeTempDir();
    const cmd = process.platform === 'win32' ? 'ping -n 10 127.0.0.1 >nul' : 'sleep 10';
    const res = await bashTool.execute({ command: cmd, timeout: 1500 }, ctx());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/timed out/);
  }, 15000);
});

describe('validateArgs', () => {
  it('parses valid JSON', () => {
    const res = validateArgs(readFileTool, '{"path":"a.ts"}');
    expect(res.ok).toBe(true);
  });
  it('rejects malformed JSON', () => {
    const res = validateArgs(readFileTool, '{bad json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Malformed JSON/);
  });
  it('rejects schema violations with field names', () => {
    const res = validateArgs(readFileTool, '{"path":42}');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/path/);
  });
});
