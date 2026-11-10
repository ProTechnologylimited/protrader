/*
 * ProTrader web build for both the public Express site and Capacitor Android.
 *
 * Creates js/appkit.bundle.js from the AppKit source, then creates a clean
 * ./www directory containing ONLY browser-facing files. Do not copy the whole
 * project root or the whole js directory: they also contain server code,
 * build tooling, scripts, and local-only files.
 *
 * Run from the project root with: npm run build
 */

import { build } from 'esbuild';
import {
  copyFile,
  cp,
  mkdir,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const webRoot = path.join(projectRoot, 'www');

const requiredBrowserFiles = [
  'index.html',
  'community.html',
  'js/config.js',
  'js/util.js',
  'js/store.js',
  'js/ui.js',
  'js/market.js',
  'js/chart.js',
  'js/wallet.js',
  'js/app.js',
  'js/views/trade.js',
  'js/views/launch.js',
  'js/views/airdrops.js',
  'js/views/earn.js',
  'js/views/bots.js',
  'js/views/wallet-view.js',
];

async function assertFile(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  try {
    const details = await stat(absolutePath);
    if (!details.isFile()) {
      throw new Error(`${relativePath} is not a file.`);
    }
  } catch {
    throw new Error(
      `Required ProTrader browser file is missing: ${relativePath}`
    );
  }

  return absolutePath;
}

async function copyBrowserFile(relativePath) {
  const source = await assertFile(relativePath);
  const destination = path.join(webRoot, relativePath);

  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

// 1. Build the existing Reown/AppKit browser bundle without changing its
//    established output location used by the rest of the project.
await build({
  entryPoints: ['js/src/appkit.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'js/appkit.bundle.js',
  define: {
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis',
  },
  logLevel: 'info',
});

// 2. Validate all browser entry points before replacing the previous output.
for (const relativePath of requiredBrowserFiles) {
  await assertFile(relativePath);
}
await assertFile('js/appkit.bundle.js');
await assertFile('css/styles.css');
await stat(path.join(projectRoot, 'assets'));

// 3. Recreate a clean Capacitor webDir. It intentionally excludes .env,
//    SQLite databases, backups, node_modules, scripts, and backend source.
await rm(webRoot, { recursive: true, force: true });
await mkdir(webRoot, { recursive: true });

for (const relativePath of requiredBrowserFiles) {
  await copyBrowserFile(relativePath);
}

await cp(
  path.join(projectRoot, 'css'),
  path.join(webRoot, 'css'),
  { recursive: true },
);

await cp(
  path.join(projectRoot, 'assets'),
  path.join(webRoot, 'assets'),
  { recursive: true },
);

// Keep the generated bundle available if the frontend loads it dynamically.
await copyBrowserFile('js/appkit.bundle.js');

// The web server exposes /community. A directory index lets the same path
// resolve to the Community page in Capacitor's local web asset server.
await mkdir(path.join(webRoot, 'community'), { recursive: true });
await copyFile(
  path.join(webRoot, 'community.html'),
  path.join(webRoot, 'community', 'index.html'),
);

// 4. Assert Capacitor's required entry point exists at the configured root.
await assertFile(path.join('www', 'index.html'));

console.log('ProTrader web build completed.');
console.log(`Capacitor webDir: ${path.relative(projectRoot, webRoot)}`);
console.log('Included: index, Community, CSS, assets, and allowlisted browser JS.');
console.log('Excluded: .env, SQLite data, backups, backend source, and node_modules.');
