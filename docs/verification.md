# What is verified, and by what

Every claim in this repository has a layer that would fail if the claim stopped
being true. Claims without such a layer are listed at the bottom as unverified,
because a completion condition with nothing behind it is a hope.

## Machine

`npm test` runs four suites. Each contains mutations: the guarded behaviour is
deliberately broken and the check is confirmed to fail. A test that passes either
way proves nothing.

| Suite | Guards |
| --- | --- |
| `conditions` | painting, the collapse channel and what it must not swallow (hidden, emptied), injected images, multi-sheet resolution; the theme passed to the core and the theme reported; font-fallback and rich text as layout gaps; what SKILL.md says the core draws (section N), run against the core |
| `exitcodes` | 0, 1, 2 and 3 stay distinguishable and rank 2 over 1 over 3, including a simulated missing `happy-dom`; 3 for an over-budget image and for a property the preview does not lay out; warnings sorted by the core's `reason` (a `text-shadow` screen 0, `-unity-text-auto-size` 3, `aspect-ratio` 0 because the core lays it out, a Hangul Label 3, `colour` 1); the job's theme, the report's first line and the page agreeing on the theme drawn, and the page's backdrop following it; assembled screens, a mistyped `element-name`, a missing template, a cyclic graph, slots, package paths |
| `binding` | determinism, name retirement, renames, the untouched logic file, a repeated name refused before anything is written |
| `docs` | SKILL.md still describes the code it ships with, including the controls it calls drawn or not drawn (read off the core, not kept as a list here) and the documented theme |

Notable mutations, and what would slip past without them:

- **free the render inside `run()`** — every channel still agrees while the
  screen is blank. Found in the browser first, then given a test.
- **read painting from a snapshot** — the assertion is worded correctly and
  passes over a torn-down container. Only a mutation exposed it.
- **judge `display: none` from the inline style only** — a USS class or a
  pseudo-state hides the element on screen while the report calls it collapsed.
  The class case fails; so does handing the style judgement different states
  from the render, which the cascade-agreement check catches.
- **let a states value be a string** — the core iterates it letter by letter and
  applies nothing, so a job asking for `"hover"` checks the plain screen and
  says it passed. Refused by name; the mutation shows the refusal losing its
  reason.
- **skip the match check on a states key** — a selector that names no element
  is applied to nothing, and the run looks like a check of the state it named.
- **count an over-budget image as a problem** — a screen with a large
  background can never exit 0 however correct it is. And the reverse, **let 3
  outrank 1** — a real defect hides behind "the preview may differ from Unity".
- **sort warnings by `kind` again** — `unsupported-property` is both `colour`
  (the author's typo) and `text-shadow` (this preview's limit). Failing on the
  kind fails correct screens; passing on it lets the typo through. The mutations
  file `not-uss` as "not drawn", ignore `affectsLayout`, and drop the unknown
  `reason` / `subject.kind` default, and each is caught.
- **exempt `Image` from the collapse check** — a sizeless image, once supplied,
  raises no warning in any channel.
- **always write the logic half** — hand-written C# disappears while all other
  assertions pass.
- **render the parsed tree instead of the expanded one** — the screen is right,
  every channel agrees, and the collapse and overflow checks silently skip every
  node inside an instance because it has no label. The gate would pass a screen
  it never looked at. Guarded by an instrument check of its own: a laid-out node
  absent from the index is reported as a fault in the report, not as a finding.
- **fold a nested reference against the raw parent URL** — the core hands back
  `from` exactly as written, so at two levels deep `A.uxml` inside `Parts/B.uxml`
  resolves to `A.uxml` instead of `Parts/A.uxml`, and a document already in hand
  looks unresolved. One level hides it completely, and so does a two-level
  fixture where the middle document is reached by a path that needs no folding —
  the raw URL and the folded key are the same string there, and the mutation
  passes. The fixture that proves this has to nest three deep.
- **classify `template-slot-unsupported` or `package-path-not-searched` as an
  ordinary problem** — the exit code goes to 1 on screens that are correct, and a
  signal that is always on stops carrying anything.
- **classify `duplicate-name-in-tree` as a problem** — every screen assembled
  from a template used twice fails the gate, which is the exact category of file
  this version exists to open.
- **derive fields from a repeated name** — three fields all reach the first
  element and the C# compiles; on the next run the contract, keyed by name,
  collapses them onto one field and emits it three times, which does not compile
  at all. Both were silent before.
- **let a checkout carry CRLF** — `core.autocrlf=true` is the Windows default,
  and without `* text=auto eol=lf` the clone no longer matches what was
  committed. `tests/docs.mjs` parses SKILL.md with LF patterns, matched nothing,
  and then died on `Object.keys(undefined)` — a TypeError, not a named failure.
  Reproduced on an unmodified checkout, so it was the repo's to fix. Guarded
  twice: the checkout is normalised, and the parser tolerates CRLF and reports a
  count instead of destructuring into a crash.
- **copy a directory with `fs.cpSync`** — on Windows, with a non-ASCII character
  anywhere in either path, the process dies with STATUS_ACCESS_VIOLATION and
  prints nothing at all. No exit code from the contract at all, no stack, no line.
  Found by two independent verifications on Node v22.17.0 under a Korean user
  folder; spaces in the path are fine, so the trigger is the character set. The
  harness copies with readdir + copyFile for that reason.
- **drop the retirement report** — a removed element reads as a clean run.
- **leave the theme out of the core's options** — a job asking for the editor
  theme gets the runtime screen, the report says runtime, and everything
  agrees with itself. Caught only by comparing the editor and runtime Label
  heights. Its three siblings: report what was asked instead of what was drawn
  (an unknown name is then printed as if it had been drawn), tidy an unknown name
  before the core sees it (the core's warning, the only trace that the theme was
  wrong, is lost and the run passes), and return no theme at all.
- **let `font-fallback` reach the default branch** — a correct Korean screen
  exits 1. Found by the core's own changelog, not by any screen in this
  repository; no existing fixture had Hangul in it. Its siblings: ignore
  `affectsLayout` (a Hangul Label exits 0, which is what the core says is
  wrong), file every font-fallback as a layout gap (one that moves no box then
  exits 3), and switch the hint off.
- **sample a layout gap with a property the core has since started to lay
  out** — `aspect-ratio` was the sample; from core 0.6.0 it raises nothing, so
  the tests that used it failed late and for a reason that looked like a bug in
  the gate. The sample is now `-unity-text-auto-size`, and `aspect-ratio` has a
  test of its own saying it exits 0.
- **claim in SKILL.md what the core does not do** — "a forced `disabled` is
  not dimmed", "no scrollbar", "a `RepeatButton` is bare text", "a `TextField`
  has no caret or selection". Each claim is checked in two halves: the core is
  run, and the sentence is looked for. Each half is broken on its own — the core
  half with doctored results (a dimmed forced disabled, a scroller part, a
  styled RepeatButton, a caret part, and an empty part list that would pass on
  nothing), the document half by flipping, removing or re-pointing the
  sentence. The matching ignores where a line breaks.
- **let the page's backdrop follow its own light/dark switch** — runtime text is
  dark, the core paints nothing behind the panel, and a near-black checkerboard
  makes the default theme unreadable. The stage carries the drawn theme for its
  backdrop; mutations: follow the job's value, no attribute, a rule missing.

## Human

Two things no script here can reach.

**The browser.** The preview is opened by a person at each milestone. It caught
the blank stage, the clipped scale caption, and a "Fit UI" control that silently
did nothing because upscaling was capped at 1×.

**Unity.** Confirmed on 6000.0.40f1:

1. Both C# halves compile together.
2. The generated half compiles **alone**, with the logic file deleted —
   unimplemented `partial void` members were verified absent from the DLL. This
   is why event wiring goes through a concrete wrapper rather than subscribing to
   a partial directly.
3. A button press reaches the handler in the human-owned file.
4. A `Toggle`, when the preview could not yet draw one (uxml-author 0.2), renders
   normally in Unity, which is what the "not drawn by this preview" channel exists
   to tell you. The controls the channel names today (`MinMaxSlider`, `Foldout`,
   `DropdownField`) were read off the core's output, not confirmed in Unity.

## Not verified

- **That the generated C# compiles in your project.** Checked once by hand, not
  on every run; no Unity here.
- **Colour, borders and font rendering against Unity.** Drawn, never compared.
- **The real C# type of a custom control.** Unknown types bind as
  `VisualElement`, which is a floor rather than an answer, and are reported.
- **Whether Unity uses a texture's intrinsic size for an unsized `<ui:Image>`.**
  Our renderer does not; Unity was not measured. Give images an explicit size.
- **Why `npm test` crashes on Windows.** The first suite passes every assertion
  and then exits `0xC0000005` during teardown. A probe covering the same
  operations in isolation — window left open, window closed, twenty
  render/dispose cycles, repeated redefinition of the check module — exits
  cleanly in all seven cases, so three plausible causes are ruled out and none
  is established. The scripts the skill calls are unaffected: cases 4 to 6 in
  that probe are what `preview.mjs` does, and a real screen was authored on
  Windows through the skill. Contributors should run the suites one at a time.

- **How the preview page looks.** The runtime and editor checkerboards, the
  header's theme line and dark-on-light text were not looked at by anyone in a
  browser when they were written; the grey values are a choice, not a
  measurement.
- **That setting `-unity-font-definition` ends a Hangul warning in a project.**
  Against the core, the font-fallback warning does go away and "font not loaded
  by this preview" takes its place (exit stays 3). Whether a real Unity font
  asset then lays the text out as the person expects was not tried.
- **That SKILL.md makes an agent behave as intended.** The document is checked
  against the code, not against a model's behaviour.
