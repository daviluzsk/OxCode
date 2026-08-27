import { afterEach, describe, expect, it } from 'vitest';
import { checkForUpdate, isGitClone, isWorkingTreeClean } from '../src/updater.js';
import { cleanup, makeTempDir } from './helpers.js';

let dir = '';
afterEach(() => { if (dir) cleanup(dir); dir = ''; });

describe('updater', () => {
  it('reports a plain directory is not a git clone', async () => {
    dir = makeTempDir();
    expect(await isGitClone(dir)).toBe(false);
    expect(await isWorkingTreeClean(dir)).toBe(false);
  });

  it('returns null (no auto-update) outside a git clone', async () => {
    dir = makeTempDir();
    expect(await checkForUpdate(dir)).toBeNull();
  });

  it('detects the project checkout as a git clone', async () => {
    // the repo root of this test run is a git clone
    expect(await isGitClone(process.cwd())).toBe(true);
  });
});
