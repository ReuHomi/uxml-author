// The exit code is the contract. 1 and 2 must stay distinguishable:
// "checked, found a problem" vs "never checked".
import { execFileSync, execFileSync as run } from 'node:child_process';
import { writeFileSync, mkdirSync, renameSync, existsSync, rmSync,
         readdirSync, copyFileSync } from 'node:fs';
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
    expect(exitOf(goodJob) === 2, 'happy-dom missing → 2, not a silent pass');
  } finally { if (moved) renameSync(hidden, mod); }
  expect(exitOf(goodJob) === 0, 'and it recovers once happy-dom is back');
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

console.log('\nG — the cap is never silent');
{
  const p = job('cap', {
    uxml: 'demo/Inventory.uxml', panel: { width: 480, height: 320 },
    assets: { 'Art/potion.png': 'demo/Art/potion.png' },
  });
  // 0-byte cap is simulated by pointing at a file bigger than the limit is not
  // possible here, so assert the happy path reports the injection instead, and
  // that a missing file is reported rather than dropped.
  const p2 = job('capmiss', {
    uxml: 'demo/Inventory.uxml', panel: { width: 480, height: 320 },
    assets: { 'Art/potion.png': 'demo/Art/gone.png' },
  });
  let out = '';
  try { out = execFileSync('node', [ROOT + 'scripts/preview.mjs', p2], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout; }
  expect(/asset not embedded/.test(out) && /file not found/.test(out),
    'an asset that could not be embedded says so');
  expect(exitOf(p2) === 1, 'and it counts as a problem, not a shrug');
  expect(exitOf(p) === 0, 'while a good asset passes');
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
    expect(exitOf(goodJob) === 2, 'mutation (unparseable page) → 2, the page is never written silently');
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
  expect(/slot/.test(sl.split('assets not yet present')[0].split('not drawn by this version')[1] || ''),
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
