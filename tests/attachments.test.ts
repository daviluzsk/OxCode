import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAttachments } from '../src/ui/attachments.js';
import { cleanup, makeTempDir, writeFile } from './helpers.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanup(dirs.pop()!); });

// a 1x1 PNG
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000',  'hex');

describe('resolveAttachments', () => {
  it('inlines a workspace text file as a fenced block', () => {
    const dir = makeTempDir(); dirs.push(dir);
    writeFile(dir, 'notes.txt', 'hello world');
    const { parts, notes } = resolveAttachments(dir, 'read @notes.txt please');
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as { text: string }).text).toContain('hello world');
    expect(notes.join(' ')).toMatch(/Attached notes\.txt/);
  });

  it('attaches an image from OUTSIDE the workspace as an image part', () => {
    const dir = makeTempDir(); dirs.push(dir);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ox-img-')); dirs.push(outside);
    const img = path.join(outside, 'shot.png');
    fs.writeFileSync(img, PNG);
    const abs = img.split(path.sep).join('/');
    const { parts } = resolveAttachments(dir, `look at @${abs}`);
    const image = parts.find((p) => p.type === 'image_url');
    expect(image, 'image outside root should attach').toBeTruthy();
    expect((image as { image_url: { url: string } }).image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('still refuses a non-image file from outside the workspace', () => {
    const dir = makeTempDir(); dirs.push(dir);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ox-txt-')); dirs.push(outside);
    const f = path.join(outside, 'secret.txt');
    fs.writeFileSync(f, 'nope');
    const { parts, notes } = resolveAttachments(dir, `read @${f.split(path.sep).join('/')}`);
    expect(parts.length).toBe(0);
    expect(notes.join(' ')).toMatch(/outside the workspace/);
  });
});
