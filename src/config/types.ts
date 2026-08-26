import { z } from 'zod';

export const PermissionModeSchema = z.enum([
  'default',
  'askAll',
  'acceptEdits',
  'plan',
  'dangerouslySkipPermissions',
]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const OutputFormatSchema = z.enum(['text', 'json', 'stream-json']);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/** Settings file schema (~/.ox/settings.json, .ox/settings.json). */
export const SettingsFileSchema = z
  .object({
    model: z.string().optional(),
    provider: z.enum(['openrouter', 'mock']).optional(),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    permissionMode: PermissionModeSchema.optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    /** Custom instructions appended to the system prompt. */
    appendSystemPrompt: z.string().optional(),
    /** Pentest mode: security-testing methodology guidance in the system prompt. */
    pentest: z.boolean().optional(),
    maxTurns: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
    /** Token budget at which automatic compaction kicks in. */
    compactThreshold: z.number().int().positive().optional(),
    /** Extra file/directory ignore patterns (gitignore syntax). */
    ignore: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })
  .strict();
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

/** Fully-resolved runtime configuration. */
export interface ResolvedConfig {
  model: string;
  provider: 'openrouter' | 'mock';
  baseUrl: string;
  apiKey: string | undefined;
  permissionMode: PermissionMode;
  reasoningEffort: ReasoningEffort | undefined;
  appendSystemPrompt: string | undefined;
  pentest: boolean;
  maxTurns: number;
  stream: boolean;
  compactThreshold: number;
  ignore: string[];
  cwd: string;
}

export const DEFAULT_MODEL = 'stealth/ox-alpha';
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MAX_TURNS = 100;
export const DEFAULT_COMPACT_THRESHOLD = 120_000;

export const defaultConfig: Omit<ResolvedConfig, 'cwd' | 'apiKey'> = {
  model: DEFAULT_MODEL,
  provider: 'openrouter',
  baseUrl: DEFAULT_BASE_URL,
  permissionMode: 'default',
  reasoningEffort: undefined,
  appendSystemPrompt: undefined,
  pentest: false,
  maxTurns: DEFAULT_MAX_TURNS,
  stream: true,
  compactThreshold: DEFAULT_COMPACT_THRESHOLD,
  ignore: [],
};
