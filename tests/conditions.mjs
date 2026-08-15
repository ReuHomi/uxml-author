// Each condition is a claim plus the mutation that would break it.
// A condition whose mutation still passes is not a condition.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const w = new Window({ url: 'http://localhost' });
Object.assign(globalThis, {
  window: w, document: w.document, HTMLElement: w.HTMLElement,
  Node: w.Node, getComputedStyle: w.getComputedStyle.bind(w),
});

const root = new URL('..', import.meta.url).pathname;
await import(root + 'src/core.bundle.js');
const core = globalThis.UxmlCore;
await core.loadLayoutEngine();

const CHECK_SRC = readFileSync(root + 'src/check.js', 'utf8');
function loadCheck(mutate) {
  const src = mutate ? mutate(CHECK_SRC) : CHECK_SRC;
  new Function(src)();
  return globalThis.UxmlCheck;
}
loadCheck();

let failures = 0;
function expect(cond, what) {
  if (!cond) failures++;
  console.log((cond ? '  ok   ' : '  FAIL ') + what);
}
function section(name) { console.log('\n' + name); }

const stage = () => w.document.createElement('div');

// ── fixtures ────────────────────────────────────────────────────────────────
const PANEL = { width: 400, height: 300 };

const UXML_BASIC = `<ui:UXML xmlns:ui="UnityEngine.UIElements">
  <Style src="Styles/Main.uss" />
  <ui:VisualElement name="Panel">
    <ui:Label name="Title" text="Inventory" />
    <ui:Toggle name="SoundToggle" label="Sound" />
    <ui:Image name="Icon" />
  </ui:VisualElement>
</ui:UXML>`;

// Main imports Theme with a RELATIVE url; Theme is what sets the panel width.
const SHEETS = {
  'Styles/Main.uss': `@import url("Theme.uss");
#Title { font-size: 18px; margin-bottom: 8px; }
#Icon { width: 48px; height: 48px; background-image: url("Assets/UI/icon.png"); }`,
  'Styles/Theme.uss': `#Panel { width: 260px; padding: 12px; }`,
};

const B64 = readFileSync('/tmp/t.b64', 'utf8');   // 64x32 png
const DATA_URI = 'data:image/png;base64,' + B64;

// ── A is checked by the build script (byte identity of the inlined copies) ──

section('B — painting, read at the moment the user sees it');
{
  const C = loadCheck();
  const s = stage();
  const res = C.run(core, s, { uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL });
  expect(s.childNodes.length > 0, 'container still holds painted DOM after run() returns');
  expect(res.painted.elementCount === res.painted.boxCount,
    `every laid-out node painted (${res.painted.elementCount}/${res.painted.boxCount})`);
  expect(res.painted.texts.Title === 'Inventory', "the Label's text reached the DOM");
  res.dispose();
  expect(s.childNodes.length === 0, 'dispose() removes the painted DOM');
  expect(core.liveNodeCount() === 0, 'dispose() frees every Yoga node  [J]');
}
{
  // mutation: free inside run()
  const C = loadCheck((s) => s.replace('      dispose: r.dispose,', '      dispose: (r.dispose(), function () {}),'));
  const s = stage();
  const res = C.run(core, s, { uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL });
  expect(s.childNodes.length === 0, 'mutation (free inside run) → container is empty, so B would fail');
  res.dispose();
}

section('C — collapse excludes what is already reported, and is not vacuous');
{
  const C = loadCheck();
  const s = stage();
  const res = C.run(core, s, { uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL });
  expect(res.unsupported.length === 1, 'Toggle reported as unsupported');
  expect(!res.collapsed.some((c) => c.name === 'SoundToggle'), 'Toggle not counted a second time as collapsed');
  const zero = res.boxes.filter((b) => b.name && (b.box.width === 0 || b.box.height === 0));
  expect(zero.some((b) => b.name === 'SoundToggle'),
    'a zero-size named node really exists — the exclusion skipped something, it did not find nothing');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace('      if (excluded.has(id)) return;', ''));
  const s = stage();
  const res = C.run(core, s, { uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL });
  expect(res.collapsed.some((c) => c.name === 'SoundToggle'),
    'mutation (drop the exclusion) → Toggle appears in collapsed, so the rule does something');
  res.dispose();
}

section('D — supplying an image must not silence the failure');
{
  const UXML_NOSIZE = UXML_BASIC.replace('name="Icon"', 'name="Loose"');
  const SHEETS_NOSIZE = {
    'Styles/Main.uss': `@import url("Theme.uss");
#Loose { background-image: url("Assets/UI/icon.png"); }`,
    'Styles/Theme.uss': `#Panel { width: 260px; }`,
  };
  const C = loadCheck();
  const s = stage();
  const res = C.run(core, s, {
    uxml: UXML_NOSIZE, sheets: SHEETS_NOSIZE, panel: PANEL,
    assets: { 'Assets/UI/icon.png': DATA_URI },
  });
  expect(res.missingAssets.length === 0, 'the asset resolved, so the core is silent');
  expect(res.collapsed.some((c) => c.name === 'Loose'),
    'the sizeless Image is still caught — by collapse, not by a warning');
  res.dispose();
}
{
  const UXML_NOSIZE = UXML_BASIC.replace('name="Icon"', 'name="Loose"');
  const SHEETS_NOSIZE = {
    'Styles/Main.uss': `@import url("Theme.uss");\n#Loose { background-image: url("Assets/UI/icon.png"); }`,
    'Styles/Theme.uss': `#Panel { width: 260px; }`,
  };
  const s = stage();
  const C = loadCheck((x) => x.replace(
    "      if (excluded.has(id)) return;",
    "      if (excluded.has(id)) return;\n      if (info.type === 'Image') return;"));
  const res = C.run(core, s, { uxml: UXML_NOSIZE, sheets: SHEETS_NOSIZE, panel: PANEL, assets: { 'Assets/UI/icon.png': DATA_URI } });
  expect(res.collapsed.length === 0 && res.missingAssets.length === 0,
    'mutation (exempt Image from collapse) → nothing catches it in any channel');
  res.dispose();
}

section('E — injected assets are reported from our own books');
{
  const C = loadCheck();
  const s = stage();
  const res = C.run(core, s, {
    uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL,
    assets: { 'Assets/UI/icon.png': DATA_URI },
  });
  expect(res.injected.length === 1 && res.injected[0] === 'Assets/UI/icon.png',
    'the injection is recorded, though no warning mentions it');
  expect(res.missingAssets.length === 0, 'and the warning channel is empty, which is why the record is needed');
  res.dispose();
}

section('F — every sheet reaches the coordinates, relative @import included');
{
  const C = loadCheck();
  const a = stage(), b = stage();
  const full = C.run(core, a, { uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL });
  const wFull = full.boxes.find((x) => x.name === 'Panel').box.width;
  full.dispose();

  const blanked = C.run(core, b, {
    uxml: UXML_BASIC, panel: PANEL,
    sheets: { ...SHEETS, 'Styles/Theme.uss': '' },
  });
  const wBlank = blanked.boxes.find((x) => x.name === 'Panel').box.width;
  blanked.dispose();

  expect(full.sheetsRequested.includes('Styles/Theme.uss'),
    'the relative @import resolved against its containing sheet');
  expect(wFull === 260, `Theme.uss drove the width (got ${wFull})`);
  expect(wBlank !== wFull, `mutation (blank Theme.uss) → width changes (${wFull} → ${wBlank})`);
}
{
  // mutation: stop resolving relative urls. The key becomes 'Theme.uss', which
  // is in no map, so the sheet silently stops arriving.
  const C = loadCheck((x) => x.replace('    if (!from) return url;', '    return url;'));
  const s = stage();
  const res = C.run(core, s, { uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL });
  const wid = res.boxes.find((x) => x.name === 'Panel').box.width;
  expect(res.sheetsMissing.includes('Theme.uss') && wid !== 260,
    `mutation (no relative resolution) → sheet is looked up as 'Theme.uss', misses, width ${wid}`);
  res.dispose();
}
{
  const C = loadCheck();
  const s = stage();
  const res = C.run(core, s, {
    uxml: UXML_BASIC, panel: PANEL,
    sheets: { 'Styles/Main.uss': SHEETS['Styles/Main.uss'] },   // Theme missing
  });
  expect(res.sheetsMissing.includes('Styles/Theme.uss'), 'a missing sheet is named, not swallowed');
  expect(res.parseWarnings.some((x) => x.kind === 'import-unresolved'),
    'and the core raises import-unresolved');
  res.dispose();
}

section('H — no silent default panel size');
{
  const C = loadCheck();
  let threw = false;
  try { C.run(core, stage(), { uxml: UXML_BASIC, sheets: SHEETS }); } catch { threw = true; }
  expect(threw, 'run() refuses to render without a panel size');
}

console.log(failures ? `\nFAILED: ${failures}` : '\nall conditions hold');
process.exit(failures ? 1 : 0);
