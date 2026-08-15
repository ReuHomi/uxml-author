// Regenerates src/core.bundle.js — the ONE renderer both consumers share.
// The preview HTML inlines it in a <script> tag; the headless check imports it
// as an ES module. IIFE format is what lets a single artifact do both:
// a plain <script> under file:// (no module/CORS rules) and a side-effecting
// Node import that leaves globalThis.UxmlCore behind.
//
// Because there is only one renderer there is nothing to keep in sync, so this
// script carries no version stamp and no drift check. That is the point.
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'uxml-entry-'));
const entry = join(tmp, 'entry.js');
writeFileSync(entry, `import * as core from 'uxml-preview';\nglobalThis.UxmlCore = core;\n`);

await build({
  entryPoints: [entry],
  bundle: true, platform: 'browser', format: 'iife',
  target: 'es2022', minify: true,
  outfile: new URL('../src/core.bundle.js', import.meta.url).pathname,
});
console.log('core.bundle.js written');
