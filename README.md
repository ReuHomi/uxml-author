# uxml-author

**Design Unity UI Toolkit screens in a conversation, and see the layout before Unity does.**

Describe a screen — or hand over a sketch — and get `.uxml`, `.uss`, a C# scaffold,
and a single HTML file you can open in any browser to see how it lays out. The
layout comes from Yoga, the same engine UI Toolkit uses, so the geometry is not a
guess at what Unity will do.

It is a [Claude Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview):
a folder of instructions and scripts that an agent reads and runs. There is no UI
to learn and no commands to memorise.

```
"Make me an inventory panel with an item icon, a name, an auto-use toggle,
 and a Use button."
```

<!-- screenshot: preview.html beside the same screen running in Unity -->

## Install

**In Claude Code**, two lines:

```
/plugin marketplace add ReuHomi/uxml-author
/plugin install uxml-author@uxml-author
```

`happy-dom` is installed for you, and the skill is available in your next
session.

**Anywhere else — hand the address to your agent and ask it to install.**

```
https://github.com/ReuHomi/uxml-author
```

> Install the skill at https://github.com/ReuHomi/uxml-author

Cowork, Codex, Cursor and other agents that read the SKILL.md format can clone a
repository and put it where skills live. If you would rather do it yourself:

```bash
git clone https://github.com/ReuHomi/uxml-author ~/.claude/skills/uxml-author
cd ~/.claude/skills/uxml-author && npm install
```

Start a fresh session afterwards — skill metadata is read once, at session start.

**Requirements.** Node 18 or newer. `happy-dom` is the only runtime dependency;
the renderer itself is committed as a single pre-built file, so there is nothing
to compile and no Unity install involved.

Without `happy-dom` the preview still renders in a browser — it needs no Node at
all — but the automatic checks cannot run, and the skill will tell you so rather
than pretending the output was verified.

## What it does

**Writes the files.** UXML and USS as text, from a description, a sketch, or an
existing screen you want changed.

**Checks them before you look.** Every render reports what could not be drawn,
what collapsed to nothing, what fell outside the panel, and which stylesheets
failed to load. The skill fixes what it can and tells you the rest.

**Gives you one file to judge by.** `preview.html` contains the renderer, the
layout, the source, and the report, with no external references. Open it from
disk, mail it, drop it in a ticket.

**Scaffolds the C#.** Two files: one the generator owns and rewrites on every
run, one that is yours and is never touched again — so redrawing the UI cannot
eat your code. Field names are recorded in `ui-contract.md` and do not move when
the design does.

## What it is honest about

A preview that flattered its own output would be worse than none. This one is
built to say what it did not draw.

**Trustworthy.** The geometry of `VisualElement`, `Label`, `Button`, `Image` and
`ScrollView`, at the panel size you give it.

**Not yet drawn.** `Toggle`, `Slider`, `TextField`, `DropdownField` and other
controls fall back to a plain element — which means they occupy nothing and
disappear from the preview, while Unity draws them normally. Every one of them is
reported, every time, because the screen gives you no other clue.

**Never claimed.** Colour, borders and fonts are drawn but have not been checked
against Unity. Text width comes from a browser font rather than Unity's font
asset; this is a known divergence, not a bug to be fixed here.

If a screen is mostly unsupported controls, the skill says so before it starts
rather than handing you an empty preview afterwards.

## How the layout is computed

Layout is delegated to [uxml-preview](https://github.com/ReuHomi/uxml-preview),
which runs a WebAssembly build of Yoga — the same layout engine inside UI
Toolkit — and paints to the DOM. Its accuracy against a real Unity build, with
the units the numbers are counted in, is documented at
[`docs/accuracy.md`](https://github.com/ReuHomi/uxml-preview/blob/main/docs/accuracy.md).
The USS reference tables live there too and are not copied into this repository,
because a table copied by hand goes stale and then lies.

The same renderer runs in the [VS Code extension](https://github.com/ReuHomi/vscode-uxml-preview)
if you would rather have a live preview pane while editing by hand.

## What comes out

| File | Owner | Note |
| --- | --- | --- |
| `Screen.uxml`, `Screen.uss` | you | the deliverable; drop these into your project |
| `preview.html` | generated | a viewing window, regenerated on each change |
| `ScreenController.Bindings.cs` | the generator | fields and event wiring, rewritten every run |
| `ScreenController.cs` | **you** | your logic; written once and never touched again |
| `ui-contract.md` | the generator | the names C# depends on, including retired ones |

The C# is a draft to review and change, not working code. It finds the elements
and wires `Button.clicked`; what a button should *do* is left to you, in the half
of the class regeneration cannot reach.

## Running the scripts yourself

The skill drives these for you, but they are ordinary Node scripts.

```bash
node scripts/preview.mjs job.json      # render, check, and write preview.html
node scripts/bind-csharp.mjs bind.json # C# scaffold and name contract
```

Both use the same exit codes: `0` ran and clean, `1` ran and found something,
`2` **did not run** — nothing checked this output. The third is deliberately
distinct from the second, because "checked and found a problem" and "never
checked" must not look alike to whatever reads the result.

```bash
npm test    # conditions, exit codes, C# binding, and documentation
```

The suites check their own mutations: each one deliberately breaks the behaviour
it guards and confirms the check fails. A test that passes either way proves
nothing.

## Not in scope

Driving or installing the Unity editor. Generating game logic. Widening control
support — that belongs to the renderer. Writing into your project without being
asked.

## Related

- [uxml-preview](https://github.com/ReuHomi/uxml-preview) — the renderer, as an npm library
- [vscode-uxml-preview](https://github.com/ReuHomi/vscode-uxml-preview) — a live preview pane for VS Code

## License

Apache-2.0.

---

<sub>Unity UI Toolkit · UXML · USS · UI Builder alternative · preview UXML without
Unity · UXML renderer · UXML to HTML · Unity UI generator · Yoga layout · Claude
Skill · Claude Code skill · AI agent Unity UI · generate UXML from a sketch ·
Unity UI from natural language · UI Toolkit C# binding · UIDocument scaffold</sub>
