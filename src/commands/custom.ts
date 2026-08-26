import fs from 'node:fs';
import path from 'node:path';

export interface CustomCommand {
  name: string;
  description: string;
  /** Markdown body; $ARGUMENTS is replaced with the invocation arguments. */
  body: string;
  file: string;
}

/** Load user-defined commands from .ox/commands/<name>.md */
export function loadCustomCommands(cwd: string): Map<string, CustomCommand> {
  const dir = path.join(cwd, '.ox', 'commands');
  const out = new Map<string, CustomCommand>();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      const name = f.replace(/\.md$/, '');
      const firstLine = body.split('\n')[0]?.trim() ?? '';
      const description = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : `Custom command: ${name}`;
      out.set(name, { name, description, body, file: path.join(dir, f) });
    } catch {
      /* skip unreadable command */
    }
  }
  return out;
}

/** Expand a custom command into a prompt for the agent. */
export function expandCustomCommand(cmd: CustomCommand, args: string): string {
  const substituted = cmd.body.replaceAll('$ARGUMENTS', args);
  return `${substituted}\n\n[Invoked via custom command /${cmd.name}${args ? ` with arguments: ${args}` : ''}]`;
}
