import fs from 'node:fs';
import path from 'node:path';

const MAX_INSTRUCTION_CHARS = 24_000;
const UPWARD_LEVELS = 5;

export interface InstructionSource {
  file: string;
  content: string;
}

/**
 * Load repository instruction files with deterministic precedence:
 *   1. ./OX.md
 *   2. ./.ox/instructions.md
 *   3. ./AGENTS.md
 *   4. OX.md / AGENTS.md in parent directories (up to 5 levels)
 * All found files are merged in that order and truncated to a budget.
 */
export function loadInstructions(cwd: string): InstructionSource[] {
  const sources: InstructionSource[] = [];
  const tryAdd = (file: string) => {
    try {
      const content = fs.readFileSync(file, 'utf8').trim();
      if (content) sources.push({ file, content });
    } catch {
      /* not present */
    }
  };

  tryAdd(path.join(cwd, 'OX.md'));
  tryAdd(path.join(cwd, '.ox', 'instructions.md'));
  tryAdd(path.join(cwd, 'AGENTS.md'));

  let dir = path.dirname(cwd);
  for (let i = 0; i < UPWARD_LEVELS; i++) {
    tryAdd(path.join(dir, 'OX.md'));
    tryAdd(path.join(dir, 'AGENTS.md'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // enforce total budget
  let total = 0;
  const bounded: InstructionSource[] = [];
  for (const s of sources) {
    if (total >= MAX_INSTRUCTION_CHARS) break;
    const room = MAX_INSTRUCTION_CHARS - total;
    const content = s.content.length > room ? s.content.slice(0, room) + '\n[instructions truncated]' : s.content;
    total += content.length;
    bounded.push({ file: s.file, content });
  }
  return bounded;
}

export function formatInstructions(sources: InstructionSource[], cwd: string): string {
  if (sources.length === 0) return '';
  const parts = sources.map((s) => {
    const rel = path.relative(cwd, s.file) || s.file;
    return `--- ${rel} ---\n${s.content}`;
  });
  return `\n\n# Project Instructions\n\nThe following repository instruction files must be respected:\n\n${parts.join('\n\n')}`;
}
