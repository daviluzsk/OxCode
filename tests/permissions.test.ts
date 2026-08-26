import { describe, expect, it } from 'vitest';
import { PermissionManager } from '../src/permissions/manager.js';
import { bashTool } from '../src/tools/bash.js';
import { applyPatchTool } from '../src/tools/applyPatch.js';
import { readFileTool } from '../src/tools/readFile.js';
import { deletePathTool } from '../src/tools/fileOps.js';

const yes = async () => 'yes' as const;
const no = async () => 'no' as const;

describe('PermissionManager', () => {
  it('default mode: read-only runs free, edits ask, dangerous asks with danger flag', () => {
    const pm = new PermissionManager('default', yes);
    expect(pm.classify(readFileTool, { path: 'a' }).decision).toBe('allow');
    expect(pm.classify(applyPatchTool, { path: 'a', edits: [] }).decision).toBe('ask');
    const danger = pm.classify(bashTool, { command: 'rm -rf /' });
    expect(danger.decision).toBe('ask');
    expect(danger.danger).toBe(true);
    expect(pm.classify(bashTool, { command: 'npm test' }).decision).toBe('allow');
  });

  it('acceptEdits: edits auto-approved, deletion still asks, risky bash asks', () => {
    const pm = new PermissionManager('acceptEdits', yes);
    expect(pm.classify(applyPatchTool, { path: 'a', edits: [] }).decision).toBe('allow');
    expect(pm.classify(deletePathTool, { path: 'a' }).decision).toBe('ask');
    expect(pm.classify(bashTool, { command: 'git push origin main' }).decision).toBe('ask');
  });

  it('plan mode: mutations and execution denied, reads allowed', () => {
    const pm = new PermissionManager('plan', yes);
    expect(pm.classify(readFileTool, { path: 'a' }).decision).toBe('allow');
    const edit = pm.classify(applyPatchTool, { path: 'a', edits: [] });
    expect(edit.decision).toBe('deny');
    expect(edit.reason).toMatch(/Plan mode/);
    expect(pm.classify(bashTool, { command: 'ls' }).decision).toBe('deny');
  });

  it('dangerouslySkipPermissions: everything allowed without asking', async () => {
    let asked = false;
    const pm = new PermissionManager('dangerouslySkipPermissions', async () => {
      asked = true;
      return 'no';
    });
    const res = await pm.check(deletePathTool, { path: 'a' }, 'delete a');
    expect(res.allowed).toBe(true);
    expect(asked).toBe(false);
  });

  it('askAll: every tool asks, including reads; high-risk stays danger-flagged', () => {
    const pm = new PermissionManager('askAll', yes);
    expect(pm.classify(readFileTool, { path: 'a' }).decision).toBe('ask');
    expect(pm.classify(applyPatchTool, { path: 'a', edits: [] }).decision).toBe('ask');
    expect(pm.classify(bashTool, { command: 'npm test' }).decision).toBe('ask');
    const danger = pm.classify(bashTool, { command: 'rm -rf /' });
    expect(danger.decision).toBe('ask');
    expect(danger.danger).toBe(true);
  });

  it('askAll: session approvals still skip repeat asks', async () => {
    let askCount = 0;
    const pm = new PermissionManager('askAll', async () => {
      askCount++;
      return 'yes-session';
    });
    await pm.check(readFileTool, { path: 'a' }, 'read a');
    const second = await pm.check(readFileTool, { path: 'b' }, 'read b');
    expect(second.allowed).toBe(true);
    expect(askCount).toBe(1);
  });

  it('session approvals: yes-session stops future asks for similar calls', async () => {
    let askCount = 0;
    const pm = new PermissionManager('default', async () => {
      askCount++;
      return 'yes-session';
    });
    await pm.check(applyPatchTool, { path: 'a', edits: [] }, 'edit a');
    const second = await pm.check(applyPatchTool, { path: 'b', edits: [] }, 'edit b');
    expect(second.allowed).toBe(true);
    expect(askCount).toBe(1);
  });

  it('denied permission returns a reason', async () => {
    const pm = new PermissionManager('default', no);
    const res = await pm.check(deletePathTool, { path: 'a' }, 'delete a');
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/denied/);
  });
});
