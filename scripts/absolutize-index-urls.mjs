#!/usr/bin/env node
/**
 * Rewrites the relative codeUrls in packs/<pack>/index.json to absolute URLs,
 * so a consumer that reads the index without its surrounding directory (a copied
 * manifest, an offline cache) can still fetch every script. The base is the
 * directory of the index's own updateUrl. Runs in place; idempotent.
 *
 * Usage:
 *   node scripts/absolutize-index-urls.mjs [pack]
 *
 * Default: pack=default
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const pack = process.argv[2] ?? 'default';
const indexPath = join(repoRoot, 'packs', pack, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));

const updateUrl = index.updateUrl;
if (typeof updateUrl !== 'string' || !updateUrl.startsWith('http')) {
  throw new Error(`Pack "${pack}" needs an absolute http(s) updateUrl to resolve codeUrls against; got: ${updateUrl}`);
}
const base = updateUrl.slice(0, updateUrl.lastIndexOf('/') + 1);

let changed = 0;
for (const plugin of index.plugins ?? []) {
  const codeUrl = plugin.codeUrl;
  if (typeof codeUrl !== 'string' || codeUrl.startsWith('http') || codeUrl.startsWith('file:')) {
    continue;
  }
  plugin.codeUrl = base + codeUrl;
  changed++;
  console.log(`  ${plugin.id} → ${plugin.codeUrl}`);
}

if (changed > 0) {
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  console.log(`Updated ${changed} codeUrl(s) in ${indexPath}`);
} else {
  console.log(`No relative codeUrls to rewrite in ${indexPath}`);
}
