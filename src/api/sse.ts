/**
 * Incremental Server-Sent-Events parser for streaming chat completions.
 * Tolerates malformed lines and split chunks.
 */

export interface SseEvent {
  data: string;
}

export class SseParser {
  private buffer = '';

  /** Feed a decoded text chunk; returns complete events. */
  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    // SSE events are separated by blank lines.
    let idx: number;
    while ((idx = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawEvent = this.buffer.slice(0, idx);
      const match = this.buffer.slice(idx).match(/^\r?\n\r?\n/);
      this.buffer = this.buffer.slice(idx + (match ? match[0].length : 2));
      const dataLines: string[] = [];
      for (const line of rawEvent.split(/\r?\n/)) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        // ignore event:, id:, retry: and comments
      }
      if (dataLines.length > 0) {
        events.push({ data: dataLines.join('\n') });
      }
    }
    return events;
  }

  /** Flush any trailing partial event at end of stream. */
  flush(): SseEvent[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest.startsWith('data:')) {
      return [{ data: rest.slice(5).replace(/^ /, '') }];
    }
    return [];
  }
}
