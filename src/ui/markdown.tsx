import React from 'react';
import { Text } from 'ink';
import { colors } from './theme.js';

/**
 * Minimal terminal markdown renderer for assistant output.
 *
 * Terminals cannot show raw `**bold**` / `*italic*` / `` `code` `` markers as
 * formatting, so we translate the common inline + heading syntax into Ink
 * styles and drop the markers. Anything we do not recognise is left verbatim.
 */

interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

// Ordered so earlier patterns win: code first (its content is literal),
// then bold (**/__), then italic (*/_).
const INLINE = [
  { kind: 'code' as const, re: /`([^`]+)`/ },
  { kind: 'bold' as const, re: /\*\*([^*]+)\*\*/ },
  { kind: 'bold' as const, re: /__([^_]+)__/ },
  { kind: 'italic' as const, re: /(?<![A-Za-z0-9])\*([^*\n]+)\*(?![A-Za-z0-9])/ },
  { kind: 'italic' as const, re: /(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/ },
];

/** Split one line of text into styled spans, honoring inline markdown. */
export function parseInline(text: string): Span[] {
  // Find the earliest match across all patterns; recurse on the remainder.
  let best: { index: number; length: number; inner: string; kind: 'code' | 'bold' | 'italic' } | null = null;
  for (const { kind, re } of INLINE) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, length: m[0].length, inner: m[1] ?? '', kind };
    }
  }
  if (!best) return text ? [{ text }] : [];

  const spans: Span[] = [];
  if (best.index > 0) spans.push({ text: text.slice(0, best.index) });
  spans.push({ text: best.inner, [best.kind]: true });
  const rest = text.slice(best.index + best.length);
  if (rest) spans.push(...parseInline(rest));
  return spans;
}

function renderSpans(spans: Span[]): React.ReactNode {
  return spans.map((s, i) => (
    <Text key={i} bold={s.bold} italic={s.italic} color={s.code ? colors.accent : undefined}>
      {s.text}
    </Text>
  ));
}

/** Render markdown text as Ink <Text> lines (block-level: headings + inline). */
export function Markdown({ text, dim }: { text: string; dim?: boolean }): React.JSX.Element {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <Text key={i} bold color={colors.accent} wrap="wrap">
              {parseInline(heading[2] ?? '').map((s, j) => (
                <Text key={j} italic={s.italic}>
                  {s.text}
                </Text>
              ))}
            </Text>
          );
        }
        return (
          <Text key={i} dimColor={dim} wrap="wrap">
            {renderSpans(parseInline(line))}
          </Text>
        );
      })}
    </>
  );
}
