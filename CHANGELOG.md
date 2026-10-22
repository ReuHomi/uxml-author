# Changelog

## 0.3.0 —

Moves to uxml-preview 0.7.1: Unity's runtime theme by default, fifteen drawn
controls instead of five, and text the default font cannot draw no longer
fails the run.

### Behaviour changes

Read these first if anything acts on the exit code of `scripts/preview.mjs`, or
compares previews with earlier ones.

- **The default theme is `runtime`.** A screen drawn without a theme now looks
  like a game screen: 14px dark text, Label and Button with Unity's runtime
  margins and padding, a Button with its runtime look, a scrolling `ScrollView`
  reserving 24px for its scrollbar. Nothing is painted behind the panel, as in a
  game, so runtime text is dark on whatever the preview shows behind it. Every
  existing screen looks different with no change to its UXML or USS. Ask for
  `"theme": "editor"` to draw the editor theme; it is not 0.2.1's drawing, because
  the core's editor values are measured now.
- **Hangul, Han and Kana text in the default font exits 3** (0 on 0.2.1, where
  the core did not warn). Unity draws those characters with a fallback font and
  the box can differ in size. With the 0.7.1 core and 0.2.1's rule the
  new `font-fallback` reason would have exited 1 on a correct screen; it is now a
  layout gap, or "not drawn" when the core says no box moves. The report gives
  the core's words and one line on setting the font with
  `-unity-font-definition`.
- **A rich text tag in a `text` exits 3** (0 on 0.2.1, where the core did not
  warn): the preview draws the tags as characters and Unity interprets them.
- **`aspect-ratio`, `letter-spacing`, `word-spacing` and
  `-unity-paragraph-spacing` no longer exit 3**: the core lays them out. A screen
  that used one of them exited 3 on 0.2.1 and exits 0 now.
  `-unity-text-auto-size` goes the other way: the core now says it moves boxes
  in Unity (best-fit text), so a screen that used it exits 3 where 0.2.1 exited 0.
- **Fifteen controls are drawn**, up from five: `GroupBox`, `Box`, `TextField`,
  `Slider`, `SliderInt`, `Toggle`, `RadioButton`, `ProgressBar`, `TextElement`
  and `RepeatButton` join `VisualElement`, `Label`, `Button`, `Image` and
  `ScrollView`. They no longer fall back to a zero-size element or appear under
  "not drawn", so a screen can report an overflow or a collapse that they used
  to hide. `MinMaxSlider`, `Foldout`, `DropdownField` and the rest still fall
  back and are still reported. A `TextField` has no caret or selection, a
  `ScrollView` has no scrollbar, a `RepeatButton` is bare text.
- **The job takes `theme`**: `"runtime"` (the default) or `"editor"`. A name the
  core does not know is reported (exit 1) and the runtime theme is drawn. The
  first line of the report and the top of the preview name the theme that was
  drawn, not the one asked for.
- **A `disabled` forced through `states` or `activeStates` is not dimmed.** Only
  `enabled="false"` written in the UXML dims. Rules for `:disabled` in your USS
  still apply.

### Other changes

- The core bundle is rebuilt from uxml-preview 0.7.1 (303,507 bytes, 5,153
  lines; it was 246,989 bytes and 4,054 lines).
- The checkerboard behind the preview follows the theme that was drawn (light
  for runtime, dark for editor) and no longer follows the page's light/dark
  switch, which left runtime text unreadable in dark mode.
- The `version-dependent` channel is described as what it now is: values Unity
  measured differently on two versions. Using the theme's defaults no longer
  raises it.
- `SKILL.md` lists the fifteen drawn controls and what they leave out, drops
  the sentences saying `TextField`, `Slider` and `Toggle` cannot be drawn,
  explains the theme, and names the third cause of exit 3. The README's lists
  follow.

## 0.2.1 — 2026-10-13

Moves to uxml-preview 0.5.1, which says what each warning is about. The
check now sorts warnings by that instead of by their kind.

### Behaviour changes

Read these first if anything acts on the exit code of `scripts/preview.mjs`.

- **Exit 3 also means "a property was not laid out".** It used to mean only
  that an image was over the embed budget. It now means the check ran, found
  no defect, and the preview may differ from Unity: an image over the budget,
  or valid USS that changes size or position in Unity and that this preview
  does not lay out, such as `aspect-ratio`. A screen that used one of those
  and exited 0 now exits 3. Zero-size and overflow findings next to such a
  property say they come from this preview's layout.
- **Valid USS this preview does not draw no longer fails a screen.** 0.5.1
  reports properties it used to skip in silence, such as `text-shadow` and
  `transition`. They are listed as *not drawn by this preview* and leave the
  exit code alone, so a correct screen that uses them exits 0.
- **USS that does not exist still fails, and now says what to write.** A
  misspelt or CSS-only property (`colour`, `font-family`, `gap`) or a value
  that cannot work (`display: grid`) exits 1, as before. Where USS has another
  name, the report gives it.
- **More is reported than before**, because 0.5.1 is less silent: state
  pseudo-classes Unity does not have (`:selected`), `@media` and `@keyframes`
  blocks, and the like now appear, as defects (exit 1).
- **Things that are ignored in Unity too** (`:root` in a template sheet) are
  listed as *ignored here and in Unity* and need nothing.
- A warning whose `reason` or `subject` this version does not recognise —
  the core may add new ones — fails the run instead of being filed where it
  could be missed.

### Other changes

- The core bundle is rebuilt from uxml-preview 0.5.1. `<Bindings>` and
  `<ui:Columns>` are no longer laid out, which is where Unity puts them (see
  the core's changelog).
- A `states` key the renderer refuses is recognised by the warning's data
  (`subject.kind: 'states-key'`), no longer by its wording.
- The list of Unity states is the core's `USS_STATES`; the copy kept here is
  gone.
- `SKILL.md` tells the agent what to do with each kind of warning: fix what
  is not USS, keep correct USS the preview does not draw, do nothing for what
  Unity ignores too, never call a code-3 result Unity's, and do not aim for a
  report with no warnings.

## 0.2.0 — 2026-10-13

Answers the three issues in the external report of 2026-10-10: hidden elements
failed the check (Skill-1), there was no way to check a screen in a state such
as `:hover` (Skill-2), and a large image made a correct screen fail (Skill-3).

### Breaking changes

Read these first if anything acts on the exit code of `scripts/preview.mjs`.

- **New exit code 3.** The check ran and found nothing wrong with the screen,
  but an image was over the embed budget, so the preview is incomplete. It used
  to be 1. A caller that treats every non-zero code as "the document is wrong"
  needs to tell 3 apart. When several apply, 2 wins over 1, 1 over 3, and 3
  over 0. `scripts/bind-csharp.mjs` is unchanged and uses only 0, 1 and 2.
- **A `states` key that cannot be applied is a refusal (exit 2), not a
  problem (exit 1).** That covers a key the renderer cannot read as a selector:
  left alone, the renderer's own warning for it would have been counted among
  the document's warnings and given 1. The same goes for a key that matches no
  element, a name that is not a Unity state, and a value that is not an array.
  A job that asks for something the check cannot do was not checked, and now
  says so.
- **An unexpected error exits 2, not 1.** Node ends a process that dies of an
  unhandled error with 1, so a crash — including a job file holding `null` —
  used to read as "checked, and found a problem". Both `preview.mjs` and
  `bind-csharp.mjs` now catch it and exit 2, with the error and a line saying
  it is not a judgement. A job file that is not a JSON object is refused by
  name.
- **A missing asset file exits 2, not 1.** A file named in `assets` that is
  not on disk means the job points at nothing, like a missing UXML; it is no
  longer counted as a problem with the screen. The run stops before rendering
  and lists every missing file at once.
- **`renames` in a bind job must be a map of names.** A string, an array,
  `null` or a number, or an entry whose new name is not a non-empty string,
  now stops `bind-csharp.mjs` with exit 2 and says which. Before, a string was
  split into one "rename" per letter and recorded in the contract.
- **Some screens that used to fail now pass, and the other way round.**
  - Elements hidden by `display: none` no longer exit 1 (see below).
  - Images between the old caps (512 KB per file, 2 MB in total) and the new
    ones are now embedded instead of failing the run.
  - The preview page now reaches its verdict through the same code as the
    headless check (see below), so a page that said *Pass* before can now say
    *Attention*.

### Hidden elements are reported, not failed

- An element that is `display: none`, or sits inside one, is no longer
  reported as collapsed. It goes to a new **Hidden by `display: none`** list,
  with the rule that hid it — a USS class, a pseudo-state such as `:hover`, or
  an inline `style`. It does not change the exit code. It is always listed,
  because a mistyped class hides an element just as well as an intended one,
  and only a person can tell which.
- A shown element with no size of its own whose children are all hidden goes
  to a new **Emptied by hidden children** list, also outside the exit code.
- Still collapsed, still exit 1: an explicit `width: 0` or `height: 0`, a
  zero-size element with even one visible child, and anything with
  `opacity: 0` or `visibility: hidden`, which keep their size in Unity.

### Checking a screen in a state

- The job takes `states` — a USS selector mapped to an array of state names —
  and `activeStates`, an array of states every element is in. Leave both out
  and nothing changes.
- State names are Unity's pseudo-classes: `hover`, `active`, `inactive`,
  `focus`, `disabled`, `enabled`, `checked`.
- The combination applied is printed on the report's second line and at the
  top of the preview page.
- A selector must not itself contain a state (`#Use`, not `#Use:disabled`);
  the renderer picks elements before any state is applied, so such a key
  matches nothing and is refused with that explanation.

### Image budget

- The default budget is 4 MB per file and 16 MB in total, where 1 MB is
  1024 × 1024 bytes on disk. It was 512 KB and 2 MB.
- A job can change it: `"assetBudget": { "perFileMB": 8, "totalMB": 32 }`.
  A value that is not a positive number, or an unknown key, stops the run with
  exit 2.
- An image over the budget is listed apart from problems, with its path, size,
  the reason and the budget applied, and is drawn as not yet present. Source
  files are only read, never converted or replaced.
- The message for the total budget gives the numbers. It used to say the cap
  "was already reached", although a smaller image later in the list could
  still fit, and did.
- An image file that is missing stops the run (exit 2) and is listed with
  every other missing file; see the breaking changes above.

### The preview page and the report agree

- The page now reaches its verdict through the same function the headless
  check uses for its exit code. It used to keep its own shorter list, which
  missed nodes absent from the layout index, one `src` naming two documents,
  and templates that could not be read. The page catches those now, so a page
  that read *Pass* may read *Attention*.
- An incomplete preview (exit 3) gets its own verdict on the page,
  *Incomplete preview*, neither pass nor problem.
- The page's *Images left out of the embed* list is gone: a missing file now
  stops the run, and an image over the budget has its own list.

### Smaller fixes

- A refusal (exit 2) no longer ends with "the files may still be produced".
  No refusal writes the page. The message now says that no preview was
  written, or, when a `preview.html` is already at the output path, that it is
  from an earlier run and was not checked.
- When a run stops on an unexpected error, it says what is on disk: no
  preview, an earlier run's page, or a page this run wrote before failing.
  `bind-csharp.mjs` names the files it had already written instead of always
  saying "Nothing was written".
- `SKILL.md` gives the bundle's real size and no longer calls it minified.
