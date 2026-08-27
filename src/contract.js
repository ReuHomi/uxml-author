// ui-contract.md is the only thing standing between a redesign and a runtime
// null. The design will be thrown out several times; the names C# reaches for
// must not move. This module owns that file's shape.
//
// It holds no DOM and no renderer, so it runs anywhere.

const KEYWORDS = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked',
  'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else',
  'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for',
  'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock',
  'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params',
  'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short',
  'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true',
  'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual',
  'void', 'volatile', 'while',
]);

// Types Unity's UIElements namespace provides. This is about the C# surface, not
// about what our renderer can draw — Unity has Toggle even though the preview
// falls back on it. Anything not listed becomes VisualElement and is reported,
// so an out-of-date list costs precision, never correctness.
const UNITY_TYPES = new Set([
  'VisualElement', 'Label', 'Button', 'Image', 'ScrollView', 'Toggle', 'Slider', 'SliderInt',
  'TextField', 'IntegerField', 'FloatField', 'DropdownField', 'EnumField', 'Foldout',
  'ListView', 'TreeView', 'ProgressBar', 'RadioButton', 'RadioButtonGroup', 'MinMaxSlider',
  'GroupBox', 'HelpBox', 'TemplateContainer', 'Box', 'PopupWindow', 'Vector2Field',
  'Vector3Field', 'RectField', 'ColorField', 'ObjectField', 'MultiColumnListView',
]);

/**
 * Purpose: turn a UXML `name` into a C# field identifier, the same way every
 *          time. The derivation is mechanical on purpose — a model inventing
 *          field names is precisely the drift the contract exists to stop.
 * Ensures: the result is a legal C# identifier and unique within `taken`.
 */
export function fieldNameFor(uxmlName, taken) {
  let s = uxmlName.replace(/[^A-Za-z0-9_]/g, '');
  if (!s) s = 'element';
  if (/^[0-9]/.test(s)) s = '_' + s;
  s = s[0].toLowerCase() + s.slice(1);
  if (KEYWORDS.has(s)) s = '@' + s;
  let out = s, n = 2;
  while (taken.has(out)) out = s + n++;
  taken.add(out);
  return out;
}

// A UXML tag that is not the name of the class Unity puts in the hierarchy.
// `<ui:Instance>` is the only one: expansion replaces it with a TemplateContainer
// and the instance's `name` attaches to that container — measured on 6000.0.40f1,
// not inferred. Without this the tag falls through to the VisualElement floor and
// gets reported as unrecognised, which is a warning about a fact we know.
const TAG_TO_TYPE = new Map([
  ['Instance', 'TemplateContainer'],
]);

export function csharpTypeFor(elementType) {
  const mapped = TAG_TO_TYPE.get(elementType);
  if (mapped) return mapped;
  return UNITY_TYPES.has(elementType) ? elementType : 'VisualElement';
}
export function isKnownUnityType(elementType) {
  return TAG_TO_TYPE.has(elementType) || UNITY_TYPES.has(elementType);
}

const HEADER = [
  '| Name | Element | C# type | C# field | Status | Note |',
  '| --- | --- | --- | --- | --- | --- |',
];

/**
 * Purpose: read an existing contract.
 * Ensures: THROWS on anything it cannot read. Falling back to "start fresh"
 *          would erase every retired name in the file — the loudest possible
 *          version of the failure this file prevents. The caller turns a throw
 *          into exit 2, never into a regeneration.
 */
export function parseContract(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith('| Name |'));
  if (start === -1) throw new Error('no contract table found (expected a row beginning "| Name |")');
  const rows = [];
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) { if (line === '') continue; else break; }
    const cells = line.slice(1, -1).split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
    if (cells.length !== 6) {
      throw new Error(`contract row ${i + 1} has ${cells.length} columns, expected 6: ${line}`);
    }
    const [name, element, type, field, status, note] = cells;
    if (!['active', 'retired'].includes(status)) {
      throw new Error(`contract row ${i + 1} has unknown status "${status}"`);
    }
    rows.push({ name, element, type, field, status, note });
  }
  // Two rows for one name make `prevByName` ambiguous, and the loser is dropped
  // silently — the field it holds then drifts on every regeneration. A contract
  // that cannot be read one way is unreadable, so this throws like the rest.
  const byName = new Map();
  for (const r of rows) {
    if (byName.has(r.name)) {
      throw new Error(
        `contract has two rows for name "${r.name}" (fields "${byName.get(r.name).field}" ` +
        `and "${r.field}"); one of them would be dropped on the next run`);
    }
    byName.set(r.name, r);
  }
  return rows;
}

/**
 * Purpose: find names that more than one element carries.
 * Ensures: returns Map<name, count> holding only counts above one, in first-seen
 *          order. Empty means every name addresses exactly one element.
 *
 * Why this is a hard stop rather than a note: `Q<T>(name)` returns the FIRST
 * match, so N fields derived from one name all point at the same element while
 * the C# still compiles. That is the drift this contract exists to prevent, and
 * it is invisible at runtime until something is wired to the wrong box.
 */
export function duplicateNames(elements) {
  const counts = new Map();
  for (const el of elements) counts.set(el.name, (counts.get(el.name) || 0) + 1);
  const dupes = new Map();
  for (const [name, n] of counts) if (n > 1) dupes.set(name, n);
  return dupes;
}

export function serializeContract(title, rows) {
  const cell = (v) => String(v || '').replace(/\|/g, '\\|');
  return [
    `# UI contract — ${title}`,
    '',
    'C# reaches for these names. The design may be redrawn as often as needed;',
    'these must not move. Regeneration adds and retires rows, and never renames',
    'an existing one on its own.',
    '',
    '- **active** — present in both the UXML and the C#.',
    '- **retired** — gone from the UXML. Kept here because C# may still reach for',
    '  it, and `Q<T>()` returns null rather than failing to compile.',
    '',
    ...HEADER,
    ...rows.map((r) =>
      `| ${cell(r.name)} | ${cell(r.element)} | ${cell(r.type)} | ${cell(r.field)} | ${cell(r.status)} | ${cell(r.note)} |`),
    '',
  ].join('\n');
}

/**
 * Purpose: fold this run's elements into the previous contract.
 * Ensures: - an existing name keeps its field, whatever moved in the UXML
 *          - a name absent from the UXML becomes retired, never disappears
 *          - explicit renames are recorded on both rows, so an intended change
 *            and an accidental one do not look alike
 *          - `reserved` keeps the caller's own template members out of the
 *            field pool; a clash there yields C# that will not compile
 */
export function reconcile(previous, elements, renames, reserved) {
  const prevByName = new Map(previous.map((r) => [r.name, r]));
  const renameOf = new Map(Object.entries(renames || {}));   // old -> new
  const taken = new Set([...(reserved || []), ...previous.map((r) => r.field)]);
  const rows = [];
  const events = { added: [], retired: [], renamed: [], retyped: [] };

  // apply renames first so the new name inherits the old field
  for (const [oldName, newName] of renameOf) {
    const row = prevByName.get(oldName);
    if (!row) continue;
    prevByName.delete(oldName);
    prevByName.set(newName, { ...row, name: newName, note: `renamed from ${oldName}` });
    events.renamed.push({ from: oldName, to: newName, field: row.field });
  }

  const seen = new Set();
  for (const el of elements) {
    seen.add(el.name);
    const prev = prevByName.get(el.name);
    if (prev) {
      const type = csharpTypeFor(el.type);
      if (prev.type !== type) events.retyped.push({ name: el.name, from: prev.type, to: type });
      rows.push({
        name: el.name, element: el.type, type, field: prev.field,   // field is never re-derived
        status: 'active',
        note: prev.note === 'gone from the UXML' ? '' : prev.note,   // a note is a human's, keep it
      });
      if (prev.status === 'retired') events.added.push({ name: el.name, field: prev.field, back: true });
    } else {
      const field = fieldNameFor(el.name, taken);
      rows.push({
        name: el.name, element: el.type, type: csharpTypeFor(el.type),
        field, status: 'active', note: '',
      });
      events.added.push({ name: el.name, field });
    }
  }

  for (const [name, row] of prevByName) {
    if (seen.has(name)) continue;
    rows.push({ ...row, status: 'retired', note: row.note || 'gone from the UXML' });
    if (row.status !== 'retired') events.retired.push({ name, field: row.field });
  }

  return { rows, events };
}
