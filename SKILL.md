---
name: uxml-author
description: >
  Design Unity UI Toolkit screens from a description or a sketch and see them
  before Unity does. Produces .uxml, .uss, a C# scaffold and a name contract,
  plus a self-contained HTML preview rendered by the same Yoga layout engine
  Unity uses. Use whenever someone wants a Unity UI, a UXML layout, a USS
  stylesheet, a HUD, an inventory screen, a menu, a settings panel, or wants an
  existing UXML/USS changed, reviewed, or ported from HTML/CSS.
---

# Authoring Unity UI Toolkit screens

You write UXML and USS as text. A local renderer lays them out with Yoga — the
same engine UI Toolkit uses — and tells you what went wrong before anyone opens
Unity. You read that report, fix what it found, and hand the person a preview
they can open in a browser.

The person should experience one conversation. Generate, check, and preview
happen inside your turn; do not narrate the steps or make them learn commands.

## What comes out

| File | Owner | Note |
| --- | --- | --- |
| `*.uxml`, `*.uss` | you | the actual deliverable; this is what goes into Unity |
| `preview.html` | generated | a viewing window, not a deliverable |
| `*.Bindings.cs` | the generator | rewritten every run |
| `*.cs` | the person | written once, never touched again |
| `ui-contract.md` | the generator | the names C# depends on |

## Before you start

Ask only what you cannot find. If the conversation already answered something,
or a file in the project does, use that and move on. Put the remaining questions
in a single message rather than a sequence.

**Panel size.** Every `%` and every stretch is measured against it, so there is
no safe default and the tooling refuses to render without one. Look in the
project's `PanelSettings` asset for `m_ReferenceResolution` first; a file beats
a recollection. Otherwise ask, offering 1920×1080 and 1080×1920.

**Where the files go.** Default to producing files the person downloads. If the
working directory holds an `Assets/` folder or existing `.uxml` files, they are
probably running you inside a project — ask whether to write there, and where.
Never write into someone's project without being told to.

## The loop

1. **Read the structure.** From a description, a sketch, or existing files.
   Decide the element tree and the names. Do not invent Unity behaviour you are
   unsure of — the reference documents below are the source.
2. **Write the UXML and USS as text.** There is no assembly API and you do not
   need one.
3. **Run the check.** Write a job file and run `scripts/preview.mjs`. Read the
   exit code and the report.
4. **Fix what it found**, and run again. Do this before showing anything.
5. **Show the person** the preview file and a short summary of anything the
   report still flags. Never hand over a preview whose problems you have not
   mentioned.
6. **Iterate** on their feedback. Regenerate the preview when the files change,
   not when they only ask a question.
7. **When the layout settles**, run `scripts/bind-csharp.mjs` for the C# and the
   contract.

```
node scripts/preview.mjs job.json
```
```json
{
  "uxml": "Inventory.uxml",
  "title": "Inventory",
  "panel": { "width": 1920, "height": 1080 },
  "assets": { "Art/potion.png": "Art/potion.png" },
  "out": "preview.html"
}
```
Stylesheets are found relative to the UXML and read automatically; `assets` is
optional and only for images the person supplied.

```
node scripts/bind-csharp.mjs bind.json
```
```json
{
  "uxml": "Inventory.uxml",
  "className": "InventoryController",
  "outDir": ".",
  "contract": "ui-contract.md",
  "renames": { "UseButton": "ConfirmButton" }
}
```
`renames` is only for a rename the person actually asked for.

Never open `src/core.bundle.js`. It is a 166 KB minified build artifact and
reading it will cost you the conversation for nothing.

## Exit codes

| Code | Meaning | What you do |
| --- | --- | --- |
| 0 | ran, clean | carry on |
| 1 | ran, found something | fix it, or tell the person plainly if you cannot |
| 2 | **did not run** | nothing checked this output; say so before showing anything |

Code 2 usually means `happy-dom` is missing (`npm install happy-dom`) or the
panel size is absent. The preview HTML still renders in a browser — it needs no
Node — but no machine has looked at it. Say that out loud. A file presented as
if it were checked, when it was not, is the failure this whole tool exists to
prevent.

## Reading the report

Four of the channels mean different things and must not be flattened together.

**Not drawn by this version.** `Toggle`, `Slider`, `TextField` and other
controls the renderer has no drawing for fall back to a plain element, which
means height 0 — they vanish from the preview, and everything below them slides
up. Unity draws them normally. Nothing on the screen marks their absence, so
this list is the only trace. Always pass it on.

**Assets not yet present.** Normal while a UI is new. Drawn as a magenta hatch,
so the person can already see it. Do not present these as problems; burying a
normal state among failures teaches people to skim the whole report, and a
report nobody reads is the same as no report.

**Supplied for this preview only.** Images the person handed over. They are not
in the project and Unity will not show them. Resolving an asset makes the
renderer fall silent, so this line comes from our own bookkeeping — a supplied
image is the one case where helping could have quietly erased a warning.

If you draw or generate a placeholder image so the preview reads better, pass it
through `assets` like any other supplied file. It lands in the channel above and
is reported as absent from the project. Never let a placeholder imply the asset
exists — a preview that looks more finished than the project is the failure this
tool is built against, and it is the one case where trying to help removes a
warning the person needed.

**Collapsed to zero size.** A failure that raises no warning at all. Usually a
`<ui:Image>` with no size in the USS, or a container whose children could not
give it a height. Always fix these.

`Measured on Unity 6000.0.40f1` is a standing condition, not an event. It fires
whenever a control uses theme defaults. Do not treat it as a problem and do not
lead with it.

## USS is not CSS

Writing UXML with CSS reflexes fails quietly — the layout is plausible and
wrong. These eight cause the most damage:

1. `flex-direction` defaults to **`column`**, not `row`.
2. There is no `z-index`. Overlap is decided by sibling order.
3. Sizing is always `border-box`.
4. Margins do not collapse.
5. There are no bare text nodes. Text is the `text` attribute of a `Label`.
6. Type selectors are C# class names.
7. There are no `@keyframes`, only transitions.
8. Default theme rules lose to author rules regardless of specificity.

The full mapping lives in the renderer's repository and is kept current there:
`docs/uss-reference.md`, `docs/uss-vs-css.md`, `docs/supported.md`,
`docs/accuracy.md`. Link to those rather than restating them; a table copied by
hand goes stale and then lies.

Always give `<ui:Image>` an explicit `width` and `height`. Without them it
occupies nothing here, and supplying the image removes the warning without
making it appear.

## What the preview is worth

It is honest about layout and quiet about the rest.

- **Trust** the geometry of `VisualElement`, `Label`, `Button`, `Image` and
  `ScrollView`, at the panel size given.
- **Do not trust** colour, borders and fonts as a match for Unity — they are
  drawn, but never verified against it.
- **Text width** comes from a browser font, not from Unity's font asset. This is
  a known divergence.
- **Do not read sizes off the screen.** The view scales to fit and prints the
  factor; the source is where dimensions come from.

Say so before you begin when a screen is mostly `Toggle`, `Slider`,
`DropdownField` and the like: the preview will be close to empty and worth
little for that screen. Warning afterwards, with a blank preview already on the
table, is worse than not offering.

## Names are a contract

The design will be redrawn several times. The names C# reaches for must not move
with it, because `Q<T>("Name")` returns null rather than failing to compile —
the break appears at runtime, far from the edit that caused it.

- Only elements with a `name` attribute are bound. Name what code needs to reach
  and leave decoration unnamed.
- Never rename an existing element on your own initiative. If the person asks
  for a rename, pass it in `renames` so the contract records it; an intended
  change and an accident should not look alike.
- Removing an element retires its row rather than deleting it, and exits 1. Tell
  the person which C# will start getting null.
- If the contract cannot be parsed the run stops at code 2 and writes nothing.
  Do not "start over" by deleting it — that erases every retired name in it.

## The C# is a draft

Two files, one class.

`*.Bindings.cs` is regenerated every run: fields, the `Q<T>` lookups, event
wiring, and a `Require<T>` helper that names any element it cannot find instead
of throwing an anonymous null. Nothing anyone writes should live here.

`*.cs` is written once and then left alone, including through redesigns. It
holds `OnBound()` and a `partial void On…Clicked()` per button, with a draft
body. **This is where behaviour goes.** If the person asks for specific logic,
write it into this file — it is theirs to keep, and regeneration cannot reach
it.

Tell them plainly that the C# is a starting shape to review and change, not
working code. The generator knows what the UXML contains; it does not know what
their game means. It does not choose an architecture, and it wires only
`Button.clicked`, because that is the only event whose intent is unambiguous
from the markup.

A button added after their file exists gets a declaration but no body, and an
unimplemented partial method compiles away in silence. The run reports it; pass
that on.

## Do not

- Drive or install the Unity editor. This produces files.
- Write into someone's project without being asked.
- Restate the USS mapping tables. Link to them.
- Quote accuracy figures without their units. If unsure, link `docs/accuracy.md`
  instead of naming a number.
