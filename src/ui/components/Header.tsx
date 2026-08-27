import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols, brand, mrrobotArt, GLITCH_ROWS } from '../theme.js';
import { VERSION } from '../../version.js';

export interface HeaderProps {
  cwd: string;
  model: string;
  provider: string;
  fileCount: number | null;
  gitBranch: string | null;
  dangerMode: boolean;
  mrRobot?: boolean;
}

const TIPS: Array<{ cmd: string; desc: string }> = [
  { cmd: '/help', desc: 'all commands' },
  { cmd: '@file', desc: 'attach a file or image' },
  { cmd: '/init', desc: 'analyze repo → OX.md' },
  { cmd: '/resume', desc: 'past sessions' },
  { cmd: '/pentest', desc: 'security testing' },
  { cmd: '/swarm', desc: '3D agent office' },
];

/** The fsociety "boot" screen — giant glitch banner, no frame (Mr Robot mode). */
function MrRobotScreen(): React.JSX.Element {
  const red = colors.accent; // redBright while the mrrobot theme is applied
  const time = new Date().toISOString().slice(11, 19);
  const art = mrrobotArt();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box justifyContent="space-between">
        <Text color={red} dimColor>root@fsociety:~$ ./fsociety.dat --run</Text>
        <Text color={red} dimColor>[ {time} UTC ]</Text>
      </Box>
      <Text color={red} dimColor>{GLITCH_ROWS[0]}</Text>
      <Text> </Text>
      {/* giant MR / ROBOT — a couple of rows flicker dim for a glitch feel */}
      {art.map((l, i) => (
        <Text key={i} color="redBright" bold dimColor={i === 3 || i === 8} wrap="truncate-end">
          {l}
        </Text>
      ))}
      <Text> </Text>
      <Text color={red} dimColor>{GLITCH_ROWS[1]}</Text>
      <Box justifyContent="space-between" marginTop={1}>
        <Text>
          <Text color={red}>~ </Text>
          <Text color="redBright" bold>fsociety</Text>
          <Text color={red}> ~ control is an illusion ~ </Text>
          <Text color="greenBright">hello, friend</Text>
          <Text color={red}> ~</Text>
        </Text>
        <Text color={red} dimColor>[fsociety.dat]</Text>
      </Box>
    </Box>
  );
}

export function Header({ cwd, model, provider, fileCount, gitBranch, dangerMode, mrRobot }: HeaderProps): React.JSX.Element {
  if (mrRobot) return <MrRobotScreen />;

  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const shownCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor={colors.accent} paddingX={2} paddingY={1} flexDirection="column">
        {/* mascot + title row */}
        <Box flexDirection="row">
          <Box flexDirection="column" marginRight={2}>
            {brand.mascot.map((line, i) => (
              <Text key={i} color={colors.accent} bold>
                {line}
              </Text>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text>
              <Text bold color={colors.accent}>
                {brand.name}
              </Text>
              <Text dimColor>{`  v${VERSION}`}</Text>
            </Text>
            <Text dimColor>{brand.tagline}</Text>
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
