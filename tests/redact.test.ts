import { describe, expect, it } from 'vitest';
import { maskKey, redactSecrets } from '../src/utils/redact.js';

describe('redactSecrets', () => {
  it('redacts OpenRouter keys', () => {
    const out = redactSecrets('key is sk-or-v1-abcdef1234567890abcdef ok');
    expect(out).not.toContain('abcdef1234567890abcdef');
    expect(out).toContain('sk-or-***');
  });

  it('redacts bearer tokens', () => {
    const out = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
    expect(out).toContain('Bearer ***');
  });

  it('redacts key=value secrets', () => {
    const out = redactSecrets('api_key = "supersecretvalue123"');
    expect(out).not.toContain('supersecretvalue123');
  });

  it('redacts PEM private keys', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----';
    expect(redactSecrets(pem)).toBe('[REDACTED PRIVATE KEY]');
  });

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('const x = 42;')).toBe('const x = 42;');
  });
});

describe('maskKey', () => {
  it('shows only the last 4 characters', () => {
    expect(maskKey('sk-or-1234567890abcdef')).toBe('***cdef');
  });
  it('handles missing keys', () => {
    expect(maskKey(undefined)).toBe('(not set)');
  });
});
