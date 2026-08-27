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
export const MASCOT = ['^__^ ', '(oo) ', '(__) '];
export const MASCOT_MINI = '(oo)';

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
} as const;
