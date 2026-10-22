// The exit code is the contract. 1 and 2 must stay distinguishable:
// "checked, found a problem" vs "never checked". 3 is a third thing again:
// "checked, nothing wrong with the document, but the preview is short of an
// image the budget kept out" — and it must never hide a 1.
import { execFileSync, execFileSync as run } from 'node:child_process';
import { writeFileSync, mkdirSync, renameSync, existsSync, rmSync,
         readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = ROOT + 'tests/tmp/';

// Written out rather than using fs.cpSync, which on Windows crashes the process
// outright — STATUS_ACCESS_VIOLATION, no output, no stack — when either path
// contains a non-ASCII character. Two independent runs found it on Node v22.17.0
// under a Korean user folder; a path with spaces is fine, so the trigger is the
// character set. Product code never touched it, but a checker that dies without
// saying so is the one failure this repo cannot tolerate: the caller cannot tell
// "checked and failed" from "never ran", which is the whole point of 1 vs 2.
// readdir + copyFile is the same work through a code path that does not crash.
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) copyFileSync(src, dst);
  }
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP + 'Styles', { recursive: true });
copyTree(ROOT + 'demo', TMP + 'demo');

let failures = 0;
function expect(cond, what) { if (!cond) failures++; console.log((cond ? '  ok   ' : '  FAIL ') + what); }

function exitOf(jobPath) {
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', jobPath], { stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
}
function job(name, obj) {
  const p = TMP + name + '.json';
  writeFileSync(p, JSON.stringify({ ...obj, out: '../out/' + name + '.html' }));
  return p;
}
const goodJob = TMP + 'demo/job.json';
function runJob(jobPath) {
  try { return { code: 0, out: execFileSync('node', [ROOT + 'scripts/preview.mjs', jobPath], { encoding: 'utf8', stdio: 'pipe' }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
// Mutations rewrite a source file for one run and put it back. The replaced
// text must be present, or the mutation tested nothing — that is a failure.
function mutate(file, from, to, fn) {
  const path = ROOT + file, orig = readFileSync(path, 'utf8');
  if (!orig.includes(from)) { expect(false, `mutation target is present in ${file}: ${from}`); return; }
  try { writeFileSync(path, orig.replace(from, to)); fn(); } finally { writeFileSync(path, orig); }
}
// What the page a person opens decided, read by actually running it.
function pageOf(name) {
  return JSON.parse(execFileSync('node', [ROOT + 'tests/page-verdict.mjs', TMP + '../out/' + name + '.html'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

console.log('\ncode 0 — gate ran, clean');
expect(exitOf(goodJob) === 0, 'the demo passes');

console.log('\ncode 2 — the gate did not run');
expect(exitOf(TMP + 'nope.json') === 2, 'no job file');
writeFileSync(TMP + 'bad.json', '{ not json');
expect(exitOf(TMP + 'bad.json') === 2, 'unparseable job');
expect(exitOf(job('nopanel', { uxml: 'demo/Inventory.uxml' })) === 2, 'no panel size');
expect(exitOf(job('nouxml', { uxml: 'demo/Missing.uxml', panel: { width: 400, height: 300 } })) === 2, 'no UXML file');
{
  const mod = ROOT + 'node_modules/happy-dom';
  const hidden = ROOT + 'node_modules/.happy-dom-hidden';
  let moved = false;
  try {
    if (existsSync(mod)) { renameSync(mod, hidden); moved = true; }
    const hd = runJob(goodJob);
    expect(hd.code === 2, 'happy-dom missing → 2, not a silent pass');
    expect(!/may still be produced|preview HTML still works/.test(hd.out) && /No preview was written/.test(hd.out),
      'and it does not claim a preview page exists');
  } finally { if (moved) renameSync(hidden, mod); }
  expect(exitOf(goodJob) === 0, 'and it recovers once happy-dom is back');
}

console.log('\nevery refusal says what is on disk, and none claims a file it did not write');
{
  const { readFileSync, statSync } = await import('node:fs');
  // Each path that ends in code 2, grouped by where it stops. None of them
  // writes the page; the message must say so, and must name a stale page left
  // at the output path by an earlier run instead of letting it pass as new.
  const OLD = /may still be produced/;
  const NONE = /No preview was written, and nothing was checked\./;
  const STALE = /No preview was written by this run\. The file already at .*stale\.html is from an earlier run/;
  const inv = { uxml: 'demo/Inventory.uxml', panel: { width: 480, height: 320 } };
  const paths = [
    ['no job file', () => runJob(TMP + 'nope.json')],
    ['unparseable job', () => runJob(TMP + 'bad.json')],
    ['job format: no panel', () => runJob(job('r-nopanel', { uxml: 'demo/Inventory.uxml' }))],
    ['job format: bad budget', () => runJob(job('r-budget', { ...inv, assetBudget: { perFileMB: 0 } }))],
    ['states that cannot apply', () => runJob(job('r-states', { ...inv, states: { '#Nope': ['hover'] } }))],
  ];
  for (const [what, go] of paths) {
    const r = go();
    expect(r.code === 2 && NONE.test(r.out) && !OLD.test(r.out), `${what} → 2, "no preview was written", nothing about files being produced`);
  }
  for (const n of ['r-nopanel', 'r-budget', 'r-states']) {
    expect(!existsSync(TMP + '../out/' + n + '.html'), `and ${n} really left no page behind`);
  }

  // A page from an earlier run sits at the output path. The refusal names it
  // as old, and leaves it exactly as it was.
  mkdirSync(TMP + '../out', { recursive: true });
  const stalePath = TMP + '../out/stale.html';
  for (const [what, extra] of [['bad budget', { assetBudget: { totalMB: -1 } }], ['states', { states: { '#Use': 'hover' } }],
                               ['no panel', { panel: undefined }]]) {
    writeFileSync(stalePath, '<!-- from an earlier run -->');
    const before = statSync(stalePath).mtimeMs;
    const p = TMP + 'stale.json';
    writeFileSync(p, JSON.stringify({ ...inv, ...extra, out: '../out/stale.html' }));
    const r = runJob(p);
    expect(r.code === 2 && STALE.test(r.out) && !NONE.test(r.out),
      `${what} with an old page at the output path → the message calls it an earlier run's, unchecked`);
    expect(readFileSync(stalePath, 'utf8') === '<!-- from an earlier run -->' && statSync(stalePath).mtimeMs === before,
      'and the old page is left untouched');
  }
  // mutations
  mutate('scripts/preview.mjs', "  return '  No preview was written, and nothing was checked.';",
    "  return '  The files may still be produced, but nothing has checked them.';", () => {
      const r = runJob(job('r-nopanel', { uxml: 'demo/Inventory.uxml' }));
      expect(OLD.test(r.out), 'mutation (the old closing line) → the no-panel case sees it and fails');
    });
  mutate('scripts/preview.mjs', '  if (outPath && existsSync(outPath)) {', '  if (false) {', () => {
    writeFileSync(stalePath, '<!-- from an earlier run -->');
    const r = runJob(TMP + 'stale.json');
    expect(!STALE.test(r.out), 'mutation (stale page not looked for) → the earlier-run case catches it');
  });
  mutate('scripts/preview.mjs', "outPath = at(job.out || 'preview.html');\n", '', () => {
    writeFileSync(stalePath, '<!-- from an earlier run -->');
    const r = runJob(TMP + 'stale.json');
    expect(!STALE.test(r.out), 'mutation (output path known only at the end) → the earlier-run case catches it');
  });
  rmSync(stalePath, { force: true });
}

console.log('\nan unexpected error is code 2, never 1');
{
  // Node exits 1 on an unhandled error, and 1 is "checked, found a problem".
  // Each case here is a run that decided nothing; each must say so with a 2.
  const NOT_JUDGED = /not a judgement of the UXML or USS/;
  for (const [text, what, re] of [['null', 'null', /holds null/], ['42', 'a number', /holds a number \(42\)/],
                                   ['[{"uxml":"x"}]', 'an array', /holds an array/], ['"job.json"', 'a string', /holds a string \("job\.json"\)/]]) {
    const p = TMP + 'shape.json';
    writeFileSync(p, text);
    const r = runJob(p);
    expect(r.code === 2 && /must hold a JSON object/.test(r.out) && re.test(r.out) && !/TypeError/.test(r.out),
      `a job that is ${what} → 2, refused by name rather than by a crash (got ${r.code})`);
  }

  const AFTER_CHECK = "catch (e) { cannotRun('the render threw: ' + e.message); }\n";
  mutate('scripts/preview.mjs', AFTER_CHECK, AFTER_CHECK + "throw new Error('mutation: thrown after the check');\n", () => {
    rmSync(TMP + 'out/preview.html', { force: true });
    const r = runJob(goodJob);
    expect(r.code === 2, `mutation (throw right after the check) → 2, not 1 (got ${r.code})`);
    expect(/thrown after the check/.test(r.out) && NOT_JUDGED.test(r.out) && /No preview was written, and nothing was checked/.test(r.out),
      'and the message carries the error, says it is not a judgement, and says no preview was written');
    writeFileSync(TMP + 'out/preview.html', '<!-- from an earlier run -->');
    const s2 = runJob(goodJob);
    expect(s2.code === 2 && /is from an earlier run/.test(s2.out), 'with an old page at the path, it names that page as an earlier run\'s');
    rmSync(TMP + 'out/preview.html', { force: true });

    // The net is what makes this a 2. Without it Node's own 1 comes back.
    mutate('scripts/preview.mjs', "process.on('uncaughtException', unexpected);\n", '', () =>
      expect(runJob(goodJob).code === 1, 'mutation (no safety net) → the same throw exits 1, so the case above catches it'));
  });
  mutate('scripts/preview.mjs', AFTER_CHECK, AFTER_CHECK + "await Promise.reject(new Error('mutation: rejected after the check'));\n", () => {
    const r = runJob(goodJob);
    expect(r.code === 2 && /rejected after the check/.test(r.out) && NOT_JUDGED.test(r.out),
      `mutation (a rejected await after the check) → 2 (got ${r.code})`);
  });
  // A rejection nobody awaits. Under Node's default it is rethrown and the
  // uncaughtException hook would catch it anyway; the rejection hook is what
  // holds when Node is told only to warn, where without it the run carries on
  // and can exit 0 on a check that broke halfway.
  {
    const warnOnly = (jobPath) => {
      try { execFileSync('node', ['--unhandled-rejections=warn', ROOT + 'scripts/preview.mjs', jobPath], { stdio: 'pipe' }); return 0; }
      catch (e) { return e.status; }
    };
    mutate('scripts/preview.mjs', AFTER_CHECK, AFTER_CHECK + "Promise.reject(new Error('mutation: a rejection nobody awaits'));\n", () => {
      expect(warnOnly(goodJob) === 2, 'mutation (a floating rejection, Node set to warn only) → 2');
      mutate('scripts/preview.mjs', "process.on('unhandledRejection', unexpected);\n", '', () =>
        expect(warnOnly(goodJob) === 0, 'mutation (no rejection hook) → the broken run exits 0, so the case above catches it'));
    });
  }
  mutate('scripts/preview.mjs', "pageWritten = true;\n", "pageWritten = true;\nthrow new Error('mutation: thrown after the page');\n", () => {
    const r = runJob(goodJob);
    expect(r.code === 2 && /A preview was written to .* but the run did not finish; do not present it as checked/.test(r.out),
      `mutation (throw after the page is written) → 2, and the message says the page exists but is not checked (got ${r.code})`);
  });
  mutate('scripts/preview.mjs', "if (job === null || typeof job !== 'object' || Array.isArray(job)) {", 'if (false) {', () => {
    writeFileSync(TMP + 'shape.json', 'null');
    const r = runJob(TMP + 'shape.json');
    expect(r.code === 2 && !/must hold a JSON object/.test(r.out) && NOT_JUDGED.test(r.out),
      'mutation (no shape check) → the net still gives 2, but the reason is a stack trace, which the shape case catches');
  });
  runJob(goodJob);
}

console.log('\ncode 1 — gate ran, judgement failed');
writeFileSync(TMP + 'Collapse.uxml',
  `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/C.uss" />
   <ui:VisualElement name="Box"><ui:Image name="Loose" /></ui:VisualElement></ui:UXML>`);
writeFileSync(TMP + 'Styles/C.uss', '#Box { width: 100px; height: 100px; }');
expect(exitOf(job('collapse', { uxml: 'Collapse.uxml', panel: { width: 300, height: 200 } })) === 1,
  'a sizeless Image collapses → 1');

writeFileSync(TMP + 'NoSheet.uxml',
  `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/Gone.uss" />
   <ui:VisualElement name="Box" /></ui:UXML>`);
expect(exitOf(job('nosheet', { uxml: 'NoSheet.uxml', panel: { width: 300, height: 200 } })) === 1,
  'an unreadable stylesheet → 1 (wrong coordinates, not merely missing style)');

console.log('\nhidden is reported, never counted');
{
  // The external report's fixture, verbatim.
  writeFileSync(TMP + 'Report.uxml', `<ui:UXML xmlns:ui="UnityEngine.UIElements">
    <ui:VisualElement name="Hidden" style="display:none;width:80px;height:40px">
        <ui:VisualElement name="Child" style="width:20px;height:10px" />
    </ui:VisualElement>
</ui:UXML>`);
  const r = runJob(job('report', { uxml: 'Report.uxml', panel: { width: 300, height: 200 } }));
  expect(r.code === 0, `display: none on a parent and its child → 0 (got ${r.code})`);
  expect(/hidden by display: none \(2\)/.test(r.out) && /#Hidden — itself, by inline style attribute/.test(r.out) &&
    /#Child — inside #Hidden/.test(r.out), 'and both are listed, with what hid them');
  const pg = pageOf('report');
  expect(/^Pass/.test(pg.verdict), 'the page agrees: ' + pg.verdict);
  expect(pg.channels['Hidden by display: none'].count === 2, 'and lists the same two as hidden');
  expect(pg.channels['Collapsed to zero size'].count === 0, 'and none as collapsed');

  writeFileSync(TMP + 'Styles/E.uss', '.gone { display: none; } .sized { width: 20px; height: 20px; }');
  writeFileSync(TMP + 'Emptied.uxml', `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/E.uss" />
    <ui:VisualElement name="Tabs"><ui:VisualElement name="Page" class="gone sized" /></ui:VisualElement></ui:UXML>`);
  const e = runJob(job('emptied', { uxml: 'Emptied.uxml', panel: { width: 300, height: 200 } }));
  expect(e.code === 0, `a container emptied by hidden children → 0 (got ${e.code})`);
  expect(/emptied by hidden children \(1\)/.test(e.out) && /#Tabs/.test(e.out) &&
    /check the rules that hide its children/.test(e.out), 'and it is listed with a prompt to confirm it was meant');
  const pe = pageOf('emptied');
  expect(/^Pass/.test(pe.verdict) && pe.channels['Emptied by hidden children'].count === 1, 'the page agrees');

  writeFileSync(TMP + 'Mixed.uxml', `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/E.uss" />
    <ui:VisualElement name="Box"><ui:VisualElement name="Page" class="gone sized" /><ui:Image name="Loose" /></ui:VisualElement></ui:UXML>`);
  const m = runJob(job('mixed', { uxml: 'Mixed.uxml', panel: { width: 300, height: 200 } }));
  expect(m.code === 1, `a visible zero-size child next to a hidden one → 1 (got ${m.code})`);
  const pm = pageOf('mixed');
  expect(!/^Pass/.test(pm.verdict) && pm.channels['Collapsed to zero size'].count === 2,
    'and the page does not pass it either: ' + pm.verdict);
}

console.log('\nstates come from the job, and a state that cannot be applied is not a judgement');
{
  writeFileSync(TMP + 'Styles/U.uss', '#Panel { width: 300px; height: 200px; }\n#Use { width: 80px; }\n#Use:hover { width: 140px; }');
  writeFileSync(TMP + 'Use.uxml', `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/U.uss" />
    <ui:VisualElement name="Panel"><ui:Button name="Use" text="Use" /></ui:VisualElement></ui:UXML>`);
  const base = { uxml: 'Use.uxml', panel: { width: 400, height: 300 } };
  const ok = runJob(job('states', { ...base, states: { '#Use': ['hover'] }, activeStates: ['disabled'] }));
  expect(ok.code === 0, `a job with states runs → 0 (got ${ok.code})`);
  const line = ok.out.split('\n')[1];
  expect(line === 'states: #Use :hover   every element :disabled', 'the second line of the report names them: ' + line);
  const pg = pageOf('states');
  expect(pg.applied === line, 'and the page shows the same line: ' + pg.applied);
  const none = runJob(job('nostates', base));
  expect(none.code === 0 && none.out.split('\n')[1] === 'states: none applied (the default)',
    'omitted, the report says so and nothing else changes');

  const refused = [
    [{ states: { '#Use': 'hover' } }, /must be an array.*the string "hover"/, 'a string where an array belongs'],
    [{ activeStates: { hover: true } }, /activeStates must be an array/, 'activeStates not an array'],
    [{ states: { '#Nope': ['hover'] } }, /"#Nope" matches no element/, 'a key matching nothing'],
    [{ states: { '#Use[x]': ['hover'] } }, /"#Use\[x\]" is not a usable USS selector/, 'a key the core refuses as a selector'],
    [{ states: { '#Use': ['pressed'] } }, /"pressed", which is not a Unity state/, 'a state Unity does not have'],
  ];
  refused.forEach(([extra, re, what], i) => {
    const r = runJob(job('refuse' + i, { ...base, ...extra }));
    expect(r.code === 2 && re.test(r.out), `${what} → 2, and the message says which and why (got ${r.code})`);
  });
}

console.log('\nthe theme: the job asks, the core draws, and the report says which was drawn');
{
  const base = { uxml: 'Use.uxml', panel: { width: 400, height: 300 } };
  const first = (r) => r.out.split('\n')[0];
  const dflt = runJob(job('theme-default', base));
  expect(dflt.code === 0 && /^theme runtime   panel 400x300/.test(first(dflt)), 'no theme in the job → the first line says runtime: ' + first(dflt));
  const edit = runJob(job('theme-editor', { ...base, theme: 'editor' }));
  expect(edit.code === 0 && /^theme editor   panel 400x300/.test(first(edit)), 'theme: "editor" → the first line says editor: ' + first(edit));
  const run = runJob(job('theme-runtime', { ...base, theme: 'runtime' }));
  expect(run.code === 0 && /^theme runtime   panel/.test(first(run)), 'theme: "runtime" asked outright is the default');
  const bad = runJob(job('theme-bad', { ...base, theme: 'dark' }));
  expect(bad.code === 1 && /^theme runtime   panel/.test(first(bad)),
    'an unknown theme → 1, and the first line says what was drawn (runtime), not what was asked: ' + first(bad));
  expect(/malformed: Unknown theme 'dark' in the theme option; drew the default theme 'runtime'/.test(bad.out),
    'and the core\'s warning is in the report in its own words');
  expect(runJob(job('theme-null', { ...base, theme: null })).code === 1, 'null is not "no theme": it is a value the core refuses → 1');
  expect(dflt.out.split('\n')[1] === 'states: none applied (the default)', 'the states line is still the second line');

  const pd = pageOf('theme-default'), pe = pageOf('theme-editor'), pb = pageOf('theme-bad');
  expect(pd.theme === 'theme runtime' && pe.theme === 'theme editor' && pb.theme === 'theme runtime',
    `the page names the same theme as the report: ${pd.theme} / ${pe.theme} / ${pb.theme}`);
  expect(/^Pass/.test(pe.verdict) && /^Attention/.test(pb.verdict), 'and reaches the same verdict on each');

  // mutations
  mutate('scripts/preview.mjs', 'theme: job.theme', 'theme: undefined', () =>
    expect(!/^theme editor/.test(first(runJob(TMP + 'theme-editor.json'))), 'mutation (the job\'s theme never reaches the check) → an editor job reports runtime'));
  mutate('scripts/preview.mjs', 'L(`${check.describeTheme(res)}   panel', "L(`theme ${job.theme || 'runtime'}   panel", () =>
    expect(/^theme dark/.test(first(runJob(TMP + 'theme-bad.json'))), 'mutation (print what was asked) → an unknown theme is reported as "dark"'));
  mutate('src/page.html', 'globalThis.UxmlCheck.describeTheme(res)', "'theme ' + (UXML_INPUT.theme || 'runtime')", () => {
    runJob(TMP + 'theme-bad.json');
    expect(pageOf('theme-bad').theme === 'theme dark', 'mutation (the page prints what was asked) → an unknown theme is shown as "dark"');
  });
  runJob(TMP + 'theme-bad.json');              // put the unmutated page back before anything reads it
}

console.log('\nG — the cap is never silent');
{
  const p = job('cap', {
    uxml: 'demo/Inventory.uxml', panel: { width: 480, height: 320 },
    assets: { 'Art/potion.png': 'demo/Art/potion.png' },
  });
  // The budget itself is exercised under "code 3" below. Here: the happy path
  // reports the injection, and a missing file stops the run. It used to be a
  // problem (1), which told the caller to fix a document that was fine; the
  // fault is in the job's paths, the same kind as a missing UXML, so it is 2.
  // Every missing file is named in one go, not just the first.
  const p2 = job('capmiss', {
    uxml: 'demo/Inventory.uxml', panel: { width: 480, height: 320 },
    assets: { 'Art/potion.png': 'demo/Art/gone.png', 'Art/ok.png': 'demo/Art/potion.png', 'Art/bg.png': 'demo/Art/also-gone.png' },
  });
  const miss = runJob(p2);
  expect(miss.code === 2, `a missing asset file → 2, the job points at nothing (got ${miss.code})`);
  expect(/2 asset file\(s\) named in the job do not exist/.test(miss.out) &&
    /Art\/potion\.png: demo\/Art\/gone\.png/.test(miss.out) && /Art\/bg\.png: demo\/Art\/also-gone\.png/.test(miss.out) &&
    !/Art\/ok\.png:/.test(miss.out), 'and both missing files are named in one report, the present one is not');
  expect(/No preview was written/.test(miss.out), 'and it says no preview was written');
  for (const [bad, what] of [['Art/x.png', 'a string'], [[1], 'an array'], [{ 'Art/x.png': 5 }, 'a non-string file']]) {
    const r = runJob(job('capbad', { uxml: 'demo/Inventory.uxml', panel: { width: 480, height: 320 }, assets: bad }));
    expect(r.code === 2 && /assets must/.test(r.out), `assets that are ${what} → 2, refused by name (got ${r.code})`);
  }
  mutate('scripts/preview.mjs', '  if (missing.length) {', '  if (false) {', () => {
    // Still a 2 — reading the missing file throws and the safety net catches
    // it — but as a stack trace about one file, not a report naming them all.
    const r = runJob(p2);
    expect(!/named in the job do not exist/.test(r.out),
      `mutation (missing files not refused) → only a crash about one file is left (exit ${r.code}), so the case above catches it`);
  });
  mutate('scripts/preview.mjs', "const missing = Object.entries(job.assets).filter(([, f]) => !existsSync(at(f)));",
    "const missing = Object.entries(job.assets).filter(([, f]) => !existsSync(at(f))).slice(0, 1);", () =>
    expect(!/Art\/bg\.png: /.test(runJob(p2).out), 'mutation (stop at the first missing file) → the second is not named, so the case above catches it'));
  expect(exitOf(p) === 0, 'while a good asset passes');
}

console.log('\nwhat the core says a warning is about decides the exit code');
{
  // Three screens a person will actually write. Each must land on its own code
  // and stay there across core upgrades: a valid style the preview does not
  // draw passes, one that moves boxes in Unity makes the preview incomplete,
  // and a misspelt property is the document's to fix.
  const screen = (name, uss, body = '<ui:Label name="Title" text="Inventory" />', extra = {}) => {
    writeFileSync(TMP + `Styles/${name}.uss`, '#Panel { width: 300px; height: 200px; } ' + uss);
    writeFileSync(TMP + `${name}.uxml`, `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/${name}.uss" />
      <ui:VisualElement name="Panel">${body}</ui:VisualElement></ui:UXML>`);
    return job('w-' + name, { uxml: `${name}.uxml`, panel: { width: 400, height: 300 }, ...extra });
  };
  const shadow = runJob(screen('Shadow', '#Title { text-shadow: 1px 1px 0 black; }'));
  expect(shadow.code === 0, `a correct screen that uses text-shadow → 0 (got ${shadow.code})`);
  expect(/not drawn by this preview \(1\)[\s\S]*text-shadow/.test(shadow.out) && /problems \(0\)/.test(shadow.out),
    'and text-shadow is listed as not drawn, not as a problem');
  expect(/^Pass/.test(pageOf('w-Shadow').verdict), 'the page passes it too');

  // aspect-ratio is laid out by the core since 0.6.0, so the layout-gap sample is -unity-text-auto-size
  // (core tests/contract-060/text-and-fonts.test.ts, "D6": not-rendered with affectsLayout: true).
  const AUTO = '#Title { -unity-text-auto-size: best-fit 8px 40px; }';
  const auto = runJob(screen('AutoSize', AUTO));
  expect(auto.code === 3, `a screen that uses -unity-text-auto-size → 3 (got ${auto.code})`);
  expect(/not laid out by this preview \(1\)[\s\S]*-unity-text-auto-size \(Unity 6000\.3\+\)/.test(auto.out) &&
    /from this preview's layout, not Unity's/.test(auto.out), 'and the report says which property and that coordinates are the preview\'s');
  const pa = pageOf('w-AutoSize');
  expect(/^Incomplete preview/.test(pa.verdict) && /not laid out/.test(pa.verdict) && pa.channels['Not laid out by this preview'].count === 1,
    'the page calls it incomplete and lists it: ' + pa.verdict);
  const aspect = runJob(screen('Aspect', '#Title { aspect-ratio: 2; }'));
  expect(aspect.code === 0 && /not laid out/.test(aspect.out) === false,
    `aspect-ratio is laid out now: a screen that uses it → 0, no layout gap (got ${aspect.code})`);

  const both = runJob(screen('AutoCollapse', AUTO, '<ui:Label name="Title" text="x" /><ui:Image name="Loose" />'));
  expect(both.code === 1 && /#Loose has no size and is invisible \(by this preview's layout/.test(both.out),
    `-unity-text-auto-size next to a collapsed image → 1, and the collapse says whose layout found it (got ${both.code})`);

  // Text the default font cannot draw. The core's own words come first; the skill adds one line.
  const HINT = /-unity-font-definition removes this warning; this preview cannot load font assets/;
  const han = runJob(screen('Hangul', '', '<ui:Label name="Title" text="한글" />'));
  expect(han.code === 3, `a Hangul Label in the default font → 3, not 1 (got ${han.code})`);
  expect(/not laid out by this preview \(1\)[\s\S]*-unity-font-definition: The runtime default font \(NotInter-Regular\) has no glyphs for Hangul/.test(han.out) && HINT.test(han.out),
    'and the report gives the core\'s words, then the one line about setting the font');
  const ph = pageOf('w-Hangul');
  expect(/^Incomplete preview/.test(ph.verdict) && ph.channels['Not laid out by this preview'].count === 1 && HINT.test(ph.channels['Not laid out by this preview'].items.join(' ')),
    'the page agrees and carries the same line: ' + ph.verdict);
  const hanEditor = runJob(screen('HangulEditor', '', '<ui:Label name="Title" text="한글" />', { theme: 'editor' }));
  expect(hanEditor.code === 3 && /The editor default font \(Inter-Regular SDF\)/.test(hanEditor.out), 'the same on the editor theme, in that theme\'s words');
  const rich = runJob(screen('RichText', '', '<ui:Label name="Title" text="&lt;b&gt;Inventory&lt;/b&gt;" />'));
  expect(rich.code === 3 && /not laid out by this preview \(1\)[\s\S]*enable-rich-text/.test(rich.out), `a rich text tag → 3 (got ${rich.code})`);
  expect(/^Incomplete preview/.test(pageOf('w-RichText').verdict), 'and the page agrees');

  const typo = runJob(screen('Colour', '#Title { colour: red; }'));
  expect(typo.code === 1 && /colour: not in the USS property reference/.test(typo.out), `a misspelt colour → 1 (got ${typo.code})`);
  expect(/^Attention/.test(pageOf('w-Colour').verdict), 'the page flags it too');

  const font = runJob(screen('Font', '#Title { font-family: Arial; }'));
  expect(font.code === 1 && /write -unity-font-definition instead/.test(font.out), 'font-family → 1, and the report names what to write instead');

  const root = runJob(screen('Root', ':root { width: 400px; }'));
  expect(root.code === 0 && /ignored here and in Unity \(1\)/.test(root.out), ':root → 0, listed as nothing to do');

  // mutations
  mutate('src/check.js', "        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';", "        return 'unsupported';", () => {
    expect(runJob(TMP + 'w-AutoSize.json').code === 0, 'mutation (affectsLayout ignored) → -unity-text-auto-size passes as 0, so the 3 case catches it');
    expect(runJob(TMP + 'w-RichText.json').code === 0, 'and a rich text tag passes as 0');
  });
  mutate('src/check.js', "      case 'font-fallback':\n        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';\n", '', () =>
    expect(runJob(TMP + 'w-Hangul.json').code === 1, 'mutation (font-fallback unhandled) → a Hangul Label fails the run with 1, so the 3 case catches it'));
  mutate('src/check.js', "      case 'font-fallback':\n        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';\n",
    "      case 'font-fallback':\n        return 'unsupported';\n", () =>
    expect(runJob(TMP + 'w-Hangul.json').code === 0, 'mutation (font-fallback always "not drawn") → a Hangul Label passes as 0'));
  mutate('src/check.js', "    return w.reason === 'font-fallback'", '    return false', () =>
    expect(!HINT.test(runJob(TMP + 'w-Hangul.json').out), 'mutation (the font hint switched off) → the report loses the line'));
  mutate('src/check.js', "      case 'not-uss':\n      case 'invalid-value':\n        return 'other';",
    "      case 'invalid-value':\n        return 'other';\n      case 'not-uss':\n        return 'unsupported';", () => {
    expect(runJob(TMP + 'w-Colour.json').code === 0, 'mutation (not-uss filed as not drawn) → the colour typo passes, so the 1 case catches it');
  });
  mutate('src/check.js', "      case 'not-rendered':\n", "      case 'not-rendered-x':\n", () =>
    expect(runJob(TMP + 'w-Shadow.json').code === 1, 'mutation (kind-agnostic default only) → text-shadow fails a correct screen, so the 0 case catches it'));
}

console.log('\ncode 3 — ran, no defect, but the budget kept an image out of the preview');
{
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const MB = 1024 * 1024;
  mkdirSync(TMP + 'big', { recursive: true });
  // Made here, at run time, so nothing outside the checkout is read and nothing
  // large is committed. Content is irrelevant to the budget, only size counts.
  const big = (name, mb) => { const f = TMP + 'big/' + name; writeFileSync(f, Buffer.alloc(Math.round(mb * MB), 7)); return 'big/' + name; };
  const one = big('one.png', 1), five = big('five.png', 5), three1 = big('three1.png', 3), three2 = big('three2.png', 3), half = big('half.png', 0.5);
  const hash = (f) => createHash('sha256').update(readFileSync(TMP + f)).digest('hex');
  const before = hash(five);
  const inv = { uxml: 'demo/Inventory.uxml', panel: { width: 480, height: 320 } };

  const within = runJob(job('b-within', { ...inv, assets: { 'Art/potion.png': one } }));
  expect(within.code === 0 && /assets embedded 1/.test(within.out), `a 1 MB image is within the default budget → 0 (got ${within.code})`);

  const over = runJob(job('b-over', { ...inv, assets: { 'Art/potion.png': five } }));
  expect(over.code === 3, `only a 5 MB image over the 4 MB default per-file budget → 3 (got ${over.code})`);
  expect(/problems \(0\)/.test(over.out), 'and it is not among the problems');
  expect(/over the embed budget \(1\)/.test(over.out) && /Art\/potion\.png \(big\/five\.png, 5\.00 MB\): 5\.00 MB is over the 4 MB per-file budget\s+\[budget 4 MB per file, 16 MB total\]/.test(over.out),
    'it is listed with path, size, reason and the budget applied');
  const po = pageOf('b-over');
  expect(/^Incomplete preview/.test(po.verdict) && po.colour === 'var(--blue)', 'the page calls it incomplete, neither pass nor problem: ' + po.verdict);
  expect(po.channels['Over the embed budget'].count === 1 && po.channels['Collapsed to zero size'].count === 0,
    'and lists it in its own channel, not among the problems');
  expect(hash(five) === before, 'the source file is untouched');

  const both = runJob(job('b-both', { uxml: 'Collapse.uxml', panel: { width: 300, height: 200 }, assets: { 'Art/x.png': five } }));
  expect(both.code === 1, `over the budget and a collapsed element → 1, a defect outranks it (got ${both.code})`);
  expect(/^Attention/.test(pageOf('b-both').verdict), 'and the page agrees');

  const raised = runJob(job('b-raised', { ...inv, assets: { 'Art/potion.png': five }, assetBudget: { perFileMB: 8 } }));
  expect(raised.code === 0 && /assets embedded 1/.test(raised.out), `raising perFileMB to 8 embeds it → 0 (got ${raised.code})`);
  expect(/^Pass/.test(pageOf('b-raised').verdict), 'and the page passes');

  const total = runJob(job('b-total', { ...inv, assetBudget: { totalMB: 5 },
    assets: { 'Art/potion.png': three1, 'Art/b.png': three2, 'Art/c.png': half } }));
  expect(total.code === 3, `two 3 MB images against a 5 MB total budget → 3 (got ${total.code})`);
  expect(/Art\/b\.png .*would bring the embedded total to 6\.00 MB, over the 5 MB total budget \(3\.00 MB already embedded\)/.test(total.out),
    'the one that did not fit says by how much, against the total');
  expect(/assets embedded 2/.test(total.out), 'and a smaller file after it still fits — the message no longer claims the cap "was reached"');

  for (const [bad, what] of [[{ perFileMB: -1 }, 'negative'], [{ totalMB: 0 }, 'zero'], [{ perFileMB: '4' }, 'a string'],
                             [{ sizeMB: 4 }, 'an unknown key'], [[4, 16], 'an array'], [null, 'null']]) {
    const r = runJob(job('b-bad', { ...inv, assets: { 'Art/potion.png': one }, assetBudget: bad }));
    expect(r.code === 2 && /assetBudget/.test(r.out), `a budget that is ${what} → 2, refused by name (got ${r.code})`);
  }

  mutate('src/check.js', "    var overBudget = meta.overBudget || [];\n", "    var overBudget = meta.overBudget || [];\n    overBudget.forEach(function (a) { push('over budget: ' + a.path); });\n", () =>
    expect(runJob(TMP + 'b-over.json').code === 1, 'mutation (over budget counted as a problem) → the 3 case becomes 1'));
  mutate('src/check.js', 'code: problems.length ? 1 : (overBudget.length || layoutGaps.length) ? 3 : 0', 'code: (overBudget.length || layoutGaps.length) ? 3 : problems.length ? 1 : 0', () =>
    expect(runJob(TMP + 'b-both.json').code === 3, 'mutation (3 outranks 1) → the defect case becomes 3'));
  mutate('scripts/preview.mjs', '    budget[k] = v;', '', () =>
    expect(runJob(TMP + 'b-raised.json').code === 3, 'mutation (the job budget is ignored) → the raised case stays 3'));
  mutate('scripts/preview.mjs', "if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {", 'if (false) {', () =>
    expect(runJob(job('b-neg', { ...inv, assets: { 'Art/potion.png': one }, assetBudget: { perFileMB: -1 } })).code !== 2,
      'mutation (no value check) → a negative budget is run instead of refused'));
  mutate('scripts/preview.mjs', 'if (assetTotal + buf.length > totalLimit) {', 'if (false) {', () =>
    expect(runJob(TMP + 'b-total.json').code === 0, 'mutation (no total check) → the total case passes'));
  mutate('src/page.html', '} else if (verdict.code === 3) {', '} else if (false) {', () => {
    runJob(TMP + 'b-over.json');
    expect(/^Pass/.test(pageOf('b-over').verdict), 'mutation (page ignores 3) → the page passes an incomplete preview');
  });
  runJob(TMP + 'b-over.json');                       // leave the page as the real code writes it
}

console.log('\nA — the page the human opens is the code we verified');
{
  const { readFileSync } = await import('node:fs');
  execFileSync('node', [ROOT + 'scripts/preview.mjs', goodJob], { stdio: 'pipe' });
  // Read what this run wrote, not whatever happens to be lying in out/ from a
  // manual run. A fresh clone found this: the assertion passed on leftovers.
  const html = readFileSync(TMP + 'out/preview.html', 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(blocks[0] === readFileSync(ROOT + 'src/core.bundle.js', 'utf8'), 'the renderer is inlined byte-for-byte');
  expect(blocks[1] === readFileSync(ROOT + 'src/check.js', 'utf8'), 'the check is inlined byte-for-byte');
  let parses = true;
  blocks.forEach((b) => { try { new Function(b); } catch { parses = false; } });
  expect(parses, 'every inlined block parses');

  // mutation: corrupt the page template so the input placeholder is left broken
  const tpl = ROOT + 'src/page.html';
  const orig = readFileSync(tpl, 'utf8');
  try {
    writeFileSync(tpl, orig.replace('var UXML_INPUT = "__INPUT__";', 'var UXML_INPUT = "__INPUT__"null;'));
    rmSync(TMP + 'out/preview.html', { force: true });
    const pg = runJob(goodJob);
    expect(pg.code === 2, 'mutation (unparseable page) → 2, the page is never written silently');
    expect(/No preview was written/.test(pg.out) && !/may still be produced/.test(pg.out) && !existsSync(TMP + 'out/preview.html'),
      'and the refusal says no page was written, which is true');
  } finally { writeFileSync(tpl, orig); }
  expect(exitOf(goodJob) === 0, 'and it recovers');
}

console.log('\nthe report says what it could not see');
{
  // `texts` is keyed by name, so a repeated name used to leave every copy but
  // the last out of the report with nothing said. The screen was right and the
  // report was quietly short — the pairing this gate exists to prevent.
  writeFileSync(TMP + 'Twice.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/T.uss" />
     <ui:VisualElement name="Row"><ui:Label name="cell" text="a" /><ui:Label name="cell" text="b" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(TMP + 'Styles/T.uss', '#Row { width: 200px; height: 60px; } .x { }');
  const p = job('twice', { uxml: 'Twice.uxml', panel: { width: 300, height: 200 } });
  let out = '';
  try { out = execFileSync('node', [ROOT + 'scripts/preview.mjs', p], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  // Not a failure: the screen is right, and once a template is instantiated
  // twice a repeated name is unavoidable. The C# question is asked elsewhere,
  // and bind-csharp refuses there. What must not happen is silence.
  expect(exitOf(p) === 0, 'a repeated name is not a fault in the screen');
  expect(/names that address more than one element/.test(out), 'but the report says so');
  expect(/written by hand/.test(out),
    'and does not blame a template when the document has none');
  expect(/- cell —/.test(out), 'and names it');
  expect(/bind-csharp refuses/.test(out), 'and points at where it does matter');
}

console.log('\nassembled screens — more than one file behind one panel');
{
  // The point of this version. Everything here was invisible before: the
  // instances rendered as nothing, so the gate had nothing to judge and said so
  // by staying quiet.
  mkdirSync(TMP + 'asm/Parts', { recursive: true });
  mkdirSync(TMP + 'asm/Styles', { recursive: true });
  // The template's own sheet sits one level up from the template. That is the
  // case that caught a key mismatch: the prefetch stored it under the literal
  // '../Styles/Slot.uss' while the renderer asked for 'Styles/Slot.uss'.
  writeFileSync(TMP + 'asm/Parts/Slot.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="../Styles/Slot.uss" />
     <ui:VisualElement name="slot-root" class="slot"><ui:Label name="slot-label" text="empty" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(TMP + 'asm/Styles/Slot.uss', '.slot { width: 120px; height: 40px; }');
  writeFileSync(TMP + 'asm/Styles/Main.uss', '#Panel { width: 400px; height: 200px; }');
  const entry = (third) => `<ui:UXML xmlns:ui="UnityEngine.UIElements">
    <Style src="Styles/Main.uss" />
    <ui:Template name="Slot" src="Parts/Slot.uxml" />
    <ui:VisualElement name="Panel">
      <ui:Instance template="Slot" name="a"><ui:AttributeOverrides element-name="slot-label" text="Sword" /></ui:Instance>
      <ui:Instance template="Slot" name="b"><ui:AttributeOverrides element-name="slot-label" text="Potion" /></ui:Instance>
      ${third}
    </ui:VisualElement></ui:UXML>`;

  writeFileSync(TMP + 'asm/Good.uxml', entry(''));
  const good = job('asmgood', { uxml: 'asm/Good.uxml', panel: { width: 480, height: 320 } });
  let g = '';
  try { g = execFileSync('node', [ROOT + 'scripts/preview.mjs', good], { encoding: 'utf8' }); }
  catch (e) { g = (e.stdout || '') + (e.stderr || ''); }
  expect(exitOf(good) === 0, 'an assembled screen passes');
  expect(/templates 1/.test(g), 'and the template document was pulled in');
  expect(!/import-unresolved/.test(g),
    "and the template's own stylesheet resolved — the key the renderer asks for, not the one written");
  expect(/names that address more than one element/.test(g),
    'and the repeated inner names are reported rather than counted as a fault');

  // Unity accepts a mistyped element-name in silence. This is the one thing
  // here that Unity does not do for you, so it must fail loudly.
  writeFileSync(TMP + 'asm/Typo.uxml',
    entry('<ui:Instance template="Slot" name="c"><ui:AttributeOverrides element-name="slot-labl" text="Typo" /></ui:Instance>'));
  const typo = job('asmtypo', { uxml: 'asm/Typo.uxml', panel: { width: 480, height: 320 } });
  let t = '';
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', typo], { encoding: 'utf8' }); }
  catch (e) { t = (e.stdout || '') + (e.stderr || ''); }
  expect(exitOf(typo) === 1, 'a mistyped element-name → 1');
  expect(/slot-labl/.test(t) && /slot-label/.test(t),
    'and the report gives both what was asked for and what is there');

  // A missing template is not a missing style: the instance contributes nothing
  // at all, so the screen is short by whole regions rather than unstyled.
  writeFileSync(TMP + 'asm/Gone.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/Main.uss" />
     <ui:Template name="Slot" src="Parts/NotThere.uxml" />
     <ui:VisualElement name="Panel"><ui:Instance template="Slot" name="a" /></ui:VisualElement></ui:UXML>`);
  const gone = job('asmgone', { uxml: 'asm/Gone.uxml', panel: { width: 480, height: 320 } });
  let n = '';
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', gone], { encoding: 'utf8' }); }
  catch (e) { n = (e.stdout || '') + (e.stderr || ''); }
  expect(exitOf(gone) === 1, 'an unreadable template → 1');
  expect(/missing from the screen entirely/.test(n), 'and says the screen is short, not merely unstyled');

  // The prefetch walks a graph to a fixed point. A cycle must be reported by
  // the renderer, which can name the path — never spun on here.
  writeFileSync(TMP + 'asm/Parts/A.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:Template name="B" src="B.uxml" />
     <ui:VisualElement name="a"><ui:Instance template="B" name="bi" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(TMP + 'asm/Parts/B.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:Template name="A" src="A.uxml" />
     <ui:VisualElement name="b"><ui:Instance template="A" name="ai" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(TMP + 'asm/Cycle.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/Main.uss" />
     <ui:Template name="A" src="Parts/A.uxml" />
     <ui:VisualElement name="Panel"><ui:Instance template="A" name="root-a" /></ui:VisualElement></ui:UXML>`);
  const cyc = job('asmcycle', { uxml: 'asm/Cycle.uxml', panel: { width: 480, height: 320 } });
  let c = '';
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', cyc], { encoding: 'utf8' }); }
  catch (e) { c = (e.stdout || '') + (e.stderr || ''); }
  const code = exitOf(cyc);
  expect(code === 1, 'a cyclic template graph → 1, judged rather than hung');
  expect(!/did not settle after/.test(c),
    'and the prefetch settled — the cycle is the renderer\'s to name, not a spin here');
  expect(/template-cycle/.test(c), 'and the cycle is named');
  // Two template diagnostics deliberately do NOT reach the exit code, and both
  // decisions are easy to reverse by accident, so each has a case.
  //
  // A slot child is content that is invisible here and present in Unity — the
  // same thing `unsupported` has always meant. A package path this renderer does
  // not search is true on every run that touches one; a signal that never varies
  // would pin the exit code at 1 and stop meaning anything.
  writeFileSync(TMP + 'asm/Parts/Slotted.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements">
     <ui:VisualElement name="win" style="width: 100px; height: 60px;"><ui:VisualElement slot-name="body" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(TMP + 'asm/Slot.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/Main.uss" />
     <ui:Template name="W" src="Parts/Slotted.uxml" />
     <ui:VisualElement name="Panel"><ui:Instance template="W" name="w">
       <ui:Label name="filling" slot="body" text="hi" /></ui:Instance></ui:VisualElement></ui:UXML>`);
  const slot = job('asmslot', { uxml: 'asm/Slot.uxml', panel: { width: 480, height: 320 } });
  let sl = '';
  try { sl = execFileSync('node', [ROOT + 'scripts/preview.mjs', slot], { encoding: 'utf8' }); }
  catch (e) { sl = (e.stdout || '') + (e.stderr || ''); }
  expect(/slot/.test(sl), 'a slot is reported');
  expect(/slot/.test(sl.split('assets not yet present')[0].split('not drawn by this preview')[1] || ''),
    'in the section for things invisible here and present in Unity');
  expect(exitOf(slot) === 0,
    'and it does not fail the screen — the same standing the fallback controls have');

  writeFileSync(TMP + 'asm/Pkg.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/Main.uss" />
     <ui:Template name="P" src="Packages/com.example.thing/UI/Row.uxml" />
     <ui:VisualElement name="Panel"><ui:Instance template="P" name="p" /></ui:VisualElement></ui:UXML>`);
  const pkg = job('asmpkg', { uxml: 'asm/Pkg.uxml', panel: { width: 480, height: 320 } });
  let pk = '';
  try { pk = execFileSync('node', [ROOT + 'scripts/preview.mjs', pkg], { encoding: 'utf8' }); }
  catch (e) { pk = (e.stdout || '') + (e.stderr || ''); }
  // The report prints a warning's message, not its kind, so the assertion has
  // to name what the human actually sees.
  const PKG = /does not independently search Unity Packages/;
  expect(PKG.test(pk), 'a package path this renderer does not search is reported');
  expect(PKG.test(pk.split('problems (')[0]),
    'and as a standing condition, above the problems — never pinning the exit code at 1');
  // Two levels of nesting, each with its own relative src. This is the case the
  // core's own `resolveImport` bug lived in one layer down: the core hands back
  // `from` exactly as written, so a host that folds against the raw parent URL
  // resolves `C.uxml` inside `sub/B.uxml` to `C.uxml` instead of `sub/C.uxml`
  // and reports a document it already holds as unresolved. One level cannot show
  // it — the raw URL and the folded key are the same string there.
  //
  // Asserted directly because the protection was, until this case existed, held
  // up only by the cycle test above, which happens to nest twice and fails on a
  // different line. A test that catches something incidentally stops catching it
  // the moment someone edits it for an unrelated reason.
  // The folders matter. The entry reaches B as `sub/B.uxml`, so B's raw URL and
  // its folded key are the same string and the second hop proves nothing. B then
  // reaches C by the bare name `C.uxml`, and there the two diverge — raw
  // `C.uxml`, folded `sub/C.uxml`. Only the hop AFTER that one, C to D, can tell
  // whether the fold was remembered. A shallower fixture passes either way, and
  // one did while this case was being written.
  mkdirSync(TMP + 'asm/sub', { recursive: true });
  writeFileSync(TMP + 'asm/sub/D.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements">
     <ui:VisualElement name="d-root" style="width: 60px; height: 20px;" /></ui:UXML>`);
  writeFileSync(TMP + 'asm/sub/C.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:Template name="D" src="D.uxml" />
     <ui:VisualElement name="c-root"><ui:Instance template="D" name="di" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(TMP + 'asm/sub/B.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:Template name="C" src="C.uxml" />
     <ui:VisualElement name="b-root"><ui:Instance template="C" name="ci" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(TMP + 'asm/Deep.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/Main.uss" />
     <ui:Template name="B" src="sub/B.uxml" />
     <ui:VisualElement name="Panel"><ui:Instance template="B" name="bi" /></ui:VisualElement></ui:UXML>`);
  const deep = job('asmdeep', { uxml: 'asm/Deep.uxml', panel: { width: 480, height: 320 } });
  let dp = '';
  try { dp = execFileSync('node', [ROOT + 'scripts/preview.mjs', deep], { encoding: 'utf8' }); }
  catch (e) { dp = (e.stdout || '') + (e.stderr || ''); }
  expect(exitOf(deep) === 0, 'a template two levels down, each src relative to its own file, resolves');
  expect(/templates 3/.test(dp), 'and all three documents were pulled in');
  expect(!/template-src-unresolved/.test(dp),
    "and the second level is not reported unresolved while sitting in the map");

  // Two template documents A cannot both be a document B calls "Shared.uxml".
  // Nothing downstream can tell them apart, so it must be said rather than let
  // the later one win.
  mkdirSync(TMP + 'asm/one', { recursive: true });
  mkdirSync(TMP + 'asm/two', { recursive: true });
  for (const d of ['one', 'two']) {
    writeFileSync(TMP + `asm/${d}/Shared.uxml`,
      `<ui:UXML xmlns:ui="UnityEngine.UIElements">
       <ui:VisualElement name="${d}-root" style="width: 40px; height: 20px;" /></ui:UXML>`);
    writeFileSync(TMP + `asm/${d}/Holder.uxml`,
      `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:Template name="S" src="Shared.uxml" />
       <ui:VisualElement name="${d}-holder"><ui:Instance template="S" name="${d}-i" /></ui:VisualElement></ui:UXML>`);
  }
  writeFileSync(TMP + 'asm/Collide.uxml',
    `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Styles/Main.uss" />
     <ui:Template name="H1" src="one/Holder.uxml" /><ui:Template name="H2" src="two/Holder.uxml" />
     <ui:VisualElement name="Panel">
       <ui:Instance template="H1" name="h1" /><ui:Instance template="H2" name="h2" /></ui:VisualElement></ui:UXML>`);
  const coll = job('asmcollide', { uxml: 'asm/Collide.uxml', panel: { width: 480, height: 320 } });
  let cl = '';
  try { cl = execFileSync('node', [ROOT + 'scripts/preview.mjs', coll], { encoding: 'utf8' }); }
  catch (e) { cl = (e.stdout || '') + (e.stderr || ''); }
  expect(/Shared\.uxml/.test(cl) && /(names two different documents|template-src-unresolved)/.test(cl),
    'one raw src standing for two documents is reported, not silently resolved to whichever came first');
}

console.log(failures ? `\nFAILED: ${failures}` : '\nexit-code contract holds');
process.exit(failures ? 1 : 0);
