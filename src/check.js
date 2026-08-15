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

    var sheetsRequested = [];
    var sheetsMissing = [];
    var doc = core.parse(input.uxml, undefined, {
      resolveImport: function (url, from) {
        var key = resolveSheetUrl(url, from || null);
        sheetsRequested.push(key);
        if (Object.prototype.hasOwnProperty.call(sheets, key)) return sheets[key];
        sheetsMissing.push(key);
        return null;
      },
    });

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
    var unsupported = [], missingAssets = [], versionDependent = [], other = [];
    r.warnings.forEach(function (w) {
      if (w.kind === 'unsupported-control') unsupported.push(w);
      else if (w.kind === 'asset-unresolved') missingAssets.push(w);
      else if (w.kind === 'version-dependent') versionDependent.push(w);
      else other.push(w);
    });

    var excluded = new Set();
    unsupported.forEach(function (w) { if (w.node != null) excluded.add(w.node); });

    var collapsed = [], overflow = [];
    r.boxes.forEach(function (box, id) {
      var info = labels.get(id);
      if (!info || !info.name) return;       // unnamed nodes are not a contract surface
      if (excluded.has(id)) return;
      if (box.width === 0 || box.height === 0) collapsed.push({ id: id, type: info.type, name: info.name, box: box });
      if (box.left + box.width > panel.width || box.top + box.height > panel.height) {
        overflow.push({ id: id, type: info.type, name: info.name, box: box });
      }
    });

    // Painting is a fact apart from layout. Warnings, boxes and liveNodeCount
    // can all be right while the container is empty.
    var texts = {};
    r.elements.forEach(function (el, id) {
      var info = labels.get(id);
      if (info && info.name) texts[info.name] = el.textContent;
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
      },
      parseWarnings: doc.warnings || [],
      unsupported: unsupported,
      missingAssets: missingAssets,
      versionDependent: versionDependent,
      other: other,
      collapsed: collapsed,
      overflow: overflow,
      injected: injected,
      sheetsRequested: sheetsRequested,
      sheetsMissing: sheetsMissing,
      rootId: doc.root.id,
      boxes: boxes,
      panel: panel,
    };
  }

  globalThis.UxmlCheck = { run: run, resolveSheetUrl: resolveSheetUrl };
})();
