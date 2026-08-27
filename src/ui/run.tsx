import React from 'react';
import { render } from 'ink';
import type { Runtime } from '../runtime.js';
import { App } from './App.js';

/** Mount the interactive TUI. Returns when the user exits. */
export async function runInteractive(runtime: Runtime, startWithResumePicker: boolean): Promise<void> {
  // Ctrl+C is handled inside the app (interrupt vs. exit), so disable Ink's default.
  // `clearScreen` lets the app wipe the terminal (e.g. entering Mr Robot mode) so
  // the previous static output (the OxCode header) is gone, not just scrolled up.
  const holder: { clear: () => void } = { clear: () => {} };
  const instance = render(
    <App runtime={runtime} startWithResumePicker={startWithResumePicker} clearScreen={() => holder.clear()} />,
    { exitOnCtrlC: false },
  );
  holder.clear = () => {
    if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear screen + scrollback
    instance.clear(); // reset Ink's static output so it reprints fresh
  };
  await instance.waitUntilExit();
  // Never leave the terminal in a broken state.
  if (process.stdout.isTTY) {
    process.stdout.write('[?25h'); // show cursor
  }
}
