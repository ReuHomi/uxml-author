// node scripts/bind-csharp.mjs job.json
//
// Same exit-code contract as preview.mjs:
//   0  ran, nothing needs your attention
//   1  ran, something needs a change in your C#
//   2  DID NOT RUN — no contract was reconciled, nothing was written
//
// The generator owns field names. A model choosing them is the drift this whole
// file exists to prevent: the design gets redrawn, the names wobble, and
// Q<T>() starts returning null while everything still compiles.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseContract, serializeContract, reconcile, csharpTypeFor, isKnownUnityType, duplicateNames }
  from '../src/contract.js';

// See preview.mjs: .pathname breaks on Windows.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function cannotRun(msg, hint) {
  console.error('DID NOT RUN — ' + msg);
  if (hint) console.error('  ' + hint);
  console.error('  Nothing was written. The existing contract is untouched.');
  process.exit(2);
}

const jobPath = process.argv[2];
if (!jobPath || !existsSync(jobPath)) cannotRun('no job file at ' + jobPath);
let job;
try { job = JSON.parse(readFileSync(jobPath, 'utf8')); }
catch (e) { cannotRun('job file is not valid JSON: ' + e.message); }

const base = dirname(resolve(jobPath));
const at = (p) => resolve(base, p);

if (!job.uxml || !existsSync(at(job.uxml))) cannotRun('no UXML at ' + job.uxml);
const uxmlText = readFileSync(at(job.uxml), 'utf8');
const uxmlName = basename(job.uxml);

// ── the renderer's parser, so the C# and the preview read the same tree ──────
let core;
try {
  // See preview.mjs: a bare absolute path is not importable on Windows.
  await import(pathToFileURL(ROOT + 'src/core.bundle.js').href);
  core = globalThis.UxmlCore;
} catch (e) { cannotRun('the parser bundle failed to load: ' + e.message); }

// Parsed, NOT expanded — a deliberate line, and the one place in this repo where
// the two consumers see different trees. The preview must expand, because it
// judges a screen and half the screen would otherwise be missing. The contract
// must not, because it answers a different question: which names does THIS
// document own? An instance's inner names belong to the template's own file and
// its own controller; pulling them in would make one C# class reach across a
// file boundary, and every repeated instance would collide on the way. What the
// entry document owns is the `name` on each `<ui:Instance>` itself, which is the
// TemplateContainer — and that is bindable, being exactly what Unity puts in the
// hierarchy.
let doc;
try { doc = core.parse(uxmlText, undefined, { resolveImport: () => null }); }
catch (e) { cannotRun('the UXML did not parse: ' + e.message); }

// ── extract, deterministically ───────────────────────────────────────────────
// Only elements carrying a `name`. Classes are for styling and are shared by
// many nodes; a name is what Q<T>() takes, so a name is what a contract can be
// made of. Elements without one are counted and reported, never guessed at.
const elements = [];
let unnamed = 0;
const NOT_ELEMENTS = new Set(['UXML', 'Style', 'Template', 'AttributeOverrides']);
(function walk(node) {
  const local = node.name.local;
  if (!NOT_ELEMENTS.has(local)) {
    const attr = node.attributes.find((a) => a.name === 'name');
    if (attr && attr.value) elements.push({ name: attr.value, type: local });
    else unnamed++;   // <Style> and friends are sheet plumbing, not UI to bind
  }
  node.children.forEach(walk);
})(doc.root);

// ── refuse before writing anything ───────────────────────────────────────────
// Checked here, not after generation: a Bindings.cs missing some fields while
// the hand-written Logic.cs still reaches for them is worse than no file.
const dupes = duplicateNames(elements);
if (dupes.size) {
  console.error(`${uxmlName} uses the same name for more than one element, so C# cannot`);
  console.error('address them apart — Q<T>(name) returns the first match and the rest are');
  console.error('unreachable. Nothing was written.');
  console.error('');
  for (const [name, n] of dupes) console.error(`  "${name}" — ${n} elements`);
  console.error('');
  console.error('Give each one its own name, or drop the name and select by class if the');
  console.error('code does not need to reach it. A repeated name is legal UXML and Unity');
  console.error('will not complain; it is the C# side that cannot work with it.');
  process.exit(1);
}

if (elements.length === 0) {
  console.log('no element in ' + uxmlName + ' carries a name attribute, so there is nothing');
  console.log('for C# to hold. Add name="…" to the elements the code needs to reach.');
  process.exit(1);
}

// ── reconcile with the previous contract ─────────────────────────────────────
const contractPath = at(job.contract || 'ui-contract.md');
let previous = [];
if (existsSync(contractPath)) {
  try { previous = parseContract(readFileSync(contractPath, 'utf8')); }
  catch (e) {
    // Never "start fresh" here. Rewriting an unreadable contract would erase
    // every retired name in it, which is the loudest form of the failure this
    // file prevents.
    cannotRun('the existing contract could not be read: ' + e.message,
      'Fix ' + contractPath + ' by hand, or move it aside if you mean to start over.');
  }
}

// The template declares members of its own. Deriving a field name blind to
// them produces C# that will not compile, and nothing here would notice.
const RESERVED = ['document', 'Require', 'OnEnable', 'OnDisable'];
const { rows, events } = reconcile(previous, elements, job.renames, RESERVED);

// ── generate ─────────────────────────────────────────────────────────────────
const className = job.className || uxmlName.replace(/\.uxml$/i, '').replace(/[^A-Za-z0-9_]/g, '') + 'Controller';
const active = rows.filter((r) => r.status === 'active');
const buttons = active.filter((r) => r.type === 'Button');

const pad = (n) => ' '.repeat(n);
const cap = (x) => x.replace(/^@/, '').replace(/^./, (c) => c.toUpperCase());

const fields = active.map((r) => `${pad(4)}private ${r.type} ${r.field};`).join('\n');
const queries = active.map((r) =>
  `${pad(8)}${r.field} = Require<${r.type}>(root, "${r.name}");`).join('\n');

// A partial method with no implementation is removed whole, so a method-group
// reference to it will not compile. Subscribing through a wrapper keeps the
// generated half standing on its own, and keeps a real delegate to unsubscribe
// — a lambda would create a different instance each time and never detach.
const subscribe = buttons.length
  ? '\n' + buttons.map((r) => `${pad(8)}${r.field}.clicked += Handle${cap(r.field)}Clicked;`).join('\n') + '\n\n'
  : '\n';
const unsubscribe = buttons.length
  ? buttons.map((r) => `${pad(8)}${r.field}.clicked -= Handle${cap(r.field)}Clicked;`).join('\n') + '\n'
  : '';
const declarations = [`${pad(4)}partial void OnBound();`]
  .concat(buttons.map((r) => `${pad(4)}partial void On${cap(r.field)}Clicked();`)).join('\n');
const wrappers = buttons.map((r) =>
  `${pad(4)}private void Handle${cap(r.field)}Clicked() => On${cap(r.field)}Clicked();\n`).join('');

const handlers = buttons.map((r) =>
  `${pad(4)}// ${r.name} was pressed. Draft \u2014 replace with what your game should do.\n` +
  `${pad(4)}partial void On${cap(r.field)}Clicked()\n${pad(4)}{\n` +
  `${pad(8)}Debug.Log("${r.name} pressed");\n${pad(4)}}\n`).join('\n');

const outDir = job.outDir ? at(job.outDir) : base;
const bindingsPath = resolve(outDir, className + '.Bindings.cs');
const logicPath = resolve(outDir, className + '.cs');

function fill(tmpl, vars) {
  const text = Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll('{{' + k + '}}', v), readFileSync(ROOT + 'templates/' + tmpl, 'utf8'));
  // A placeholder that appears twice would otherwise be filled once and left
  // raw the second time, compiling as a literal and reading as a typo.
  const left = text.match(/\{\{[A-Z]+\}\}/);
  if (left) cannotRun(`the ${tmpl} template still has an unfilled placeholder: ${left[0]}`);
  return text;
}

const common = {
  UXML: uxmlName, CLASS: className,
  CONTRACT: basename(contractPath),
  BINDINGS: basename(bindingsPath), LOGIC: basename(logicPath),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(bindingsPath, fill('Bindings.cs.tmpl', {
  ...common, FIELDS: fields, QUERIES: queries, SUBSCRIBE: subscribe,
  UNSUBSCRIBE: unsubscribe, DECLARATIONS: declarations, WRAPPERS: wrappers,
}));

// The logic half is written once and then owned by whoever edits it. Merging
// into it would turn every regeneration into a chance to eat someone's work,
// and a botched merge is a quieter failure than no merge at all.
const logicExisted = existsSync(logicPath);
if (!logicExisted) writeFileSync(logicPath, fill('Logic.cs.tmpl', { ...common, HANDLERS: handlers }));

writeFileSync(contractPath, serializeContract(job.title || uxmlName, rows));

// ── report ───────────────────────────────────────────────────────────────────
const L = (s) => console.log(s);
L(`${active.length} bound, ${rows.length - active.length} retired, ${unnamed} element(s) without a name`);

const unknown = active.filter((r) => !isKnownUnityType(r.element));
if (unknown.length) {
  L(`\ncustom or unrecognised types (${unknown.length}) — bound as VisualElement, which is the`);
  L(`safe floor; give them their real type in your own code if you need it`);
  unknown.forEach((r) => L(`  - <${r.element}> #${r.name}`));
}
if (events.added.length) {
  L(`\nnew fields (${events.added.length})`);
  events.added.forEach((e) => L(`  - ${e.name} → ${e.field}${e.back ? ' (was retired, now back)' : ''}`));
}

const problems = [];
const newButtons = events.added.filter((e) => buttons.some((b) => b.field === e.field));
if (logicExisted) {
  newButtons.forEach((e) => problems.push(
    `${e.name} is a new button. Its handler On${cap(e.field)}Clicked is declared in the ` +
    `generated half but not implemented in ${basename(logicPath)}, so pressing it does ` +
    `nothing. An unimplemented partial method compiles away silently.`));
}
events.retired.forEach((e) => problems.push(
  `${e.name} is gone from the UXML. Any C# still calling Q<…>("${e.name}") — the field ` +
  `${e.field} — now gets null at runtime and still compiles. Remove it or restore the element.`));
events.renamed.forEach((e) => problems.push(
  `${e.from} was renamed to ${e.to}. The field ${e.field} is unchanged, but the query string ` +
  `in the regenerated file has moved; anything you wrote against the old string needs updating.`));
events.retyped.forEach((e) => problems.push(
  `${e.name} changed type, ${e.from} → ${e.to}. The field is declared differently now, so code ` +
  `using it may no longer compile.`));

L(`\nneeds your attention (${problems.length})`);
problems.forEach((p) => L('  - ' + p));
L(`\n${bindingsPath}   (rewritten)`);
L(`${logicPath}   (${logicExisted ? 'left alone' : 'created'})`);
L(`${contractPath}`);

process.exit(problems.length ? 1 : 0);
