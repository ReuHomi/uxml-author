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
    <ui:MinMaxSlider name="RangeSlider" />
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

// A property the core still does not lay out (core tests/contract-060/text-and-fonts.test.ts, D6).
const AUTO = '#P { -unity-text-auto-size: best-fit 8px 40px; }';

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
  expect(res.unsupported.length === 1, 'MinMaxSlider reported as unsupported');
  expect(!res.collapsed.some((c) => c.name === 'RangeSlider'), 'MinMaxSlider not counted a second time as collapsed');
  const zero = res.boxes.filter((b) => b.name && (b.box.width === 0 || b.box.height === 0));
  expect(zero.some((b) => b.name === 'RangeSlider'),
    'a zero-size named node really exists — the exclusion skipped something, it did not find nothing');
  res.dispose();
}
{
  const C = loadCheck((s) => s.replace('      if (excluded.has(id)) return;', ''));
  const s = stage();
  const res = C.run(core, s, { uxml: UXML_BASIC, sheets: SHEETS, panel: PANEL });
  expect(res.collapsed.some((c) => c.name === 'RangeSlider'),
    'mutation (drop the exclusion) → MinMaxSlider appears in collapsed, so the rule does something');
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

section('J — states asked for in the job are the states drawn');
// The external report gave two USS lines; the document around them is ours.
const UXML_USE = `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="U.uss" />
  <ui:Template name="Slot" src="Slot.uxml" />
  <ui:VisualElement name="Panel"><ui:Button name="Use" text="Use" /><ui:Instance template="Slot" name="SlotA" /></ui:VisualElement></ui:UXML>`;
const USE_SHEETS = {
  'U.uss': `#Panel { width: 380px; height: 280px; }
#Use { width: 80px; }
#Use:hover { width: 140px; }
#Use:disabled { height: 50px; }
#Panel[odd] { width: 1px; }`,
};
const useInput = (extra) => ({ uxml: UXML_USE, sheets: USE_SHEETS, templates: ZERO_TEMPLATES, panel: PANEL, ...extra });
const boxOf = (res, n) => res.boxes.find((b) => b.name === n).box;
const layout = (res) => JSON.stringify(res.boxes.map((b) => [b.name, b.box]));
{
  const C = loadCheck();
  const plain = C.run(core, stage(), useInput({}));
  expect(boxOf(plain, 'Use').width === 80, `#Use is 80px with no states (got ${boxOf(plain, 'Use').width})`);
  expect(C.describeStates(plain.applied) === 'states: none applied (the default)', 'and the report says no states were applied');
  const hover = C.run(core, stage(), useInput({ states: { '#Use': ['hover'] } }));
  expect(boxOf(hover, 'Use').width === 140, `states {"#Use": ["hover"]} → 140px (got ${boxOf(hover, 'Use').width})`);
  expect(C.describeStates(hover.applied) === 'states: #Use :hover', 'and the applied combination is named: ' + C.describeStates(hover.applied));
  const both = C.run(core, stage(), useInput({ states: { '#Use': ['hover', 'disabled'] } }));
  const b = boxOf(both, 'Use');
  expect(b.width === 140 && b.height === 50, `hover and disabled together → 140x50 (got ${b.width}x${b.height})`);
  const split = C.run(core, stage(), useInput({ states: { '#Use': ['hover'] }, activeStates: ['disabled'] }));
  const sb = boxOf(split, 'Use');
  expect(sb.width === 140 && sb.height === 50, `hover by key, disabled on every element → 140x50 (got ${sb.width}x${sb.height})`);
  expect(C.describeStates(split.applied) === 'states: #Use :hover   every element :disabled', 'and both parts are named');
  const empty = C.run(core, stage(), useInput({ states: {}, activeStates: [] }));
  expect(layout(empty) === layout(plain), 'explicitly empty states draw exactly what omitted states draw');
  [plain, hover, both, split, empty].forEach((r) => r.dispose());

  // "Omitted" must mean the behaviour before this input existed, measured
  // against a copy of the check with the old hardcoded options put back.
  const Old = loadCheck((x) => x.replace('var cascadeOpts = { activeStates: st.activeStates, states: st.states };',
    'var cascadeOpts = { activeStates: new Set(), states: {} };'));
  const old = Old.run(core, stage(), useInput({}));
  const now = loadCheck().run(core, stage(), useInput({}));
  expect(layout(old) === layout(now) &&
    JSON.stringify(old.other) === JSON.stringify(now.other), 'omitted states: same boxes and warnings as before');
  old.dispose(); now.dispose();
}
{
  // States reach the hidden judgement through the same options as the render.
  const C = loadCheck();
  const res = C.run(core, stage(), { uxml: UXML_ZERO.replace('__TOGGLE__', 'none'), sheets: ZERO_SHEETS,
    templates: ZERO_TEMPLATES, panel: PANEL, states: { '#Use': ['hover'] } });
  const use = res.hidden.find((h) => h.name === 'Use');
  expect(use && /"#Use:hover" in Z\.uss/.test(use.origin), 'a pseudo-state rule hides #Use once the state is applied: ' + (use && use.origin));
  expect(res.cascadeMismatch.length === 0, 'and both cascades saw the state');
  res.dispose();
}
{
  // The probe runs on its own parse. Nothing it does may reach what is judged.
  const C = loadCheck();
  const a = C.run(core, stage(), useInput({}));
  const b = C.run(core, stage(), useInput({ states: { '#Panel': ['focus'], '#SlotRoot': ['hover'] } }));
  expect(layout(a) === layout(b), 'a state no rule uses leaves every box where it was');
  expect(JSON.stringify(a.other) === JSON.stringify(b.other) &&
    JSON.stringify(a.versionDependent) === JSON.stringify(b.versionDependent), 'and every warning as it was');
  expect(!b.depsRequested.some((d) => /probe/.test(d)) && b.depsMissing.length === a.depsMissing.length,
    'and the probe sheet is in no dependency list');
  expect(b.applied.states['#SlotRoot'], 'a key matching an element inside a template instance is accepted');
  a.dispose(); b.dispose();
}
const refusal = (C, extra) => C.checkStates(core, useInput(extra)).errors.join(' | ');
{
  // The allow-list is the core's, not a copy kept here. A copy is a second
  // place to forget when Unity adds a state.
  expect(!/\[\s*'hover',\s*'active'/.test(CHECK_SRC), 'check.js holds no copy of the state list');
  const more = { ...core, USS_STATES: [...core.USS_STATES, 'future-state'] };
  expect(loadCheck().checkStates(more, useInput({ states: { '#Use': ['future-state'] } })).errors.length === 0,
    'a state the core adds is accepted without touching check.js');
  const Pinned = loadCheck((x) => x.replace('var allowed = Array.prototype.slice.call(core.USS_STATES);',
    "var allowed = ['hover', 'active', 'inactive', 'focus', 'disabled', 'enabled', 'checked'];"));
  expect(Pinned.checkStates(more, useInput({ states: { '#Use': ['future-state'] } })).errors.length > 0,
    'mutation (a pinned copy again) → the new state is refused, so the case above catches it');
}
{
  const C = loadCheck();
  const cases = [
    [{ states: { '#Use': 'hover' } }, /must be an array.*the string "hover"/, 'a string where an array belongs'],
    [{ activeStates: 'hover' }, /activeStates must be an array.*the string "hover"/, 'activeStates as a string'],
    [{ states: ['#Use'] }, /states must be an object/, 'states as an array'],
    [{ states: { '#Use': [] } }, null, 'an empty list is accepted, and applies nothing'],
    [{ states: { '#Use': ['hovr'] } }, /"hovr", which is not a Unity state/, 'a mistyped state name'],
    [{ states: { '#Use': ['selected'] } }, /"selected", which is not a Unity state/, ':selected, which USS does not support'],
    [{ activeStates: ['root'] }, /"root", which is not a Unity state/, ':root, which is not a state'],
    [{ states: { '#Nope': ['hover'] } }, /"#Nope" matches no element/, 'a key that matches no element'],
    [{ states: { '#Use[x]': ['hover'] } }, /"#Use\[x\]" is not a usable USS selector/, 'a key the core cannot use as a selector'],
    [{ states: { '#Use { x': ['hover'] } }, /is not a selector/, 'a key that would break out of a rule'],
  ];
  cases.forEach(([extra, re, what]) => {
    const e = refusal(C, extra);
    expect(re ? re.test(e) : e === '', `${what} → ${re ? 'refused' : 'accepted'}${e ? ': ' + e : ''}`);
  });
  let threw = '';
  try { C.run(core, stage(), useInput({ states: { '#Nope': ['hover'] } })); } catch (e) { threw = e.message; }
  expect(/states refused/.test(threw), 'run() itself refuses, so the page cannot draw an unasked-for screen');
  const own = C.run(core, stage(), useInput({}));
  expect(own.other.some((w) => w.kind === 'unsupported-selector'),
    "the document's own unsupported selector keeps its old channel");
  own.dispose();
}
// mutations
{
  const C = loadCheck((x) => x.replace('var cascadeOpts = { activeStates: st.activeStates, states: st.states };',
    'var cascadeOpts = { activeStates: new Set(), states: {} };'));
  const res = C.run(core, stage(), useInput({ states: { '#Use': ['hover'] } }));
  expect(boxOf(res, 'Use').width === 80, 'mutation (states hardcoded empty again) → #Use stays 80px, so the 140px case catches it');
  res.dispose();
}
{
  // Without the check a string is iterated as the core would iterate it.
  const C = loadCheck((x) => x.replace('    if (!Array.isArray(value)) {', '    value = Array.from(value);\n    if (false) {'));
  const e = refusal(C, { states: { '#Use': 'hover' } });
  expect(!/must be an array/.test(e),
    'mutation (no array check) → the string is split into letters and the refusal no longer says why: ' + e);
}
{
  const C = loadCheck((x) => x.replace("typeof n !== 'string' || allowed.indexOf(n) === -1", "typeof n !== 'string'"));
  expect(refusal(C, { states: { '#Use': ['hovr'] } }) === '', 'mutation (no allow-list) → a mistyped state is accepted');
}
{
  const C = loadCheck((x) => x.replace("        else if (!hit.has(PROBE_PROP + i)) {", "        else if (false) {"));
  expect(refusal(C, { states: { '#Nope': ['hover'] } }) === '', 'mutation (no match check) → a key matching nothing is accepted');
}
{
  const READ = "if (subj && subj.kind === 'states-key' && Object.prototype.hasOwnProperty.call(states, subj.key)) refused.add(subj.key);";
  const C = loadCheck((x) => x.replace(READ, ''));
  const e = refusal(C, { states: { '#Use[x]': ['hover'] } });
  expect(!/not a usable USS selector/.test(e), 'mutation (core refusal not read) → the unusable key is misdescribed: ' + e);
}
{
  // The refusal reads the core's `subject`, not its message. A core that
  // rewords every warning — which 0.5.1 says it may do in any release — must
  // still have its refusal of a states key noticed.
  const reworded = {
    ...core,                                // the core's exports are getters; copy their values
    resolveStyles: (doc, opts) => {
      const out = core.resolveStyles(doc, opts);
      return { ...out, warnings: out.warnings.map((w) => ({ ...w, message: 'reworded by a future core' })) };
    },
  };
  const e = loadCheck().checkStates(reworded, useInput({ states: { '#Use[x]': ['hover'] } })).errors.join(' | ');
  expect(/"#Use\[x\]" is not a usable USS selector/.test(e), 'with every core message reworded, the unusable key is still refused by its subject');
  // mutation: go back to matching the wording
  const ByText = loadCheck((x) => x.replace(
    "if (subj && subj.kind === 'states-key' && Object.prototype.hasOwnProperty.call(states, subj.key)) refused.add(subj.key);",
    "keys.forEach(function (k) { if (w.message.indexOf('states key \"' + k + '\"') === 0) refused.add(k); });"));
  const e2 = ByText.checkStates(reworded, useInput({ states: { '#Use[x]': ['hover'] } })).errors.join(' | ');
  expect(!/not a usable USS selector/.test(e2), 'mutation (match the message text again) → the reworded core slips past, so the case above catches it');
}
{
  const C = loadCheck((x) => x.replace("if (st.errors.length) throw new Error(", "if (false) throw new Error("));
  const res = C.run(core, stage(), useInput({ states: { '#Use[x]': ['hover'] } }));
  expect(res.other.some((w) => w.subject && w.subject.kind === 'states-key' && w.subject.key === '#Use[x]'),
    "mutation (run() does not refuse) → the job's bad key lands among the document's own warnings");
  res.dispose();
}
{
  const C = loadCheck((x) => x.replace("        var extra = {}; extra[PROBE_SHEET] = probe;",
    "        var extra = {}; extra[PROBE_SHEET] = probe; input.sheets[PROBE_SHEET] = probe; input.uxml = String(input.uxml).replace(ROOT_OPEN, function (m) { return m + '<Style src=\"' + PROBE_SHEET + '\" />'; });"));
  const inp = useInput({ states: { '#Panel': ['focus'] } });
  inp.sheets = { ...USE_SHEETS };
  const res = C.run(core, stage(), inp);
  expect(res.depsRequested.some((d) => /probe/.test(d)), 'mutation (probe leaks into the real parse) → the isolation case catches it');
  res.dispose();
}

section('K — the probe passes a states key exactly when the renderer applies it');
// Measured, not assumed. The core matches a states key with no state at all
// in scope — neither activeStates nor the `disabled` an `enabled="false"`
// attribute gives — so a key that itself needs a state never selects anything
// there. A probe that disagreed would pass a key the renderer then ignores, and
// the run would report a state it never drew. Each row asks both sides.
const UXML_EN = `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="E.uss" />
<ui:VisualElement name="Panel">
  <ui:Button name="Use" text="Use" enabled="false" />
  <ui:VisualElement name="Parent" enabled="false"><ui:VisualElement name="Child" /></ui:VisualElement>
  <ui:VisualElement name="Free" />
</ui:VisualElement></ui:UXML>`;
// `checked` is the marker state: nothing else in these documents puts it on an
// element, so a 141px width can only mean the renderer applied the key.
const EN_USS = `#Panel { width: 380px; height: 280px; }
#Use, #Child, #Free { width: 80px; height: 20px; }
#Use:checked, #Child:checked, #Free:checked { width: 141px; }
*:checked { --applied: 1; }`;
const EN_CASES = [
  ['#Use', []], ['#Use:disabled', []], ['#Use:disabled', ['disabled']],
  ['#Child:disabled', []], ['#Child:disabled', ['disabled']],
  ['#Parent:disabled #Child', []], ['#Parent:disabled #Child', ['disabled']],
  ['#Free:disabled', []], ['#Free:disabled', ['disabled']],
  ['#Use:hover', []], ['#Use:hover', ['hover']],
  ['#Use:enabled', []], ['#Free:enabled', []], ['#Free:enabled', ['enabled']],
  [':root', []], [':root', ['hover']],
  ['#Parent #Child', []], ['#Parent #Child', ['disabled']], ['Button', ['disabled']],
];
function rendererApplies(key, active) {
  const doc = core.expandTemplates(core.parse(UXML_EN, undefined, { resolveImport: () => EN_USS })).document;
  const opts = { activeStates: new Set(active), states: { [key]: ['checked'] } };
  const r = core.render(doc, stage(), { size: PANEL, ...opts });
  const nm = new Map();
  (function walk(n) { const a = n.attributes.find((x) => x.name === 'name'); nm.set(n.id, a ? a.value : '(root)'); n.children.forEach(walk); })(doc.root);
  const byBox = [...r.boxes].filter(([, b]) => b.width === 141).map(([id]) => nm.get(id));
  const byStyle = [];
  core.resolveStyles(doc, opts).styles.forEach((m, id) => {
    const v = m.get('--applied');
    if (v && v.origin.kind === 'rule') byStyle.push(nm.get(id));
  });
  r.dispose();
  return { byBox, byStyle };
}
function probeTable(C) {
  return EN_CASES.map(([key, active]) => {
    const st = C.checkStates(core, { uxml: UXML_EN, sheets: { 'E.uss': EN_USS }, states: { [key]: ['checked'] }, activeStates: active });
    const { byBox, byStyle } = rendererApplies(key, active);
    return { key, active, passed: st.errors.length === 0, applied: byStyle.length > 0, byBox, byStyle, why: st.errors.join('; ') };
  });
}
{
  const rows = probeTable(loadCheck());
  rows.forEach((r) => {
    const label = `${r.key}${r.active.length ? ' with activeStates ' + r.active.join(',') : ''}`;
    expect(r.passed === r.applied,
      `${label}: probe ${r.passed ? 'passes' : 'refuses'}, renderer ${r.applied ? 'applies on ' + r.byStyle.join(',') : 'applies nothing'}`);
  });
  // The width check is the drawn result; the cascade check also covers the
  // root, which has no width rule. They must name the same sized elements.
  expect(rows.every((r) => r.byBox.join() === r.byStyle.filter((n) => n !== '(root)').join()),
    'the two ways of telling "applied" agree on every row');
  expect(rows.some((r) => r.passed) && rows.some((r) => !r.passed), 'and the table has both outcomes, so it is not vacuous');
  const hint = rows.find((r) => r.key === '#Use:disabled' && r.active.length === 0).why;
  expect(/a state pseudo-class in the key itself never matches/.test(hint), 'a refused key with a state in it says why: ' + hint);
  expect(!/pseudo-class/.test(refusal(loadCheck(), { states: { '#Nope': ['hover'] } })),
    'a plain miss does not get that explanation');
}
{
  // mutation: the probe applies the job's activeStates, as it did before
  const C = loadCheck((x) => x.replace('core.resolveStyles(probeDoc, { activeStates: new Set(), states: {} })',
    'core.resolveStyles(probeDoc, { activeStates: activeSet, states: {} })'));
  const bad = probeTable(C).filter((r) => r.passed !== r.applied).map((r) => r.key + '+' + r.active.join(','));
  expect(bad.includes('#Use:hover+hover') && bad.includes('#Free:disabled+disabled'),
    'mutation (probe sees activeStates) → it passes keys the renderer ignores: ' + bad.join(' '));
}
{
  // mutation: the `enabled` attribute is left on the probe copy
  const C = loadCheck((x) => x.replace('        stripEnabled(probeDoc.root);\n', ''));
  const bad = probeTable(C).filter((r) => r.passed !== r.applied).map((r) => r.key + '+' + r.active.join(','));
  expect(bad.includes('#Use:disabled+') && bad.includes('#Child:disabled+') && bad.includes('#Parent:disabled #Child+'),
    'mutation (probe keeps enabled="false") → it passes keys aimed at disabled elements: ' + bad.join(' '));
}

section('L — warnings are sorted by what the core says they are about');
{
  const C = loadCheck();
  const one = (uss, uxmlBody = '<ui:Label name="P" text="hi" />', extra = {}) => {
    const res = C.run(core, stage(), {
      uxml: `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="W.uss" />${uxmlBody}</ui:UXML>`,
      sheets: { 'W.uss': '#P { width: 100px; height: 40px; } ' + uss }, panel: PANEL, ...extra,
    });
    res.dispose();
    return res;
  };
  const has = (list, prop) => list.some((w) => w.subject && w.subject.property === prop);
  const shadow = one('#P { text-shadow: 1px 1px 0 black; }');
  expect(has(shadow.unsupported, 'text-shadow') && !has(shadow.other, 'text-shadow') && shadow.layoutGaps.length === 0,
    'text-shadow (not-rendered, no layout effect) → "not drawn by this preview", not a defect');
  const auto = one(AUTO);
  expect(has(auto.layoutGaps, '-unity-text-auto-size') && !has(auto.unsupported, '-unity-text-auto-size'),
    '-unity-text-auto-size (not-rendered, affectsLayout) → its own channel');
  expect(C.judge(auto, {}).code === 3, 'and on its own that is code 3');
  const aspectNow = one('#P { aspect-ratio: 2; }');
  expect(!aspectNow.layoutGaps.length && !aspectNow.unsupported.length && C.judge(aspectNow, {}).code === 0,
    'aspect-ratio is laid out by the core now: no warning, code 0 — so it is no longer a layout-gap sample');
  const typo = one('#P { colour: red; }');
  expect(has(typo.other, 'colour') && C.judge(typo, {}).code === 1, 'colour (not-uss) → a defect, code 1');
  const font = one('#P { font-family: Arial; }');
  const fw = font.other.find((w) => w.subject && w.subject.property === 'font-family');
  expect(fw && /write -unity-font-definition instead/.test(C.describeDefect(fw)), 'font-family → a defect that names the USS property to write: ' + (fw && C.describeDefect(fw)));
  const grid = one('#P { display: grid; }');
  expect(has(grid.other, 'display') && C.judge(grid, {}).code === 1, 'display: grid (invalid-value) → a defect, code 1');
  const root = one(':root { width: 380px; }');
  expect(root.matchesUnity.some((w) => w.subject && w.subject.selector === ':root') && C.judge(root, {}).code === 0,
    ':root (matches-unity) → listed as nothing to do, code 0');
  // A Button with no text on the editor theme is 4px high on Unity 6000.0.40f1 and 19px on 6000.3.25f1
  // (core CHANGELOG 0.7.0, "Applying the theme is no longer a warning").
  const button = one('', '<ui:Button name="P" />', { theme: 'editor' });
  expect(button.versionDependent.length > 0 && C.judge(button, {}).code === 0, 'a Button with no text on the editor theme (version-dependent) keeps its channel, code 0');
  const themed = one('', '<ui:Button name="P" text="b" />');
  expect(themed.versionDependent.length === 0 && themed.other.length === 0,
    'using the runtime theme is not a warning any more: the channel stays empty for a Button with text');
  const both = one(AUTO + ' #Z { width: 0; }', '<ui:Label name="P" text="hi" /><ui:Image name="Z" />');
  const j = C.judge(both, {});
  expect(j.code === 1 && j.problems.some((p) => /#Z has no size.*by this preview's layout/.test(p)),
    'a collapse next to a layout gap is still 1, and says it is this preview\'s layout');
  expect(!C.judge(typo, {}).problems.some((p) => /this preview's layout/.test(p)) ,
    'and without a gap, no such caveat');

  // Real core output for text the default font cannot draw, and for rich text. Both carry
  // affectsLayout: true (checked against the 0.7.1 bundle), so both are layout gaps.
  const hangul = one('', '<ui:Label name="P" text="한글" />');
  expect(has(hangul.layoutGaps, '-unity-font-definition') && hangul.other.length === 0 && C.judge(hangul, {}).code === 3,
    'Hangul in the default font (font-fallback, affectsLayout) → a layout gap, code 3, not a defect');
  const hangulEditor = one('', '<ui:Label name="P" text="한글" />', { theme: 'editor' });
  expect(has(hangulEditor.layoutGaps, '-unity-font-definition') && C.judge(hangulEditor, {}).code === 3,
    'and the same on the editor theme');
  const rich = one('', '<ui:Label name="P" text="&lt;b&gt;hi&lt;/b&gt;" />');
  expect(has(rich.layoutGaps, 'enable-rich-text') && rich.other.length === 0 && C.judge(rich, {}).code === 3,
    'a rich text tag (not-rendered, affectsLayout) → a layout gap, code 3');
  const richOff = one('', '<ui:Label name="P" enable-rich-text="false" text="&lt;b&gt;hi&lt;/b&gt;" />');
  expect(!richOff.layoutGaps.length && !richOff.other.length && C.judge(richOff, {}).code === 0,
    'and with enable-rich-text="false" Unity draws the characters too: nothing to report');
  const fb = (affects) => ({ kind: 'unsupported-property', reason: 'font-fallback', message: 'core words',
    subject: Object.assign({ kind: 'property', property: '-unity-font-definition', missingGlyphs: 'hangul' }, affects === undefined ? {} : { affectsLayout: affects }) });
  expect(C.classify(fb(true)) === 'layoutGaps', 'font-fallback that affects layout → layoutGaps');
  expect(C.classify(fb(false)) === 'unsupported' && C.classify(fb(undefined)) === 'unsupported',
    'font-fallback that does not (false or absent) → unsupported, not a defect');
  expect(C.classify({ kind: 'unsupported-property', reason: 'font-fallback', message: 'x' }) === 'unsupported',
    'font-fallback with no subject at all → unsupported');
  const HINT = /-unity-font-definition removes this warning; this preview cannot load font assets/;
  const gap = C.describeGap(fb(true));
  expect(gap.indexOf('-unity-font-definition: core words') === 0 && HINT.test(gap),
    'a font-fallback gap reads: the core\'s words, then one line on setting the font: ' + gap);
  const notDrawn = (w) => typeof C.describeNotDrawn === 'function' ? C.describeNotDrawn(w) : '(describeNotDrawn does not exist)';
  const note = notDrawn(fb(false));
  expect(note.indexOf('core words') === 0 && HINT.test(note), 'and so does a font-fallback in the "not drawn" list');
  expect(notDrawn({ kind: 'unsupported-property', reason: 'not-rendered', message: 'plain core words' }) === 'plain core words' &&
    !HINT.test(C.describeGap({ kind: 'unsupported-property', reason: 'not-rendered', message: 'm', subject: { kind: 'property', property: 'aspect-ratio' } })),
    'while any other warning is the core\'s words, unchanged');

  // Open sets: values the core may add later are not guessed at.
  const cls = (w) => C.classify(w);
  expect(cls({ kind: 'unsupported-property', reason: 'brand-new-reason', message: 'x' }) === 'other', 'an unknown reason → other (exit 1), never dropped');
  expect(cls({ kind: 'unsupported-property', reason: 'not-rendered', subject: { kind: 'brand-new-subject' }, message: 'x' }) === 'other',
    'an unknown subject kind → other, even under a reason that would not fail');
  expect(cls({ kind: 'asset-unresolved', message: 'x', subject: { kind: 'asset', path: 'a.png', form: 'url' } }) === 'missingAssets',
    'no reason: a missing image keeps its non-failing channel');
  expect(cls({ kind: 'import-unresolved', message: 'x', subject: { kind: 'import', url: 'a.uss', from: null } }) === 'other',
    'no reason, any other kind → other');
  expect(cls({ kind: 'duplicate-name-in-tree', reason: 'matches-unity', subject: { kind: 'name', name: 'n' }, message: 'x' }) === 'repeatedNames',
    'a repeated name (matches-unity, name) keeps its own channel');
}
// mutations — each undoes one branch the cases above depend on
{
  const M = (from, to) => loadCheck((x) => { if (!x.includes(from)) throw new Error('mutation target missing: ' + from); return x.replace(from, to); });
  const run1 = (C, uss, body = '<ui:Label name="P" text="hi" />') => {
    const r = C.run(core, stage(), { uxml: `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="W.uss" />${body}</ui:UXML>`,
      sheets: { 'W.uss': '#P { width: 100px; height: 40px; } ' + uss }, panel: PANEL });
    r.dispose(); return C.judge(r, {}).code;
  };
  expect(run1(M("        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';", "        return 'unsupported';"), AUTO) === 0,
    'mutation (affectsLayout ignored) → -unity-text-auto-size passes as 0, so the case above catches it');
  expect(run1(M("      case 'not-uss':\n", "      case 'not-uss':\n        return 'unsupported';\n"), '#P { colour: red; }') !== 1,
    'mutation (not-uss filed as "not drawn") → the colour typo stops failing, so the case above catches it');
  expect(run1(M("      case 'matches-unity':\n        return subj && subj.kind === 'name' ? 'repeatedNames' : 'matchesUnity';\n", ''), ':root { width: 380px; }') === 1,
    'mutation (matches-unity unhandled) → :root fails the run');
  expect(run1(M("      case 'not-rendered':\n", "      case 'not-rendered-x':\n"), '#P { text-shadow: 1px 1px 0 black; }') === 1,
    'mutation (not-rendered unhandled) → text-shadow fails the run, as the default branch says it must');
  expect(M("    if (subj && KNOWN_SUBJECTS.indexOf(subj.kind) === -1) return 'other';\n", '')
    .classify({ kind: 'unsupported-property', reason: 'not-rendered', subject: { kind: 'brand-new-subject' }, message: 'x' }) !== 'other',
    'mutation (subject kinds not checked) → the unknown subject is filed as not drawn');
  expect(M("      default:\n        return 'other';", "      default:\n        return 'matchesUnity';")
    .classify({ kind: 'x', reason: 'brand-new-reason', message: 'x' }) !== 'other',
    'mutation (unknown reason filed as harmless) → the open-set case catches it');
  expect(M("code: problems.length ? 1 : (overBudget.length || layoutGaps.length) ? 3 : 0", "code: problems.length ? 1 : overBudget.length ? 3 : 0")
    .judge({ painted: { childCount: 1, elementCount: 1, boxCount: 1 }, unindexed: [], ambiguousDeps: [], cascadeMismatch: [], collapsed: [], overflow: [], other: [],
             layoutGaps: [{ reason: 'not-rendered' }] }, {}).code === 0,
    'mutation (layout gaps not in the verdict) → code 0 where it must be 3');
  // font-fallback and rich text, through the same kind of mutation. A mutation whose target is
  // absent from check.js tested nothing, and says so.
  const tryM = (from, to) => { try { return M(from, to); } catch (e) { expect(false, e.message); return null; } };
  const code = (C, body, uss = '', extra = {}) => {
    if (!C) return null;
    const r = C.run(core, stage(), { uxml: `<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="W.uss" />${body}</ui:UXML>`,
      sheets: { 'W.uss': '#P { width: 100px; height: 40px; } ' + uss }, panel: PANEL, ...extra });
    r.dispose(); return C.judge(r, {}).code;
  };
  const HANGUL = '<ui:Label name="P" text="한글" />', RICH = '<ui:Label name="P" text="&lt;b&gt;hi&lt;/b&gt;" />';
  const FB = "      case 'font-fallback':\n        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';\n";
  expect(code(tryM(FB, ''), HANGUL) === 1,
    'mutation (font-fallback unhandled) → it falls to the default and Hangul text fails the run, so the case above catches it');
  expect(code(tryM(FB, "      case 'font-fallback':\n        return 'unsupported';\n"), HANGUL) === 0,
    'mutation (font-fallback ignores affectsLayout, always "not drawn") → Hangul passes as 0');
  const always = tryM(FB, "      case 'font-fallback':\n        return 'layoutGaps';\n");
  expect(always && always.classify({ kind: 'unsupported-property', reason: 'font-fallback', message: 'x', subject: { kind: 'property', affectsLayout: false } }) !== 'unsupported',
    'mutation (font-fallback always a layout gap) → one that does not affect layout is filed wrongly');
  expect(code(M("        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';", "        return 'unsupported';"), RICH) === 0,
    'mutation (affectsLayout ignored) → rich text passes as 0');
  expect(code(M("      case 'not-rendered':\n", "      case 'not-rendered-x':\n"), RICH) === 1,
    'mutation (not-rendered unhandled) → rich text fails the run');
  expect(code(M("code: problems.length ? 1 : (overBudget.length || layoutGaps.length) ? 3 : 0", "code: problems.length ? 1 : overBudget.length ? 3 : 0"), RICH) === 0,
    'mutation (layout gaps not in the verdict) → rich text passes as 0');
  const hintGone = tryM("function fontHint(", "function fontHintOff(");
  const gapOf = (C) => C && C.describeGap({ kind: 'unsupported-property', reason: 'font-fallback', message: 'core words',
    subject: { kind: 'property', property: '-unity-font-definition', affectsLayout: true } });
  expect(hintGone === null || !/removes this warning/.test(String(gapOf(hintGone))),
    'mutation (the font hint renamed away) → the hint disappears from the gap line');
  const NoBasis = M("var basis = (res.layoutGaps || []).length ?", "var basis = false ?");
  const rb = NoBasis.run(core, stage(), { uxml: '<ui:UXML xmlns:ui="UnityEngine.UIElements"><Style src="W.uss" /><ui:Label name="P" text="hi" /><ui:Image name="Z" /></ui:UXML>',
    sheets: { 'W.uss': '#P { width: 100px; height: 40px; -unity-text-auto-size: best-fit 8px 40px; }' }, panel: PANEL });
  rb.dispose();
  expect(!NoBasis.judge(rb, {}).problems.some((p) => /this preview's layout/.test(p)), 'mutation (no preview-basis label) → the caveat case catches it');
}

section('M — the theme is passed to the core, and what was drawn is what is reported');
{
  const C = loadCheck();
  const LABEL = '<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:Label name="P" text="hi" /></ui:UXML>';
  const go = (Chk, extra) => { const r = Chk.run(core, stage(), { uxml: LABEL, panel: PANEL, ...extra }); r.dispose(); return r; };
  const height = (r) => r.boxes.find((b) => b.name === 'P').box.height;
  const isBad = (r) => r.other.some((w) => w.kind === 'malformed' && w.reason === 'invalid-value' && /Unknown theme 'dark'/.test(w.message));
  const def = go(C, {}), rt = go(C, { theme: 'runtime' }), ed = go(C, { theme: 'editor' }), bad = go(C, { theme: 'dark' });
  expect(def.theme === 'runtime' && rt.theme === 'runtime' && height(def) === height(rt) && !def.other.length,
    'no theme asked → the core\'s default, runtime, is drawn and reported, with no warning');
  expect(ed.theme === 'editor' && height(ed) !== height(def) && !ed.other.length,
    `theme: "editor" reaches the renderer and is reported: Label ${height(ed)}px against ${height(def)}px`);
  expect(bad.theme === 'runtime' && height(bad) === height(def),
    'an unknown theme draws the default, and the result says runtime — what was drawn, not what was asked');
  expect(isBad(bad) && C.judge(bad, {}).code === 1 && C.judge(bad, {}).problems.some((p) => /Unknown theme 'dark'/.test(p)),
    'and the core\'s warning lands in "other": code 1, named in the problems');
  expect(go(C, { theme: null }).other.length === 1, 'null is a value, not "unset": the core judges it too');

  // Each mutation breaks one hand-off between the job and the core.
  const T = (from, to) => { try { return loadCheck((x) => { if (!x.includes(from)) throw new Error('mutation target missing: ' + from); return x.replace(from, to); }); }
                            catch (e) { expect(false, e.message); return null; } };
  const pass = T('theme: input.theme,', '');
  expect(pass && go(pass, { theme: 'editor' }).theme === 'runtime',
    'mutation (the theme never reaches the core) → "editor" is drawn as runtime, so the case above catches it');
  const echo = T('theme: r.theme,', "theme: input.theme || 'runtime',");
  expect(echo && go(echo, { theme: 'dark' }).theme === 'dark',
    'mutation (report what was asked, not what was drawn) → the unknown theme is reported as "dark"');
  const swallow = T('theme: input.theme,', "theme: input.theme === 'editor' ? 'editor' : undefined,");
  expect(swallow && !isBad(go(swallow, { theme: 'dark' })),
    'mutation (an unknown theme quietly replaced before the core sees it) → the warning is lost and the run passes');
  const dropped = T('theme: r.theme,', '');
  expect(dropped && go(dropped, {}).theme === undefined,
    'mutation (the result carries no theme) → the report has nothing to print');
}

section('N — what SKILL.md says the core draws, run against the core');
{
  // Each claim has two halves: the core really does it, and the document says so. A claim is
  // tested by making each half wrong in turn; a half that can be broken without the check
  // noticing is not guarding anything.
  const C = loadCheck();
  const SKILL = readFileSync(root + 'SKILL.md', 'utf8');
  const paint = (body, extra = {}) => {
    const el = stage();
    const r = C.run(core, el, { uxml: `<ui:UXML xmlns:ui="UnityEngine.UIElements">${body}</ui:UXML>`, panel: PANEL, ...extra });
    return { el, r };
  };
  const styleOf = (p, name) => { const b = p.r.boxes.find((x) => x.name === name); return p.el.querySelector('[data-uxml-node="' + b.id + '"]').style; };
  const parts = (p) => [...p.el.querySelectorAll('[data-uxml-part]')].map((e) => e.getAttribute('data-uxml-part'));
  const claim = (what, core_, say, badCore, badDoc) => {
    expect(core_.holds, 'the core: ' + what + ' — ' + core_.seen);
    expect(say.test(SKILL), 'SKILL.md says it');
    badCore.forEach(([why, f]) => expect(!f(), `mutation (${why}) → the core half fails`));
    badDoc.forEach(([why, f]) => expect(!say.test(f(SKILL)), `mutation (${why}) → the document half fails`));
  };

  // Disabled: only the element written enabled="false" is dimmed (core CHANGELOG 0.7.0, "Only the
  // element written `enabled="false"` is dimmed" and "A state forced through `states` stays on that element").
  const written = paint('<ui:Button name="B" text="a" enabled="false" />');
  const forced = paint('<ui:Button name="B" text="a" />', { states: { '#B': ['disabled'] } });
  const everywhere = paint('<ui:Button name="B" text="a" />', { activeStates: ['disabled'] });
  const dims = (p) => styleOf(p, 'B').opacity;
  const disabledHolds = (w, f, e) => w === '0.5' && !f && !e;
  const SAY_FORCED = /forced[^.]*`disabled`[^.]*is not dimmed/, SAY_FILE = /Only `enabled="false"` written in the UXML dims/;
  claim('enabled="false" dims; a disabled forced through states or activeStates does not',
    { holds: disabledHolds(dims(written), dims(forced), dims(everywhere)),
      seen: `${dims(written)} / ${dims(forced) || 'not dimmed'} / ${dims(everywhere) || 'not dimmed'}` },
    { test: (t) => SAY_FORCED.test(t) && SAY_FILE.test(t) },
    [['forced disabled dims', () => disabledHolds('0.5', '0.5', '')], ['enabled="false" does not dim', () => disabledHolds('', '', '')],
     ['activeStates dims', () => disabledHolds('0.5', '', '0.5')]],
    [['"is not dimmed" removed', (t) => t.replace(/is not dimmed/g, 'is dimmed')], ['the file-only sentence removed', (t) => t.replace(SAY_FILE, '')],
     ['both halves removed', (t) => t.replace(/is not dimmed/g, 'is dimmed').replace(SAY_FILE, '')]]);

  // Scrollbars: the width is reserved, nothing is drawn.
  const scroll = paint('<ui:ScrollView name="S"><ui:Label text="x" /></ui:ScrollView>');
  const noBar = (names) => names.length > 0 && !names.some((n) => /scroller|slider|dragger|tracker/.test(n));
  claim('a ScrollView is built from its viewport and container only; no scrollbar part',
    { holds: noBar(parts(scroll)), seen: parts(scroll).join(', ') },
    /`ScrollView`[^.]*reserves[^.]*scrollbar and does not draw it/,
    [['a scroller part appears', () => noBar(parts(scroll).concat('unity-scroller'))], ['a dragger part appears', () => noBar(parts(scroll).concat('unity-dragger'))],
     ['no part at all (the test would pass on nothing)', () => noBar([])]],
    [['the sentence says it is drawn', (t) => t.replace('does not draw it', 'draws it')], ['the sentence removed', (t) => t.replace(/[^.\n]*reserves[^.]*scrollbar and does not draw it\./, '')],
     ['the control renamed', (t) => t.replace('A `ScrollView` reserves', 'A `Box` reserves')]]);

  // RepeatButton: bare text, as in Unity.
  const rb = paint('<ui:RepeatButton name="R" text="r" /><ui:Button name="B" text="b" />');
  const plain = (s) => !s.backgroundColor && !s.borderWidth;
  const bare = (r, b) => plain(r) && !plain(b);
  claim('a RepeatButton has no background or border where a Button has both',
    { holds: bare(styleOf(rb, 'R'), styleOf(rb, 'B')), seen: 'R ' + (plain(styleOf(rb, 'R')) ? 'plain' : 'styled') + ', B ' + (plain(styleOf(rb, 'B')) ? 'plain' : 'styled') },
    /`RepeatButton` is bare text/,
    [['the RepeatButton gets a background', () => bare({ backgroundColor: '#959595' }, {})], ['the Button loses its look', () => bare({}, {})],
     ['both styled', () => bare({ borderWidth: '1px' }, { borderWidth: '1px' })]],
    [['the sentence says it looks like a button', (t) => t.replace('is bare text', 'is a button')], ['the sentence removed', (t) => t.replace(/`RepeatButton` is bare text/g, '')],
     ['the control renamed', (t) => t.replace('`RepeatButton` is bare text', '`TextElement` is bare text')]]);

  // TextField: no caret, no selection.
  const tf = paint('<ui:TextField name="T" label="l" value="v" />');
  const noCaret = (names) => names.length >= 3 && !names.some((n) => /cursor|caret|selection/.test(n));
  claim('a TextField has its label, input and text; no caret or selection part',
    { holds: noCaret(parts(tf)), seen: parts(tf).join(', ') },
    /`TextField` does not draw its caret or its selection/,
    [['a caret part appears', () => noCaret(parts(tf).concat('unity-text-field__cursor'))], ['a selection part appears', () => noCaret(parts(tf).concat('unity-text-field__selection'))],
     ['no part at all', () => noCaret([])]],
    [['the sentence says it draws them', (t) => t.replace('does not draw its caret', 'draws its caret')], ['the sentence removed', (t) => t.replace(/`TextField` does not draw its caret or its selection/g, '')],
     ['the control renamed', (t) => t.replace('`TextField` does not draw', '`Slider` does not draw')]]);
  [written, forced, everywhere, scroll, rb, tf].forEach((p) => p.r.dispose());
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
