// The one judgement. The headless gate imports this file; the preview HTML
// inlines the same bytes. Keeping both consumers on one copy is what removes
// the possibility of the screen and the report disagreeing.
//
// Input is data only — no filesystem, no network. Whoever calls it has already
// read the sheets and encoded the assets, because `resolveImport` is synchronous
// and a browser cannot reach a disk.
(function () {
  var ABSOLUTE = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\//;

  /**
   * Purpose: resolve a sheet reference the way the core hands it to us.
   * Requires: `from` is the URL of the sheet containing the import, or null
   *           when the reference came straight off `<Style src="…">`.
   * Ensures: a scheme or a leading slash is returned untouched — those are
   *          global, and rewriting them would make two different references
   *          collapse onto one key.
   */
  function resolveSheetUrl(url, from) {
    if (ABSOLUTE.test(url)) return url;
    if (!from) return url;
    var base = from.replace(/[^/]*$/, '');
    var parts = (base + url).split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '.' || p === '') continue;
      if (p === '..') out.pop();
      else out.push(p);
    }
    return out.join('/');
  }

  function nameOf(node) {
    for (var i = 0; i < node.attributes.length; i++) {
      if (node.attributes[i].name === 'name') return node.attributes[i].value;
    }
    return null;
  }

  // `parent` and `children` are recorded because `display` is not inherited:
  // the core leaves a hidden element's descendants with no display value of
  // their own, so whether one of them is shown can only be answered by walking
  // up the tree ourselves.
  function indexNodes(node, map, parent) {
    var kids = [];
    for (var i = 0; i < node.children.length; i++) kids.push(node.children[i].id);
    map.set(node.id, { type: node.name.local, name: nameOf(node), parent: parent, children: kids });
    for (var j = 0; j < node.children.length; j++) indexNodes(node.children[j], map, node.id);
    return map;
  }

  /**
   * Purpose: say where a `display: none` came from, in words a person can act
   *          on — the sheet and the selector, or the element's own style
   *          attribute. A class typo that hides something by accident is only
   *          findable if the report names the rule that did it.
   */
  function describeOrigin(doc, origin) {
    if (!origin) return 'unknown origin';
    if (origin.kind === 'inline') return 'inline style attribute';
    if (origin.kind === 'rule') {
      var sheet = doc.sheets && doc.sheets[origin.sheet];
      var item = sheet && sheet.items && sheet.items[origin.item];
      var where = origin.sourceDocument || (sheet && sheet.origin) || ('sheet ' + origin.sheet);
      if (item && item.rule && item.rule.selectorSpan && typeof sheet.source === 'string') {
        var sel = sheet.source.slice(item.rule.selectorSpan.start, item.rule.selectorSpan.end).trim();
        return '"' + sel + '" in ' + where;
      }
      return 'a rule in ' + where;
    }
    return origin.kind;
  }

  // USS lengths that are an explicit zero. An element sized 0 on purpose is a
  // collapse the author wrote, so it must not be explained away as "emptied".
  var EXPLICIT_ZERO = /^-?0+(\.0+)?(px|%)?$/;

  // One hook serves both kinds of dependency, because the core resolves a
  // `<ui:Template src>` through the same `resolveImport` it uses for a
  // stylesheet. We cannot be told which kind is being asked for, so we look in
  // both maps rather than guess from the extension — a miss carries the
  // resolved key, which says what it was on its own.
  //
  // The core hands back `from` exactly as it received it — the raw `src`
  // string written in the parent document, never a folded one. At one level
  // those are the same and nothing shows. At two, `A.uxml` declared inside
  // `Parts/B.uxml` arrives as resolveImport("A.uxml", "B.uxml") and folds to
  // `A.uxml` instead of `Parts/A.uxml`, so a document already in hand looks
  // unresolved. Remembering what each raw URL folded to is what makes the
  // second level behave like the first.
  //
  // A factory, so that the state probe below gets bookkeeping of its own and
  // can never leave its sheet in the lists the report reads.
  function makeResolver(sheets, templates, extra) {
    var requested = [], missing = [], ambiguous = [];
    var foldedOf = Object.create(null);
    function resolve(url, from) {
      if (extra && !from && Object.prototype.hasOwnProperty.call(extra, url)) return extra[url];
      var base = from ? (foldedOf[from] || from) : null;
      var key = resolveSheetUrl(url, base);
      if (Object.prototype.hasOwnProperty.call(foldedOf, url)) {
        // One raw string standing for two documents (the same file name under
        // two folders). Nothing here can tell them apart, so say so instead of
        // silently letting the later one win.
        if (foldedOf[url] !== key) ambiguous.push({ url: url, was: foldedOf[url], now: key });
      } else {
        foldedOf[url] = key;
      }
      requested.push(key);
      if (Object.prototype.hasOwnProperty.call(templates, key)) return templates[key];
      if (Object.prototype.hasOwnProperty.call(sheets, key)) return sheets[key];
      missing.push(key);
      return null;
    }
    return { resolve: resolve, requested: requested, missing: missing, ambiguous: ambiguous };
  }

  // A `states` key is judged by the core. Since 0.6.0 it reports a key it cannot apply as data —
  // `subject: { kind: 'states-key', key, problem?, state? }` — and measures the key itself, in the
  // context it measured: no state in scope, so a key that needs one never selects anything. This file
  // used to keep a probe stylesheet and a copy of the state list to reach the same verdicts; the two
  // were compared on every case the suites carry and the core agreed on all of them, so they are gone
  // (core CHANGELOG 0.6.0, "For consumers": "uxml-author master assumes the 0.5.1 meaning").
  //
  // What the core is silent about stays here, and is checked before it is asked:
  //   - a name in `activeStates` (the core applies "hovr" to every element without a word), checked
  //     against the core's own USS_STATES
  //   - a key with a `{` in it (the core accepts "#Use { x" and applies nothing)
  // and the shape of the job's values, which the core would answer with a TypeError.
  function stateList(value, where, errors, list, enforce) {
    if (!Array.isArray(value)) {
      // A string is iterable and the core throws on it; either way nothing would be applied.
      errors.push(where + ' must be an array of state names, got ' +
        (typeof value === 'string' ? 'the string ' + JSON.stringify(value) : JSON.stringify(value)));
      return null;
    }
    var ok = true;
    value.forEach(function (n) {
      if (typeof n !== 'string' || (enforce && list.indexOf(n) === -1)) {
        errors.push(where + ' names ' + JSON.stringify(n) + ', which is not a Unity state; use one of ' +
          list.join(', '));
        ok = false;
      }
    });
    return ok ? value.slice() : null;
  }

  var PSEUDO_IN_KEY_HINT = ' — a key is matched before any state is applied, so a state pseudo-class in the ' +
    'key itself never matches; select the element without it';

  /** The skill's words for what the core said about one key. A problem this version does not know is
   *  refused all the same, in the core's own words — `problem` is an open set. */
  function describeStatesKey(w, states) {
    var subj = w.subject, key = JSON.stringify(subj.key);
    switch (subj.problem) {
      case 'matches-nothing':
        return 'states key ' + key + ' matches no element in the document';
      case 'state-in-key':
        return 'states key ' + key + ' matches no element in the document' + PSEUDO_IN_KEY_HINT;
      case 'unknown-state':
        return 'states[' + key + '] names ' + JSON.stringify(subj.state) + ', which is not a Unity state';
      case undefined:
        return 'states key ' + key + ' is not a usable USS selector';
      default:
        return 'states key ' + key + ' was refused by the core (' + subj.problem + '): ' + w.message;
    }
  }

  /**
   * Purpose: decide whether the states a caller asked for can be applied, and
   *          turn them into what the core takes.
   * Ensures: `errors` is empty, or the render must not happen — the screen it
   *          would judge is not the one asked about. Every refusal names the
   *          key or value and why.
   */
  function checkStates(core, input) {
    var errors = [];
    var allowed = Array.prototype.slice.call(core.USS_STATES);
    var rawStates = input.states === undefined ? {} : input.states;
    var rawActive = input.activeStates === undefined ? [] : input.activeStates;
    var states = {};
    if (rawStates === null || typeof rawStates !== 'object' || Array.isArray(rawStates)) {
      errors.push('states must be an object mapping a USS selector to an array of state names, got ' +
        JSON.stringify(rawStates));
    } else {
      Object.keys(rawStates).forEach(function (key) {
        if (!key.trim() || /[{};]/.test(key)) {
          errors.push('states key ' + JSON.stringify(key) + ' is not a selector');
          return;
        }
        // No list here: which names are states is the core's to say, once it is asked below.
        var list = stateList(rawStates[key], 'states[' + JSON.stringify(key) + ']', errors, allowed, false);
        if (list) states[key] = list;
      });
    }
    var active = stateList(rawActive, 'activeStates', errors, allowed, true) || [];
    var activeSet = new Set(active);

    if (!errors.length && Object.keys(states).length) {
      var res = makeResolver(input.sheets || {}, input.templates || {}, null);
      var doc = core.expandTemplates(core.parse(String(input.uxml), undefined, { resolveImport: res.resolve })).document;
      core.resolveStyles(doc, { activeStates: activeSet, states: states }).warnings.forEach(function (w) {
        var subj = w.subject;
        if (!subj || subj.kind !== 'states-key' || !Object.prototype.hasOwnProperty.call(states, subj.key)) return;
        errors.push(describeStatesKey(w, states));
      });
    }

    return {
      errors: errors,
      states: states,
      activeStates: activeSet,
      applied: { states: states, activeStates: active },
    };
  }

  /**
   * Purpose: decide whether the theme a caller asked for is one the core draws.
   * Ensures: `errors` is empty when `theme` is undefined (the core's default) or the core drew
   *          exactly what was asked. The core draws its default for a name it does not know and
   *          warns, with a warning that has no `subject` and so cannot be told from the others by
   *          its fields; what can be told is the result — `RenderResult.theme` is not the theme
   *          asked. No list of names is kept here. A screen drawn in a theme nobody asked for is
   *          not the screen asked about, so the caller refuses to run.
   * Effects: draws an empty document into `container` and frees it again.
   */
  function checkTheme(core, theme, container) {
    var errors = [];
    if (theme === undefined) return { errors: errors };
    var r = core.render(core.parse('<ui:UXML xmlns:ui="UnityEngine.UIElements" />'), container,
      { size: { width: 1, height: 1 }, theme: theme });
    var differs = r.theme !== theme, drawn = r.theme;
    r.dispose();
    if (differs) {
      errors.push('theme ' + JSON.stringify(theme) + ' is not a theme the core draws; it would draw ' +
        JSON.stringify(drawn) + ' instead — use "runtime" or "editor"');
    }
    return { errors: errors };
  }

  /** One wording for both consumers, so the report and the page name the same thing. */
  function describeStates(applied) {
    var keys = Object.keys(applied.states);
    if (!keys.length && !applied.activeStates.length) return 'states: none applied (the default)';
    var parts = keys.map(function (k) { return k + ' :' + applied.states[k].join(':'); });
    if (applied.activeStates.length) parts.push('every element :' + applied.activeStates.join(':'));
    return 'states: ' + parts.join('   ');
  }

  /**
   * Purpose: one render, turned into the channels a human and a model read.
   *
   * Deps/Effects: paints into `container`, allocates Yoga nodes.
   *   OWNERSHIP: the caller frees, via the returned `dispose`. It is not called
   *   here — dispose also tears the painted DOM out of the container, and the
   *   two consumers have different lifetimes: the gate frees at once, the
   *   preview must keep the pixels until the page goes away.
   *
   * Ensures:
   *   - `collapsed` never repeats a node already in `unsupported`. A fallback
   *     control is height 0 by construction; counting it twice inflates the
   *     problem count without adding a fact.
   *   - `hidden` and `emptied` never repeat a node in `collapsed`, and neither
   *     is a defect: they are listed so a person can confirm the state was
   *     meant. `collapsed` keeps everything else of zero size.
   *   - `injected` comes from our own bookkeeping, never from warnings.
   *     Resolving an asset makes the core go quiet, so the one party who knows
   *     an image was supplied for the preview only is us.
   */
  function run(core, container, input) {
    var sheets = input.sheets || {};
    var assets = input.assets || {};
    var panel = input.panel;
    if (!panel || !panel.width || !panel.height) {
      throw new Error('panel size is required — % and stretch are all measured against it');
    }

    var resolver = makeResolver(input.sheets || {}, input.templates || {}, null);
    var resolveDep = resolver.resolve;
    var depsRequested = resolver.requested, depsMissing = resolver.missing, ambiguous = resolver.ambiguous;

    // Refused before anything is drawn: a state the caller asked for that
    // cannot be applied means the screen judged would not be the one asked
    // about. The gate turns this into "did not run", never into a finding.
    var st = checkStates(core, input);
    if (st.errors.length) throw new Error('states refused — ' + st.errors.join('; '));

    // The same for the theme: drawn in one nobody asked for, the screen is not the one asked about.
    var th = checkTheme(core, input.theme, container.ownerDocument.createElement('div'));
    if (th.errors.length) throw new Error('theme refused — ' + th.errors.join('; '));

    var parsed = core.parse(input.uxml, undefined, { resolveImport: resolveDep });

    // Expansion is a separate call and produces a DERIVED tree. Everything below
    // must read that tree, not the parsed one: indexing the parsed tree would
    // leave every node inside an instance unlabelled, and the collapse and
    // overflow checks skip unlabelled nodes — the gate would pass a screen it
    // never looked at. `parsed` stays untouched for anything that serializes.
    var expansion = core.expandTemplates(parsed);
    var doc = expansion.document;

    var labels = indexNodes(doc.root, new Map(), null);

    // One options object for both cascades. The render resolves styles inside
    // itself and does not hand them back, so the display judgement asks
    // `resolveStyles` separately — and the two only describe the same screen
    // if they are given the same states. Sharing the object is what keeps
    // them from drifting; `cascadeMismatch` below is what catches it if they do.
    var cascadeOpts = { activeStates: st.activeStates, states: st.states };

    var injected = [];
    var r = core.render(doc, container, {
      size: panel,
      measureText: core.createDefaultMeasureText(
        typeof document === 'undefined' ? undefined : document
      ),
      resolveAsset: function (path) {
        if (Object.prototype.hasOwnProperty.call(assets, path)) {
          injected.push(path);
          return assets[path];
        }
        return null;
      },
      activeStates: cascadeOpts.activeStates,
      states: cascadeOpts.states,
      // Passed through untouched, `undefined` included: the core has a default and
      // judges any value it does not know (a warning, then the default is drawn).
      // Tidying the value here would hide that warning from the report.
      theme: input.theme,
    });
    var resolved = core.resolveStyles(doc, cascadeOpts);

    // `version-dependent` marks a value Unity measured differently on two versions
    // (since uxml-preview 0.7.0: an editor-theme Button with no text, spacing without a
    // generator, a title of only spaces) — the preview draws one of them. The author
    // cannot act on it, so counting it as a problem would fail a correct screen. It gets
    // its own channel and never reaches the exit code.
    //
    // Two of the template diagnostics belong in channels that already exist,
    // and putting them in `other` would have been wrong in opposite directions:
    //
    //   template-slot-unsupported — content that is invisible here and present
    //     in Unity. That is exactly what `unsupported` means; it is a trace, not
    //     a defect in the document.
    //   package-path-not-searched — a standing constraint of this renderer, true
    //     on every run that touches such a path. `versionDependent` exists for
    //     conditions that are always on, because a signal that never varies
    //     carries nothing and would make the exit code permanently 1.
    //
    // Everything else template-related IS a defect the author can act on, so it
    // stays in `other` and reaches the exit code.
    //   duplicate-name-in-tree — the UNAVOIDABLE consequence of instantiating one
    //     template more than once, and correct UXML. Failing on it would fail
    //     every assembled screen, which is precisely the kind of file this
    //     version exists to open. It is not a defect in the screen; it is a
    //     constraint on the C# that can be written against it, so it gets its own
    //     channel. `bind-csharp` refuses separately, where the question is asked.
    //
    var channels = {
      unsupported: [], layoutGaps: [], missingAssets: [], versionDependent: [],
      repeatedNames: [], matchesUnity: [], other: [],
    };
    var allWarnings = r.warnings.concat(expansion.warnings || []);
    allWarnings.forEach(function (w) { channels[classify(w)].push(w); });
    var unsupported = channels.unsupported, missingAssets = channels.missingAssets,
        versionDependent = channels.versionDependent, repeatedNames = channels.repeatedNames,
        other = channels.other;

    // A control or slot the preview does not draw is height 0 by construction,
    // so its node is not also counted as collapsed. A property it does not
    // draw says nothing about the element's size, so it excludes nothing.
    var excluded = new Set();
    unsupported.forEach(function (w) {
      if (w.node != null && (!w.subject || w.subject.kind === 'control')) excluded.add(w.node);
    });

    // Two different things used to share one `return` here, and only one of them
    // is legitimate. A node with no `name` is genuinely not a contract surface.
    // A node absent from `labels` altogether means the tree we indexed is not
    // the tree that was laid out — the index would then be silently skipping
    // whole regions while still reporting a pass. That is an instrument fault,
    // not a finding, so it gets its own channel and is never merged with the
    // unnamed case.
    //
    // Zero size has three different causes, and only one is a defect:
    //   hidden  — the element or an ancestor is `display: none` in the final
    //             applied style (USS class, pseudo-state or inline alike). A
    //             deliberate state, so it never reaches the exit code — but it
    //             is always listed, because a class typo hides things too.
    //   emptied — sized only by its children, and every laid-out child is
    //             hidden or itself emptied. Same standing as hidden.
    //   collapsed — everything else, including an explicit width/height of 0.
    // opacity and visibility do not take an element out of layout, so they
    // are not part of this rule; such an element still has its size.
    function displayNone(id) {
      var m = resolved.styles.get(id);
      var d = m && m.get('display');
      return d && d.value === 'none' ? d.origin : null;
    }
    var hiddenBy = new Map();           // id -> id of the element whose display is none
    r.boxes.forEach(function (box, id) {
      var info = labels.get(id);
      if (!info) return;
      if (displayNone(id)) { hiddenBy.set(id, id); return; }
      for (var p = info.parent; p != null; p = labels.get(p) ? labels.get(p).parent : null) {
        if (displayNone(p)) { hiddenBy.set(id, p); return; }
      }
    });
    function explicitZero(id) {
      var m = resolved.styles.get(id);
      return ['width', 'height'].some(function (k) {
        var v = m && m.get(k);
        return !!v && EXPLICIT_ZERO.test(String(v.value).trim());
      });
    }
    var emptiedMemo = new Map();
    function isEmptied(id) {
      if (emptiedMemo.has(id)) return emptiedMemo.get(id);
      var info = labels.get(id), box = r.boxes.get(id), out = false;
      if (info && box && (box.width === 0 || box.height === 0) && !hiddenBy.has(id) && !explicitZero(id)) {
        var kids = info.children.filter(function (k) { return r.boxes.has(k); });
        out = kids.length > 0 && kids.every(function (k) { return hiddenBy.has(k) || isEmptied(k); });
      }
      emptiedMemo.set(id, out);
      return out;
    }

    var collapsed = [], overflow = [], unindexed = [], hidden = [], emptied = [];
    r.boxes.forEach(function (box, id) {
      var info = labels.get(id);
      if (!info) { unindexed.push(id); return; }
      if (!info.name) return;                // unnamed nodes are not a contract surface
      if (excluded.has(id)) return;
      if (hiddenBy.has(id)) {
        var by = hiddenBy.get(id), byInfo = labels.get(by) || {};
        hidden.push({ id: id, type: info.type, name: info.name, box: box,
                      by: { id: by, type: byInfo.type, name: byInfo.name, self: by === id },
                      origin: describeOrigin(doc, displayNone(by)) });
        return;                              // not laid out, so overflow cannot apply either
      }
      if (box.width === 0 || box.height === 0) {
        if (isEmptied(id)) emptied.push({ id: id, type: info.type, name: info.name, box: box });
        else collapsed.push({ id: id, type: info.type, name: info.name, box: box });
      }
      if (box.left + box.width > panel.width || box.top + box.height > panel.height) {
        overflow.push({ id: id, type: info.type, name: info.name, box: box });
      }
    });

    // The two cascades must agree. The painted element carries `display: none`
    // exactly when the render's own cascade said so; if `resolveStyles` was
    // given different states, the two disagree here and the hidden channel
    // would be describing a screen nobody drew. That is an instrument fault.
    var cascadeMismatch = [];
    r.elements.forEach(function (el, id) {
      var painted = el.style && el.style.display === 'none';
      if (painted !== !!displayNone(id)) {
        var info = labels.get(id) || {};
        cascadeMismatch.push({ id: id, type: info.type, name: info.name });
      }
    });

    // Painting is a fact apart from layout. Warnings, boxes and liveNodeCount
    // can all be right while the container is empty.
    // `texts` is keyed by name, so a repeated name loses every copy but the
    // last. Silent before: the report would show one text and say nothing about
    // the others. Repeated names are normal once a template is instantiated
    // more than once, so this has to be visible rather than assumed away.
    var texts = {}, textCollisions = [];
    r.elements.forEach(function (el, id) {
      var info = labels.get(id);
      if (!info || !info.name) return;
      if (Object.prototype.hasOwnProperty.call(texts, info.name)) {
        textCollisions.push(info.name);
        return;                              // first one wins, like Q<T>() does
      }
      texts[info.name] = el.textContent;
    });

    var boxes = [];
    r.boxes.forEach(function (box, id) {
      var info = labels.get(id) || {};
      boxes.push({ id: id, type: info.type, name: info.name, box: box });
    });

    return {
      dispose: r.dispose,
      painted: {
        childCount: container.childNodes.length,
        elementCount: r.elements.size,
        boxCount: r.boxes.size,
        texts: texts,
        textCollisions: textCollisions,
      },
      parseWarnings: parsed.warnings || [],
      unsupported: unsupported,
      layoutGaps: channels.layoutGaps,
      matchesUnity: channels.matchesUnity,
      missingAssets: missingAssets,
      versionDependent: versionDependent,
      repeatedNames: repeatedNames,
      other: other,
      collapsed: collapsed,
      hidden: hidden,
      emptied: emptied,
      cascadeMismatch: cascadeMismatch,
      overflow: overflow,
      unindexed: unindexed,
      injected: injected,
      // Kept under the old names: every consumer reads them, and a stylesheet
      // is still what most of them are. `deps*` is the honest superset.
      sheetsRequested: depsRequested,
      sheetsMissing: depsMissing,
      depsRequested: depsRequested,
      depsMissing: depsMissing,
      ambiguousDeps: ambiguous,
      applied: st.applied,
      // What the core drew, not what was asked for: an unknown name is drawn as the default.
      theme: r.theme,
      rootId: doc.root.id,
      boxes: boxes,
      panel: panel,
    };
  }

  // Every `subject.kind` uxml-preview 0.7.1 documents (api.md, "subject"). Both `reason` and
  // `subject.kind` are open sets — the core may add values in a minor release —
  // so anything outside these lists is not guessed at: it goes to `other`,
  // where it is printed and fails the run, rather than vanishing into a channel
  // that never reaches the exit code.
  var KNOWN_SUBJECTS = ['property', 'selector', 'states-key', 'asset', 'import', 'control', 'name', 'at-rule'];

  /**
   * Purpose: which channel a warning belongs to, decided by what the core says
   *          the warning is about (`reason`) rather than by what kind of
   *          warning it is. One `kind` covers both the author's mistakes and
   *          this preview's limits — `unsupported-property` is `colour` and
   *          also `text-shadow` — and only `reason` tells them apart.
   * Ensures: one of the channel names `run` keeps:
   *   not-uss, invalid-value  -> other          the author's; exit 1
   *   not-rendered            -> unsupported    valid, not drawn here; no exit
   *                           -> layoutGaps     ...and it moves boxes in Unity; exit 3
   *   font-fallback           -> layoutGaps     drawn, but Unity uses a fallback font and
   *                                             the box can differ; exit 3
   *                           -> unsupported    ...when the core says it moves no box
   *   matches-unity           -> matchesUnity   nothing to do; no exit
   *                              (a repeated name keeps its own channel)
   *   version-dependent       -> versionDependent
   *   no reason               -> by kind, as before 0.5.1: the core omits a
   *                              reason when none applies, e.g. an asset or a
   *                              file the host did not supply
   *   anything else           -> other
   */
  function classify(w) {
    var subj = w.subject;
    if (subj && KNOWN_SUBJECTS.indexOf(subj.kind) === -1) return 'other';
    switch (w.reason) {
      case 'not-uss':
      case 'invalid-value':
        return 'other';
      case 'not-rendered':
        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';
      case 'font-fallback':
        return subj && subj.affectsLayout === true ? 'layoutGaps' : 'unsupported';
      case 'matches-unity':
        return subj && subj.kind === 'name' ? 'repeatedNames' : 'matchesUnity';
      case 'version-dependent':
        return 'versionDependent';
      case undefined:
        if (w.kind === 'asset-unresolved') return 'missingAssets';
        if (w.kind === 'version-dependent') return 'versionDependent';
        return 'other';
      default:
        return 'other';
    }
  }

  /** How a warning in `other` reads in a report: the core's words, plus what to write instead. */
  function describeDefect(w) {
    var s = w.kind + ': ' + w.message;
    var subj = w.subject;
    if (subj && subj.kind === 'property' && subj.replacements && subj.replacements.length) {
      s += ' — write ' + subj.replacements.join(', ') + ' instead';
    }
    return s;
  }

  // The core says the default font lacks the glyphs; the way out is the author's, and the
  // core's text does not know this preview's limit, so the skill adds one line. The core's
  // own words always come first. Setting the font moves the warning rather than ending the
  // exit 3: a Unity font asset cannot be loaded here, and the core says so in its place.
  function fontHint(w) {
    return w.reason === 'font-fallback'
      ? ' \u2014 Setting the Unity font with -unity-font-definition removes this warning; this preview cannot load font assets, so it reports that instead.'
      : '';
  }

  /** How a layout gap reads: the property, and the Unity version that has it. */
  function describeGap(w) {
    var subj = w.subject || {};
    return (subj.property || w.kind) + (subj.since ? ' (Unity ' + subj.since + '+)' : '') + ': ' + w.message + fontHint(w);
  }

  /** How an entry in "not drawn by this preview" reads: the core's words, and the hint if there is one. */
  function describeNotDrawn(w) {
    return w.message + fontHint(w);
  }

  /** The theme that was drawn, in one wording for the report and the page. */
  function describeTheme(res) {
    return 'theme ' + res.theme;
  }

  /**
   * Purpose: the verdict, in one place. The gate turns `code` into its exit
   *          code and the page turns it into its verdict line, so the two
   *          cannot reach different conclusions from the same run.
   * Requires: `meta` carries what only the host could see — sheets and
   *           templates it could not read, and assets it would not embed
   *           because of the budget. A missing asset file never gets here: the
   *           host refuses the job instead.
   * Ensures: code 1 when `problems` is non-empty — a defect in the document
   *          or in what was given to judge it; otherwise 3 when the preview
   *          may differ from Unity — the budget kept an image out, or a
   *          property that moves boxes in Unity was not laid out — which says
   *          nothing against the document; otherwise 0. A defect outranks an
   *          incomplete preview. Code 2 is never produced here: whoever calls
   *          this already ran the check.
   */
  function judge(res, meta) {
    meta = meta || {};
    var problems = [];
    var push = function (t) { problems.push(t); };
    if (res.painted.childCount === 0) push('nothing was painted');
    if (res.painted.elementCount !== res.painted.boxCount) {
      push((res.painted.boxCount - res.painted.elementCount) + ' laid-out node(s) were never painted');
    }
    if (res.unindexed.length) {
      push(res.unindexed.length + ' laid-out node(s) are absent from the indexed tree — the checks below skipped them, so this report is incomplete in a way it cannot describe');
    }
    res.ambiguousDeps.forEach(function (a) {
      push('"' + a.url + '" names two different documents (' + a.was + ' and ' + a.now + '); one of them was not loaded');
    });
    if (res.cascadeMismatch.length) {
      push(res.cascadeMismatch.length + ' element(s) were painted with a different display than the style judgement saw — the hidden list describes a screen nobody drew');
    }
    var templateMisses = meta.templateMisses || [], sheetMisses = meta.sheetMisses || [];
    if (templateMisses.length) push(templateMisses.length + ' template document(s) could not be read — the instances they fill are missing from the screen entirely, not merely unstyled');
    if (sheetMisses.length) push(sheetMisses.length + ' stylesheet(s) could not be read — the coordinates below are wrong, not merely incomplete');
    // When the preview leaves out something that moves boxes in Unity, its
    // coordinates are its own. The findings still stand as findings — they are
    // what this layout shows — but say whose layout they come from.
    var basis = (res.layoutGaps || []).length ? ' (by this preview\'s layout, which leaves out a property that moves boxes in Unity)' : '';
    res.collapsed.forEach(function (c) { push('<' + c.type + '> #' + c.name + ' has no size and is invisible' + basis); });
    res.overflow.forEach(function (c) { push('<' + c.type + '> #' + c.name + ' runs outside the panel' + basis); });
    res.other.forEach(function (x) { push(describeDefect(x)); });
    var overBudget = meta.overBudget || [];
    var layoutGaps = res.layoutGaps || [];
    return {
      problems: problems, overBudget: overBudget, layoutGaps: layoutGaps,
      code: problems.length ? 1 : (overBudget.length || layoutGaps.length) ? 3 : 0,
    };
  }

  globalThis.UxmlCheck = {
    run: run, judge: judge, classify: classify, describeDefect: describeDefect, describeGap: describeGap,
    describeNotDrawn: describeNotDrawn, describeTheme: describeTheme,
    resolveSheetUrl: resolveSheetUrl,
    checkStates: checkStates, checkTheme: checkTheme, describeStates: describeStates,
  };
})();
