export type ApiErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'client'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'invalid-response'
  | 'unknown';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
    readonly retriable: boolean = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromStatus(status: number, body: string, retryAfterMs?: number): ApiError {
    const snippet = body.length > 500 ? body.slice(0, 500) + '…' : body;
    switch (status) {
      case 400:
        return new ApiError(`Bad request (400). The request may be malformed or too large. ${snippet}`, 'client', status, false);
      case 401:
        return new ApiError('Authentication failed (401). Check your API key.', 'auth', status, false);
      case 403:
        return new ApiError(`Access denied (403). Your key may lack permission for this model. ${snippet}`, 'auth', status, false);
      case 404:
        return new ApiError(`Not found (404). The model or endpoint may not exist. ${snippet}`, 'client', status, false);
      case 408:
        return new ApiError('Request timeout (408).', 'timeout', status, true);
      case 409:
        return new ApiError('Conflict (409). Retrying may help.', 'server', status, true);
      case 429:
        return new ApiError('Rate limited (429).', 'rate-limit', status, true, retryAfterMs);
      case 503:
      case 529:
        return new ApiError(`Service overloaded (${status}) — backing off.`, 'rate-limit', status, true, retryAfterMs);
      default:
        if (status >= 500) {
          return new ApiError(`Provider server error (${status}). ${snippet}`, 'server', status, true, retryAfterMs);
        }
        return new ApiError(`Unexpected HTTP ${status}. ${snippet}`, 'unknown', status, false);
    }
  }

  static network(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof Error && err.name === 'AbortError') {
      return new ApiError('Request cancelled.', 'cancelled', undefined, false);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new ApiError(`Network error: ${msg}`, 'network', undefined, true);
  }
}

export function missingApiKeyMessage(): string {
  return [
    'No API key found.',
    '',
    'Set OPENROUTER_API_KEY before launching OxCode:',
    '',
    'PowerShell:',
    '  $env:OPENROUTER_API_KEY="..."',
    '',
    'cmd:',
    '  set OPENROUTER_API_KEY=...',
    '',
    'bash/zsh:',
    '  export OPENROUTER_API_KEY="..."',
    '',
    'Alternatively set apiKey in ~/.ox/settings.json (user-level config).',
  ].join('\n');
}
