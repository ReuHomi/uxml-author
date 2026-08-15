// node scripts/preview.mjs job.json
//
// One render for the model (headless, here) and one for the human (the HTML
// this writes). Same check.js in both, so the two cannot disagree.
//
// EXIT CODE IS THE CONTRACT:
//   0  gate ran, everything passed
//   1  gate ran, something failed — collapse, overflow, unsupported, bad sheet
//   2  GATE DID NOT RUN — no judgement was made about this output
//
// 1 and 2 must never be merged. "checked and found a problem" and "never
// checked" look identical to a caller that only tests for zero, and the second
// one is how a skill starts shipping unverified files quietly.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: on Windows the latter yields '/C:/Users/...',
// which fs cannot open. Unity development is largely a Windows activity, so
// this is not an edge case here.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PER_ASSET_LIMIT = 512 * 1024;   // bytes on disk, before base64
const TOTAL_ASSET_LIMIT = 2 * 1024 * 1024;

function cannotRun(msg, hint) {
  console.error('CANNOT VERIFY — ' + msg);
  if (hint) console.error('  ' + hint);
  console.error('  The files may still be produced, but nothing has checked them.');
  process.exit(2);
}

// ── job ─────────────────────────────────────────────────────────────────────
const jobPath = process.argv[2];
if (!jobPath || !existsSync(jobPath)) cannotRun('no job file at ' + jobPath);
let job;
try { job = JSON.parse(readFileSync(jobPath, 'utf8')); }
catch (e) { cannotRun('job file is not valid JSON: ' + e.message); }

const base = dirname(resolve(jobPath));
const at = (p) => resolve(base, p);

if (!job.panel || !job.panel.width || !job.panel.height) {
  cannotRun('no panel size', 'Every % and stretch in the USS is measured against it; there is no safe default.');
}
if (!job.uxml || !existsSync(at(job.uxml))) cannotRun('no UXML at ' + job.uxml);
const uxml = readFileSync(at(job.uxml), 'utf8');

// ── environment ─────────────────────────────────────────────────────────────
let Window;
try { ({ Window } = await import('happy-dom')); }
catch {
  cannotRun('happy-dom is not installed, so there is no DOM to render into',
    'Run `npm install happy-dom`. Until then the preview HTML still works — it renders in the browser — but no machine has looked at it.');
}
const w = new Window({ url: 'http://localhost' });
Object.assign(globalThis, {
  window: w, document: w.document, HTMLElement: w.HTMLElement,
  Node: w.Node, getComputedStyle: w.getComputedStyle.bind(w),
});

try {
  await import(ROOT + 'src/core.bundle.js');
  await import(ROOT + 'src/check.js');
} catch (e) { cannotRun('the renderer bundle failed to load: ' + e.message); }
const core = globalThis.UxmlCore;
const check = globalThis.UxmlCheck;
try { await core.loadLayoutEngine(); }
catch (e) { cannotRun('the layout engine (Yoga/WASM) failed to start: ' + e.message); }

// ── prefetch sheets ─────────────────────────────────────────────────────────
// resolveImport is synchronous and a browser cannot reach a disk, so the sheets
// must be in hand before either render. Discovery is a parse-only pass.
// `<Style src>` is relative to the UXML, not to wherever the job file happens
// to sit. The demo hid this because the two were the same folder.
const sheetRoot = job.sheetRoot ? at(job.sheetRoot) : dirname(at(job.uxml));
const sheets = {};
const sheetMisses = [];
core.parse(uxml, undefined, {
  resolveImport: (url, from) => {
    const key = check.resolveSheetUrl(url, from || null);
    if (key in sheets) return sheets[key];
    const file = job.sheets && job.sheets[key] ? at(job.sheets[key]) : join(sheetRoot, key);
    if (!existsSync(file)) { sheetMisses.push({ key, file }); return null; }
    sheets[key] = readFileSync(file, 'utf8');
    return sheets[key];
  },
});

// ── encode assets, with a cap that is never silent ──────────────────────────
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
const assets = {};
const assetSkipped = [];
let assetTotal = 0;
for (const [uxmlPath, file] of Object.entries(job.assets || {})) {
  const abs = at(file);
  if (!existsSync(abs)) { assetSkipped.push({ path: uxmlPath, why: 'file not found: ' + file }); continue; }
  const buf = readFileSync(abs);
  if (buf.length > PER_ASSET_LIMIT) {
    assetSkipped.push({ path: uxmlPath, why: `${(buf.length / 1024).toFixed(0)} KB exceeds the ${PER_ASSET_LIMIT / 1024} KB per-file cap` });
    continue;
  }
  if (assetTotal + buf.length > TOTAL_ASSET_LIMIT) {
    assetSkipped.push({ path: uxmlPath, why: 'the total embedded-asset cap was already reached' });
    continue;
  }
  assetTotal += buf.length;
  const ext = abs.split('.').pop().toLowerCase();
  assets[uxmlPath] = `data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

// ── the gate ────────────────────────────────────────────────────────────────
const input = { uxml, sheets, assets, panel: job.panel };
let res;
try { res = check.run(core, w.document.createElement('div'), input); }
catch (e) { cannotRun('the render threw: ' + e.message); }

const problems = [];
const push = (t) => problems.push(t);

if (res.painted.childCount === 0) push('nothing was painted');
if (res.painted.elementCount !== res.painted.boxCount) {
  push(`${res.painted.boxCount - res.painted.elementCount} laid-out node(s) were never painted`);
}
if (sheetMisses.length) push(`${sheetMisses.length} stylesheet(s) could not be read — the coordinates below are wrong, not merely incomplete`);
res.collapsed.forEach((c) => push(`<${c.type}> #${c.name} has no size and is invisible`));
res.overflow.forEach((c) => push(`<${c.type}> #${c.name} runs outside the panel`));
res.other.forEach((x) => push(`${x.kind}: ${x.message}`));
assetSkipped.forEach((a) => push(`asset not embedded — ${a.path}: ${a.why}`));

res.dispose();

// ── report ──────────────────────────────────────────────────────────────────
const L = (s) => console.log(s);
L(`panel ${job.panel.width}x${job.panel.height}   sheets ${Object.keys(sheets).length}   assets embedded ${Object.keys(assets).length}`);

L(`\nnot drawn by this version (${res.unsupported.length}) — invisible here, visible in Unity; this list is the only trace`);
res.unsupported.forEach((x) => L('  - ' + x.message));

if (res.versionDependent.length) {
  L(`\nmeasured on Unity 6000.0.40f1 (${res.versionDependent.length}) — a standing condition, not a problem`);
  res.versionDependent.forEach((x) => L('  - ' + x.message));
}

L(`\nassets not yet present (${res.missingAssets.length}) — normal for new UI; drawn as a magenta hatch`);
res.missingAssets.forEach((x) => L('  - ' + x.message));

if (res.injected.length) {
  L(`\nsupplied for the preview only (${res.injected.length}) — these are NOT in the project; Unity will not show them`);
  res.injected.forEach((p) => L('  - ' + p));
}

L(`\nproblems (${problems.length})`);
problems.forEach((p) => L('  - ' + p));

// ── the human's copy ────────────────────────────────────────────────────────
const outPath = at(job.out || 'preview.html');
mkdirSync(dirname(outPath), { recursive: true });
const coreSrc = readFileSync(ROOT + 'src/core.bundle.js', 'utf8');
const checkSrc = readFileSync(ROOT + 'src/check.js', 'utf8');
for (const [n, s] of [['core', coreSrc], ['check', checkSrc]]) {
  if (s.includes('</script')) cannotRun(n + ' contains </script — inlining would break the page');
}
const page = readFileSync(ROOT + 'src/page.html', 'utf8')
  .replace('/*__CORE__*/', () => coreSrc)
  .replace('/*__CHECK__*/', () => checkSrc)
  .replace('"__INPUT__"', () => JSON.stringify({
    ...input,
    title: job.title || job.uxml,
    meta: { sheetMisses, assetSkipped, injectedNote: res.injected },
  }));
// The inlined copies must be byte-identical to their sources, and every block
// must actually parse. A page that silently fails to run is worse than no page:
// the human opens it, sees nothing, and has no idea whether that is the answer.
{
  const blocks = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks[0] !== coreSrc || blocks[1] !== checkSrc) cannotRun('inlining altered the renderer or the check');
  blocks.forEach((b, i) => {
    try { new Function(b); }
    catch (e) { cannotRun(`inlined script block ${i} does not parse: ${e.message}`); }
  });
}
writeFileSync(outPath, page);
L(`\npreview → ${outPath}  (${(page.length / 1024).toFixed(0)} KB)`);

process.exit(problems.length ? 1 : 0);
