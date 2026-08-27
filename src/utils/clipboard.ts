import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

/**
 * Grab an image from the OS clipboard and save it inside the workspace under
 * `.ox/pastes/`. Returns the workspace-relative path. Throws if there is no
 * image on the clipboard or the platform has no supported clipboard tool.
 */
export async function pasteClipboardImage(cwd: string): Promise<string> {
  const dir = path.join(cwd, '.ox', 'pastes');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `paste-${Date.now()}.png`);
  const rel = path.relative(cwd, abs).split(path.sep).join('/');

  if (process.platform === 'win32') {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
      "$img=[System.Windows.Forms.Clipboard]::GetImage(); " +
      `if($img -ne $null){ $img.Save('${abs.replace(/\\/g, '\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png); 'ok' } else { 'noimg' }`;
    const r = await execa('powershell', ['-NoProfile', '-STA', '-Command', script], { reject: false });
    if (!/\bok\b/.test(r.stdout ?? '')) throw new Error('no image on the clipboard');
    return rel;
  }

  if (process.platform === 'darwin') {
    // pngpaste is the reliable path; fall back to a clear message.
    const r = await execa('pngpaste', [abs], { reject: false });
    if (r.exitCode !== 0 || !fs.existsSync(abs)) throw new Error('no image on the clipboard (install pngpaste: brew install pngpaste)');
    return rel;
  }

  // linux: Wayland (wl-paste) then X11 (xclip)
  for (const [bin, args] of [
    ['wl-paste', ['--type', 'image/png']],
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
  ] as Array<[string, string[]]>) {
    try {
      const r = await execa(bin, args, { encoding: 'buffer', reject: false });
      const out = r.stdout as unknown as Buffer;
      if (r.exitCode === 0 && out && out.length > 8) {
        fs.writeFileSync(abs, out);
        return rel;
      }
    } catch {
      /* try next tool */
    }
  }
  throw new Error('no image on the clipboard (install wl-clipboard or xclip)');
}
