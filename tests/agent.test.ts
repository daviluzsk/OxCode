import { afterEach, describe, expect, it } from 'vitest';
import { Agent, nullHooks } from '../src/agent/loop.js';
import { TodoStore } from '../src/agent/todo.js';
import { MockProvider, type MockTurn } from '../src/api/index.js';
import { defaultConfig, type ResolvedConfig } from '../src/config/types.js';
import { PermissionManager, type ApprovalResponse } from '../src/permissions/manager.js';
import { Session } from '../src/sessions/store.js';
import { createBuiltinRegistry } from '../src/tools/index.js';
import { cleanup, makeTempDir, readFile, writeFile } from './helpers.js';

let dir = '';
afterEach(() => {
  if (dir) cleanup(dir);
  dir = '';
});

function makeAgent(turns: MockTurn[], opts?: { approve?: ApprovalResponse; maxTurns?: number }) {
  const config: ResolvedConfig = {
    ...defaultConfig,
    cwd: dir,
    apiKey: undefined,
    maxTurns: opts?.maxTurns ?? 20,
    compactThreshold: 1_000_000,
  };
  const provider = new MockProvider(turns);
  const registry = createBuiltinRegistry(new TodoStore());
  const permissions = new PermissionManager('default', async () => opts?.approve ?? 'yes');
  const session = new Session(dir, config.model);
  const agent = new Agent({
    provider,
    config,
    registry,
    permissions,
    session,
    systemPrompt: 'You are a test agent.',
    hooks: nullHooks,
  });
  return { agent, session, provider };
}

describe('agent loop (mocked provider)', () => {
  it('Scenario 1: read_file then final answer', async () => {
    dir = makeTempDir();
    writeFile(dir, 'hello.txt', 'hi there\n');
    const { agent, session } = makeAgent([
      { text: 'Let me read it.', toolCalls: [{ name: 'read_file', arguments: { path: 'hello.txt' } }] },
      { text: 'The file says hi.' },
    ]);
    const result = await agent.run('what is in hello.txt?');
    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('The file says hi.');
    const toolMsg = session.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(String(toolMsg!.content)).toContain('hi there');
  });

  it('Scenario 2: read → patch → bash in one user request', async () => {
    dir = makeTempDir();
    writeFile(dir, 'calc.ts', 'export const add = (a: number, b: number) => a - b;\n');
    const { agent } = makeAgent([
      { toolCalls: [{ name: 'read_file', arguments: { path: 'calc.ts' } }] },
      { toolCalls: [{ name: 'apply_patch', arguments: { path: 'calc.ts', edits: [{ old_text: 'a - b', new_text: 'a + b' }] } }] },
      { toolCalls: [{ name: 'bash', arguments: { command: process.platform === 'win32' ? 'type calc.ts' : 'cat calc.ts' } }] },
      { text: 'Fixed and verified.' },
    ]);
    const result = await agent.run('fix add()');
    expect(result.status).toBe('completed');
    expect(readFile(dir, 'calc.ts')).toContain('a + b');
  });

  it('Scenario 3: tool failure is reported back and the model recovers', async () => {
    dir = makeTempDir();
    writeFile(dir, 'real.ts', 'content\n');
    const { agent, session } = makeAgent([
      { toolCalls: [{ name: 'read_file', arguments: { path: 'missing.ts' } }] },
      { toolCalls: [{ name: 'read_file', arguments: { path: 'real.ts' } }] },
      { text: 'Recovered.' },
    ]);
    const result = await agent.run('read the file');
    expect(result.status).toBe('completed');
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    expect(String(toolMsgs[0]!.content)).toMatch(/not found/);
    expect(String(toolMsgs[1]!.content)).toContain('content');
  });

  it('Scenario 4: malformed tool call JSON is fed back as an error', async () => {
    dir = makeTempDir();
    const config: ResolvedConfig = { ...defaultConfig, cwd: dir, apiKey: undefined };
    const registry = createBuiltinRegistry(new TodoStore());
    const permissions = new PermissionManager('default', async () => 'yes');
    const badSession = new Session(dir, config.model);

    // A provider that emits a tool call with broken JSON arguments once,
    // then (on the next turn) a plain final answer.
    let calls = 0;
    const badProvider: import('../src/api/index.js').ModelProvider = {
      name: 'bad-json',
      async *stream() {
        calls++;
        if (calls === 1) {
          yield { type: 'tool-call' as const, call: { id: 'c1', name: 'read_file', argumentsJson: '{oops' } };
          yield { type: 'done' as const, finishReason: 'tool_calls' as const };
        } else {
          yield { type: 'text-delta' as const, text: 'Recovered after fixing arguments.' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
        }
      },
    };
    const bad = new Agent({
      provider: badProvider,
      config,
      registry,
      permissions,
      session: badSession,
      systemPrompt: 't',
      hooks: nullHooks,
    });
    const result = await bad.run('do something');
    expect(result.status).toBe('completed');
    const toolMsg = badSession.messages.find((m) => m.role === 'tool');
    expect(String(toolMsg!.content)).toMatch(/Malformed JSON/);
  });

  it('Scenario 5: denied permission reaches the model as a tool error', async () => {
    dir = makeTempDir();
    const { agent, session } = makeAgent(
      [
        { toolCalls: [{ name: 'bash', arguments: { command: 'rm -rf build' } }] },
        { text: 'Understood, I will not delete anything.' },
      ],
      { approve: 'no' },
    );
    const result = await agent.run('clean the build dir');
    expect(result.status).toBe('completed');
    const toolMsg = session.messages.find((m) => m.role === 'tool');
    expect(String(toolMsg!.content)).toMatch(/Permission denied/);
  });

  it('Scenario 6: provider error ends the run with status error', async () => {
    dir = makeTempDir();
    const { agent } = makeAgent([{ failOnce: { status: 500, message: 'boom' } }]);
    const result = await agent.run('hi');
    expect(result.status).toBe('error');
    expect(result.errorText).toMatch(/500/);
  });

  it('stops at max turns', async () => {
    dir = makeTempDir();
    writeFile(dir, 'a.txt', 'x\n');
    const { agent } = makeAgent(
      Array.from({ length: 10 }, () => ({ toolCalls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] })),
      { maxTurns: 3 },
    );
    const result = await agent.run('loop forever');
    expect(result.status).toBe('max-turns');
  });

  it('tracks token usage from the provider', async () => {
    dir = makeTempDir();
    const { agent, session } = makeAgent([{ text: 'done' }]);
    await agent.run('hi');
    expect(session.data.usage.requests).toBe(1);
    expect(session.data.usage.inputTokens).toBeGreaterThan(0);
  });
});
