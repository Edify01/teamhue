#!/usr/bin/env node
/**
 * Packages the built extension into a distributable zip and stages it for the
 * website download, so `site/` can be deployed to Vercel with the installer
 * already in place.
 *
 * Usage:  npm run package
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, cp, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const staging = resolve(root, '.package');
const siteDownloads = resolve(root, 'site/public/downloads');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function main() {
  if (!existsSync(resolve(dist, 'manifest.json'))) {
    console.error(c.red('✗ No build found. Run `npm run build` first.'));
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
  const version = manifest.version;

  // Stage as a folder named `teamhue` so users unzip to a clearly-named dir.
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await cp(dist, resolve(staging, 'teamhue'), { recursive: true });

  // A short readme inside the zip for anyone who opens it before the website.
  await writeFile(
    resolve(staging, 'teamhue', 'INSTALL.txt'),
    [
      'TeamHue — installation',
      '======================',
      '',
      '1. Keep this "teamhue" folder somewhere permanent (e.g. Documents).',
      '   Chrome loads the extension from this location every time it starts,',
      '   so do not delete or move it afterwards.',
      '',
      '2. Open Chrome and go to:  chrome://extensions',
      '',
      '3. Turn on "Developer mode" (toggle, top-right).',
      '',
      '4. Click "Load unpacked" and select this "teamhue" folder.',
      '',
      '5. Pin TeamHue from the puzzle-piece icon in your toolbar.',
      '   The setup page opens automatically.',
      '',
      'Then: one person creates the team and shares the join code.',
      'Everyone who enters that code sees the same colors.',
      '',
      `Version ${version}`,
    ].join('\n'),
    'utf8',
  );

  await mkdir(siteDownloads, { recursive: true });
  const zipPath = resolve(siteDownloads, 'teamhue.zip');
  await rm(zipPath, { force: true });

  // `zip` ships with macOS and Linux. -r recursive, -q quiet, -X no extra attrs.
  execFileSync('zip', ['-rqX', zipPath, 'teamhue'], { cwd: staging, stdio: 'inherit' });
  await rm(staging, { recursive: true, force: true });

  const { size } = await stat(zipPath);
  console.log(
    c.green('\n✓ Packaged') +
      c.dim(` v${version} · ${(size / 1024 / 1024).toFixed(2)} MB\n`) +
      c.dim('  → site/public/downloads/teamhue.zip\n') +
      c.dim('  Deploy the site and the download button will serve this file.\n'),
  );
}

main().catch((err) => {
  console.error(c.red('\n✗ Packaging failed:\n'), err);
  process.exit(1);
});
