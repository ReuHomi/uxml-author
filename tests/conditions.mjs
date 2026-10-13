// Each condition is a claim plus the mutation that would break it.
// A condition whose mutation still passes is not a condition.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { fileURLToPath, pathToFileURL } from 'node:url';

const w = new Window({ url: 'http://localhost' });
Object.assign(globalThis, {
  window: w, document: w.document, HTMLElement: w.HTMLElement,
  Node: w.Node, getComputedStyle: w.getComputedStyle.bind(w),
});

const root = fileURLToPath(new URL('..', import.meta.url));
await import(pathToFileURL(root + 'src/core.bundle.js').href);
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

const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh8QAAAABJRU5ErkJggg==';

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

section('I — display: none is hidden, not collapsed; the rest of zero size still is');
// The external report's own fixture, verbatim. Before this channel existed
// both elements were reported collapsed and the run exited 1 on a screen that
// was exactly what its author wrote.
const UXML_REPORT = `<ui:UXML xmlns:ui="UnityEngine.UIElements">
    <ui:VisualElement name="Hidden" style="display:none;width:80px;height:40px">
        <ui:VisualElement name="Child" style="width:20px;height:10px" />
    </ui:VisualElement>
</ui:UXML>`;
const UXML_ZERO = `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="Z.uss" />
  <ui:Template name="Slot" src="Slot.uxml" />
  <ui:VisualElement name="Panel">
    <ui:VisualElement name="ByClass" class="gone"><ui:VisualElement name="ByClassKid" /></ui:VisualElement>
    <ui:Instance template="Slot" name="SlotA" />
    <ui:Instance template="Slot" name="SlotB" class="off" />
    <ui:VisualElement name="Tabs"><ui:VisualElement name="PageOne" class="gone sized" /></ui:VisualElement>
    <ui:VisualElement name="Outer2"><ui:VisualElement name="Mid"><ui:VisualElement name="Deep" class="gone sized" /></ui:VisualElement></ui:VisualElement>
    <ui:VisualElement name="Mixed"><ui:VisualElement name="MixedGone" class="gone sized" /><ui:Image name="MixedLoose" /></ui:VisualElement>
    <ui:Image name="Lone" />
    <ui:VisualElement name="Zero"><ui:VisualElement name="ZeroKid" class="gone sized" /></ui:VisualElement>
    <ui:VisualElement name="Outer"><ui:Image name="Inner" /></ui:VisualElement>
    <ui:Image name="Faded" />
    <ui:Image name="Invisible" />
    <ui:Image name="Toggled" class="__TOGGLE__" />
    <ui:Button name="Use" text="Use" />
  </ui:VisualElement>
</ui:UXML>`;
const ZERO_SHEETS = {
  'Z.uss': `#Panel { width: 380px; height: 280px; }
.gone { display: none; }
.sized { width: 30px; height: 30px; }
#SlotB .slot { display: none; }
#Zero { height: 0; }
#Faded { opacity: 0; }
#Invisible { visibility: hidden; }
#Use { width: 80px; height: 30px; }
#Use:hover { display: none; }`,
};
const ZERO_TEMPLATES = {
  'Slot.uxml': `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:VisualElement name="SlotRoot" class="slot" style="width: 40px; height: 20px;" /></ui:UXML>`,
};
function zeroRun(C, toggle) {
  return C.run(core, stage(), {
    uxml: UXML_ZERO.replace('__TOGGLE__', toggle), sheets: ZERO_SHEETS,
    templates: ZERO_TEMPLATES, panel: PANEL,
  });
}
const names = (list) => list.map((x) => x.name);
const hiddenNames = (res) => names(res.hidden);
{
  const C = loadCheck();
  const res = C.run(core, stage(), { uxml: UXML_REPORT, panel: PANEL });
  expect(hiddenNames(res).join(',') === 'Hidden,Child',
    `report fixture: Hidden and Child are hidden (got ${hiddenNames(res)})`);
  expect(res.collapsed.length === 0, `report fixture: nothing collapsed (got ${names(res.collapsed)})`);
  const child = res.hidden.find((h) => h.name === 'Child');
  expect(child && !child.by.self && child.by.name === 'Hidden',
    'the child names the ancestor that hides it');
  expect(res.hidden[0].origin === 'inline style attribute', `and the cause is named: ${res.hidden[0].origin}`);
  expect(res.cascadeMismatch.length === 0, 'the render and the style judgement agree');
  res.dispose();
}
{
  const C = loadCheck();
  const res = zeroRun(C, 'none');
  const hid = hiddenNames(res), col = names(res.collapsed), emp = names(res.emptied);
  expect(hid.includes('ByClass') && hid.includes('ByClassKid'), 'a USS class hides the element and its child');
  expect(/"\.gone" in Z\.uss/.test(res.hidden.find((h) => h.name === 'ByClass').origin),
    'and the report names the rule and the sheet: ' + res.hidden.find((h) => h.name === 'ByClass').origin);
  expect(hid.includes('SlotRoot') && res.hidden.some((h) => h.name === 'SlotRoot' && /#SlotB \.slot/.test(h.origin)),
    'inside a template instance, a rule in the screen hides the template element');
  expect(!hid.includes('SlotB') && emp.includes('SlotB'),
    'and the instance itself is emptied by its hidden child, not hidden and not collapsed');
  expect(!col.includes('SlotA') && !emp.includes('SlotA') && !hid.includes('SlotA'),
    'while the other instance of the same template is untouched');
  expect(emp.includes('Tabs') && !col.includes('Tabs'), 'a container whose only child is hidden is emptied');
  expect(emp.includes('Mid') && emp.includes('Outer2'), 'emptied propagates: a parent of an emptied child is emptied');
  expect(col.includes('Mixed') && col.includes('MixedLoose') && !emp.includes('Mixed'),
    'one visible zero-size child keeps the parent collapsed');
  expect(col.includes('Lone'), 'no children and no size is collapsed');
  expect(col.includes('Zero') && !emp.includes('Zero'), 'an explicit height: 0 is collapsed even with only hidden children');
  expect(col.includes('Outer') && col.includes('Inner'), 'a visible zero-size parent with a zero-size child: both collapsed');
  expect(col.includes('Faded') && col.includes('Invisible') && !hid.includes('Faded') && !hid.includes('Invisible'),
    'opacity: 0 and visibility: hidden are not hidden by this rule');
  expect(col.includes('Toggled'), 'shown, a sizeless Image is collapsed');
  expect(!hid.includes('Use') && !col.includes('Use'), 'a rule under a pseudo-state that is not active does not hide');
  expect(res.cascadeMismatch.length === 0, 'the render and the style judgement agree');
  res.dispose();

  const off = zeroRun(C, 'gone');
  expect(hiddenNames(off).includes('Toggled') && !names(off.collapsed).includes('Toggled'),
    'the same Image with the hiding class is hidden instead — the size check comes back the moment it is shown');
  off.dispose();
}
// mutations — each one undoes a judgement the cases above depend on
{
  const C = loadCheck((s) => s.replace('      if (hiddenBy.has(id)) {', '      if (false) {'));
  const res = C.run(core, stage(), { uxml: UXML_REPORT, panel: PANEL });
  expect(names(res.collapsed).includes('Hidden'), 'mutation (no hidden branch) → the report fixture collapses again');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace(
    "        if (displayNone(p)) { hiddenBy.set(id, p); return; }", ''));
  const res = C.run(core, stage(), { uxml: UXML_REPORT, panel: PANEL });
  expect(names(res.collapsed).includes('Child'), 'mutation (no ancestor walk) → the child of a hidden element collapses');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace(
    "      return d && d.value === 'none' ? d.origin : null;",
    "      return d && d.value === 'none' && d.origin.kind === 'inline' ? d.origin : null;"));
  const res = zeroRun(C, 'none');
  expect(names(res.collapsed).includes('ByClass'),
    'mutation (only an inline style counts) → a USS class no longer hides, so the class case catches it');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace(
    "      return d && d.value === 'none' ? d.origin : null;",
    "      var v = m && m.get('visibility');\n      if (v && v.value === 'hidden') return v.origin;\n      return d && d.value === 'none' ? d.origin : null;"));
  const res = zeroRun(C, 'none');
  expect(hiddenNames(res).includes('Invisible'), 'mutation (visibility: hidden counts) → the visibility case catches it');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace("        if (isEmptied(id)) emptied.push(", "        if (false) emptied.push("));
  const res = zeroRun(C, 'none');
  expect(names(res.collapsed).includes('Tabs'), 'mutation (no emptied channel) → the emptied container collapses');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace('!hiddenBy.has(id) && !explicitZero(id)', '!hiddenBy.has(id)'));
  const res = zeroRun(C, 'none');
  expect(names(res.emptied).includes('Zero'), 'mutation (ignore an explicit 0) → height: 0 is explained away as emptied');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace('kids.every(function (k)', 'kids.some(function (k)'));
  const res = zeroRun(C, 'none');
  expect(names(res.emptied).includes('Mixed'), 'mutation (some child hidden is enough) → a parent with a visible child is emptied');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace('|| isEmptied(k); });', '; });'));
  const res = zeroRun(C, 'none');
  expect(names(res.collapsed).includes('Outer2'), 'mutation (emptied does not propagate) → the grandparent collapses');
  res.dispose();
}
{
  // The two cascades are tied together by one options object. Hand the style
  // judgement different states and the hidden list stops describing the
  // screen that was drawn — which must be caught, not reported as hidden.
  const C = loadCheck((s) => s.replace('core.resolveStyles(doc, cascadeOpts)',
    "core.resolveStyles(doc, { activeStates: new Set(['hover']), states: {} })"));
  const res = zeroRun(C, 'none');
  expect(names(res.cascadeMismatch).includes('Use'),
    'mutation (style judgement given other states) → the mismatch is caught on #Use');
  res.dispose();
}

section('H — no silent default panel size');
{
  const C = loadCheck();
  let threw = false;
  try { C.run(core, stage(), { uxml: UXML_BASIC, sheets: SHEETS }); } catch { threw = true; }
  expect(threw, 'run() refuses to render without a panel size');
}

// Close the window before leaving. happy-dom holds timers and async work that
// otherwise survive into process teardown, and native cleanup with live handles
// is how a clean run turns into an access violation on Windows.
await w.happyDOM.close();

console.log(failures ? `\nFAILED: ${failures}` : '\nall conditions hold');
process.exit(failures ? 1 : 0);
