import { describe, expect, it } from 'vitest';
import { isNvidiaModel, endpointFor } from '../src/api/models.js';
import { defaultConfig, NVIDIA_BASE_URL, type ResolvedConfig } from '../src/config/types.js';

const cfg = (over: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
  ...defaultConfig,
  cwd: '.',
  apiKey: 'sk-or',
  nvidiaApiKey: 'nvapi-k',
  ...over,
});

describe('model routing', () => {
  it('classifies NVIDIA-hosted models', () => {
    expect(isNvidiaModel('deepseek-ai/deepseek-v4-pro-0813')).toBe(true);
    expect(isNvidiaModel('deepseek-ai/deepseek-v4-flash-0731')).toBe(true);
    expect(isNvidiaModel('moonshotai/kimi-k3')).toBe(true);
    expect(isNvidiaModel('nvidia/nemotron-3-ultra-550b-a55b')).toBe(true);
    // OpenRouter ids (note the :free variant) are NOT NVIDIA
    expect(isNvidiaModel('nvidia/nemotron-3-ultra-550b-a55b:free')).toBe(false);
    expect(isNvidiaModel('z-ai/glm-5.2:free')).toBe(false);
    expect(isNvidiaModel('openrouter/auto')).toBe(false);
  });

  it('picks the NVIDIA endpoint + key for NVIDIA models', () => {
    const ep = endpointFor('deepseek-ai/deepseek-v4-pro-0813', cfg());
    expect(ep.baseUrl).toBe(NVIDIA_BASE_URL);
    expect(ep.apiKey).toBe('nvapi-k');
    expect(ep.keyName).toBe('NVIDIA');
  });

  it('picks the OpenRouter endpoint + key for everything else', () => {
    const ep = endpointFor('z-ai/glm-5.2:free', cfg({ baseUrl: 'https://openrouter.test/v1' }));
    expect(ep.baseUrl).toBe('https://openrouter.test/v1');
    expect(ep.apiKey).toBe('sk-or');
    expect(ep.keyName).toBe('OpenRouter');
  });
});
