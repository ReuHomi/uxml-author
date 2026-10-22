// SKILL.md makes claims about the tooling: job keys, exit codes, which controls
// are unsupported, how many pitfalls are listed. Documentation drifts silently —
// nothing breaks, the model just starts following instructions that are no
// longer true. These run the real thing and compare.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL = readFileSync(ROOT + 'SKILL.md', 'utf8');
const T = ROOT + 'tests/tmpdoc/';
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });

let failures = 0;
const expect = (c, what) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + what); };
const section = (s) => console.log('\n' + s);

// `\r?\n` rather than `\n`: a clone with core.autocrlf=true hands this file back
// with CRLF, the pattern matched nothing, and the destructure below then threw
// on undefined — the suite died with a TypeError instead of naming a failure.
// .gitattributes now normalises the checkout, and this is the second line of
// defence: a checker that crashes tells the caller nothing about what it saw.
function jsonBlocks() {
  return [...SKILL.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
}

section('the job files in the documentation are the job files the scripts read');
{
  const blocks = jsonBlocks();
  expect(blocks.length === 3, `three job examples are documented (found ${blocks.length})`);
  // Guarded rather than destructured straight away: when the count is wrong the
  // interesting thing is the count, and reading it off a stack trace is worse
  // than being told.
  const [preview = {}, bind = {}, withStates = {}] = blocks;
  const pSrc = readFileSync(ROOT + 'scripts/preview.mjs', 'utf8');
  const bSrc = readFileSync(ROOT + 'scripts/bind-csharp.mjs', 'utf8');
  Object.keys(preview).forEach((k) =>
    expect(pSrc.includes('job.' + k), `preview.mjs reads job.${k}`));
  Object.keys(withStates).forEach((k) =>
    expect(pSrc.includes('job.' + k), `preview.mjs reads job.${k} (states example)`));
  // Named in prose rather than in an example, so checked by name.
  expect(/`activeStates`/.test(SKILL) && pSrc.includes('job.activeStates'),
    'activeStates is documented and preview.mjs reads job.activeStates');
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
  const [preview, bind, withStates] = jsonBlocks();
  if (!preview || !bind || !withStates) { expect(false, 'the job examples are readable at all'); }
  else {

  const p = { ...preview };
  delete p.assets;                      // the example points at a file we do not ship
  writeFileSync(T + 'job.json', JSON.stringify(p));
  let pCode = 0;
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', T + 'job.json'], { stdio: 'pipe' }); }
  catch (e) { pCode = e.status; }
  expect(pCode === 0, 'the documented preview job runs clean on a minimal UXML');

  writeFileSync(T + 'states.json', JSON.stringify(withStates));
  let sCode = 0;
  try { execFileSync('node', [ROOT + 'scripts/preview.mjs', T + 'states.json'], { stdio: 'pipe' }); }
  catch (e) { sCode = e.status; }
  expect(sCode === 0, 'the documented states job runs clean too — its selector matches and its states are Unity\'s');

  // The documented list of state names is the list the check enforces.
  await import(pathToFileURL(ROOT + 'src/core.bundle.js').href);
  const allowed = globalThis.UxmlCore.USS_STATES;
  const para = SKILL.slice(SKILL.indexOf("The\nnames are Unity's own pseudo-classes"));
  const listed = [...para.slice(0, para.indexOf('\n\n')).matchAll(/`(\w+)`/g)].map((m) => m[1]);
  expect(listed.length === allowed.length && listed.every((n) => allowed.includes(n)),
    `the state names SKILL.md lists are exactly the ones accepted: ${listed.join(', ')}`);

  const b = { ...bind };
  delete b.renames;                     // renaming something that was never there is not a case
  writeFileSync(T + 'bind.json', JSON.stringify(b));
  let bCode = 0;
  try { execFileSync('node', [ROOT + 'scripts/bind-csharp.mjs', T + 'bind.json'], { stdio: 'pipe' }); }
  catch (e) { bCode = e.status; }
  expect(bCode === 0, 'the documented bind job runs clean');
  }
}

section('the theme the document describes is the theme the scripts take');
{
  const pSrc = readFileSync(ROOT + 'scripts/preview.mjs', 'utf8');
  const [preview = {}] = jsonBlocks();
  // Both halves of one claim, so each can be broken on its own below.
  const documented = (doc, src) =>
    /"theme"/.test(doc) && src.includes('job.theme') &&
    /game\s+screen[^.]*`runtime`/.test(doc) && /editor\s+window[^.]*`editor`/.test(doc) &&
    /first\s+line\s+of\s+the\s+report[^.]*theme/.test(doc) && /nothing\s+is\s+painted\s+behind\s+the\s+panel/.test(doc);
  expect(typeof preview.theme === 'string', 'the documented preview job carries a theme');
  expect(documented(SKILL, pSrc), 'SKILL.md says when to use each theme, where the report names it, and what is behind the panel; preview.mjs reads job.theme');
  expect(!documented(SKILL.replace(/game\s+screen[^.]*`runtime`/, ''), pSrc), 'mutation (no word on game screens) → the claim check fails');
  expect(!documented(SKILL, pSrc.replace(/job\.theme/g, 'job.skin')), 'mutation (preview.mjs reads another key) → the claim check fails');
  expect(!documented(SKILL.replace(/first\s+line\s+of\s+the\s+report/g, 'last line of the report'), pSrc), 'mutation (the wrong line named) → the claim check fails');
  expect(!documented(SKILL.replace(/nothing\s+is\s+painted\s+behind\s+the\s+panel/g, 'a dark panel is painted'), pSrc), 'mutation (the backdrop described wrongly) → the claim check fails');

  writeFileSync(T + 'ThemeScreen.uxml', `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:Button name="B" text="Use" /></ui:UXML>`);
  const themed = (theme) => {
    writeFileSync(T + 'theme.json', JSON.stringify({ uxml: 'ThemeScreen.uxml', panel: { width: 200, height: 100 }, theme, out: 'theme.html' }));
    try { return { code: 0, out: execFileSync('node', [ROOT + 'scripts/preview.mjs', T + 'theme.json'], { encoding: 'utf8', stdio: 'pipe' }) }; }
    catch (e) { return { code: e.status, out: String(e.stdout || '') }; }
  };
  for (const name of ['runtime', 'editor']) {
    const r = themed(name);
    expect(r.code === 0 && r.out.split('\n')[0].startsWith('theme ' + name + '   '), `theme "${name}" runs clean and the report's first line names it: ${r.out.split('\n')[0]}`);
  }
  // An unknown name is a job that cannot be run as written (code 2, nothing written), like a state that
  // matches nothing — not a finding about the document.
  rmSync(T + 'theme.html', { force: true });
  const unknown = themed('dark');
  expect(unknown.code === 2 && !existsSync(T + 'theme.html'), 'an unknown name stops the run with code 2 and writes no preview, as SKILL.md says');
  const SAYS_REFUSED = (t) => /A\s+name\s+other\s+than\s+`runtime`\s+or\s+`editor`[^.]*code\s+2[^.]*no\s+preview/.test(t);
  expect(SAYS_REFUSED(SKILL), 'SKILL.md says that about an unknown name: code 2, no preview');
  expect(!SAYS_REFUSED(SKILL.replace(/code\s+2/g, 'code 1')) && !SAYS_REFUSED(SKILL.replace(/no\s+preview/g, 'a preview')) &&
    !SAYS_REFUSED(SKILL.replace(/other\s+than\s+`runtime`\s+or\s+`editor`/, 'the core does not know')),
    'mutations (code 1, a preview, the names dropped) → the claim check fails');
}

section('code 2 and the preview file: what the text says is what the script does');
{
  // A refusal writes no page, but a failure after the page is on disk leaves one — and says so.
  const pSrc = readFileSync(ROOT + 'scripts/preview.mjs', 'utf8');
  const says = (doc) => /fails\s+after\s+the\s+page\s+was\s+written,\s+the\s+message\s+says\s+so/.test(doc);
  const does = (src) => /pageWritten\s*=\s*true/.test(src) && /A preview was written to \$\{outPath\} before this, but the run did not finish/.test(src);
  expect(says(SKILL) && does(pSrc), 'SKILL.md says a failure after the page was written is reported, and preview.mjs reports it');
  expect(!says(SKILL.replace(/fails\s+after\s+the\s+page\s+was\s+written/, 'fails')), 'mutation (the sentence loses its condition) → the claim check fails');
  expect(!does(pSrc.replace('pageWritten = true;', '')), 'mutation (the script never records the write) → the claim check fails');
  expect(!does(pSrc.replace('before this, but the run did not finish', 'as usual')), 'mutation (the message no longer says it) → the claim check fails');
}

section('the exit codes are what the table says');
{
  expect(/\|\s*0\s*\|.*ran, clean/.test(SKILL), 'the table documents 0');
  expect(/\|\s*1\s*\|.*ran, found something/.test(SKILL), 'the table documents 1');
  expect(/\|\s*2\s*\|.*did not run/i.test(SKILL), 'the table documents 2');
  expect(/\|\s*3\s*\|.*ran, clean, but the preview may differ from Unity.*budget.*not laid out/.test(SKILL), 'the table documents 3, with both causes');
  expect(/Code 3 is never about the UXML or USS/.test(SKILL), 'and says 3 is the budget to fix, not the document');
  expect(/0–3/.test(SKILL), 'and gives the range as 0–3');

  // The rules an agent follows on a warning. Each is a sentence the model acts
  // on, so each is checked for by what it tells the model to do.
  const rules = SKILL.slice(SKILL.indexOf('### What to do with a warning'));
  expect(rules.length > 0 && /\*\*Not USS\*\*[\s\S]*fix it[\s\S]*what to write instead, use that/.test(rules), 'rule: not-uss is fixed, with the replacement when given');
  expect(/Never remove or change\s+correct USS to make a warning go away/.test(rules), 'rule: correct USS the preview does not draw is kept');
  expect(/\*\*Ignored here and in Unity\*\*: do nothing/.test(rules), 'rule: matches-unity needs nothing');
  expect(/\*\*Code 3\*\*: do not say the result matches Unity/.test(rules), 'rule: code 3 is never described as matching Unity');
  expect(/not for a report with no warnings/.test(rules), 'rule: zero warnings is not the goal');

  // The budget the text promises is the budget the script applies.
  const pSrc = readFileSync(ROOT + 'scripts/preview.mjs', 'utf8');
  const def = pSrc.match(/DEFAULT_BUDGET = \{ perFileMB: (\d+), totalMB: (\d+) \}/);
  expect(!!def && new RegExp(`budget: ${def[1]} MB per file and ${def[2]} MB\\s+in total`).test(SKILL),
    `the documented default budget is the one in preview.mjs (${def && def[1]} and ${def && def[2]} MB)`);
  expect(/1 MB is 1024 × 1024 bytes/.test(SKILL) && /const MB = 1024 \* 1024;/.test(pSrc), 'and MB means the same in both');
  expect(/"assetBudget"/.test(SKILL) && pSrc.includes('job.assetBudget'), 'assetBudget is documented and read');
  expect(/bind uses only 0, 1\s*(\/\/)?\s*and 2/.test(readFileSync(ROOT + 'scripts/bind-csharp.mjs', 'utf8')),
    'bind-csharp says it uses only 0, 1 and 2');

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
  const para = SKILL.slice(SKILL.indexOf('**Not drawn by this preview.**'));
  const sentence = para.slice(0, para.indexOf('\n\n'));
  const named = [...sentence.matchAll(/`([A-Z]\w+)`/g)].map((m) => m[1]);
  expect(named.length >= 2, 'the paragraph names some controls: ' + named.join(', '));
  named.forEach((c) =>
    expect(!supported.includes(c), `${c} is called undrawable and really is`));

  supported.forEach((c) =>
    expect(new RegExp('`' + c + '`').test(SKILL), `${c} is supported and SKILL.md mentions it`));

  // The sentence that tells the model to warn the person first must not name a control the
  // preview now draws: "mostly Toggle, Slider" was true of 0.5.1 and is false of 0.7.1.
  const said = SKILL.indexOf('Say so before you begin when a screen is mostly');
  expect(said !== -1, 'SKILL.md still has the sentence about screens made mostly of controls the preview cannot draw');
  const warnSentence = said === -1 ? '' : SKILL.slice(said, SKILL.indexOf('\n\n', said));
  const warned = [...warnSentence.matchAll(/`([A-Z]\w+)`/g)].map((m) => m[1]);
  expect(warned.length >= 2, 'it names some controls: ' + warned.join(', '));
  const noneDrawn = (names, drawn) => names.length >= 2 && names.every((c) => !drawn.includes(c));
  expect(noneDrawn(warned, supported), `none of them is drawn by the core: ${warned.join(', ')}`);
  expect(!noneDrawn(warned, supported.concat(warned[0] || 'X')), 'mutation (the core starts drawing one of them) → the check fails');
  expect(!noneDrawn(warned.concat('Toggle'), supported), 'mutation (the stale example Toggle is named) → the check fails');
  expect(!noneDrawn(warned.slice(0, 1), supported), 'mutation (only one control named) → the check fails');

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

section('the version is one version wherever it is written');
{
  // The plugin manifests carry no version on purpose (a pinned one stopped
  // updates reaching installs), so package.json is the one place it is set.
  // The lockfile and the top changelog entry must follow it.
  const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'));
  const lock = JSON.parse(readFileSync(ROOT + 'package-lock.json', 'utf8'));
  const top = readFileSync(ROOT + 'CHANGELOG.md', 'utf8').match(/^## (\d+\.\d+\.\d+)/m);
  expect(lock.version === pkg.version && lock.packages[''].version === pkg.version,
    `package-lock.json says ${lock.version} / ${lock.packages[''].version}, as package.json does (${pkg.version})`);
  expect(!!top && top[1] === pkg.version, `the newest CHANGELOG entry is ${pkg.version} (found ${top && top[1]})`);
  for (const f of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const m = JSON.parse(readFileSync(ROOT + f, 'utf8'));
    expect(m.version === undefined && (m.plugins || []).every((p) => p.version === undefined),
      `${f} still carries no version of its own`);
  }
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
  // Every .mjs under scripts/ and tests/, read off the disk rather than kept
  // as a list here. The list this replaced was written by hand and had already
  // missed tests/page-verdict.mjs when that file was added; a check that only
  // covers the files someone remembered to name protects exactly those.
  const sources = ['scripts', 'tests'].flatMap((d) =>
    readdirSync(ROOT + d).filter((f) => f.endsWith('.mjs')).sort().map((f) => d + '/' + f));
  expect(sources.includes('tests/page-verdict.mjs') && sources.includes('scripts/preview.mjs'),
    `the scan finds the files, including ones added later: ${sources.length} files`);
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

  // A module specifier is a module specifier whether it reaches `import()` or a
  // patched-in `from` clause. The first version of this check only looked at
  // `await import(...)` and missed two static specifiers built by string
  // rewriting, which is how they reached a published commit.
  sources.forEach((f) => {
    const src = readFileSync(ROOT + f, 'utf8');
    const built = [...src.matchAll(/from '"\s*\+\s*(\w+)/g)]
      .filter((m) => /ROOT|root/.test(m[1]))
      .filter((m) => !src.slice(m.index, m.index + 120).includes('pathToFileURL'));
    expect(built.length === 0,
      `${f} builds import specifiers as file URLs too, not only for import()`);
  });

  // npm is npm.cmd on Windows, and execFileSync without a shell reports ENOENT.
  const docsSrc = readFileSync(ROOT + 'tests/docs.mjs', 'utf8');
  const npmCalls = [...docsSrc.matchAll(/execFileSync\('npm'[\s\S]{0,200}?\}\)/g)].map((m) => m[0]);
  expect(npmCalls.length > 0 && npmCalls.every((c) => /shell:\s*true/.test(c)),
    'every npm invocation runs through a shell');
}

section('nothing reaches outside the repository for its inputs');
{
  // tests/conditions.mjs read a PNG from /tmp that was generated by hand and
  // never committed. Every "fresh clone" run passed because the clone was made
  // in the same container as the stray file. A checkout is only verified if it
  // is verified against nothing but itself.
  const scanned = ['src', 'scripts', 'tests', 'templates'];
  const offenders = [];
  for (const dir of scanned) {
    for (const f of readdirSync(ROOT + dir)) {
      if (!/\.(mjs|js|tmpl)$/.test(f)) continue;
      // Comments explain these hazards by quoting them, so strip comments
      // first or the explanation trips the check it belongs to.
      const src = readFileSync(ROOT + dir + '/' + f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const hits = [...src.matchAll(/['"`](\/(?:tmp|home|Users|var|opt|etc)\/[^'"`]*|[A-Za-z]:[\\/][^'"`]*)['"`]/g)]
        .map((m) => m[1])
        .filter((path) => !/^\/(tmp|home)\/(?:$|\.\.)/.test(path));
      hits.forEach((h) => offenders.push(`${dir}/${f}: ${h}`));
    }
  }
  expect(offenders.length === 0,
    'no absolute path outside the checkout' + (offenders.length ? ': ' + offenders.join(', ') : ''));
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

{
  // The bundle is a committed build artifact, and the failure it invites is a
  // stale one: someone reaches for a newer core API in check.js and forgets to
  // rebuild. Everything still loads, and the feature is simply absent at run
  // time. So the artifact has to say which core it came from, and it has to
  // actually contain what the code around it calls.
  const bundle = readFileSync(ROOT + 'src/core.bundle.js', 'utf8');
  const stamp = bundle.match(/uxml-preview (\d+\.\d+\.\d+)/);
  expect(!!stamp, 'the bundle names the core version it was built from');
  expect(/GENERATED FILE/.test(bundle) && /npm run build:core/.test(bundle),
    'and says it is generated, and how to regenerate it');

  const buildScript = readFileSync(ROOT + 'scripts/build-core-bundle.mjs', 'utf8');
  const hinted = buildScript.match(/uxml-preview@(\d+\.\d+\.\d+)/);
  expect(!!hinted && !!stamp && hinted[1] === stamp[1],
    `the install hint in the build script matches the bundle: ${hinted && hinted[1]} vs ${stamp && stamp[1]}`);

  // Named one at a time rather than through a list kept somewhere: a list would
  // be a third place to forget.
  for (const api of ['collectDependencies', 'expandTemplates', 'loadLayoutEngine', 'parse', 'render', 'serialize']) {
    expect(bundle.includes(api + ':'), `the bundle exports ${api}, which the code calls`);
  }

  // SKILL.md tells the model how big the file it must not open is. A stale
  // figure is how "166 KB minified" outlived the switch to an unminified build.
  const said = SKILL.match(/build artifact of about\s+(\d+) KB \(([\d,]+) lines\)/);
  const kb = bundle.length / 1024;
  const lines = (bundle.match(/\n/g) || []).length;          // as `wc -l` counts
  expect(!!said && Math.abs(Number(said[1]) - kb) <= kb * 0.05 &&
         Number(said[2].replace(/,/g, '')) === lines,
    `SKILL.md gives the bundle's real size: says ${said && said[1]} KB / ${said && said[2]} lines, is ${kb.toFixed(0)} KB / ${lines}`);
  expect(!/minified build artifact/.test(SKILL), 'and does not call it minified');

  expect(bundle.split('\n').length > 100,
    'and it is not minified onto a handful of lines, so a core bump is reviewable');
}

rmSync(T, { recursive: true, force: true });
console.log(failures ? `\nFAILED: ${failures}` : '\ndocumentation matches the code');
process.exit(failures ? 1 : 0);
