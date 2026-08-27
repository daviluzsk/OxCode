import type { ResolvedConfig } from '../config/types.js';
import { missingApiKeyMessage } from './errors.js';
import { endpointFor, isNvidiaModel } from './models.js';
import { MockProvider } from './mock.js';
import { OpenRouterProvider } from './openrouter.js';
import type { ModelProvider } from './types.js';

export * from './types.js';
export * from './errors.js';
export { MockProvider } from './mock.js';
export { OpenRouterProvider } from './openrouter.js';
export { isNvidiaModel, NVIDIA_MODELS, endpointFor } from './models.js';
export type { MockTurn } from './mock.js';

/** Build a provider from resolved configuration. */
export function createProvider(config: ResolvedConfig): ModelProvider {
  if (config.provider === 'mock') {
    return MockProvider.explorer();
  }
  // Need at least one credential; the per-model router below picks the right one.
  if (!config.apiKey && !config.nvidiaApiKey) {
    throw new Error(missingApiKeyMessage());
  }
  return new OpenRouterProvider({
    apiKey: config.apiKey ?? '',
    baseUrl: config.baseUrl,
    // Route each request to NVIDIA or OpenRouter based on the model id,
    // reading the keys from config at call time (so /model + first-run
    // key prompts take effect without rebuilding the provider).
    route: (model) => (isNvidiaModel(model) ? endpointFor(model, config) : null),
  });
}
