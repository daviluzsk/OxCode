import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveConfig } from '../src/config/loader.js';
import { cleanup, makeTempDir, writeFile } from './helpers.js';

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

describe('config precedence', () => {
  it('applies defaults when nothing is set', () => {
    dir = makeTempDir();
    const cfg = resolveConfig({ cwd: dir, env: {}, userSettingsFile: path.join(dir, 'nope.json') });
    expect(cfg.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(cfg.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(cfg.permissionMode).toBe('default');
    expect(cfg.maxTurns).toBe(100);
  });

  it('env beats defaults; user config beats env; project beats user; CLI beats all', () => {
    dir = makeTempDir();
    const userFile = writeFile(dir, 'user.json', JSON.stringify({ model: 'user-model', maxTurns: 50 }));
    writeFile(dir, '.ox/settings.json', JSON.stringify({ model: 'project-model' }));
    writeFile(dir, '.ox/settings.local.json', JSON.stringify({ maxTurns: 77 }));

    const cfg = resolveConfig({
      cwd: dir,
      env: { OX_MODEL: 'env-model', OPENROUTER_API_KEY: 'sk-test' },
      userSettingsFile: userFile,
      cli: { model: 'cli-model' },
    });
    expect(cfg.model).toBe('cli-model');
    expect(cfg.maxTurns).toBe(77); // project local beats user(50)
    expect(cfg.apiKey).toBe('sk-test');
  });

  it('project settings.local.json overrides project settings.json', () => {
    dir = makeTempDir();
    writeFile(dir, '.ox/settings.json', JSON.stringify({ model: 'a' }));
    writeFile(dir, '.ox/settings.local.json', JSON.stringify({ model: 'b' }));
    const cfg = resolveConfig({ cwd: dir, env: {}, userSettingsFile: path.join(dir, 'none.json') });
    expect(cfg.model).toBe('b');
  });

  it('--dangerously-skip-permissions wins over everything', () => {
    dir = makeTempDir();
    const userFile = writeFile(dir, 'user.json', JSON.stringify({ permissionMode: 'plan' }));
    const cfg = resolveConfig({
      cwd: dir,
      env: {},
      userSettingsFile: userFile,
      cli: { dangerouslySkipPermissions: true, permissionMode: 'acceptEdits' },
    });
    expect(cfg.permissionMode).toBe('dangerouslySkipPermissions');
  });

  it('rejects malformed settings with a readable error', () => {
    dir = makeTempDir();
    const userFile = writeFile(dir, 'bad.json', '{ not json');
    expect(() => resolveConfig({ cwd: dir, env: {}, userSettingsFile: userFile })).toThrow(/Invalid JSON/);
  });

  it('rejects invalid settings schema with field details', () => {
    dir = makeTempDir();
    const userFile = writeFile(dir, 'bad2.json', JSON.stringify({ maxTurns: 'lots' }));
    expect(() => resolveConfig({ cwd: dir, env: {}, userSettingsFile: userFile })).toThrow(/maxTurns/);
  });
});
