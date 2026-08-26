import path from 'node:path';

/**
 * Sensitive-file detector. Files matching these patterns must never be
 * sent to the model merely because they exist in the repository.
 */

const SENSITIVE_BASENAMES = new Set([
  '.env',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials.json',
  'credentials',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'service-account.json',
]);

const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /\.jks$/i,
  /^\.?ssh(\/|\\)/i,
  /_rsa$/i,
  /_ed25519$/i,
  /\.secret$/i,
  /^\.git-credentials$/i,
];

export function isSensitivePath(p: string): boolean {
  const base = path.basename(p);
  if (SENSITIVE_BASENAMES.has(base.toLowerCase())) return true;
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(base)) return true;
  }
  // anything under a .ssh directory
  const norm = p.split(path.sep).join('/');
  if (/(^|\/)\.ssh\//.test(norm)) return true;
  return false;
}

/** Allow-list for obviously non-secret env templates. */
export function isAllowedEnvTemplate(p: string): boolean {
  const base = path.basename(p).toLowerCase();
  return (
    base === '.env.example' ||
    base === '.env.sample' ||
    base === '.env.template' ||
    base === '.env.defaults'
  );
}

/** Final policy check used by file-reading tools. */
export function isBlockedFromModel(p: string): boolean {
  if (isAllowedEnvTemplate(p)) return false;
  return isSensitivePath(p);
}
