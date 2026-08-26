import { describe, expect, it } from 'vitest';
import { formatCount, formatDuration } from '../src/utils/format.js';

describe('formatCount', () => {
  it('leaves sub-thousand values intact', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(42)).toBe('42');
    expect(formatCount(999)).toBe('999');
  });

  it('compacts thousands with one decimal, trimming .0', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1200)).toBe('1.2k');
    expect(formatCount(12_500)).toBe('12.5k');
    expect(formatCount(150_000)).toBe('150k');
  });

  it('compacts millions', () => {
    expect(formatCount(1_500_000)).toBe('1.5M');
    expect(formatCount(2_000_000)).toBe('2M');
  });

  it('guards against invalid input', () => {
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(NaN)).toBe('0');
  });
});

describe('formatDuration', () => {
  it('renders seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(8_200)).toBe('8s');
    expect(formatDuration(59_999)).toBe('59s');
  });

  it('renders minutes and seconds', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(95_000)).toBe('1m35s');
  });

  it('renders hours and minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(3_725_000)).toBe('1h2m');
  });

  it('clamps negatives to zero', () => {
    expect(formatDuration(-100)).toBe('0s');
  });
});
