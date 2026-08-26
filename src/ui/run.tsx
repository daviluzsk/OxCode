import React from 'react';
import { render } from 'ink';
import type { Runtime } from '../runtime.js';
import { App } from './App.js';

/** Mount the interactive TUI. Returns when the user exits. */
export async function runInteractive(runtime: Runtime, startWithResumePicker: boolean): Promise<void> {
  // Ctrl+C is handled inside the app (interrupt vs. exit), so disable Ink's default.
  const instance = render(<App runtime={runtime} startWithResumePicker={startWithResumePicker} />, {
    exitOnCtrlC: false,
  });
  await instance.waitUntilExit();
  // Never leave the terminal in a broken state.
  if (process.stdout.isTTY) {
    process.stdout.write('[?25h'); // show cursor
  }
}
