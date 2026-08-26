import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../theme.js';
import { VERSION } from '../../version.js';

export interface HeaderProps {
  cwd: string;
  model: string;
  provider: string;
  fileCount: number | null;
  gitBranch: string | null;
  dangerMode: boolean;
}

const SHORTCUTS: Array<{ cmd: string; desc: string }> = [
  { cmd: '/resume', desc: 'resume a session' },
  { cmd: '/init', desc: 'create OX.md' },
  { cmd: '/help', desc: 'all commands' },
  { cmd: '/doctor', desc: 'check setup' },
];

export function Header({ cwd, model, provider, fileCount, gitBranch, dangerMode }: HeaderProps): React.JSX.Element {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const shownCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>{shownCwd}</Text>
      <Box borderStyle="round" borderColor={colors.accent} paddingX={2} marginTop={1} flexDirection="column">
        <Text>
          <Text bold color={colors.accent}>
            OxCode
          </Text>
          <Text dimColor>{'  '}{VERSION}</Text>
        </Text>
        <Text> </Text>
        <Text>
          <Text bold>Ox Alpha coding agent</Text>
          <Text dimColor>{` ${symbols.bullet} ${model} (${provider})`}</Text>
        </Text>
        <Text dimColor>
          {fileCount === null ? '3000+ files' : `${fileCount} files`}
          {gitBranch ? ` ${symbols.bullet} git: ${gitBranch}` : ''}
        </Text>
        <Text> </Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="column">
            {SHORTCUTS.slice(0, 2).map((s) => (
              <Text key={s.cmd}>
                <Text color={colors.accent}>{s.cmd}</Text>
                <Text dimColor>{`  ${s.desc}`}</Text>
              </Text>
            ))}
          </Box>
          <Box flexDirection="column">
            {SHORTCUTS.slice(2).map((s) => (
              <Text key={s.cmd}>
                <Text color={colors.accent}>{s.cmd}</Text>
                <Text dimColor>{`  ${s.desc}`}</Text>
              </Text>
            ))}
          </Box>
        </Box>
        {dangerMode ? (
          <>
            <Text> </Text>
            <Text color={colors.warning} bold>
              {symbols.warning} dangerouslySkipPermissions — every tool runs without asking
            </Text>
          </>
        ) : null}
      </Box>
    </Box>
  );
}
