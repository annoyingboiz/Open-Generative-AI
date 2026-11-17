#!/usr/bin/env node
// Builds src/catalog/apimart-overrides.json from APIMart's public docs.
//   node scripts/apimart-docs.mjs            # fetch docs and write the file
//   node scripts/apimart-docs.mjs --dir DIR  # use already downloaded .md files
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApimartOverrides, fetchApimartDocs } from '../src/catalog/apimart-docs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'src', 'catalog', 'apimart-overrides.json');

async function loadDocs() {
  const dirArg = process.argv.indexOf('--dir');
  if (dirArg > 0) {
    const dir = process.argv[dirArg + 1];
    return fs.readdirSync(dir).map((f) => ({ url: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
  }
  const { docs, total, failed } = await fetchApimartDocs({ fetchFn: (url) => fetch(url) });
  if (failed) console.warn(`${failed} of ${total} pages failed`);
  return docs;
}

const out = buildApimartOverrides(await loadDocs());
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${Object.keys(out).length} models → ${path.relative(process.cwd(), OUT)}`);
