// Regenerates src/core.bundle.js — the ONE renderer both consumers share.
// The preview HTML inlines it in a <script> tag; the headless check imports it
// as an ES module. IIFE format is what lets a single artifact do both:
// a plain <script> under file:// (no module/CORS rules) and a side-effecting
// Node import that leaves globalThis.UxmlCore behind.
//
// Because there is only one renderer there is nothing to keep in sync, so this
// script carries no drift check. It does stamp the core version it built from:
// the bundle is committed, and "which core is this" was a question that had no
// answer in the file itself the first time it mattered.
//
// NOT MINIFIED, on purpose. Minifying saved 51 KB (177 vs 228 KB) and cost the
// only review a committed build artifact can get: minified, the whole bundle is
// 15 lines, so bumping the core produces one unreadable diff line. Unminified it
// is ~3,700 lines with module boundaries marked, and an upgrade diff shows where
// the change landed. The preview HTML grows by the same 51 KB, which is the
// cheaper side of that trade.
//
// Identifiers stay mangled regardless: uxml-preview publishes an already-mangled
// dist with no sourcemaps, so there are no original names left to recover here.
// That is a core-side limitation, not one this script can fix.
//
// Maintainers only, and deliberately not a dependency: Claude Code runs
// `npm ci` on plugin install, which would then pull esbuild's platform binaries
// onto every user's machine for a script none of them run.
//
//   npm install --no-save esbuild uxml-preview@0.5.0
//
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'uxml-entry-'));
const entry = join(tmp, 'entry.js');
writeFileSync(entry, `import * as core from 'uxml-preview';\nglobalThis.UxmlCore = core;\n`);

// The entry sits in the OS temp dir, so Node's usual "walk up from the importer"
// never reaches this checkout's node_modules — resolution failed outright rather
// than picking up something stale. nodePaths pins it to the one install we mean.
const nodeModules = fileURLToPath(new URL('../node_modules', import.meta.url));

// Read the version from the package actually being bundled, never from a
// constant here — a constant is a second place to forget.
const corePkg = JSON.parse(
  readFileSync(join(nodeModules, 'uxml-preview', 'package.json'), 'utf8'));

const banner = [
  '/*',
  ' * GENERATED FILE — do not edit. Regenerate with `npm run build:core`.',
  ' *',
  ` * uxml-preview ${corePkg.version}, bundled as an IIFE that leaves`,
  ' * globalThis.UxmlCore behind. Both consumers load this same file: the preview',
  ' * HTML inlines it in a <script> tag, and the headless gate imports it.',
  ' *',
  ' * Not minified so that bumping the core produces a diff a person can read.',
  ' * Identifiers are already mangled upstream (uxml-preview ships a mangled dist',
  ' * with no sourcemaps), so this is as legible as the artifact gets here.',
  ' */',
].join('\n');

await build({
  entryPoints: [entry],
  bundle: true, platform: 'browser', format: 'iife',
  target: 'es2022', minify: false,
  banner: { js: banner },
  nodePaths: [nodeModules],
  outfile: fileURLToPath(new URL('../src/core.bundle.js', import.meta.url)),
});
console.log(`core.bundle.js written from uxml-preview ${corePkg.version}`);
