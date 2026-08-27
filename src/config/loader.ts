import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import {
  defaultConfig,
  ReasoningEffortSchema,
  SettingsFileSchema,
  type PermissionMode,
  type ReasoningEffort,
  type ResolvedConfig,
  type SettingsFile,
} from './types.js';
import { userSettingsPath } from '../utils/paths.js';

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** CLI overrides coming from argument parsing. */
export interface CliOverrides {
  model?: string;
  baseUrl?: string;
  permissionMode?: PermissionMode;
  reasoningEffort?: ReasoningEffort;
  dangerouslySkipPermissions?: boolean;
  pentest?: boolean;
  maxTurns?: number;
}

function readSettingsFile(file: string): SettingsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ConfigError(`Cannot read settings file: ${(err as Error).message}`, file);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Invalid JSON in settings file: ${(err as Error).message}`, file);
  }
  try {
    return SettingsFileSchema.parse(json);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new ConfigError(`Invalid settings file:\n${issues}`, file);
    }
    throw err;
  }
}

/**
 * Resolve configuration with deterministic precedence:
 *   CLI arguments → project config → user config → environment → defaults
 */
export function resolveConfig(opts: {
  cwd: string;
  cli?: CliOverrides;
  env?: NodeJS.ProcessEnv;
  userSettingsFile?: string;
}): ResolvedConfig {
  const env = opts.env ?? process.env;
  const cli = opts.cli ?? {};

  const userFile = opts.userSettingsFile ?? userSettingsPath();
  const userSettings = readSettingsFile(userFile);
  const projectSettings = readSettingsFile(path.join(opts.cwd, '.ox', 'settings.json'));
  const localSettings = readSettingsFile(path.join(opts.cwd, '.ox', 'settings.local.json'));

  // project config: settings.json then settings.local.json (local wins)
  const project: SettingsFile = { ...projectSettings, ...localSettings };

  const permissionMode: PermissionMode =
    (cli.dangerouslySkipPermissions ? 'dangerouslySkipPermissions' : undefined) ??
    cli.permissionMode ??
    project.permissionMode ??
    userSettings.permissionMode ??
    defaultConfig.permissionMode;

  const envEffort = ReasoningEffortSchema.safeParse(env.OX_EFFORT);
  const reasoningEffort: ReasoningEffort | undefined =
    cli.reasoningEffort ??
    project.reasoningEffort ??
    userSettings.reasoningEffort ??
    (envEffort.success ? envEffort.data : undefined);

  const providerEnv = env.OX_PROVIDER;
  const provider =
    project.provider ??
    userSettings.provider ??
    (providerEnv === 'mock' || providerEnv === 'openrouter' ? providerEnv : undefined) ??
    defaultConfig.provider;

  const apiKey =
    project.apiKey ?? userSettings.apiKey ?? env.OPENROUTER_API_KEY ?? env.OX_API_KEY ?? undefined;
  const nvidiaApiKey =
    project.nvidiaApiKey ?? userSettings.nvidiaApiKey ?? env.NVIDIA_API_KEY ?? env.OX_NVIDIA_API_KEY ?? undefined;

  return {
    cwd: opts.cwd,
    model: cli.model ?? project.model ?? userSettings.model ?? env.OX_MODEL ?? defaultConfig.model,
    provider,
    baseUrl: cli.baseUrl ?? project.baseUrl ?? userSettings.baseUrl ?? env.OX_BASE_URL ?? defaultConfig.baseUrl,
    apiKey,
    nvidiaApiKey,
    permissionMode,
    reasoningEffort,
    appendSystemPrompt: project.appendSystemPrompt ?? userSettings.appendSystemPrompt,
    pentest: cli.pentest ?? project.pentest ?? userSettings.pentest ?? defaultConfig.pentest,
    maxTurns: cli.maxTurns ?? project.maxTurns ?? userSettings.maxTurns ?? defaultConfig.maxTurns,
    stream: project.stream ?? userSettings.stream ?? defaultConfig.stream,
    compactThreshold:
      project.compactThreshold ?? userSettings.compactThreshold ?? defaultConfig.compactThreshold,
    ignore: [...defaultConfig.ignore, ...(userSettings.ignore ?? []), ...(project.ignore ?? [])],
  };
}
