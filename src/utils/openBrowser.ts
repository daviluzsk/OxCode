import { spawn } from 'node:child_process';

/**
 * Best-effort "open this URL in the default browser".
 * Returns true if a launcher process was started (not a guarantee it showed).
 * Never throws — a headless box or missing opener just returns false.
 */
export function openInBrowser(url: string): boolean {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      // `start` is a cmd builtin; the empty "" is the window title argument.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}
