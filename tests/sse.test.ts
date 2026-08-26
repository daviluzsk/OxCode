import { describe, expect, it } from 'vitest';
import { SseParser } from '../src/api/sse.js';
import { ApiError, collectStream, MockProvider } from '../src/api/index.js';

describe('SseParser', () => {
  it('parses complete events', () => {
    const p = new SseParser();
    const events = p.feed('data: {"a":1}\n\ndata: {"b":2}\n\n');
    expect(events).toHaveLength(2);
    expect(events[0]!.data).toBe('{"a":1}');
  });

  it('handles chunks split mid-event', () => {
    const p = new SseParser();
    expect(p.feed('data: {"a":')).toHaveLength(0);
    expect(p.feed('1}\n\n')).toHaveLength(1);
  });

  it('joins multi-line data fields', () => {
    const p = new SseParser();
    const events = p.feed('data: line1\ndata: line2\n\n');
    expect(events[0]!.data).toBe('line1\nline2');
  });

  it('ignores comments and event fields', () => {
    const p = new SseParser();
    const events = p.feed(': comment\nevent: message\ndata: x\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('x');
  });

  it('handles CRLF line endings', () => {
    const p = new SseParser();
    expect(p.feed('data: a\r\n\r\ndata: b\r\n\r\n')).toHaveLength(2);
  });
});

describe('MockProvider', () => {
  it('streams text then done', async () => {
    const provider = new MockProvider([{ text: 'hello world' }]);
    const deltas: string[] = [];
    const res = await collectStream(provider.stream({ model: 'm', messages: [], tools: [] }), (d) => deltas.push(d));
    expect(res.text).toBe('hello world');
    expect(res.finishReason).toBe('stop');
    expect(deltas.length).toBeGreaterThan(1);
  });

  it('emits tool calls with finishReason tool_calls', async () => {
    const provider = new MockProvider([{ toolCalls: [{ name: 'read_file', arguments: { path: 'a.ts' } }] }]);
    const res = await collectStream(provider.stream({ model: 'm', messages: [], tools: [] }));
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.name).toBe('read_file');
    expect(JSON.parse(res.toolCalls[0]!.argumentsJson)).toEqual({ path: 'a.ts' });
    expect(res.finishReason).toBe('tool_calls');
  });

  it('failOnce produces a retriable error', async () => {
    const provider = new MockProvider([{ failOnce: { status: 429, message: 'slow down' } }]);
    const it = provider.stream({ model: 'm', messages: [], tools: [] })[Symbol.asyncIterator]();
    const ev = await it.next();
    expect(ev.value.type).toBe('error');
    if (ev.value.type === 'error') {
      expect(ev.value.error).toBeInstanceOf(ApiError);
      expect((ev.value.error as ApiError).retriable).toBe(true);
    }
  });
});
