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
