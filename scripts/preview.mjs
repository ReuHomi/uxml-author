// node scripts/preview.mjs job.json
//
// One render for the model (headless, here) and one for the human (the HTML
// this writes). Same check.js in both, so the two cannot disagree.
//
// EXIT CODE IS THE CONTRACT:
//   0  gate ran, everything passed
//   1  gate ran, something failed — collapse, overflow, unsupported, bad sheet
//   2  GATE DID NOT RUN — no judgement was made about this output, or not under
//      the conditions the job asked for (a state or budget that cannot be applied)
//   3  gate ran, no defect, but the preview is incomplete: an image was over the
//      embed budget. The budget needs adjusting, not the document.
//
// Precedence when more than one holds: 2 over 1 over 3 over 0. A defect and
// an over-budget image together are 1 — the defect is the news.
//
// 1 and 2 must never be merged. "checked and found a problem" and "never
// checked" look identical to a caller that only tests for zero, and the second
// one is how a skill starts shipping unverified files quietly.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, not .pathname: on Windows the latter yields '/C:/Users/...',
// which fs cannot open. Unity development is largely a Windows activity, so
// this is not an edge case here.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Bytes on disk, before base64. 1 MB here is 1024 × 1024 bytes.
const MB = 1024 * 1024;
const DEFAULT_BUDGET = { perFileMB: 4, totalMB: 16 };
const mb = (bytes) => (bytes / MB).toFixed(2) + ' MB';

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

// A budget the job got wrong is a job that cannot be run as written. Falling
// back to the default would check a different preview from the one asked for.
const budget = { ...DEFAULT_BUDGET };
if (job.assetBudget !== undefined) {
  const b = job.assetBudget;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    cannotRun('assetBudget must be an object like { "perFileMB": 8, "totalMB": 32 }, got ' + JSON.stringify(b));
  }
  for (const [k, v] of Object.entries(b)) {
    if (!(k in DEFAULT_BUDGET)) cannotRun(`assetBudget.${k} is not a budget; use perFileMB and/or totalMB`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      cannotRun(`assetBudget.${k} must be a positive number of MB, got ${JSON.stringify(v)}`);
    }
    budget[k] = v;
  }
}
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
  // pathToFileURL, not a bare path: on Windows `import('C:\\...')` is read as a
  // URL whose scheme is `C:` and throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
  await import(pathToFileURL(ROOT + 'src/core.bundle.js').href);
  await import(pathToFileURL(ROOT + 'src/check.js').href);
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
const uxmlRoot = dirname(at(job.uxml));
const sheets = {};
const sheetMisses = [];

// A template `src` is relative to the UXML that declares it, not to the sheet
// root, and a stylesheet reached through a template belongs to that template's
// folder. Sheets and templates therefore cannot share one base directory.
const templates = {};
const templateMisses = [];

function readSheet(key, baseDir) {
  if (key in sheets) return sheets[key];
  const file = job.sheets && job.sheets[key] ? at(job.sheets[key]) : join(baseDir, key);
  if (!existsSync(file)) { sheetMisses.push({ key, file }); return null; }
  sheets[key] = readFileSync(file, 'utf8');
  return sheets[key];
}

// Template dependencies are a graph, and `collectDependencies` reports one hop.
// Walking to a fixed point is the host's job: the core's resolver is synchronous,
// so every document in the closure must already be in hand before the render.
// MAX_ROUNDS is not a depth limit — the core caps nesting at 32 on its own — it
// is the guarantee that a cyclic document cannot spin here instead of being
// reported as a cycle by the party that can name the path.
// Every key here is relative to the ENTRY document's folder, because that is
// what the core produces: it resolves a nested reference against the URL of the
// document holding it, and that URL is itself already entry-relative. Prefetching
// under any other key stores the right bytes where the renderer will not look —
// which surfaced as an `import-unresolved` for a template's own stylesheet, with
// the file sitting in the map the whole time.
const MAX_ROUNDS = 64;
{
  const pending = [{ source: uxml, fromKey: null }];
  const seen = new Set();
  let rounds = 0;
  while (pending.length) {
    if (++rounds > MAX_ROUNDS) {
      cannotRun(`template dependencies did not settle after ${MAX_ROUNDS} documents`,
        'A cycle should be reported by the renderer, which can name the path. Spinning here instead is a bug in the prefetch, not in your UXML.');
    }
    const { source, fromKey } = pending.shift();
    let deps;
    try { deps = core.collectDependencies(source); }
    catch (e) { cannotRun('a template declaration could not be read: ' + e.message); }
    for (const raw of deps) {
      const key = check.resolveSheetUrl(raw, fromKey);
      if (seen.has(key)) continue;           // one read per document, N expansions
      seen.add(key);
      const file = job.templates && job.templates[key] ? at(job.templates[key]) : join(uxmlRoot, key);
      if (!existsSync(file)) { templateMisses.push({ key, file }); continue; }
      const text = readFileSync(file, 'utf8');
      templates[key] = text;
      pending.push({ source: text, fromKey: key });
    }
  }
}

// Sheets: one parse pass over the entry document and over every template just
// pulled in, because a template carries its own `<Style src>`. The template pass
// hands its own key as `from`, so `../Styles/x.uss` inside `Parts/Slot.uxml`
// lands under `Styles/x.uss` — the key the renderer will ask for.
core.parse(uxml, undefined, {
  resolveImport: (url, from) => readSheet(check.resolveSheetUrl(url, from || null), sheetRoot),
});
for (const [key, text] of Object.entries(templates)) {
  core.parse(text, undefined, {
    resolveImport: (url, from) => readSheet(check.resolveSheetUrl(url, from || key), uxmlRoot),
  });
}

// ── encode assets, within a budget that is never silent ─────────────────────
// Two outcomes, kept apart. A file that is not there is a broken job and stays
// a problem. A file over the budget is fine — the preview is just short of it —
// so it goes to its own list, which on its own makes the exit code 3, not 1.
// Files are read, never written: nothing here converts or replaces a source.
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
const assets = {};
const assetSkipped = [];
const overBudget = [];
const perFileLimit = budget.perFileMB * MB, totalLimit = budget.totalMB * MB;
let assetTotal = 0;
for (const [uxmlPath, file] of Object.entries(job.assets || {})) {
  const abs = at(file);
  if (!existsSync(abs)) { assetSkipped.push({ path: uxmlPath, why: 'file not found: ' + file }); continue; }
  const buf = readFileSync(abs);
  const over = (why) => overBudget.push({ path: uxmlPath, file, bytes: buf.length, why, budget: { ...budget } });
  if (buf.length > perFileLimit) {
    over(`${mb(buf.length)} is over the ${budget.perFileMB} MB per-file budget`);
    continue;
  }
  // Files are taken in job order, and one that does not fit does not stop the
  // ones after it: a smaller file later in the list can still be embedded.
  if (assetTotal + buf.length > totalLimit) {
    over(`would bring the embedded total to ${mb(assetTotal + buf.length)}, over the ${budget.totalMB} MB total budget (${mb(assetTotal)} already embedded)`);
    continue;
  }
  assetTotal += buf.length;
  const ext = abs.split('.').pop().toLowerCase();
  assets[uxmlPath] = `data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

// ── states ──────────────────────────────────────────────────────────────────
// Judged in check.js, where the page judges them too. A state that cannot be
// applied means the screen we would check is not the one asked about, so the
// answer is "did not run", not a finding about the document.
const stateInput = { uxml, sheets, templates, states: job.states, activeStates: job.activeStates };
{
  let st;
  try { st = check.checkStates(core, stateInput); }
  catch (e) { cannotRun('the requested states could not be checked: ' + e.message); }
  if (st.errors.length) {
    cannotRun('the requested states cannot be applied, so this is not the screen asked about:\n  - ' +
      st.errors.join('\n  - '));
  }
}

// ── the gate ────────────────────────────────────────────────────────────────
// `states` and `activeStates` travel as plain JSON on the input, so the page
// inlines exactly what was checked here and converts it the same way.
const input = { uxml, sheets, templates, assets, panel: job.panel,
                states: stateInput.states, activeStates: stateInput.activeStates };
let res;
try { res = check.run(core, w.document.createElement('div'), input); }
catch (e) { cannotRun('the render threw: ' + e.message); }

// The verdict is check.js's, so the page reaches the same one.
const meta = { sheetMisses, templateMisses, assetSkipped, overBudget, injectedNote: res.injected };
const verdict = check.judge(res, meta);
const problems = verdict.problems;

res.dispose();

// ── report ──────────────────────────────────────────────────────────────────
const L = (s) => console.log(s);
L(`panel ${job.panel.width}x${job.panel.height}   sheets ${Object.keys(sheets).length}   templates ${Object.keys(templates).length}   assets embedded ${Object.keys(assets).length}`);
L(check.describeStates(res.applied));

L(`\nnot drawn by this version (${res.unsupported.length}) — invisible here, visible in Unity; this list is the only trace`);
res.unsupported.forEach((x) => L('  - ' + x.message));

// Two sources, and neither alone is enough: the core reports a repeated name
// only once expansion produced it, so a hand-written document that repeats one
// is invisible to it. Our own painting sees both. Reporting on the union is what
// keeps a repeat from going unmentioned in either direction.
{
  const collided = [...new Set(res.painted.textCollisions)];
  if (res.repeatedNames.length || collided.length) {
    // The wording used to claim a template even when there was none: a
    // hand-written document that repeats a name got told this was "normal once
    // a template is used twice", which is a different situation with a different
    // fix. Say which one it is.
    L(res.repeatedNames.length
      ? `\nnames that address more than one element — unavoidable once a template is used twice, and not a fault in the screen`
      : `\nnames that address more than one element — nothing here repeats a template, so these are repeats written by hand`);
    res.repeatedNames.forEach((x) => L('  - ' + x.message));
    if (collided.length) L(`  - ${collided.join(', ')} — the text reported below is the FIRST element's`);
    L('  Q<T>() reaches only the first. bind-csharp refuses these names rather than');
    L('  deriving fields that would all point at the same element.');
  }
}

// Hidden is never a defect and never silent: a class typo hides an element
// just as well as an intended state does, and only a person can tell which.
L(`\nhidden by display: none (${res.hidden.length}) — not a problem; check each one is meant to be hidden`);
res.hidden.forEach((h) => L(`  - <${h.type}> #${h.name} — ` +
  (h.by.self ? 'itself' : `inside #${h.by.name || '(unnamed ' + h.by.type + ')'}`) + `, by ${h.origin}`));

if (res.emptied.length) {
  L(`\nemptied by hidden children (${res.emptied.length}) — zero size only because everything inside it is hidden; not a problem`);
  res.emptied.forEach((e) => L(`  - <${e.type}> #${e.name}`));
  L('  If that is not the state you meant, check the rules that hide its children.');
}

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

// Listed apart from problems on purpose: the document is not at fault, the
// preview is short of an image. The fix is a bigger budget or a smaller file,
// never an edit to the UXML or USS.
if (overBudget.length) {
  L(`\nover the embed budget (${overBudget.length}) — the preview is incomplete, not the document; these are drawn as not yet present`);
  overBudget.forEach((a) => L(`  - ${a.path} (${a.file}, ${mb(a.bytes)}): ${a.why}   [budget ${a.budget.perFileMB} MB per file, ${a.budget.totalMB} MB total]`));
  L('  Raise assetBudget in the job to include them; the source files are never changed.');
}

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
    meta,
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

// See tests/conditions.mjs: leaving happy-dom open across process teardown is
// a native-crash hazard, and a crash here would replace the exit-code contract
// with whatever the OS reports.
await w.happyDOM.close();

process.exit(verdict.code);
