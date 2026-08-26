/**
 * Secret redaction for logs, diagnostics and tool output that may be
 * echoed back. Never print full API keys.
 */

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // OpenRouter / generic sk- keys
  { re: /\bsk-or-[A-Za-z0-9_\-]{8,}\b/g, label: 'sk-or-***' },
  { re: /\bsk-[A-Za-z0-9_\-]{16,}\b/g, label: 'sk-***' },
  // Bearer tokens
  { re: /(Bearer\s+)[A-Za-z0-9_\-.]{12,}/gi, label: '$1***' },
  // AWS-style access keys
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AKIA***' },
  // PEM private keys
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: '[REDACTED PRIVATE KEY]' },
  // key=value style secrets
  { re: /\b(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret|password|passwd)\b(\s*[:=]\s*)("?)[^\s"']{8,}("?)/gi, label: '$1$2$3***$4' },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, label);
  }
  return out;
}

/** Mask a key for display: show only the last 4 chars. */
export function maskKey(key: string | undefined | null): string {
  if (!key) return '(not set)';
  if (key.length <= 8) return '***';
  return `***${key.slice(-4)}`;
}

/** True when the string looks like it contains an unredacted secret. */
export function containsSecret(input: string): boolean {
  return SECRET_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(input);
  });
}
