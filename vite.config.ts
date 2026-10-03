import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

/** Minimal .env reader — avoids adding a dependency just for this. */
function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = resolve(__dirname, '.env');
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv();

/**
 * The content script and service worker must be single, self-contained IIFE/ESM
 * files at predictable paths. Vite's multi-entry mode would code-split them, so
 * we build them in dedicated passes (see scripts/build.mjs) and only build the
 * HTML surfaces here.
 */
export default defineConfig(({ mode }) => {
  const target = process.env.TH_TARGET ?? 'pages';

  const define = {
    __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(
      env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '',
    ),
    'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
  };

  const common = {
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    define,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: mode === 'development' ? ('inline' as const) : false,
      minify: mode === 'development' ? (false as const) : ('esbuild' as const),
      target: 'chrome114',
    },
  };

  if (target === 'background') {
    // Built as a classic (IIFE) service worker rather than an ES module.
    // MV3 supports both, but Vite deliberately skips minification for `es`
    // lib builds — IIFE gets us a properly minified, self-contained worker.
    return {
      ...common,
      plugins: [] as Plugin[],
      build: {
        ...common.build,
        lib: {
          entry: resolve(__dirname, 'src/background/index.ts'),
          formats: ['iife' as const],
          name: 'TeamHueBackground',
          fileName: () => 'src/background/index.js',
        },
        rollupOptions: { output: { extend: true, inlineDynamicImports: true } },
      },
    };
  }

  if (target === 'content') {
    return {
      ...common,
      plugins: [] as Plugin[],
      build: {
        ...common.build,
        lib: {
          entry: resolve(__dirname, 'src/content/index.ts'),
          formats: ['iife' as const],
          name: 'TeamHue',
          fileName: () => 'src/content/index.js',
        },
        rollupOptions: { output: { extend: true, inlineDynamicImports: true } },
      },
    };
  }

  // HTML surfaces (popup + options)
  return {
    ...common,
    plugins: [react()],
    build: {
      ...common.build,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/popup/index.html'),
          options: resolve(__dirname, 'src/options/index.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
