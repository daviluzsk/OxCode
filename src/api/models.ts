import { NVIDIA_BASE_URL, ABLITERATION_BASE_URL } from '../config/types.js';
import type { ResolvedConfig } from '../config/types.js';

/**
 * Models hosted on NVIDIA NIM (integrate.api.nvidia.com). These route to the
 * NVIDIA endpoint with the NVIDIA API key; everything else goes to the
 * configured OpenRouter base URL with the OpenRouter key.
 *
 * Explicit ids (not prefixes) so the OpenRouter Nemotron `:free` variant used as
 * the default is not accidentally routed to NVIDIA.
 */
export const NVIDIA_MODELS = new Set<string>([
  'deepseek-ai/deepseek-v4-pro-0813',
  'deepseek-ai/deepseek-v4-flash-0731',
  'moonshotai/kimi-k3',
  'moonshotai/kimi-k2.6',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-nano-30b-a3b',
]);

export function isNvidiaModel(model: string): boolean {
  return NVIDIA_MODELS.has(model);
}

/**
 * Uncensored models hosted by abliteration.ai (OpenAI-compatible). Routed to
 * their endpoint with the abliteration key. Matched by the `abliterated-` prefix
 * so new variants work without a code change.
 */
export function isAbliterationModel(model: string): boolean {
  return /^abliterated-/.test(model);
}

export interface Endpoint {
  baseUrl: string;
  apiKey: string | undefined;
  /** Which key is required for this endpoint, for clearer error messages. */
  keyName: 'OpenRouter' | 'NVIDIA' | 'Abliteration';
}

/** Resolve which endpoint + key a given model should use. */
export function endpointFor(model: string, config: ResolvedConfig): Endpoint {
  if (isNvidiaModel(model)) {
    return { baseUrl: NVIDIA_BASE_URL, apiKey: config.nvidiaApiKey, keyName: 'NVIDIA' };
  }
  if (isAbliterationModel(model)) {
    return { baseUrl: ABLITERATION_BASE_URL, apiKey: config.abliterationApiKey, keyName: 'Abliteration' };
  }
  return { baseUrl: config.baseUrl, apiKey: config.apiKey, keyName: 'OpenRouter' };
}
