import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApprovalRequest, ApprovalResponse } from '../../permissions/manager.js';
import { colors, symbols } from '../theme.js';

const OPTIONS: Array<{ key: string; label: string; value: ApprovalResponse }> = [
  { key: 'y', label: 'Yes', value: 'yes' },
  { key: 'a', label: 'Yes, and allow similar this session', value: 'yes-session' },
  { key: 'n', label: 'No', value: 'no' },
];

export function ApprovalPrompt({
  request,
  onAnswer,
}: {
  request: ApprovalRequest;
  onAnswer: (r: ApprovalResponse) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => (s + OPTIONS.length - 1) % OPTIONS.length);
    else if (key.downArrow) setSelected((s) => (s + 1) % OPTIONS.length);
    else if (key.return) onAnswer(OPTIONS[selected]!.value);
    else {
      const byKey = OPTIONS.find((o) => o.key === input.toLowerCase());
      if (byKey) onAnswer(byKey.value);
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Box
        borderStyle="round"
        borderColor={request.danger ? colors.error : colors.warning}
        paddingX={2}
        flexDirection="column"
      >
        <Text bold color={request.danger ? colors.error : colors.warning}>
          Permission required — {request.toolName}
        </Text>
        <Text> </Text>
        <Text wrap="wrap">{request.summary}</Text>
        <Text> </Text>
        <Text dimColor wrap="wrap">
          {request.reason}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {OPTIONS.map((o, i) => (
          <Text key={o.key} color={i === selected ? colors.accent : undefined} bold={i === selected}>
            {i === selected ? `${symbols.prompt} ` : '  '}
            {o.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
