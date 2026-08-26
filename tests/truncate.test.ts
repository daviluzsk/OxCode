import { describe, expect, it } from 'vitest';
import { estimateTokens, truncateLines, truncateMiddle } from '../src/utils/truncate.js';

describe('truncateMiddle', () => {
  it('keeps short text intact', () => {
    expect(truncateMiddle('hello', { maxChars: 100 }).truncated).toBe(false);
  });

  it('keeps head and tail with a marker for long text', () => {
    const text = 'A'.repeat(5000) + 'MIDDLE' + 'Z'.repeat(5000);
    const { text: out, truncated } = truncateMiddle(text, { maxChars: 1000 });
    expect(truncated).toBe(true);
    expect(out.startsWith('AAAA')).toBe(true);
    expect(out.endsWith('ZZZZ')).toBe(true);
    expect(out).toMatch(/characters truncated/);
    expect(out.length).toBeLessThan(1200);
  });
});

describe('truncateLines', () => {
  it('truncates by line count', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const { text: out, truncated, totalLines } = truncateLines(text, 20);
    expect(truncated).toBe(true);
    expect(totalLines).toBe(100);
    expect(out).toContain('line 0');
    expect(out).toContain('line 99');
    expect(out).toMatch(/lines truncated/);
  });
});

describe('estimateTokens', () => {
  it('approximates 4 chars per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
