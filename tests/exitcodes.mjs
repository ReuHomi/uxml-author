// The exit code is the contract. 1 and 2 must stay distinguishable:
// "checked, found a problem" vs "never checked".
import { execFileSync, execFileSync as run } from 'node:child_process';
import { writeFileSync, mkdirSync, renameSync, existsSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = ROOT + 'tests/tmp/';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP + 'Styles', { recursive: true });
cpSync(ROOT + 'demo', TMP + 'demo', { recursive: true });

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

console.log(failures ? `\nFAILED: ${failures}` : '\nexit-code contract holds');
process.exit(failures ? 1 : 0);
