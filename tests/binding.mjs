// The failure this file guards lives between two runs, not inside one. Every
// case therefore regenerates and compares.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T = ROOT + 'tests/tmp3/';
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });

let failures = 0;
const expect = (c, what) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + what); };
const section = (s) => console.log('\n' + s);

function uxml(body) {
  return `<ui:UXML xmlns:ui="UnityEngine.UIElements">\n${body}\n</ui:UXML>`;
}
const THREE = uxml(`  <ui:VisualElement name="Panel">
    <ui:Label name="Title" text="Inventory" />
    <ui:Button name="UseButton" text="Use" />
  </ui:VisualElement>`);
const TWO = uxml(`  <ui:VisualElement name="Panel">
    <ui:Label name="Title" text="Inventory" />
  </ui:VisualElement>`);

function run(name, { source, renames, contract } = {}) {
  const u = T + name + '.uxml';
  writeFileSync(u, source ?? THREE);
  const job = {
    uxml: name + '.uxml', title: name, className: name + 'Controller',
    contract: (contract || name) + '-contract.md',
  };
  if (renames) job.renames = renames;
  writeFileSync(T + name + '.json', JSON.stringify(job));
  let out = '', code = 0;
  try { out = execFileSync('node', [ROOT + 'scripts/bind-csharp.mjs', T + name + '.json'], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status; }
  const bind = T + name + 'Controller.Bindings.cs';
  const logic = T + name + 'Controller.cs';
  return {
    code, out, logicPath: logic,
    cs: existsSync(bind) ? readFileSync(bind, 'utf8') : null,
    logic: existsSync(logic) ? readFileSync(logic, 'utf8') : null,
    contract: existsSync(T + (contract || name) + '-contract.md')
      ? readFileSync(T + (contract || name) + '-contract.md', 'utf8') : null,
  };
}

section('K — the names come from the structure, not from a model');
{
  const a = run('k1');
  const b = run('k1');
  expect(a.cs === b.cs, 'the same UXML twice produces byte-identical C#');
  expect(a.contract === b.contract, 'and a byte-identical contract — nothing transient is stored');
  expect(/private Button useButton;/.test(a.cs), 'UseButton → useButton, mechanically');
  expect(a.code === 0 && b.code === 0, 'both runs are clean');
}

{
  // From scratch twice. The case above lets the second run read the first run's
  // contract, so it proves convergence, not that the derivation itself is free
  // of anything variable.
  const a = run('k2');
  rmSync(T + 'k2-contract.md');
  const b = run('k2');
  expect(a.cs === b.cs && a.contract === b.contract,
    'with no prior contract either time, both runs still match exactly');
}
{
  const clash = run('k3', {
    source: uxml(`  <ui:VisualElement name="Use-Button">
    <ui:Button name="UseButton" />
    <ui:Label name="use_button" />
  </ui:VisualElement>`),
  });
  const fields = [...clash.cs.matchAll(/private \w+ (\w+);/g)].map((m) => m[1]);
  expect(new Set(fields).size === fields.length,
    'three names that sanitise alike get distinct fields: ' + fields.join(', '));
  const again = run('k3', {
    source: uxml(`  <ui:VisualElement name="Use-Button">
    <ui:Button name="UseButton" />
    <ui:Label name="use_button" />
  </ui:VisualElement>`),
  });
  expect(clash.cs === again.cs, 'and the collision resolution is stable across runs');
}
{
  const kw = run('k4', { source: uxml('  <ui:Label name="class" />') });
  expect(/private Label @class;/.test(kw.cs), 'a C# keyword becomes a verbatim identifier');
}
{
  // Our own error message tells the user they may restore the element. Check
  // that doing so gives the field back rather than minting a second one.
  run('k5');
  run('k5', { source: TWO });                // UseButton retired
  const restored = run('k5');                // put it back
  expect(/private Button useButton;/.test(restored.cs) && !/useButton2/.test(restored.cs),
    'restoring a retired element returns its original field, as the advice promises');
  expect(/was retired, now back/.test(restored.out), 'and the return is reported');
}

{
  const clash = run('k6', { source: uxml('  <ui:Label name="document" />') });
  expect(!/private Label document;/.test(clash.cs),
    'a name that would collide with the template\'s own members is moved aside');
  expect(/private UIDocument document;/.test(clash.cs), 'and the template member survives');
}

section('L / M — a removed element retires, and says so');
{
  run('l1');                                   // three elements
  const after = run('l1', { source: TWO });    // UseButton removed
  expect(/\| UseButton \|.*\| retired \|/.test(after.contract),
    'UseButton is marked retired rather than dropped');
  expect(!/private Button useButton;/.test(after.cs), 'and it is no longer declared in C#');
  expect(after.code === 1, 'the run exits 1 — a retirement is not a clean regeneration');
  expect(/still calling Q<…>\("UseButton"\)/.test(after.out),
    'the report says what breaks and where');
}
{
  // mutation: retire quietly. Without the exit code and the message, a removal
  // reads as a normal run and the null appears months later.
  const src = readFileSync(ROOT + 'scripts/bind-csharp.mjs', 'utf8');
  const patched = T + 'quiet-bind.mjs';
  writeFileSync(patched, src
    .replace("events.retired.forEach((e) => problems.push(", "[].forEach((e) => problems.push(")
    .replace("from '../src/contract.js'", "from '" + ROOT + "src/contract.js'")
    .replace("fileURLToPath(new URL('..', import.meta.url))", JSON.stringify(ROOT)));
  writeFileSync(T + 'm1.uxml', TWO);
  writeFileSync(T + 'm1.json', JSON.stringify({ uxml: 'm1.uxml', out: 'm1.cs', contract: 'l1-contract.md' }));
  let code = 0;
  try { execFileSync('node', [patched, T + 'm1.json'], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  expect(code === 0, 'mutation (drop the retirement report) → exit 0, indistinguishable from clean');
}

section('N — a redesign does not move an existing field');
{
  run('n1');
  const moved = run('n1', {
    source: uxml(`  <ui:ScrollView name="Panel" class="rebuilt">
    <ui:Button name="UseButton" text="Confirm" />
    <ui:Label name="Title" text="Bag" />
  </ui:VisualElement>`.replace('</ui:VisualElement>', '</ui:ScrollView>')),
  });
  expect(/private Button useButton;/.test(moved.cs), 'reordering and restyling leaves useButton alone');
  expect(/\| Title \|.*\| title \|/.test(moved.contract), 'and title keeps its field too');
  expect(/Panel changed type, VisualElement → ScrollView/.test(moved.out),
    'but a type change is reported — the declaration really did change');
  expect(moved.code === 1, 'and it exits 1');
}

section('O — an intended rename is recorded, so it cannot pass as an accident');
{
  run('o1');
  const renamed = run('o1', {
    source: THREE.replace(/UseButton/g, 'ConfirmButton'),
    renames: { UseButton: 'ConfirmButton' },
  });
  expect(/\| ConfirmButton \|.*\| useButton \|.*renamed from UseButton/.test(renamed.contract),
    'the new name inherits the old field and carries the trail');
  expect(!/\| UseButton \|.*retired/.test(renamed.contract),
    'and the old name is not also retired — one event, one row');
  expect(renamed.code === 1, 'exits 1: the query string moved, so C# needs a look');
}
{
  const accidental = run('o2');
  const noDeclare = run('o2', { source: THREE.replace(/UseButton/g, 'ConfirmButton') });
  expect(/\| UseButton \|.*retired/.test(noDeclare.contract) &&
         /\| ConfirmButton \|/.test(noDeclare.contract),
    'the same edit without declaring it reads as a retirement plus a new name');
  expect(noDeclare.code === 1, 'also exits 1, but the contract shows a different shape');
}

section('Q — only named elements are bound, and the rest are counted');
{
  const mixed = run('q1', {
    source: uxml(`  <ui:VisualElement name="Panel">
    <ui:Label text="decoration" />
    <ui:Label name="Title" text="Inventory" />
  </ui:VisualElement>`),
  });
  expect(/2 bound/.test(mixed.out), 'two named elements bound');
  expect(/1 element\(s\) without a name/.test(mixed.out), 'the unnamed one is counted, not guessed at');
  expect(!/decoration/.test(mixed.cs), 'and never appears in the C#');
}
{
  const styled = run('q2', {
    source: `<ui:UXML xmlns:ui="UnityEngine.UIElements">
  <Style src="Main.uss" />
  <ui:VisualElement name="Panel" />
</ui:UXML>`,
  });
  expect(/0 element\(s\) without a name/.test(styled.out),
    '<Style> is sheet plumbing and is not counted as an unnamed element');
}

section('R / S — a contract that cannot be trusted stops the run');
{
  run('r1');
  writeFileSync(T + 'r1-contract.md',
    readFileSync(T + 'r1-contract.md', 'utf8').replace('| active |', '| alive |'));
  const broken = run('r1');
  expect(broken.code === 2, 'an unreadable contract exits 2, not 1');
  expect(/DID NOT RUN/.test(broken.out) && /untouched/.test(broken.out),
    'and says nothing was written');
  expect(/alive/.test(readFileSync(T + 'r1-contract.md', 'utf8')),
    'the damaged file is left exactly as found — never rewritten from scratch');
}
{
  run('r2');
  const c = readFileSync(T + 'r2-contract.md', 'utf8');
  writeFileSync(T + 'r2-contract.md',
    c.replace('| Title |', '| Ghost | Label | Label | ghost | active |  |\n| Title |'));
  const ghost = run('r2');
  expect(/\| Ghost \|.*retired/.test(ghost.contract),
    'a name in the contract but not in the UXML is retired');
  expect(ghost.code === 1, 'and reported');
}

section('P — the generated half carries no behaviour; the draft lives in yours');
{
  const a = run('p1');
  const generated = a.cs.replace(/\/\/.*$/gm, '');
  expect(!/Debug\.Log\(/.test(generated.replace(/Debug\.LogError/g, '')),
    'no logging in the generated half beyond the missing-element diagnostic');
  expect(!/for \(|while \(|switch \(/.test(generated), 'and no control flow');
  expect(/Draft \u2014 replace with what your game should do/.test(a.logic),
    'the draft in your half says it is a draft');
}

section('T — regenerating never touches your half');
{
  run('t1');
  const mine = readFileSync(T + 't1Controller.cs', 'utf8')
    .replace('Debug.Log("UseButton pressed");', 'inventory.Consume(selected);  // MY CODE');
  writeFileSync(T + 't1Controller.cs', mine);

  run('t1');                                   // same UXML
  run('t1', { source: TWO });                  // a redesign that retires a button
  run('t1');                                   // and back again
  const after = readFileSync(T + 't1Controller.cs', 'utf8');
  expect(after === mine, 'three regenerations later, your file is byte-identical');
  expect(/MY CODE/.test(after), 'including the line you wrote by hand');
  expect(/left alone/.test(run('t1').out), 'and the run says it left it alone');
}
{
  // mutation: write the logic half unconditionally. This is the merge-free
  // version of eating someone's work, and nothing else in the suite sees it.
  const src = readFileSync(ROOT + 'scripts/bind-csharp.mjs', 'utf8');
  const patched = T + 'greedy-bind.mjs';
  writeFileSync(patched, src
    .replace('if (!logicExisted) writeFileSync(logicPath', 'writeFileSync(logicPath')
    .replace("from '../src/contract.js'", "from '" + ROOT + "src/contract.js'")
    .replace("fileURLToPath(new URL('..', import.meta.url))", JSON.stringify(ROOT)));
  writeFileSync(T + 't2.uxml', THREE);
  writeFileSync(T + 't2.json', JSON.stringify({
    uxml: 't2.uxml', className: 't2Controller', contract: 't2-contract.md' }));
  execFileSync('node', [patched, T + 't2.json'], { stdio: 'pipe' });
  writeFileSync(T + 't2Controller.cs',
    readFileSync(T + 't2Controller.cs', 'utf8').replace('Debug.Log', 'MY_CODE; Debug.Log'));
  execFileSync('node', [patched, T + 't2.json'], { stdio: 'pipe' });
  expect(!/MY_CODE/.test(readFileSync(T + 't2Controller.cs', 'utf8')),
    'mutation (always write the logic half) → the hand-written line is gone');
}

section('U — the generated half stands alone');
{
  const a = run('u1');
  // An unimplemented partial method is removed whole, so a method-group
  // reference to one does not compile. Every subscription must therefore point
  // at something declared in this same file.
  const targets = [...a.cs.matchAll(/clicked \+= (\w+);/g)].map((m) => m[1]);
  expect(targets.length > 0, 'there is at least one subscription to check');
  expect(targets.every((t) => new RegExp('private void ' + t + '\\(').test(a.cs)),
    'every subscription target is a concrete method in the generated half: ' + targets.join(', '));
  expect(targets.every((t) => !new RegExp('partial void ' + t + '\\(').test(a.cs)),
    'and none of them is a partial declaration');
  const subs = [...a.cs.matchAll(/clicked \+= (\w+);/g)].map((m) => m[1]).sort();
  const unsubs = [...a.cs.matchAll(/clicked -= (\w+);/g)].map((m) => m[1]).sort();
  expect(JSON.stringify(subs) === JSON.stringify(unsubs),
    'every subscription is matched by an unsubscription to the same delegate');
}
{
  // A button added after your half exists gets a declaration but no body, and
  // an unimplemented partial compiles away in silence.
  run('u2', { source: TWO });
  const grown = run('u2');
  expect(/is a new button/.test(grown.out) && /compiles away silently/.test(grown.out),
    'a new button whose handler you have not written yet is reported');
  expect(grown.code === 1, 'and it exits 1');
}

console.log(failures ? `\nFAILED: ${failures}` : '\nall Step 3 conditions hold');
process.exit(failures ? 1 : 0);
