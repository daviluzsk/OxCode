/**
 * Intelligent truncation for tool output: keep the beginning and the end,
 * mark the elided region, so error context at both ends survives.
 */

export interface TruncateOptions {
  maxChars: number;
  /** Fraction of the budget given to the head (rest to the tail). */
  headRatio?: number;
}

export function truncateMiddle(text: string, opts: TruncateOptions): { text: string; truncated: boolean } {
  const { maxChars } = opts;
  if (text.length <= maxChars) return { text, truncated: false };
  const headRatio = opts.headRatio ?? 0.6;
  const head = Math.floor(maxChars * headRatio);
  const tail = maxChars - head;
  const elided = text.length - head - tail;
  const marker = `\n… [${elided.toLocaleString()} characters truncated] …\n`;
  return { text: text.slice(0, head) + marker + text.slice(text.length - tail), truncated: true };
}

/** Truncate by lines, keeping head and tail lines. */
export function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean; totalLines: number } {
  const lines = text.split('\n');
  const totalLines = lines.length;
  if (totalLines <= maxLines) return { text, truncated: false, totalLines };
  const headCount = Math.ceil(maxLines * 0.7);
  const tailCount = maxLines - headCount;
  const elided = totalLines - headCount - tailCount;
  const out = [
    ...lines.slice(0, headCount),
    `… [${elided.toLocaleString()} lines truncated] …`,
    ...lines.slice(totalLines - tailCount),
  ];
  return { text: out.join('\n'), truncated: true, totalLines };
}

/** Rough token estimate: ~4 characters per token for mixed code/prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
