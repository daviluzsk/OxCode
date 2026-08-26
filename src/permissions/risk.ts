/**
 * Command risk classification.
 *
 * Rather than naive substring matching, commands are split into segments
 * (pipes, &&, ||, ;) and each segment's executable + flags are inspected
 * against structured rules. The classifier is intentionally conservative:
 * anything it does not recognize as clearly safe in a mutating context is
 * "moderate" and may be auto-approved according to mode; anything clearly
 * destructive is "high" and always asks unless permissions are skipped.
 */

export type RiskLevel = 'safe' | 'moderate' | 'high';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

interface SegmentRule {
  re: RegExp;
  level: RiskLevel;
  reason: string;
}

/** Rules matched against a normalized command segment. */
const SEGMENT_RULES: SegmentRule[] = [
  // --- high risk: destructive / irreversible / externally visible ---
  { re: /\brm\b.*\s(-[a-zA-Z]*[rf]|-{2}(recursive|force))/, level: 'high', reason: 'recursive/forced file deletion (rm -rf)' },
  { re: /\b(rmdir|del|erase)\b.*\/s\b/i, level: 'high', reason: 'recursive directory deletion' },
  { re: /\bRemove-Item\b.*-Recurse/i, level: 'high', reason: 'recursive deletion (Remove-Item -Recurse)' },
  { re: /\bgit\s+reset\s+--hard\b/, level: 'high', reason: 'git reset --hard discards uncommitted work' },
  { re: /\bgit\s+clean\b.*\s-[a-zA-Z]*f/, level: 'high', reason: 'git clean -f deletes untracked files' },
  { re: /\bgit\s+push\b.*(--force|-f)\b/, level: 'high', reason: 'force push rewrites remote history' },
  { re: /\bgit\s+push\b/, level: 'high', reason: 'pushing publishes commits to a remote' },
  { re: /\bgit\s+(rebase|cherry-pick|revert)\b/, level: 'moderate', reason: 'git history operation' },
  { re: /\bnpm\s+publish\b|\byarn\s+npm\s+publish\b|\bpnpm\s+publish\b/, level: 'high', reason: 'publishing a package is externally visible' },
  { re: /\bdocker\s+system\s+prune\b/, level: 'high', reason: 'docker system prune deletes data' },
  { re: /\b(format|diskpart|mkfs)\b/i, level: 'high', reason: 'disk formatting/partitioning command' },
  { re: /\b(shutdown|reboot|Restart-Computer|Stop-Computer)\b/i, level: 'high', reason: 'system power command' },
  { re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;]*(\||>\s*\S*sh\b).*\b(sh|bash|pwsh|powershell)\b/i, level: 'high', reason: 'piping remote content directly into a shell' },
  { re: /\bsudo\b/, level: 'high', reason: 'elevated privileges (sudo)' },
  { re: /\b(kill|taskkill)\b.*\/f/i, level: 'moderate', reason: 'forced process termination' },
  { re: /\bDROP\s+TABLE\b|\bDROP\s+DATABASE\b/i, level: 'high', reason: 'destructive SQL statement' },
  // --- moderate: mutating but routine ---
  { re: /\b(rm|del|erase|Remove-Item)\b/i, level: 'moderate', reason: 'file deletion' },
  { re: /\b(mv|move|Move-Item|Rename-Item|ren)\b/i, level: 'moderate', reason: 'file move/rename' },
  { re: /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update|upgrade)\b/, level: 'moderate', reason: 'modifies project dependencies' },
  { re: /\bpip(3)?\s+(install|uninstall)\b/, level: 'moderate', reason: 'modifies Python environment' },
  { re: /\bgit\s+(commit|merge|checkout|switch|stash|tag|branch)\b/, level: 'moderate', reason: 'git state change' },
  { re: /\bgit\s+config\b/, level: 'moderate', reason: 'git configuration change' },
  { re: /\bchmod\b|\bchown\b|\bicacls\b/i, level: 'moderate', reason: 'permission/ownership change' },
  { re: /\b(kill|taskkill|Stop-Process)\b/i, level: 'moderate', reason: 'process termination' },
  { re: /\btouch\b|\bmkdir\b|\bNew-Item\b/i, level: 'moderate', reason: 'filesystem creation' },
  { re: /(^|\s)>{1,2}\s*\S/, level: 'moderate', reason: 'shell redirection writes to a file' },
  { re: /\btee\b/, level: 'moderate', reason: 'writes command output to a file' },
];

/** Executables considered safe read-only even with args. */
const SAFE_EXECUTABLES = new Set([
  'ls', 'dir', 'pwd', 'cd', 'cat', 'type', 'echo', 'printf', 'which', 'where', 'whereis',
  'head', 'tail', 'find', 'rg', 'grep', 'findstr', 'select-string', 'get-childitem', 'gci',
  'get-location', 'gl', 'env', 'set', 'printenv', 'uname', 'whoami', 'hostname', 'date',
  'node', 'python', 'python3', 'pip', 'pip3', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'tsc',
  'pytest', 'jest', 'vitest', 'mocha', 'cargo', 'go', 'mvn', 'gradle', 'make', 'cmake',
  'git', 'docker', 'kubectl', 'curl', 'wget', 'tar', 'zip', 'unzip', 'gzip', '7z',
  'rustc', 'javac', 'java', 'dotnet', 'composer', 'php', 'ruby', 'gem', 'deno', 'lua',
]);

/** git subcommands that are read-only. */
const SAFE_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'ls-tree',
  'blame', 'describe', 'remote', 'tag', 'shortlog', 'whatchanged', 'grep',
]);

/** Split a compound command into individual segments. */
export function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function executableOf(segment: string): string {
  const token = segment.split(/\s+/)[0] ?? '';
  return token.replace(/^["']|["']$/g, '').split(/[\\/]/).pop()!.replace(/\.(exe|bat|cmd|ps1)$/i, '').toLowerCase();
}

export function classifyCommand(command: string): RiskAssessment {
  const reasons: string[] = [];
  let worst: RiskLevel = 'safe';
  const bump = (level: RiskLevel) => {
    if (level === 'high') worst = 'high';
    else if (level === 'moderate' && worst === 'safe') worst = 'moderate';
  };

  // Whole-command patterns that span segments (e.g. download-pipe-to-shell).
  if (/\b(curl|wget|iwr|Invoke-WebRequest)\b[^;&|]*(\||\bOut-File\b[^|]*\|).{0,200}\b(sh|bash|zsh|pwsh|powershell|cmd)\b/i.test(command)) {
    return { level: 'high', reasons: ['piping remote content directly into a shell'] };
  }

  const segments = splitSegments(command);
  if (segments.length === 0) return { level: 'safe', reasons };

  for (const segment of segments) {
    let matchedRule = false;
    for (const rule of SEGMENT_RULES) {
      if (rule.re.test(segment)) {
        bump(rule.level);
        reasons.push(rule.reason);
        matchedRule = true;
        break; // first matching rule per segment is enough
      }
    }
    if (matchedRule) continue;

    const exe = executableOf(segment);
    if (exe === 'git') {
      const sub = (segment.split(/\s+/)[1] ?? '').toLowerCase();
      if (!SAFE_GIT_SUBCOMMANDS.has(sub)) {
        bump('moderate');
        reasons.push(`git ${sub} modifies repository state`);
      }
      continue;
    }
    if (!SAFE_EXECUTABLES.has(exe)) {
      // Unknown executable: not automatically safe.
      bump('moderate');
      reasons.push(`unrecognized command "${exe}"`);
    }
  }

  return { level: worst, reasons: [...new Set(reasons)] };
}
