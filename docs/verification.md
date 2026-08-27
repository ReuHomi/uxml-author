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
| `conditions` | painting, the collapse channel, injected images, multi-sheet resolution |
| `exitcodes` | 0 / 1 / 2 stay distinguishable, including a simulated missing `happy-dom`; assembled screens, a mistyped `element-name`, a missing template, a cyclic graph, slots, package paths |
| `binding` | determinism, name retirement, renames, the untouched logic file, a repeated name refused before anything is written |
| `docs` | SKILL.md still describes the code it ships with |

Notable mutations, and what would slip past without them:

- **free the render inside `run()`** — every channel still agrees while the
  screen is blank. Found in the browser first, then given a test.
- **read painting from a snapshot** — the assertion is worded correctly and
  passes over a torn-down container. Only a mutation exposed it.
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
  resolves to `A.uxml`, and a document already in hand is reported unresolved.
  One level hides it completely; the cyclic case is what exposed it.
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
- **copy a directory with `fs.cpSync`** — on Windows, with a non-ASCII character
  anywhere in either path, the process dies with STATUS_ACCESS_VIOLATION and
  prints nothing at all. No exit code in the 0/1/2 contract, no stack, no line.
  Found by two independent verifications on Node v22.17.0 under a Korean user
  folder; spaces in the path are fine, so the trigger is the character set. The
  harness copies with readdir + copyFile for that reason.
- **fold a nested reference against the raw parent URL** — see below; the fixture
  that proves it has to nest three deep, because at two the raw URL and the
  folded key are still the same string.
- **drop the retirement report** — a removed element reads as a clean run.

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
4. A `Toggle` that the preview cannot draw renders normally in Unity, which is
   what the "not drawn by this version" channel exists to tell you.

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

- **That SKILL.md makes an agent behave as intended.** The document is checked
  against the code, not against a model's behaviour.
