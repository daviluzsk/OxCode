/** Terminal symbols with ASCII fallback (OX_ASCII=1 or dumb terminal). */

const ascii = process.env.OX_ASCII === '1' || process.env.TERM === 'dumb';

export const symbols = {
  working: ascii ? '*' : '●',
  success: ascii ? 'v' : '✓',
  failure: ascii ? 'x' : '✗',
  warning: ascii ? '!' : '⚠',
  bullet: ascii ? '-' : '•',
  prompt: ascii ? '>' : '❯',
  arrow: ascii ? '->' : '→',
  nested: ascii ? 'L' : '↳',
  ellipsis: '…',
  boxTL: ascii ? '+' : '╭',
  boxTR: ascii ? '+' : '╮',
  boxBL: ascii ? '+' : '╰',
  boxBR: ascii ? '+' : '╯',
  boxH: ascii ? '-' : '─',
  boxV: ascii ? '|' : '│',
};

/**
 * OxCode mascot — a little ox ("Oxxy"). Pure ASCII so it renders in any
 * terminal. Two lines: horns/ears over an eyed face with a snout.
 */
const OX_MASCOT = ['^__^ ', '(oo) ', '(__) '];
const FSOCIETY_MASCOT = ['.----. ', '|o  o| ', '| <> | ', "'----' "];

/** Live colors — mutated by applyTheme() so /mrrobot can repaint the UI. */
export const colors = {
  accent: 'cyan',
  dim: 'gray',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  add: 'green',
  del: 'red',
  toolName: 'cyan',
  user: 'white',
};

/** Live brand + mascot — swapped by applyTheme(). */
export const brand = {
  name: 'OxCode',
  tagline: 'Nemotron-powered coding agent — and offensive-security workbench',
  mascot: OX_MASCOT,
  mascotMini: '(oo)',
};

export type ThemeMode = 'ox' | 'mrrobot';

/** Repaint the UI for a theme. `mrrobot` = red fsociety hacker look. */
export function applyTheme(mode: ThemeMode): void {
  if (mode === 'mrrobot') {
    colors.accent = 'redBright';
    colors.toolName = 'redBright';
    colors.user = 'redBright';
    brand.name = 'Mr Robot';
    brand.tagline = 'fsociety // control is an illusion';
    brand.mascot = FSOCIETY_MASCOT;
    brand.mascotMini = '[><]';
  } else {
    colors.accent = 'cyan';
    colors.toolName = 'cyan';
    colors.user = 'white';
    brand.name = 'OxCode';
    brand.tagline = 'Nemotron-powered coding agent — and offensive-security workbench';
    brand.mascot = OX_MASCOT;
    brand.mascotMini = '(oo)';
  }
}

/** Big banner shown when toggling fsociety mode. */
export const FSOCIETY_BANNER = [
  '███  fsociety  ███',
  '  M R   R O B O T  ',
  "  Hello, friend.   ",
];

// Back-compat exports (some components import these names).
export const MASCOT = brand.mascot;
export const MASCOT_MINI = brand.mascotMini;
