// node tests/page-verdict.mjs preview.html
//
// Runs the page a person opens, in happy-dom, and prints what it decided as
// JSON: the verdict line and the count in every report channel. The exit-code
// suite compares this with the headless result, because "the screen and the
// report cannot disagree" is a claim about two programs, and only running both
// shows it.
//
// One harness-side rewrite, and only one: happy-dom does not let a top-level
// `var` in one classic <script> reach the next, which every browser does. The
// input block is therefore assigned to `window` here. Nothing that judges is
// touched — the renderer and the check run exactly as inlined.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const html = readFileSync(process.argv[2], 'utf8')
  .replace('<script>var UXML_INPUT = ', '<script>window.UXML_INPUT = ');
const w = new Window({ url: 'http://localhost', settings: { enableJavaScriptEvaluation: true } });
w.document.write(html);
await w.happyDOM.waitUntilComplete();
const text = () => w.document.getElementById('verdict-text').textContent;
for (let i = 0; i < 100 && /Running/.test(text()); i++) await new Promise((r) => setTimeout(r, 50));
const channels = {};
for (const c of w.document.querySelectorAll('.chan')) {
  const title = c.querySelector('.chan-h b').textContent;
  channels[title] = {
    count: Number(c.querySelector('.n').textContent),
    items: [...c.querySelectorAll('li')].map((li) => li.textContent),
  };
}
const out = {
  verdict: text(),
  colour: w.document.getElementById('dot').style.background,
  applied: (w.document.getElementById('applied') || { textContent: '' }).textContent,
  channels,
};
await w.happyDOM.close();
process.stdout.write(JSON.stringify(out));
