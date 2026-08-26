import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/tools/applyPatch.js';

describe('applyEdits', () => {
  it('replaces a block', () => {
    const src = 'const a = 1;\nconst b = 2;\n';
    const res = applyEdits(src, [{ old_text: 'const b = 2;', new_text: 'const b = 3;' }]);
    expect(res).toEqual({ ok: true, text: 'const a = 1;\nconst b = 3;\n', applied: 1 });
  });

  it('deletes a block with empty new_text', () => {
    const res = applyEdits('a\nb\nc\n', [{ old_text: 'b\n', new_text: '' }]);
    expect(res.ok && res.text).toBe('a\nc\n');
  });

  it('inserts by anchoring on context', () => {
    const res = applyEdits('function f() {\n}\n', [{ old_text: 'function f() {\n}', new_text: 'function f() {\n  return 1;\n}' }]);
    expect(res.ok && res.text).toContain('return 1;');
  });

  it('applies multiple edits in sequence', () => {
    const res = applyEdits('a=1\nb=2\n', [
      { old_text: 'a=1', new_text: 'a=10' },
      { old_text: 'b=2', new_text: 'b=20' },
    ]);
    expect(res.ok && res.text).toBe('a=10\nb=20\n');
  });

  it('fails with a useful error when anchor text is missing', () => {
    const res = applyEdits('hello', [{ old_text: 'goodbye', new_text: 'x' }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.reason).toMatch(/not found/);
  });

  it('fails on ambiguous anchor text', () => {
    const res = applyEdits('x\nx\n', [{ old_text: 'x', new_text: 'y' }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.reason).toMatch(/occurs 2 times/);
  });

  it('supports occurrence=all', () => {
    const res = applyEdits('x\nx\n', [{ old_text: 'x', new_text: 'y', occurrence: 'all' }]);
    expect(res.ok && res.text).toBe('y\ny\n');
  });

  it('rejects empty old_text', () => {
    const res = applyEdits('abc', [{ old_text: '', new_text: 'y' }]);
    expect(res.ok).toBe(false);
  });

  it('rejects no-op edits', () => {
    const res = applyEdits('abc', [{ old_text: 'b', new_text: 'b' }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.reason).toMatch(/identical/);
  });
});
