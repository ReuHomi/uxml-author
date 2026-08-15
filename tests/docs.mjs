// SKILL.md makes claims about the tooling: job keys, exit codes, which controls
// are unsupported, how many pitfalls are listed. Documentation drifts silently —
// nothing breaks, the model just starts following instructions that are no
// longer true. These run the real thing and compare.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL = readFileSync(ROOT + 'SKILL.md', 'utf8');
const T = ROOT + 'tests/tmpdoc/';
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });

let failures = 0;
const expect = (c, what) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + what); };
const section = (s) => console.log('\n' + s);

function jsonBlocks() {
  return [...SKILL.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
}

section('the job files in the documentation are the job files the scripts read');
{
  const blocks = jsonBlocks();
  expect(blocks.length === 2, 'two job examples are documented');
  const [preview, bind] = blocks;
  const pSrc = readFileSync(ROOT + 'scripts/preview.mjs', 'utf8');
  const bSrc = readFileSync(ROOT + 'scripts/bind-csharp.mjs', 'utf8');
  Object.keys(preview).forEach((k) =>
    expect(pSrc.includes('job.' + k), `preview.mjs reads job.${k}`));
  Object.keys(bind).forEach((k) =>
    expect(bSrc.includes('job.' + k), `bind-csharp.mjs reads job.${k}`));
}

section('the documented job examples actually run');
{
  writeFileSync(T + 'Inventory.uxml', `<ui:UXML xmlns:ui="UnityEngine.UIElements">
  <Style src="Main.uss" />
  <ui:VisualElement name="Panel"><ui:Button name="UseButton" text="Use" /></ui:VisualElement>
</ui:UXML>`);
  writeFileSync(T + 'Main.uss', '#Panel { width: 200px; height: 80px; } #UseButton { height: 30px; }');
  const [preview, bind] = jsonBlocks();

  const p = { ...preview };
  delete p.assets;                      // the example points at a file we do not ship
  writeFileSync(T + 'job.json', JSON.stringify(p));
  let pCode = 0;
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', T + 'job.json'], { stdio: 'pipe' }); }
  catch (e) { pCode = e.status; }
  expect(pCode === 0, 'the documented preview job runs clean on a minimal UXML');

  const b = { ...bind };
  delete b.renames;                     // renaming something that was never there is not a case
  writeFileSync(T + 'bind.json', JSON.stringify(b));
  let bCode = 0;
  try { execFileSync('node', [ROOT + 'scripts/bind-csharp.mjs', T + 'bind.json'], { stdio: 'pipe' }); }
  catch (e) { bCode = e.status; }
  expect(bCode === 0, 'the documented bind job runs clean');
}

section('the exit codes are what the table says');
{
  expect(/\|\s*0\s*\|.*ran, clean/.test(SKILL), 'the table documents 0');
  expect(/\|\s*1\s*\|.*ran, found something/.test(SKILL), 'the table documents 1');
  expect(/\|\s*2\s*\|.*did not run/i.test(SKILL), 'the table documents 2');

  const noPanel = T + 'nopanel.json';
  writeFileSync(noPanel, JSON.stringify({ uxml: 'Inventory.uxml', out: 'x.html' }));
  let code = 0;
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', noPanel], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  expect(code === 2, 'a missing panel size really exits 2, as the text claims');

  writeFileSync(T + 'Collapse.uxml', `<ui:UXML xmlns:ui="UnityEngine.UIElements">
  <ui:VisualElement name="Box"><ui:Image name="Loose" /></ui:VisualElement></ui:UXML>`);
  writeFileSync(T + 'collapse.json', JSON.stringify({
    uxml: 'Collapse.uxml', panel: { width: 300, height: 200 }, out: 'c.html' }));
  let code1 = 0;
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', T + 'collapse.json'], { stdio: 'pipe' }); }
  catch (e) { code1 = e.status; }
  expect(code1 === 1, 'and a collapsed element really exits 1');
}

section('the controls called unsupported are unsupported');
{
  await import(pathToFileURL(ROOT + 'src/core.bundle.js').href);
  const supported = globalThis.UxmlCore.supportedControlNames();

  // Read the list out of the document rather than comparing against a list
  // kept here. A hardcoded array cannot notice the document naming a control
  // it never heard of — which is exactly how a supported control could be
  // described as unsupported and pass.
  const para = SKILL.slice(SKILL.indexOf('**Not drawn by this version.**'));
  const sentence = para.slice(0, para.indexOf('\n\n'));
  const named = [...sentence.matchAll(/`([A-Z]\w+)`/g)].map((m) => m[1]);
  expect(named.length >= 2, 'the paragraph names some controls: ' + named.join(', '));
  named.forEach((c) =>
    expect(!supported.includes(c), `${c} is called undrawable and really is`));

  supported.forEach((c) =>
    expect(new RegExp('`' + c + '`').test(SKILL), `${c} is supported and SKILL.md mentions it`));

  const trustPara = SKILL.slice(SKILL.indexOf('- **Trust** the geometry'));
  const trusted = [...trustPara.slice(0, trustPara.indexOf('\n-')).matchAll(/`([A-Z]\w+)`/g)].map((m) => m[1]);
  expect(trusted.length === supported.length &&
         trusted.every((c) => supported.includes(c)),
    'the "trust the geometry of" list is exactly the supported set: ' + trusted.join(', '));
}

section('the pitfall list is the length it claims, and the tables are not copied');
{
  const block = SKILL.slice(SKILL.indexOf('## USS is not CSS'));
  const numbers = [...block.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  expect(numbers.join(',') === '1,2,3,4,5,6,7,8',
    `the pitfalls are numbered 1 to 8 with none missing (found ${numbers.join(',')})`);
  expect(/eight/.test(block), 'and the prose says eight');
  ['uss-reference.md', 'uss-vs-css.md', 'supported.md', 'accuracy.md'].forEach((d) =>
    expect(block.includes(d), `points at ${d} instead of restating it`));
}

section('the file table matches what the generators write');
{
  const bSrc = readFileSync(ROOT + 'scripts/bind-csharp.mjs', 'utf8');
  expect(bSrc.includes("'.Bindings.cs'"), 'the generated half is named *.Bindings.cs as documented');
  expect(bSrc.includes('if (!logicExisted)'), 'the human half is only written when absent');
  expect(readFileSync(ROOT + 'templates/Bindings.cs.tmpl', 'utf8').includes('private T Require<T>'),
    'Require<T> exists, as the C# section claims');
  expect(!/RegisterValueChangedCallback/.test(bSrc),
    'only Button.clicked is wired, as the C# section claims');
}

section('the name is one name in every file that carries it');
{
  // Once published, a marketplace slug cannot change without breaking every
  // existing install, so these four must never drift apart.
  const plugin = JSON.parse(readFileSync(ROOT + '.claude-plugin/plugin.json', 'utf8'));
  const market = JSON.parse(readFileSync(ROOT + '.claude-plugin/marketplace.json', 'utf8'));
  const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'));
  const frontmatter = SKILL.match(/^name:\s*(\S+)$/m);

  expect(!!frontmatter, 'SKILL.md declares a name in its frontmatter');
  const name = frontmatter[1];
  expect(plugin.name === name, `plugin.json name is ${name}`);
  expect(pkg.name === name, `package.json name is ${name}`);
  expect(market.plugins.length === 1 && market.plugins[0].name === name,
    `the marketplace lists exactly one plugin, ${name}`);
  expect(market.plugins[0].source === './',
    'and points at the repository root, where SKILL.md lives');
  expect(new RegExp(name).test(readFileSync(ROOT + 'README.md', 'utf8')),
    'the README uses the same name');
}

section('the lockfile can be installed as Claude Code installs it');
{
  // Claude Code runs `npm ci --ignore-scripts` when it caches the plugin, and a
  // lockfile out of step with package.json makes that fail. The failure is only
  // a warning in a debug log, so the user meets a missing happy-dom instead —
  // and the tooling reports code 2 with no idea why.
  let code = 0;
  // shell: true because on Windows the executable is npm.cmd, and execFileSync
  // without a shell reports ENOENT for it.
  try {
    execFileSync('npm', ['ci', '--dry-run', '--ignore-scripts'],
      { cwd: ROOT, stdio: 'pipe', shell: true });
  }
  catch (e) { code = e.status; }
  expect(code === 0, 'npm ci accepts package.json and package-lock.json as a pair');

  const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'));
  expect(!pkg.devDependencies,
    'no devDependencies: npm ci installs those too, onto every user who installs the plugin');
  expect(Object.keys(pkg.dependencies).join(',') === 'happy-dom',
    'happy-dom is the only runtime dependency');
}

section('paths work off Windows drive letters');
{
  // `new URL(...).pathname` yields '/C:/Users/...' on Windows and fs cannot open
  // that. Unity development is largely a Windows activity, so this is a plain
  // portability requirement rather than an edge case, and it cannot be tested
  // from Linux — the check is on the shape of the code instead.
  const sources = ['scripts/preview.mjs', 'scripts/bind-csharp.mjs', 'scripts/build-core-bundle.mjs',
                   'tests/conditions.mjs', 'tests/exitcodes.mjs', 'tests/binding.mjs', 'tests/docs.mjs'];
  sources.forEach((f) => {
    const src = readFileSync(ROOT + f, 'utf8');
    expect(!/import\.meta\.url\s*\)\s*\.pathname/.test(src),
      `${f} converts a file URL with fileURLToPath, not .pathname`);

    // `import('C:\\...')` is read as a URL whose scheme is "C:" and throws
    // ERR_UNSUPPORTED_ESM_URL_SCHEME. An absolute path has to become a file URL
    // before it can be imported.
    const bareImport = [...src.matchAll(/await import\(([^)]*)\)/g)]
      .map((m) => m[1])
      .filter((arg) => /ROOT|root|here|patched/.test(arg) && !/pathToFileURL/.test(arg));
    expect(bareImport.length === 0,
      `${f} imports absolute paths as file URLs` +
      (bareImport.length ? ': ' + bareImport.join(', ') : ''));
  });

  // npm is npm.cmd on Windows, and execFileSync without a shell reports ENOENT.
  const docsSrc = readFileSync(ROOT + 'tests/docs.mjs', 'utf8');
  const npmCalls = [...docsSrc.matchAll(/execFileSync\('npm'[\s\S]{0,200}?\}\)/g)].map((m) => m[0]);
  expect(npmCalls.length > 0 && npmCalls.every((c) => /shell:\s*true/.test(c)),
    'every npm invocation runs through a shell');
}

section('no number is quoted without its unit');
{
  // Accuracy figures are the one place this project has repeatedly misled
  // itself. If SKILL.md ever names a bare count, it has to carry what was
  // counted; the safe form is a link.
  const suspicious = [...SKILL.matchAll(/(\d+)\s*\/\s*(\d+)/g)];
  expect(suspicious.length === 0,
    'SKILL.md quotes no raw accuracy ratio: ' + suspicious.map((m) => m[0]).join(', '));
  expect(/docs\/accuracy\.md/.test(SKILL), 'it links the accuracy document instead');
}

rmSync(T, { recursive: true, force: true });
console.log(failures ? `\nFAILED: ${failures}` : '\ndocumentation matches the code');
process.exit(failures ? 1 : 0);
