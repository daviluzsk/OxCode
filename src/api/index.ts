import type { ResolvedConfig } from '../config/types.js';
import { missingApiKeyMessage } from './errors.js';
import { MockProvider } from './mock.js';
import { OpenRouterProvider } from './openrouter.js';
import type { ModelProvider } from './types.js';

export * from './types.js';
export * from './errors.js';
export { MockProvider } from './mock.js';
export { OpenRouterProvider } from './openrouter.js';
export type { MockTurn } from './mock.js';

/** Build a provider from resolved configuration. */
export function createProvider(config: ResolvedConfig): ModelProvider {
  if (config.provider === 'mock') {
    return MockProvider.explorer();
  }
  if (!config.apiKey) {
    throw new Error(missingApiKeyMessage());
  }
  return new OpenRouterProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}
