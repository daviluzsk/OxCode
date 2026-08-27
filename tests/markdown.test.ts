import { describe, expect, it } from 'vitest';
import { parseInline } from '../src/ui/markdown.js';

describe('parseInline', () => {
  it('strips bold markers and flags the span', () => {
    expect(parseInline('**oi**')).toEqual([{ text: 'oi', bold: true }]);
    expect(parseInline('__ronaldo__')).toEqual([{ text: 'ronaldo', bold: true }]);
  });

  it('keeps surrounding text around emphasis', () => {
    expect(parseInline('hello **world** now')).toEqual([
      { text: 'hello ' },
      { text: 'world', bold: true },
      { text: ' now' },
    ]);
  });

  it('handles inline code and italic', () => {
    expect(parseInline('run `npm test` ok')).toEqual([
      { text: 'run ' },
      { text: 'npm test', code: true },
      { text: ' ok' },
    ]);
    expect(parseInline('this is *important*')).toEqual([
      { text: 'this is ' },
      { text: 'important', italic: true },
    ]);
  });

  it('does not treat mid-word asterisks or underscores as italic', () => {
    expect(parseInline('a_b_c')).toEqual([{ text: 'a_b_c' }]);
    expect(parseInline('2*3*4')).toEqual([{ text: '2*3*4' }]);
  });

  it('bold wins over italic on double markers', () => {
    expect(parseInline('**bold**')).toEqual([{ text: 'bold', bold: true }]);
  });

  it('leaves plain text untouched and handles empty input', () => {
    expect(parseInline('just text')).toEqual([{ text: 'just text' }]);
    expect(parseInline('')).toEqual([]);
  });
});
