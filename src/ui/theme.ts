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

/** Big block "MR ROBOT" banner shown when fsociety mode engages. */
export const FSOCIETY_BANNER = [
  '',
  '  ███╗   ███╗██████╗     ██████╗  ██████╗ ██████╗  ██████╗ ████████╗',
  '  ████╗ ████║██╔══██╗    ██╔══██╗██╔═══██╗██╔══██╗██╔═══██╗╚══██╔══╝',
  '  ██╔████╔██║██████╔╝    ██████╔╝██║   ██║██████╔╝██║   ██║   ██║   ',
  '  ██║╚██╔╝██║██╔══██╗    ██╔══██╗██║   ██║██╔══██╗██║   ██║   ██║   ',
  '  ██║ ╚═╝ ██║██║  ██║    ██║  ██║╚██████╔╝██████╔╝╚██████╔╝   ██║   ',
  '  ╚═╝     ╚═╝╚═╝  ╚═╝    ╚═╝  ╚═╝ ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝   ',
  '',
  '  [ fsociety ]  control is an illusion.',
  '',
  '  [+] encrypted channel established',
  '  [+] root access granted',
  '  [+] Hello, friend.',
  '',
];

/** ASCII fallback banner when the terminal can't render box-drawing glyphs. */
export const FSOCIETY_BANNER_ASCII = [
  '',
  '  #     # ######      ######  #######  ######  #######  #######',
  '  ##   ## #     #     #     # #     #  #     # #     #     #   ',
  '  # # # # ######      ######  #     #  ######  #     #     #   ',
  '  #  #  # #    #      #   #   #     #  #     # #     #     #   ',
  '  #     # #     #     #    #  #######  ######  #######     #   ',
  '',
  '  [ fsociety ]  control is an illusion.',
  '  [+] encrypted channel established   [+] Hello, friend.',
  '',
];

/** The fsociety banner for this terminal (box-drawing, or ASCII fallback). */
export function fsocietyBanner(): string[] {
  return ascii ? FSOCIETY_BANNER_ASCII : FSOCIETY_BANNER;
}

// Back-compat exports (some components import these names).
export const MASCOT = brand.mascot;
export const MASCOT_MINI = brand.mascotMini;
