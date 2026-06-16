#!/usr/bin/env node
/**
 * Builds packs/default/plugins/text-selection/script.dap by bundling the
 * relevant Yomitan source files into a single self-contained IIFE.
 *
 * Usage:
 *   node scripts/build-text-selection.mjs [yomitan-version-tag]
 *
 * If no version tag is given, the latest stable Yomitan release is fetched
 * from the GitHub API.
 *
 * Outputs:
 *   packs/default/plugins/text-selection/script.dap  — the bundled plugin
 *   packs/default/plugins/text-selection/plugin.dapm — updated version field
 *   packs/default/index.json                         — updated version for this plugin
 */

import { execSync } from 'child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { get } from 'https';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { createUnzip } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ── helpers ──────────────────────────────────────────────────────────────────

function httpsGet(url, opts = {}) {
  return new Promise((res, rej) => {
    const req = get(url, { headers: { 'User-Agent': 'da-lang-plugins-builder' }, ...opts }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        httpsGet(r.headers.location, opts).then(res, rej);
        return;
      }
      res(r);
    });
    req.on('error', rej);
  });
}

async function httpsGetJson(url) {
  const res = await httpsGet(url);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function download(url, destPath) {
  const res = await httpsGet(url);
  const out = createWriteStream(destPath);
  await pipeline(res, out);
}

function extractZip(zipPath, destDir) {
  // Use the system unzip — available on all GH-hosted runners and macOS
  mkdirSync(destDir, { recursive: true });
  execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`);
}

// ── version resolution ────────────────────────────────────────────────────────

async function resolveYomitanVersion(requested) {
  if (requested) return requested.startsWith('v') ? requested : `v${requested}`;
  console.log('Fetching latest stable Yomitan release…');
  const release = await httpsGetJson(
    'https://api.github.com/repos/yomidevs/yomitan/releases/latest',
  );
  return release.tag_name;
}

// ── download + extract ────────────────────────────────────────────────────────

async function fetchYomitanSource(tag) {
  const tmp = tmpdir();
  const zipPath = join(tmp, `yomitan-${tag}.zip`);
  const extractDir = join(tmp, `yomitan-${tag}`);

  const zipUrl = `https://github.com/yomidevs/yomitan/archive/refs/tags/${tag}.zip`;
  console.log(`Downloading Yomitan ${tag} from ${zipUrl}…`);
  await download(zipUrl, zipPath);

  console.log('Extracting…');
  extractZip(zipPath, extractDir);

  // GitHub archives extract to <repo>-<tag-without-v>/
  const innerName = `yomitan-${tag.replace(/^v/, '')}`;
  const srcDir = join(extractDir, innerName, 'ext', 'js');
  console.log(`Yomitan source root: ${srcDir}`);
  return { srcDir, tag, extractDir, zipPath };
}

// ── esbuild bundle ────────────────────────────────────────────────────────────

/**
 * Returns the JS source for the esbuild entry point.
 * It imports the Yomitan classes and wires them to the `da` bridge.
 */
function entrySource(srcDir) {
  // Use POSIX paths in the import statement (esbuild runs on Linux in CI)
  const gen = join(srcDir, 'dom', 'text-source-generator.js').replace(/\\/g, '/');
  return `
import { TextSourceGenerator } from '${gen}';

const _generator = new TextSourceGenerator();
let _enabled = true;

// Receive settings changes pushed by the host
if (typeof da !== 'undefined') {
  da.on('settingsChanged', (s) => { _enabled = s.enabled ?? true; });
}

function _scanAt(x, y) {
  if (!_enabled) return;
  const source = _generator.getRangeFromPoint(x, y, {
    forceOffset: false,
    allowExtensionUrl: false,
  });
  if (!source) return;
  const text = source.text();
  if (!text || !text.trim()) return;
  const rects = source.getRects();
  const rect = rects.length > 0 ? rects[0] : null;
  if (typeof da !== 'undefined') {
    da.emit('selection', {
      text,
      x,
      y,
      rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
    });
  }
}

let _lastX = 0, _lastY = 0, _rafPending = false;

document.addEventListener('mousemove', (e) => {
  _lastX = e.clientX;
  _lastY = e.clientY;
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => {
    _rafPending = false;
    _scanAt(_lastX, _lastY);
  });
}, { passive: true });

document.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  if (t) _scanAt(t.clientX, t.clientY);
}, { passive: true });
`.trimStart();
}

async function bundle(srcDir) {
  const tmp = tmpdir();
  const entryPath = join(tmp, 'text-selection-entry.mjs');
  writeFileSync(entryPath, entrySource(srcDir), 'utf8');

  const outPath = join(tmp, 'text-selection-bundle.js');

  // esbuild must be available; installed by the GH Action via npm
  execSync(
    `esbuild "${entryPath}" --bundle --format=iife --target=es2020 --outfile="${outPath}"`,
    { stdio: 'inherit' },
  );

  return readFileSync(outPath, 'utf8');
}

// ── version update helpers ────────────────────────────────────────────────────

function updateIndexVersion(indexPath, pluginId, newVersion) {
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  for (const p of index.plugins) {
    if (p.id === pluginId) { p.version = newVersion; break; }
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
}

function updateDapmVersion(dapmPath, newVersion) {
  const dapm = JSON.parse(readFileSync(dapmPath, 'utf8'));
  dapm.version = newVersion;
  writeFileSync(dapmPath, JSON.stringify(dapm, null, 2) + '\n', 'utf8');
}

// ── main ──────────────────────────────────────────────────────────────────────

const requestedTag = process.argv[2] ?? '';
const { srcDir, tag, extractDir, zipPath } = await fetchYomitanSource(
  await resolveYomitanVersion(requestedTag),
);

console.log('Bundling with esbuild…');
const bundleJs = await bundle(srcDir);

// Derive a version from the yomitan tag (strip leading 'v')
const yomitanVersion = tag.replace(/^v/, '');
const pluginVersion = `0.1.0-yomitan.${yomitanVersion}`;

const pluginDir = join(repoRoot, 'packs', 'default', 'plugins', 'text-selection');
const scriptPath = join(pluginDir, 'script.dap');
const dapmPath = join(pluginDir, 'plugin.dapm');
const indexPath = join(repoRoot, 'packs', 'default', 'index.json');

console.log(`Writing ${scriptPath}…`);
writeFileSync(scriptPath, bundleJs, 'utf8');

console.log(`Updating version to ${pluginVersion}…`);
updateDapmVersion(dapmPath, pluginVersion);
updateIndexVersion(indexPath, 'da.default.text-selection', pluginVersion);

// Expose version for the GH Action release step via GITHUB_ENV
if (process.env.GITHUB_ENV) {
  const packIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
  const packVersion = `${packIndex.version}-yomitan.${yomitanVersion}`;
  writeFileSync(process.env.GITHUB_ENV, `PACK_VERSION=${packVersion}\n`, { flag: 'a' });
}

// Cleanup
console.log('Cleaning up temporary files…');
rmSync(zipPath, { force: true });
rmSync(extractDir, { recursive: true, force: true });

console.log('Done.');
