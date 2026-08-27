import fs from 'node:fs';
import path from 'node:path';
import type { ContentPart } from '../api/index.js';
import { isBlockedFromModel } from '../security/sensitive.js';
import { isInsideRoot, resolveInCwd } from '../utils/paths.js';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MAX_ATTACH_CHARS = 60_000;
const MAX_ATTACH_FILES = 8;

export interface AttachmentResult {
  /** Parts to prepend to the user message (text blocks and/or images). */
  parts: ContentPart[];
  /** Human-readable notes about what was attached or skipped. */
  notes: string[];
}

function mimeFor(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Resolve `@path` references in user input into explicit context parts.
 * Text files are inlined as fenced blocks; images become image_url parts
 * (base64 data URLs) for multimodal providers.
 */
export function resolveAttachments(cwd: string, input: string): AttachmentResult {
  const parts: ContentPart[] = [];
  const notes: string[] = [];
  const tokens = input.match(/@([^\s@]+)/g) ?? [];
  let attached = 0;

  for (const token of tokens) {
    if (attached >= MAX_ATTACH_FILES) {
      notes.push(`Attachment limit reached (${MAX_ATTACH_FILES}); skipped ${token}.`);
      break;
    }
    const raw = token.slice(1);
    const absolute = resolveInCwd(cwd, raw);
    const ext0 = path.extname(absolute).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext0);
    // Images may be attached from anywhere (screenshots live in ~/Pictures etc.);
    // other files must stay inside the workspace root.
    if (!isInsideRoot(cwd, absolute) && !isImage) {
      notes.push(`Skipped ${token}: outside the workspace.`);
      continue;
    }
    if (isBlockedFromModel(absolute)) {
      notes.push(`Skipped ${token}: sensitive file (protected by policy).`);
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue; // not a real path — leave it as ordinary text
    }
    const rel = path.relative(cwd, absolute).split(path.sep).join('/');
    if (stat.isDirectory()) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(absolute).slice(0, 200);
      } catch {
        /* ignore */
      }
      parts.push({ type: 'text', text: `<attached-directory path="${rel}/">\n${entries.join('\n')}\n</attached-directory>` });
      notes.push(`Attached directory ${rel}/`);
      attached++;
      continue;
    }
    const ext = path.extname(absolute).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      try {
        const b64 = fs.readFileSync(absolute).toString('base64');
        parts.push({ type: 'image_url', image_url: { url: `data:${mimeFor(ext)};base64,${b64}` } });
        notes.push(`Attached image ${rel}`);
        attached++;
      } catch (e) {
        notes.push(`Could not attach ${token}: ${(e as Error).message}`);
      }
      continue;
    }
    try {
      const buf = fs.readFileSync(absolute);
      if (buf.includes(0)) {
        notes.push(`Skipped ${token}: binary file.`);
        continue;
      }
      let text = buf.toString('utf8');
      if (text.length > MAX_ATTACH_CHARS) {
        text = text.slice(0, MAX_ATTACH_CHARS) + '\n[attached file truncated]';
      }
      parts.push({ type: 'text', text: `<attached-file path="${rel}">\n${text}\n</attached-file>` });
      notes.push(`Attached ${rel}`);
      attached++;
    } catch (e) {
      notes.push(`Could not attach ${token}: ${(e as Error).message}`);
    }
  }
  return { parts, notes };
}
