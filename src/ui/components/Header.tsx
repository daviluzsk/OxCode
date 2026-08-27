import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols, MASCOT } from '../theme.js';
import { VERSION } from '../../version.js';

export interface HeaderProps {
  cwd: string;
  model: string;
  provider: string;
  fileCount: number | null;
  gitBranch: string | null;
  dangerMode: boolean;
}

const TIPS: Array<{ cmd: string; desc: string }> = [
  { cmd: '/help', desc: 'all commands' },
  { cmd: '@file', desc: 'attach a file or image' },
  { cmd: '/init', desc: 'analyze repo → OX.md' },
  { cmd: '/resume', desc: 'past sessions' },
  { cmd: '/pentest', desc: 'security testing' },
  { cmd: '/swarm', desc: '3D agent office' },
];

export function Header({ cwd, model, provider, fileCount, gitBranch, dangerMode }: HeaderProps): React.JSX.Element {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const shownCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor={colors.accent} paddingX={2} paddingY={1} flexDirection="column">
        {/* mascot + title row */}
        <Box flexDirection="row">
          <Box flexDirection="column" marginRight={2}>
            {MASCOT.map((line, i) => (
              <Text key={i} color={colors.accent} bold>
                {line}
              </Text>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text>
              <Text bold color={colors.accent}>
                OxCode
              </Text>
              <Text dimColor>{`  v${VERSION}`}</Text>
            </Text>
            <Text dimColor>Nemotron-powered coding agent — and offensive-security workbench</Text>
            <Text>
              <Text dimColor>{symbols.arrow} </Text>
              <Text color={colors.toolName}>{model}</Text>
              <Text dimColor>{` (${provider})`}</Text>
            </Text>
          </Box>
        </Box>

        <Text> </Text>
        <Text dimColor>
          {symbols.bullet} {shownCwd}
        </Text>
        <Text dimColor>
          {symbols.bullet} {fileCount === null ? '3000+ files' : `${fileCount} files`}
          {gitBranch ? `  ${symbols.bullet} git: ${gitBranch}` : ''}
        </Text>

        <Text> </Text>
        <Box flexDirection="row">
          {[0, 3].map((start) => (
            <Box key={start} flexDirection="column" marginRight={4}>
              {TIPS.slice(start, start + 3).map((t) => (
                <Text key={t.cmd}>
                  <Text color={colors.accent}>{t.cmd.padEnd(9)}</Text>
                  <Text dimColor>{t.desc}</Text>
                </Text>
              ))}
            </Box>
          ))}
        </Box>

        {dangerMode ? (
          <>
            <Text> </Text>
            <Text color={colors.error} bold>
              {symbols.warning} dangerouslySkipPermissions — every tool runs without asking
            </Text>
          </>
        ) : null}
      </Box>
    </Box>
  );
}
