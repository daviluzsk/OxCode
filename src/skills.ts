import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { userDataDir } from './utils/paths.js';
import { err, ok, type ToolDefinition, type ToolResult } from './tools/types.js';

/** A reusable skill: a SKILL.md file with optional YAML frontmatter. */
export interface Skill {
  name: string;
  description: string;
  /** Markdown body (frontmatter stripped) — what the agent follows. */
  body: string;
  /** Absolute path of the SKILL.md file. */
  file: string;
  scope: 'builtin' | 'user' | 'project';
}

/** Skills shipped with the package (<pkg>/skills/<name>/SKILL.md). */
const BUNDLED_SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

const MAX_BODY_CHARS = 30_000;

/**
 * Parse a minimal YAML frontmatter block (`---` fenced, `key: value` lines).
 * Only `name` and `description` are read; anything else is ignored.
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { meta, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { meta, body: normalized };
  const block = normalized.slice(4, end);
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2]!.trim();
    // strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[m[1]!] = value;
  }
  return { meta, body: normalized.slice(end + 4).replace(/^\n+/, '') };
}

function firstHeading(body: string): string | undefined {
  const m = body.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim();
}

function loadSkillsFromDir(dir: string, scope: Skill['scope']): Skill[] {
  const out: Skill[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const { meta, body } = parseFrontmatter(raw);
    const name = meta.name ?? entry.name;
    const description = meta.description ?? firstHeading(body) ?? '(no description)';
    out.push({ name, description, body: body.trim(), file, scope });
  }
  return out;
}

/**
 * Discover skills: bundled with the package, then user (~/.ox/skills),
 * then project (<cwd>/.ox/skills). Later scopes override by name:
 * project > user > builtin.
 */
export function discoverSkills(cwd: string): Skill[] {
  const byName = new Map<string, Skill>();
  for (const skill of loadSkillsFromDir(BUNDLED_SKILLS_DIR, 'builtin')) {
    byName.set(skill.name, skill);
  }
  for (const skill of loadSkillsFromDir(path.join(userDataDir(), 'skills'), 'user')) {
    byName.set(skill.name, skill);
  }
  for (const skill of loadSkillsFromDir(path.join(cwd, '.ox', 'skills'), 'project')) {
    byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One-line skill listing injected into the system prompt. */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.name} — ${s.description}`);
  return (
    '\n\n# Available Skills\n\n' +
    'Reusable skill packs are installed on this machine. When a task matches a skill, ' +
    'call the use_skill tool with its name to load the full instructions, then follow them.\n\n' +
    lines.join('\n')
  );
}

const useSkillSchema = z.object({
  name: z.string().min(1).describe('Name of the skill to load (see the Available Skills list).'),
});
type UseSkillArgs = z.infer<typeof useSkillSchema>;

/**
 * The use_skill tool: returns the full body of a discovered skill so the
 * agent can follow it. Registered only when at least one skill exists.
 */
export function createUseSkillTool(skills: Skill[]): ToolDefinition<UseSkillArgs> {
  const byName = new Map(skills.map((s) => [s.name, s]));
  return {
    name: 'use_skill',
    description:
      'Load a reusable skill pack by name. Returns the skill instructions which you must then follow. ' +
      'Available skills: ' +
      (skills.map((s) => s.name).join(', ') || '(none)'),
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name from the Available Skills list.' },
      },
      required: ['name'],
    },
    schema: useSkillSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `skill: ${a.name}`,
    async execute(args): Promise<ToolResult> {
      const skill = byName.get(args.name);
      if (!skill) {
        const available = skills.map((s) => `  - ${s.name} — ${s.description}`).join('\n') || '  (none)';
        return err(`Unknown skill "${args.name}". Available skills:\n${available}`);
      }
      let body = skill.body;
      if (body.length > MAX_BODY_CHARS) {
        body = body.slice(0, MAX_BODY_CHARS) + '\n\n[skill truncated — file too large]';
      }
      return ok(`# Skill: ${skill.name}\n(source: ${skill.file})\n\n${body}`, {
        kind: 'info',
        title: 'Skill',
        detail: skill.name,
      });
    },
  };
}
