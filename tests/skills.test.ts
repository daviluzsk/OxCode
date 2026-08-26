import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUseSkillTool, discoverSkills, formatSkillsForPrompt } from '../src/skills.js';

let tmp: string;
let fakeHome: string;
let origHome: string | undefined;

function writeSkill(root: string, name: string, content: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ox-skills-'));
  fakeHome = path.join(tmp, 'home');
  fs.mkdirSync(fakeHome, { recursive: true });
  origHome = process.env.USERPROFILE;
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('discoverSkills', () => {
  it('finds project skills with frontmatter', () => {
    const project = path.join(tmp, 'proj');
    writeSkill(
      path.join(project, '.ox', 'skills'),
      'review',
      '---\nname: review\ndescription: Senior code review checklist\n---\n\n# Review\n\nCheck these things.',
    );
    const skills = discoverSkills(project);
    const review = skills.find((s) => s.name === 'review');
    expect(review).toMatchObject({
      name: 'review',
      description: 'Senior code review checklist',
      scope: 'project',
    });
    expect(review!.body).toContain('# Review');
    expect(review!.body).not.toContain('---');
    // bundled skills are always present
    expect(skills.some((s) => s.scope === 'builtin')).toBe(true);
  });

  it('finds user skills and lets project override by name', () => {
    const project = path.join(tmp, 'proj');
    writeSkill(path.join(fakeHome, '.ox', 'skills'), 'shared', '# Old\n\nuser version');
    writeSkill(path.join(project, '.ox', 'skills'), 'shared', '# New\n\nproject version');
    writeSkill(path.join(fakeHome, '.ox', 'skills'), 'only-user', '# Solo\n\nuser only');
    const skills = discoverSkills(project);
    const named = skills.filter((s) => s.name === 'shared' || s.name === 'only-user');
    expect(named).toHaveLength(2);
    const shared = skills.find((s) => s.name === 'shared')!;
    expect(shared.scope).toBe('project');
    expect(shared.body).toContain('project version');
    expect(skills.find((s) => s.name === 'only-user')!.scope).toBe('user');
  });

  it('falls back to directory name and first heading without frontmatter', () => {
    const project = path.join(tmp, 'proj');
    writeSkill(path.join(project, '.ox', 'skills'), 'audit', '# Security Audit\n\nDo the audit.');
    const skills = discoverSkills(project);
    const audit = skills.find((s) => s.name === 'audit');
    expect(audit).toMatchObject({ name: 'audit', description: 'Security Audit' });
  });

  it('returns only bundled skills when no user/project skills exist', () => {
    const skills = discoverSkills(path.join(tmp, 'empty'));
    const names = skills.map((s) => s.name);
    expect(names).toContain('pentest-web');
    expect(names).toContain('pentest-report');
    for (const s of skills) expect(s.scope).toBe('builtin');
  });
});

describe('formatSkillsForPrompt', () => {
  it('is empty for no skills and lists skills otherwise', () => {
    expect(formatSkillsForPrompt([])).toBe('');
    const block = formatSkillsForPrompt([
      { name: 'a', description: 'A skill', body: '', file: '/f', scope: 'user' },
    ]);
    expect(block).toContain('Available Skills');
    expect(block).toContain('- a — A skill');
  });
});

describe('use_skill tool', () => {
  const skills = [
    { name: 'review', description: 'Review code', body: '# Review\n\nFollow the checklist.', file: '/f/SKILL.md', scope: 'project' as const },
  ];

  it('returns the skill body by name', async () => {
    const tool = createUseSkillTool(skills);
    const res = await tool.execute({ name: 'review' }, { cwd: '/tmp' });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('# Skill: review');
    expect(res.content).toContain('Follow the checklist.');
  });

  it('errors with the available list for unknown skills', async () => {
    const tool = createUseSkillTool(skills);
    const res = await tool.execute({ name: 'nope' }, { cwd: '/tmp' });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Unknown skill');
    expect(res.content).toContain('review');
  });
});
