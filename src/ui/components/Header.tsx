import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols, brand, mrrobotArt } from '../theme.js';
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

/** The fsociety "boot" screen — shown in place of the normal header in Mr Robot mode. */
function MrRobotScreen(): React.JSX.Element {
  const red = colors.accent; // redBright while the mrrobot theme is applied
  const time = new Date().toISOString().slice(11, 19);
  const art = mrrobotArt();
  const rule = '─'.repeat(64);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={red} paddingX={2} paddingY={1}>
      {/* prompt bar */}
      <Box justifyContent="space-between">
        <Text>
          <Text color={red}>┌─[</Text>
          <Text color="greenBright" bold>root</Text>
          <Text color={red}>@</Text>
          <Text color="redBright" bold>fsociety</Text>
          <Text color={red}>]─[</Text>
          <Text color="cyanBright">~</Text>
          <Text color={red}>]# connect --secure</Text>
        </Text>
        <Text color={red} dimColor>
          [ UTC {time} ]
        </Text>
      </Box>
      <Text color={red} dimColor>{rule}</Text>

      {/* boot log */}
      <Text color={red} dimColor>[+] Establishing encrypted channel to 192.168.0.2:22 …</Text>
      <Text color={red} dimColor>[+] Handshake OK · cipher aes-256-gcm · key exchange x25519</Text>
      <Text color={red} dimColor>[+] Authentication required</Text>
      <Text color={red}>
        Password: <Text bold>████████████████</Text>
      </Text>

      {/* banner */}
      <Text> </Text>
      {art.map((l, i) => (
        <Text key={i} color="redBright" bold wrap="truncate-end">
          {l}
        </Text>
      ))}
      <Box justifyContent="space-between">
        <Text color={red} dimColor>fsociety // control is an illusion</Text>
        <Text color={red}>[ fsociety.dat ]</Text>
      </Box>

      {/* success */}
      <Text> </Text>
      <Text color="greenBright">[✓] Login successful.</Text>
      <Text color="greenBright">[✓] System boot sequence complete.</Text>
      <Text color="greenBright">[✓] Welcome, friend.</Text>
      <Text color={red} dimColor>{rule}</Text>
      <Text>
        <Text color={red}>└─$ </Text>
        <Text color={red} inverse>{' '}</Text>
      </Text>
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
