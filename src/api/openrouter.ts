import { ApiError } from './errors.js';
import { SseParser } from './sse.js';
import type {
  ChatMessage,
  FinishReason,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ToolCallRequest,
  UsageInfo,
} from './types.js';
import { logger } from '../utils/logger.js';

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl: string;
  /** Referer / title headers for OpenRouter rankings (optional). */
  siteUrl?: string;
  appName?: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  /** Optional per-model endpoint router (e.g. NVIDIA vs OpenRouter). */
  route?: (model: string) => { baseUrl: string; apiKey: string | undefined; keyName?: string } | null;
}

interface RawToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** Assembles streamed tool-call deltas into complete calls. */
class ToolCallAssembler {
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();

  feed(deltas: RawToolCallDelta[]): void {
    for (const d of deltas) {
      const index = d.index ?? 0;
      let entry = this.calls.get(index);
      if (!entry) {
        entry = { id: '', name: '', args: '' };
        this.calls.set(index, entry);
      }
      if (d.id) entry.id = d.id;
      if (d.function?.name) entry.name += d.function.name;
      if (d.function?.arguments) entry.args += d.function.arguments;
    }
  }

  complete(): ToolCallRequest[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, c], n) => ({
        id: c.id || `call_${Date.now()}_${n}`,
        name: c.name,
        argumentsJson: c.args || '{}',
      }))
      .filter((c) => c.name.length > 0);
  }
}

/** Convert internal message shape to the OpenAI wire format. */
export function toWireMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role };
  if (m.content !== undefined) out.content = m.content;
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  if (m.name) out.name = m.name;
  if (m.tool_calls) {
    out.tool_calls = m.tool_calls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.argumentsJson },
    }));
  }
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ApiError('Request cancelled.', 'cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Abort a stream that goes silent for too long (a hung provider connection).
 * Configurable via OX_STREAM_TIMEOUT_MS; read at call time so it stays testable. */
function streamIdleMs(): number {
  const v = Number(process.env.OX_STREAM_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 200 ? v : 120_000;
}

function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 60_000);
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  return base * (0.5 + Math.random() * 0.5); // jitter
}

/**
 * OpenRouter provider using the OpenAI-compatible chat completions API
 * with SSE streaming. Works with any OpenAI-compatible base URL.
 */
export class OpenRouterProvider implements ModelProvider {
  readonly name = 'openrouter';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly siteUrl?: string;
  private readonly appName: string;
  private readonly maxRetries: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly route?: OpenRouterOptions['route'];

  constructor(options: OpenRouterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.siteUrl = options.siteUrl;
    this.appName = options.appName ?? 'OxCode';
    this.maxRetries = options.maxRetries ?? 4;
    this.fetchImpl = options.fetchImpl;
    this.route = options.route;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const fetchImpl = this.fetchImpl ?? fetch;
    let lastError: ApiError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (request.signal?.aborted) {
        yield { type: 'error', error: new ApiError('Request cancelled.', 'cancelled') };
        return;
      }
      try {
        yield* this.streamOnce(fetchImpl, request);
        return;
      } catch (err) {
        const apiErr = ApiError.network(err);
        if (apiErr.kind === 'cancelled') {
          yield { type: 'error', error: apiErr };
          return;
        }
        lastError = apiErr;
        logger.log('api.retry', { attempt, kind: apiErr.kind, status: apiErr.status });
        if (!apiErr.retriable || attempt === this.maxRetries) break;
        await sleep(backoffMs(attempt, apiErr.retryAfterMs), request.signal);
      }
    }
    yield { type: 'error', error: lastError ?? new ApiError('Unknown provider failure.', 'unknown') };
  }

  private async *streamOnce(fetchImpl: typeof fetch, request: ModelRequest): AsyncGenerator<ModelEvent> {
    // When a route matches, use ITS endpoint+key exclusively (do not fall back
    // to the default key, or we'd send the wrong provider's key).
    const ep = this.route?.(request.model) ?? null;
    const baseUrl = ep ? ep.baseUrl : this.baseUrl;
    const apiKey = ep ? ep.apiKey : this.apiKey;
    if (!apiKey) {
      throw new ApiError(
        `No ${ep?.keyName ?? 'API'} key set for model "${request.model}". Set the ${ep?.keyName ?? 'API'} key (e.g. nvidiaApiKey in ~/.ox/settings.json or the NVIDIA_API_KEY env var).`,
        'auth',
        undefined,
        false,
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (this.siteUrl) headers['HTTP-Referer'] = this.siteUrl;
    if (this.appName) headers['X-Title'] = this.appName;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toWireMessage),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.reasoningEffort) body.reasoning = { effort: request.reasoningEffort };

    logger.log('api.request', { model: request.model, messages: request.messages.length });

    // Idle watchdog: abort the request if the provider sends nothing for too
    // long (connection hangs open with no bytes and no [DONE] → "Thinking…"
    // forever). Linked to the user's cancel signal so Ctrl+C still works.
    const ac = new AbortController();
    const userSignal = request.signal;
    const onUserAbort = () => ac.abort();
    if (userSignal) {
      if (userSignal.aborted) ac.abort();
      else userSignal.addEventListener('abort', onUserAbort, { once: true });
    }
    let timedOut = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, streamIdleMs());
    };
    const idleCleanup = () => {
      if (idle) clearTimeout(idle);
      idle = undefined;
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
    };
    const wrapErr = (err: unknown): ApiError =>
      timedOut
        ? new ApiError(`Model stream stalled — no data for ${Math.round(streamIdleMs() / 1000)}s. Retrying.`, 'timeout', undefined, true)
        : ApiError.network(err);

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    let response: Response;
    bump();
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (err) {
      idleCleanup();
      throw wrapErr(err);
    }

    if (!response.ok) {
      idleCleanup();
      const retryAfter = response.headers.get('retry-after');
      const text = await response.text().catch(() => '');
      throw ApiError.fromStatus(
        response.status,
        text,
        retryAfter ? Number(retryAfter) * 1000 : undefined,
      );
    }

    if (!response.body) {
      idleCleanup();
      throw new ApiError('Provider returned an empty response body.', 'invalid-response');
    }

    const parser = new SseParser();
    const assembler = new ToolCallAssembler();
    const decoder = new TextDecoder();
    let finishReason: FinishReason = 'unknown';
    let emittedAny = false;

    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        bump(); // got activity — reset the idle watchdog
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const event of parser.feed(chunk)) {
          if (event.data.trim() === '[DONE]') continue;
          for await (const ev of this.handleChunk(event.data, assembler, (r) => (finishReason = r))) {
            emittedAny = true;
            yield ev;
          }
        }
      }
      for (const event of parser.flush()) {
        if (event.data.trim() === '[DONE]') continue;
        for await (const ev of this.handleChunk(event.data, assembler, (r) => (finishReason = r))) {
          emittedAny = true;
          yield ev;
        }
      }
    } catch (err) {
      const wrapped = wrapErr(err);
      if (emittedAny) {
        // Content already delivered — surface as an error event, do not retry
        // (avoids duplicating the partial output on a stall/network drop).
        yield { type: 'error', error: wrapped };
        return;
      }
      throw wrapped;
    } finally {
      idleCleanup();
      reader.releaseLock();
    }

    for (const call of assembler.complete()) {
      yield { type: 'tool-call', call };
    }
    if (request.signal?.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield { type: 'done', finishReason };
  }

  private async *handleChunk(
    data: string,
    assembler: ToolCallAssembler,
    setFinish: (r: FinishReason) => void,
  ): AsyncGenerator<ModelEvent> {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      // Malformed chunk — skip it rather than killing the stream.
      logger.log('api.malformed-chunk', { preview: data.slice(0, 120) });
      return;
    }
    const obj = json as {
      choices?: Array<{
        delta?: { content?: string | null; tool_calls?: RawToolCallDelta[] };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      error?: { message?: string };
    };

    if (obj.error?.message) {
      yield { type: 'error', error: new ApiError(`Provider error: ${obj.error.message}`, 'server', undefined, true) };
      return;
    }

    const choice = obj.choices?.[0];
    if (choice?.delta?.content) {
      yield { type: 'text-delta', text: choice.delta.content };
    }
    if (choice?.delta?.tool_calls) {
      assembler.feed(choice.delta.tool_calls);
    }
    if (choice?.finish_reason) {
      const r = choice.finish_reason;
      setFinish(r === 'stop' || r === 'tool_calls' || r === 'length' ? r : 'unknown');
    }
    if (obj.usage) {
      const usage: UsageInfo = {
        inputTokens: obj.usage.prompt_tokens ?? 0,
        outputTokens: obj.usage.completion_tokens ?? 0,
        cachedTokens: obj.usage.prompt_tokens_details?.cached_tokens,
      };
      yield { type: 'usage', usage };
    }
  }
}
