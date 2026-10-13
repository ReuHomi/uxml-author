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

The scripts below live in this skill's own directory, not the project you're
working in — resolve them from there, not from the current working directory.
Installed as a plugin, `${CLAUDE_PLUGIN_ROOT}` is that directory.

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

Images are embedded into the preview within a budget: 4 MB per file and 16 MB
in total by default, where 1 MB is 1024 × 1024 bytes on disk. A file over it is
left out of the preview, listed as over budget, and drawn as not yet present;
the source file is never converted or changed. To include a large background,
set `"assetBudget": { "perFileMB": 8, "totalMB": 32 }` in the job — either key
on its own is fine. A value that is not a positive number stops the run with
code 2.

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

**Checking a screen in a particular state.** Rules under `:hover`, `:active`,
`:focus`, `:checked`, `:disabled` and the like never apply in a plain run. To
judge the screen as it looks in one of those states, name it in the job:

```json
{
  "uxml": "Inventory.uxml",
  "panel": { "width": 1920, "height": 1080 },
  "states": { "#UseButton": ["hover", "active"] },
  "out": "preview-pressed.html"
}
```

`states` maps a USS selector to the states the elements it matches are in.
`activeStates` is a plain list of states every element is in at once, such as
`["disabled"]`. Both are optional; leave them out and nothing changes. The
names are Unity's own pseudo-classes — `hover`, `active`, `inactive`, `focus`,
`disabled`, `enabled`, `checked` — and the list is always an array, even for
one state. The report's second line and the top of the preview name the
combination that was applied, so say it when you show the result.

The run refuses (code 2) rather than guess when the request cannot be honoured:
a value that is not an array, a name that is not a Unity state, a selector the
renderer cannot use, or a selector that matches no element. Each of those would
otherwise produce a screen that looks checked and is not the one asked about.
Fix the job and run again.

Never open `src/core.bundle.js`. It is a generated build artifact of about
223 KB (3,703 lines) — not minified, but every identifier is mangled — and
reading it will cost you the conversation for nothing.

## Exit codes

| Code | Meaning | What you do |
| --- | --- | --- |
| 0 | ran, clean | carry on |
| 1 | ran, found something | fix it, or tell the person plainly if you cannot |
| 2 | **did not run** | nothing checked this output; say so before showing anything |
| 3 | ran, clean, but the preview is incomplete | an image was over the embed budget; adjust `assetBudget`, not the document |

The codes run 0–3. When several apply, 2 wins over 1, 1 over 3, and 3 over 0:
a defect alongside an over-budget image is a 1, because the defect is what
needs a fix.

Code 3 is never about the UXML or USS. Do not edit the screen to make it go
away — raise the budget, or tell the person the preview draws those images as
not yet present. The report lists each one with its size and the budget it
was measured against.

Code 2 usually means `happy-dom` is missing (`npm install happy-dom`) or the
panel size is absent. It also means the job asked for something that cannot be
applied — a state or a budget it got wrong — and the message names which. The preview HTML still renders in a browser — it needs no
Node — but no machine has looked at it. Say that out loud. A file presented as
if it were checked, when it was not, is the failure this whole tool exists to
prevent.

## Reading the report

The channels mean different things and must not be flattened together.

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

**Names that address more than one element.** Not a fault in the screen. Once a
template is instantiated twice, every `name` inside it exists twice, and that is
correct UXML — Unity does the same. It matters only on the C# side, where
`Q<T>(name)` returns the first match, so `bind-csharp` refuses those names rather
than deriving fields that would all point at one element. Report it as a
constraint on the code, never as a broken screen.

**Collapsed to zero size.** A failure that raises no warning at all. Usually a
`<ui:Image>` with no size in the USS, or a container whose children could not
give it a height. Fix these — but only these. Zero size has two other causes
that are not defects, and they are reported apart so they are never "fixed"
by accident:

**Hidden by `display: none`.** The element, or one of its ancestors, is
`display: none` in the final applied style — a USS class, a pseudo-state such
as `:hover`, or an inline `style` all count. A deliberate state, so it never
changes the exit code. It is still always listed, with the rule that did it,
because a mistyped class hides an element just as well as an intended one. Read
the list and confirm each entry is meant; pass on any you cannot vouch for.
`opacity: 0` and `visibility: hidden` are not part of this: such an element
keeps its size and is judged like any other.

**Emptied by hidden children.** An element that is shown, has no size of its
own, and whose children are all hidden (or emptied in turn) — a tab container
with every page switched off, say. Not a defect and not in the exit code. If it
is not the state the person meant, the rules hiding its children are where to
look. An element with an explicit `width: 0` or `height: 0`, or with even one
visible child, stays in *Collapsed*.

`Measured on Unity 6000.0.40f1` is a standing condition, not an event. It fires
whenever a control uses theme defaults. Do not treat it as a problem and do not
lead with it.

## Screens assembled from more than one file

Real projects rarely keep a screen in one file. A reusable piece lives in its own
`.uxml` and the screen pulls it in:

```xml
<ui:Template name="Slot" src="Parts/ItemSlot.uxml" />
<ui:Instance template="Slot" name="slot-a">
  <ui:AttributeOverrides element-name="slot-label" text="Sword" />
</ui:Instance>
```

The preview follows those references, reads every document behind the screen, and
draws the result. Nothing extra is needed in the job file; give it the entry UXML
and the rest is found. Supply `templates` only to override where a specific one
comes from, the same way `sheets` works.

Four things are worth knowing before you write one.

**A mistyped `element-name` is the one thing here Unity does not catch.** Unity
applies an override that matches nothing in complete silence — the value simply
stays as it was, and the person hunts for a styling problem that is not there.
This is the single place where the preview tells them something the editor never
will. When the report names one, lead with it.

**An instance is a `TemplateContainer` in the hierarchy,** and that is what the
generated C# binds it as. Its `name` is yours to bind; the names *inside* the
template belong to that template's own file and its own controller. The contract
deliberately does not reach across that boundary.

**A missing template is not a missing stylesheet.** An unresolved `<Style src>`
leaves the screen unstyled; an unresolved template leaves whole regions absent.
The report says which, and both exit 1.

**Slots are not drawn.** `slot-name` / `slot` are alive in Unity 6000.0.40f1 —
measured, not assumed — but this version does not place slot children. They are
reported instead of being dropped somewhere arbitrary, and they appear in *Not
drawn by this version*, alongside the fallback controls.

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
- One name, one element. If a name appears twice the generator writes nothing
  and exits 1: `Q<T>()` returns the first match, so fields derived from a
  repeated name would all reach the same element while still compiling. Repeats
  are normal *inside* an instantiated template, which is why the contract reads
  the document unexpanded.
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
