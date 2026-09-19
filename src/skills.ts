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
  const authoring =
    'You can also author your OWN skills with create_skill: when you work out a procedure worth reusing ' +
    '(a recon/exploit workflow, a build or deploy recipe, a debugging routine), save it as a skill so you ' +
    'can reload it with use_skill later instead of re-deriving it.';
  if (skills.length === 0) {
    return `\n\n# Skills\n\nNo skills are installed yet. ${authoring}`;
  }
  const lines = skills.map((s) => `- ${s.name} — ${s.description}`);
  return (
    '\n\n# Available Skills\n\n' +
    'Reusable skill packs are installed on this machine. When a task matches a skill, ' +
    'call the use_skill tool with its name to load the full instructions, then follow them. ' +
    authoring +
    '\n\n' +
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
export function createUseSkillTool(cwd: string, skills: Skill[]): ToolDefinition<UseSkillArgs> {
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
      // Merge the skills known at startup with a live re-discovery, so a skill
      // the agent just wrote with create_skill is usable in the same session.
      const byName = new Map<string, Skill>();
      for (const s of skills) byName.set(s.name, s);
      for (const s of discoverSkills(cwd)) byName.set(s.name, s);
      const skill = byName.get(args.name);
      if (!skill) {
        const available = [...byName.values()].map((s) => `  - ${s.name} — ${s.description}`).join('\n') || '  (none)';
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

const createSkillSchema = z.object({
  name: z.string().min(2).max(48).describe('kebab-case skill name, e.g. "aws-recon" or "jwt-attacks".'),
  description: z.string().min(4).max(200).describe('One line: what the skill is for and when to use it (used for discovery).'),
  body: z.string().min(20).describe('The skill instructions in Markdown — the reusable playbook the agent will follow when it loads this skill.'),
});
type CreateSkillArgs = z.infer<typeof createSkillSchema>;

/**
 * Lets the agent author a reusable skill for itself. Writes
 * <cwd>/.ox/skills/<name>/SKILL.md (project scope); it's immediately loadable
 * with use_skill and appears in future sessions' Available Skills.
 */
export function createSkillTool(cwd: string): ToolDefinition<CreateSkillArgs> {
  return {
    name: 'create_skill',
    description:
      'Author a reusable skill for yourself — a named Markdown playbook saved to .ox/skills/<name>/SKILL.md. ' +
      'Use it to capture a procedure you had to work out (a recon workflow, an exploit chain, a build/deploy ' +
      'recipe) so you can reload it with use_skill next time instead of re-deriving it. Overwrites a project ' +
      'skill of the same name.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'kebab-case skill name.' },
        description: { type: 'string', description: 'One line: what it is and when to use it.' },
        body: { type: 'string', description: 'The skill instructions in Markdown.' },
      },
      required: ['name', 'description', 'body'],
    },
    schema: createSkillSchema,
    kind: 'write',
    mutating: true,
    summarize: (a) => `create skill: ${a.name}`,
    async execute(args): Promise<ToolResult> {
      const name = args.name.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(name)) {
        return err('Invalid skill name. Use lowercase letters, digits and hyphens (2–48 chars), e.g. "web-cache-poisoning".');
      }
      const dir = path.join(cwd, '.ox', 'skills', name);
      const file = path.join(dir, 'SKILL.md');
      const existed = fs.existsSync(file);
      const desc = args.description.replace(/\r?\n/g, ' ').trim();
      const content = `---\nname: ${name}\ndescription: ${desc}\n---\n\n${args.body.trim()}\n`;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
      } catch (e) {
        return err(`Could not write the skill: ${(e as Error).message}`);
      }
      return ok(
        `${existed ? 'Updated' : 'Created'} skill "${name}" → ${file}\nLoad it any time with use_skill name="${name}".`,
        { kind: 'info', title: 'create_skill', detail: name },
      );
    },
  };
}
