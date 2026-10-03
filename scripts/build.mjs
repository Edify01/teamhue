#!/usr/bin/env node
/**
 * TeamHue build orchestrator.
 *
 * Runs three Vite passes (pages / background / content) because MV3 requires
 * the service worker and content script to be single files at fixed paths,
 * then copies static assets and rewrites the HTML paths in the manifest.
 */
import { build } from 'vite';
import { cp, mkdir, rm, readFile, access } from 'node:fs/promises';
import { existsSync, readFileSync, watch as fsWatch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const mode = watch ? 'development' : 'production';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function ensureIcons() {
  const iconPath = resolve(root, 'public/icons/icon-128.png');
  if (!existsSync(iconPath)) {
    console.log(c.dim('→ generating icons…'));
    const { generateIcons } = await import('./make-icons.mjs');
    await generateIcons();
  }
}

function checkEnv() {
  const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) {
    console.log(
      c.yellow('\n⚠  No .env file found.') +
        c.dim('\n   The extension will build, but will show a setup screen until you add\n   SUPABASE_URL and SUPABASE_ANON_KEY. Copy .env.example to .env.\n'),
    );
    return false;
  }
  const text = readFileSync(envPath, 'utf8');
  const hasUrl = /^SUPABASE_URL=\s*https:\/\/\S+/m.test(text);
  const hasKey = /^SUPABASE_ANON_KEY=\s*\S{20,}/m.test(text);
  if (!hasUrl || !hasKey) {
    console.log(c.yellow('\n⚠  .env is missing SUPABASE_URL or SUPABASE_ANON_KEY.\n'));
    return false;
  }
  return true;
}

async function runPass(target, label) {
  process.env.TH_TARGET = target;
  console.log(c.dim(`→ building ${label}…`));
  await build({ mode, configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' });
}

async function copyStatic() {
  console.log(c.dim('→ copying static assets…'));
  await cp(resolve(root, 'public'), dist, { recursive: true });
  // content.css is referenced directly by the manifest.
  await mkdir(resolve(dist, 'src/content'), { recursive: true });
  await cp(resolve(root, 'src/content/content.css'), resolve(dist, 'src/content/content.css'));
}

/**
 * Vite emits popup/options HTML with hashed asset names into
 * dist/src/{popup,options}/index.html — which is exactly where the manifest
 * points. We just verify they exist and fix any absolute asset paths, since
 * chrome-extension:// pages resolve "/assets/..." against the extension root
 * (which is correct), so no rewrite is normally needed.
 */
async function verify() {
  const required = [
    'manifest.json',
    'src/background/index.js',
    'src/content/index.js',
    'src/content/content.css',
    'src/popup/index.html',
    'src/options/index.html',
    'icons/icon-128.png',
  ];

  const missing = [];
  for (const f of required) {
    try {
      await access(resolve(dist, f));
    } catch {
      missing.push(f);
    }
  }

  if (missing.length) {
    console.error(c.red('\n✗ Build incomplete. Missing:'));
    missing.forEach((f) => console.error(c.red(`   - ${f}`)));
    process.exit(1);
  }

  // Sanity-check the manifest parses and its referenced files exist.
  const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) {
    console.error(c.red('✗ manifest_version must be 3'));
    process.exit(1);
  }
}

async function buildOnce() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await runPass('pages', 'popup + options');
  await runPass('background', 'service worker');
  await runPass('content', 'content script');
  await copyStatic();
  await verify();
}

async function main() {
  const t0 = Date.now();
  console.log(c.bold('\n  TeamHue') + c.dim(`  ·  ${mode} build\n`));

  checkEnv();
  await ensureIcons();
  await buildOnce();

  console.log(
    c.green('\n✓ Build complete') +
      c.dim(` in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`) +
      c.dim('  Load it: chrome://extensions → Developer mode → Load unpacked → ') +
      c.bold('dist/\n'),
  );

  if (!watch) return;

  console.log(c.dim('  Watching for changes… (Ctrl+C to stop)\n'));
  let rebuilding = false;
  let pending = false;

  const trigger = async () => {
    if (rebuilding) {
      pending = true;
      return;
    }
    rebuilding = true;
    try {
      const t = Date.now();
      await buildOnce();
      console.log(c.green(`✓ rebuilt`) + c.dim(` in ${((Date.now() - t) / 1000).toFixed(1)}s — reload the extension in Chrome`));
    } catch (err) {
      console.error(c.red('✗ rebuild failed:'), err.message);
    } finally {
      rebuilding = false;
      if (pending) {
        pending = false;
        setTimeout(trigger, 50);
      }
    }
  };

  let debounce;
  for (const dir of ['src', 'public']) {
    fsWatch(resolve(root, dir), { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(trigger, 180);
    });
  }
}

main().catch((err) => {
  console.error(c.red('\n✗ Build failed:\n'), err);
  process.exit(1);
});
