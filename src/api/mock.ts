import type { ModelEvent, ModelProvider, ModelRequest, ToolCallRequest } from './types.js';

/** One scripted model turn: some text plus optional tool calls. */
export interface MockTurn {
  text?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** When true, the mock "crashes" with a retriable error once. */
  failOnce?: { status: number; message: string };
}

/**
 * Deterministic scripted provider for tests and development.
 * Each stream() call consumes the next scripted turn; when the script is
 * exhausted it returns a generic final answer so loops always terminate.
 */
export class MockProvider implements ModelProvider {
  readonly name = 'mock';
  private turns: MockTurn[];
  readonly requests: ModelRequest[] = [];
  private failOnceUsed = 0;

  constructor(turns: MockTurn[]) {
    this.turns = [...turns];
  }

  /** A mock that always asks for one read then finishes — handy for dogfooding. */
  static explorer(): MockProvider {
    return new MockProvider([
      { text: 'Let me look around.', toolCalls: [{ name: 'list_directory', arguments: { path: '.' } }] },
      { text: 'Done exploring. This is a mock response.' },
    ]);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (request.signal?.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    this.requests.push(request);
    const turn = this.turns.shift() ?? { text: 'Mock final answer.' };

    if (turn.failOnce) {
      this.failOnceUsed++;
      const { ApiError } = await import('./errors.js');
      yield {
        type: 'error',
        error: ApiError.fromStatus(turn.failOnce.status, turn.failOnce.message),
      };
      return;
    }

    if (turn.text) {
      // Stream text in small chunks to exercise delta handling.
      const words = turn.text.split(/(?<=\s)/);
      for (const w of words) {
        yield { type: 'text-delta', text: w };
      }
    }
    if (turn.toolCalls) {
      const calls: ToolCallRequest[] = turn.toolCalls.map((c, i) => ({
        id: `mock_call_${this.requests.length}_${i}`,
        name: c.name,
        argumentsJson: JSON.stringify(c.arguments),
      }));
      for (const call of calls) yield { type: 'tool-call', call };
      yield {
        type: 'usage',
        usage: { inputTokens: 100, outputTokens: 20 },
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } };
    yield { type: 'done', finishReason: 'stop' };
  }
}
