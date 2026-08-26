import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, nullHooks } from '../src/agent/loop.js';
import { TodoStore } from '../src/agent/todo.js';
import { MockProvider } from '../src/api/index.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import { PermissionManager } from '../src/permissions/manager.js';
import { Session } from '../src/sessions/store.js';
import { createBuiltinRegistry } from '../src/tools/index.js';
import type { ToolDefinition } from '../src/tools/types.js';
import { cleanup, makeTempDir } from './helpers.js';

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

/** A fake screenshot tool that returns an image in its result. */
const fakeShotTool: ToolDefinition<Record<string, never>> = {
  name: 'fake_shot',
  description: 'test tool returning an image',
  parameters: { type: 'object', properties: {} },
  schema: z.object({}).strict(),
  kind: 'read',
  mutating: false,
  summarize: () => 'shot',
  async execute() {
    return {
      content: 'screenshot taken',
      images: [{ data: 'QUJD', mimeType: 'image/jpeg' }],
    };
  },
};

function hasImagePart(messages: Array<{ content?: unknown }>): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p: { type?: string }) => p.type === 'image_url'),
  );
}

describe('tool result images (transient vision)', () => {
  it('delivers images on the next request only, never persisted', async () => {
    dir = makeTempDir();
    const config: ResolvedConfig = { ...defaultConfig, cwd: dir, apiKey: undefined, compactThreshold: 1_000_000 };
    const provider = new MockProvider([
      { toolCalls: [{ name: 'fake_shot', arguments: {} }] },
      { toolCalls: [{ name: 'list_directory', arguments: { path: '.' } }] },
      { text: 'I saw the image and finished.' },
    ]);
    const registry = createBuiltinRegistry(new TodoStore());
    registry.register(fakeShotTool);
    const permissions = new PermissionManager('default', async () => 'yes');
    const session = new Session(dir, config.model);
    const agent = new Agent({ provider, config, registry, permissions, session, systemPrompt: 't', hooks: nullHooks });

    const result = await agent.run('look at the page');
    expect(result.status).toBe('completed');

    // Request #1: original conversation — no images.
    expect(hasImagePart(provider.requests[0]!.messages)).toBe(false);

    // Request #2 (after fake_shot): transient user message with the image.
    const req2 = provider.requests[1]!.messages;
    const last = req2[req2.length - 1]!;
    expect(last.role).toBe('user');
    expect(hasImagePart([last])).toBe(true);
    const parts = last.content as Array<{ type: string; image_url?: { url: string } }>;
    const img = parts.find((p) => p.type === 'image_url')!;
    expect(img.image_url!.url).toBe('data:image/jpeg;base64,QUJD');

    // Request #3 (after the read tool): image message already cleared.
    expect(hasImagePart(provider.requests[2]!.messages)).toBe(false);

    // Session on disk never holds image parts.
    expect(hasImagePart(session.messages)).toBe(false);
    expect(result.finalText).toBe('I saw the image and finished.');
  });
});
