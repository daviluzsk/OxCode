/**
 * Provider-neutral model message/event types.
 * Follows the OpenAI-compatible chat completions shape, which OpenRouter
 * (and most compatible providers) speak.
 */

export interface ImageContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export interface TextContentPart {
  type: 'text';
  text: string;
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Raw JSON string of arguments, exactly as produced by the model. */
  argumentsJson: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ContentPart[] | null;
  tool_calls?: ToolCallRequest[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface ModelRequest {
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  /** Max tokens to generate; omitted = provider default. */
  maxTokens?: number;
  temperature?: number;
  /** Reasoning effort for reasoning-capable models (provider-dependent). */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'cancelled' | 'error' | 'unknown';

export type ModelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; call: ToolCallRequest }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'done'; finishReason: FinishReason }
  | { type: 'error'; error: Error };

/** Generic provider abstraction — any OpenAI-compatible endpoint works. */
export interface ModelProvider {
  readonly name: string;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

/** Result of collecting a full streamed turn. */
export interface CollectedResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  usage?: UsageInfo;
  finishReason: FinishReason;
}

/** Convenience: drain a provider stream into a complete response. */
export async function collectStream(
  events: AsyncIterable<ModelEvent>,
  onTextDelta?: (text: string) => void,
  onReasoning?: (text: string) => void,
): Promise<CollectedResponse> {
  let text = '';
  const toolCalls: ToolCallRequest[] = [];
  let usage: UsageInfo | undefined;
  let finishReason: FinishReason = 'unknown';
  for await (const ev of events) {
    switch (ev.type) {
      case 'text-delta':
        text += ev.text;
        onTextDelta?.(ev.text);
        break;
      case 'reasoning':
        onReasoning?.(ev.text);
        break;
      case 'tool-call':
        toolCalls.push(ev.call);
        break;
      case 'usage':
        usage = ev.usage;
        break;
      case 'done':
        finishReason = ev.finishReason;
        break;
      case 'error':
        throw ev.error;
    }
  }
  return { text, toolCalls, usage, finishReason };
}
