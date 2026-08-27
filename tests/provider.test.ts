import { describe, expect, it } from 'vitest';
import { ApiError, collectStream, OpenRouterProvider } from '../src/api/index.js';

/** Build a minimal SSE streaming response. */
function sseResponse(events: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) controller.enqueue(enc.encode(`data: ${e}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

const textChunk = (text: string) =>
  JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] });
const doneChunk = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
const usageChunk = JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } });

describe('OpenRouterProvider (mocked fetch)', () => {
  it('streams text deltas, finish reason and usage', async () => {
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async () => sseResponse([textChunk('Hello'), textChunk(' world'), doneChunk, usageChunk]),
    });
    const deltas: string[] = [];
    const res = await collectStream(
      provider.stream({ model: 'stealth/ox-alpha', messages: [], tools: [] }),
      (d) => deltas.push(d),
    );
    expect(res.text).toBe('Hello world');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 4, cachedTokens: undefined });
    expect(deltas).toEqual(['Hello', ' world']);
  });

  it('assembles streamed tool calls', async () => {
    const chunks = [
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path"' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"a.ts"}' } }] } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ];
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async () => sseResponse(chunks),
    });
    const res = await collectStream(provider.stream({ model: 'm', messages: [], tools: [] }));
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toEqual({ id: 'call_1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' });
    expect(res.finishReason).toBe('tool_calls');
  });

  it('skips malformed chunks without killing the stream', async () => {
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async () => sseResponse(['{broken json', textChunk('ok'), doneChunk]),
    });
    const res = await collectStream(provider.stream({ model: 'm', messages: [], tools: [] }));
    expect(res.text).toBe('ok');
  });

  it('retries a 429 then succeeds (rate limit recovery)', async () => {
    let attempts = 0;
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      maxRetries: 2,
      fetchImpl: async () => {
        attempts++;
        if (attempts === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
        return sseResponse([textChunk('recovered'), doneChunk]);
      },
    });
    const res = await collectStream(provider.stream({ model: 'm', messages: [], tools: [] }));
    expect(attempts).toBe(2);
    expect(res.text).toBe('recovered');
  });

  it('aborts a stalled stream instead of hanging forever', async () => {
    const prev = process.env.OX_STREAM_TIMEOUT_MS;
    process.env.OX_STREAM_TIMEOUT_MS = '250';
    try {
      // fetch resolves, but the body never sends a byte — like a hung provider.
      // The mock honors the abort signal (as real fetch does) so the watchdog
      // can cancel the read.
      const provider = new OpenRouterProvider({
        apiKey: 'sk-test',
        baseUrl: 'https://example.test/v1',
        maxRetries: 0,
        fetchImpl: async (_url, init) => {
          const signal = (init as RequestInit).signal;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
              // otherwise: never enqueue, never close → stalled
            },
          });
          return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        },
      });
      const start = Date.now();
      await expect(collectStream(provider.stream({ model: 'm', messages: [], tools: [] }))).rejects.toThrow(/stall|timed|timeout/i);
      expect(Date.now() - start).toBeLessThan(3000); // did not hang
    } finally {
      if (prev === undefined) delete process.env.OX_STREAM_TIMEOUT_MS;
      else process.env.OX_STREAM_TIMEOUT_MS = prev;
    }
  }, 6000);

  it('does not retry auth failures and gives a useful error', async () => {
    let attempts = 0;
    const provider = new OpenRouterProvider({
      apiKey: 'sk-bad',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async () => {
        attempts++;
        return new Response('invalid key', { status: 401 });
      },
    });
    await expect(collectStream(provider.stream({ model: 'm', messages: [], tools: [] }))).rejects.toThrow(ApiError);
    expect(attempts).toBe(1);
  });

  it('gives up after bounded retries on persistent 500s', async () => {
    let attempts = 0;
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      maxRetries: 2,
      fetchImpl: async () => {
        attempts++;
        return new Response('server on fire', { status: 500 });
      },
    });
    await expect(collectStream(provider.stream({ model: 'm', messages: [], tools: [] }))).rejects.toThrow(/500/);
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it('sends the Authorization header and model in the request body', async () => {
    let seenAuth = '';
    let seenBody = '';
    const provider = new OpenRouterProvider({
      apiKey: 'sk-secret-1234',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async (_url, init) => {
        seenAuth = (init?.headers as Record<string, string>)['Authorization'] ?? '';
        seenBody = String(init?.body ?? '');
        return sseResponse([textChunk('x'), doneChunk]);
      },
    });
    await collectStream(provider.stream({ model: 'stealth/ox-alpha', messages: [{ role: 'user', content: 'hi' }], tools: [] }));
    expect(seenAuth).toBe('Bearer sk-secret-1234');
    expect(seenBody).toContain('"model":"stealth/ox-alpha"');
    expect(seenBody).toContain('"stream":true');
  });
});

describe('wire format', () => {
  it('serializes internal tool_calls into OpenAI function-call shape', async () => {
    let seenBody = '';
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async (_url, init) => {
        seenBody = String(init?.body ?? '');
        return sseResponse([textChunk('ok'), doneChunk]);
      },
    });
    await collectStream(
      provider.stream({
        model: 'm',
        messages: [
          { role: 'user', content: 'fix it' },
          {
            role: 'assistant',
            content: 'reading',
            tool_calls: [{ id: 'c1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' }],
          },
          { role: 'tool', tool_call_id: 'c1', name: 'read_file', content: 'file contents' },
        ],
        tools: [],
      }),
    );
    const body = JSON.parse(seenBody) as { messages: Array<Record<string, unknown>> };
    const assistant = body.messages[1]!;
    expect(assistant.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
    ]);
    expect(assistant).not.toHaveProperty('argumentsJson');
    const tool = body.messages[2]!;
    expect(tool).toMatchObject({ role: 'tool', tool_call_id: 'c1', name: 'read_file' });
  });
});

describe('reasoning effort', () => {
  it('sends reasoning.effort in the request body when configured', async () => {
    let seenBody = '';
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async (_url, init) => {
        seenBody = String(init?.body ?? '');
        return sseResponse([textChunk('ok'), doneChunk]);
      },
    });
    await collectStream(
      provider.stream({ model: 'm', messages: [], tools: [], reasoningEffort: 'high' }),
    );
    expect(JSON.parse(seenBody)).toMatchObject({ reasoning: { effort: 'high' } });
  });

  it('omits reasoning when effort is not set', async () => {
    let seenBody = '';
    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async (_url, init) => {
        seenBody = String(init?.body ?? '');
        return sseResponse([textChunk('ok'), doneChunk]);
      },
    });
    await collectStream(provider.stream({ model: 'm', messages: [], tools: [] }));
    expect(JSON.parse(seenBody)).not.toHaveProperty('reasoning');
  });
});
