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
| `exitcodes` | 0 / 1 / 2 stay distinguishable, including a simulated missing `happy-dom` |
| `binding` | determinism, name retirement, renames, the untouched logic file |
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
- **That SKILL.md makes an agent behave as intended.** The document is checked
  against the code, not against a model's behaviour.
