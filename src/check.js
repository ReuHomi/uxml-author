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

  function indexNodes(node, map) {
    map.set(node.id, { type: node.name.local, name: nameOf(node) });
    for (var i = 0; i < node.children.length; i++) indexNodes(node.children[i], map);
    return map;
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

    // One hook serves both kinds of dependency, because the core resolves a
    // `<ui:Template src>` through the same `resolveImport` it uses for a
    // stylesheet. We cannot be told which kind is being asked for, so we look in
    // both maps rather than guess from the extension — a miss carries the
    // resolved key, which says what it was on its own.
    var templates = input.templates || {};
    var depsRequested = [];
    var depsMissing = [];

    // The core hands back `from` exactly as it received it — the raw `src`
    // string written in the parent document, never a folded one. At one level
    // those are the same and nothing shows. At two, `A.uxml` declared inside
    // `Parts/B.uxml` arrives as resolveImport("A.uxml", "B.uxml") and folds to
    // `A.uxml` instead of `Parts/A.uxml`, so a document already in hand looks
    // unresolved. Remembering what each raw URL folded to is what makes the
    // second level behave like the first.
    var foldedOf = Object.create(null);
    var ambiguous = [];
    function resolveDep(url, from) {
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
      depsRequested.push(key);
      if (Object.prototype.hasOwnProperty.call(templates, key)) return templates[key];
      if (Object.prototype.hasOwnProperty.call(sheets, key)) return sheets[key];
      depsMissing.push(key);
      return null;
    }

    var parsed = core.parse(input.uxml, undefined, { resolveImport: resolveDep });

    // Expansion is a separate call and produces a DERIVED tree. Everything below
    // must read that tree, not the parsed one: indexing the parsed tree would
    // leave every node inside an instance unlabelled, and the collapse and
    // overflow checks skip unlabelled nodes — the gate would pass a screen it
    // never looked at. `parsed` stays untouched for anything that serializes.
    var expansion = core.expandTemplates(parsed);
    var doc = expansion.document;

    var labels = indexNodes(doc.root, new Map());

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
      activeStates: new Set(),
      states: {},
    });

    // `version-dependent` is a standing condition, not an event: it fires
    // whenever a themed control is used at all. Counting it as a problem makes
    // the failure signal permanent, and a signal that is always on carries
    // nothing. It gets its own channel and never reaches the exit code.
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
    var unsupported = [], missingAssets = [], versionDependent = [], repeatedNames = [], other = [];
    var allWarnings = r.warnings.concat(expansion.warnings || []);
    allWarnings.forEach(function (w) {
      if (w.kind === 'unsupported-control' || w.kind === 'template-slot-unsupported') unsupported.push(w);
      else if (w.kind === 'asset-unresolved') missingAssets.push(w);
      else if (w.kind === 'version-dependent' || w.kind === 'package-path-not-searched') versionDependent.push(w);
      else if (w.kind === 'duplicate-name-in-tree') repeatedNames.push(w);
      else other.push(w);
    });

    var excluded = new Set();
    unsupported.forEach(function (w) { if (w.node != null) excluded.add(w.node); });

    // Two different things used to share one `return` here, and only one of them
    // is legitimate. A node with no `name` is genuinely not a contract surface.
    // A node absent from `labels` altogether means the tree we indexed is not
    // the tree that was laid out — the index would then be silently skipping
    // whole regions while still reporting a pass. That is an instrument fault,
    // not a finding, so it gets its own channel and is never merged with the
    // unnamed case.
    var collapsed = [], overflow = [], unindexed = [];
    r.boxes.forEach(function (box, id) {
      var info = labels.get(id);
      if (!info) { unindexed.push(id); return; }
      if (!info.name) return;                // unnamed nodes are not a contract surface
      if (excluded.has(id)) return;
      if (box.width === 0 || box.height === 0) collapsed.push({ id: id, type: info.type, name: info.name, box: box });
      if (box.left + box.width > panel.width || box.top + box.height > panel.height) {
        overflow.push({ id: id, type: info.type, name: info.name, box: box });
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
      missingAssets: missingAssets,
      versionDependent: versionDependent,
      repeatedNames: repeatedNames,
      other: other,
      collapsed: collapsed,
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
      rootId: doc.root.id,
      boxes: boxes,
      panel: panel,
    };
  }

  globalThis.UxmlCheck = { run: run, resolveSheetUrl: resolveSheetUrl };
})();
