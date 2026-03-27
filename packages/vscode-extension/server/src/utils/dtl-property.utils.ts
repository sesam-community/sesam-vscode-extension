/**
 * DTL Property Utilities
 *
 * Helpers for working with property names defined by ["add", "propName", ...]
 * and ["add-if", "propName", ...] calls inside DTL transform rules.
 *
 * Supports:
 *   - finding the property name at the cursor
 *   - locating all definition sites for a given property name (for references + rename)
 *   - collecting a deduplicated list of all defined properties (for the outline)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddPropertyRef {
  /** Property name string content (without surrounding quotes). */
  propName: string;
  /** Character offset of the first char of the property name (after the opening `"`). */
  nameStart: number;
  /** Character offset just past the last char of the property name (before the closing `"`). */
  nameEnd: number;
}

// ---------------------------------------------------------------------------
// findAddPropertyAtOffset
// ---------------------------------------------------------------------------

/**
 * Returns the property name info when `offset` falls inside the first-argument
 * string of an `["add", "propName", ...]` or `["add-if", "propName", ...]` call.
 *
 * Returns `null` when the cursor is not on an add/add-if property name.
 */
export const findAddPropertyAtOffset = (text: string, offset: number): AddPropertyRef | null => {
  // When the cursor lands exactly on the opening `"` of `"propName"`, the normal
  // backward search picks up the closing `"` of the preceding token instead.
  // Retry with offset+1 (the first character inside the string) in that case.
  return (
    _findAddPropertyCore(text, offset) ??
    (text[offset] === '"' ? _findAddPropertyCore(text, offset + 1) : null)
  );
};

const _findAddPropertyCore = (text: string, offset: number): AddPropertyRef | null => {
  // Locate the enclosing string: walk backward for the opening `"`.
  let open = -1;

  for (let i = offset - 1; i >= 0; i--) {
    if (text[i] === '"') {
      open = i;
      break;
    }

    // Bail early if we cross a structural character that cannot precede a string value.
    if (text[i] === "\n" || text[i] === "[" || text[i] === "{") {
      break;
    }
  }

  if (open === -1) {
    return null;
  }

  // Locate the closing `"`.
  const close = text.indexOf('"', Math.max(offset, open + 1));

  if (close === -1) {
    return null;
  }

  const propName = text.slice(open + 1, close);

  if (!propName) {
    return null;
  }

  // Walk backward from the opening `"` to verify the surrounding syntax is:
  //   [ "add"   ,   "propName"
  //   [ "add-if",   "propName"
  let pos = open - 1;

  // Skip whitespace
  while (pos >= 0 && /\s/.test(text[pos])) {
    pos--;
  }

  // Expect a comma separating propName from the function name.
  if (pos < 0 || text[pos] !== ",") {
    return null;
  }

  pos--;

  // Skip whitespace
  while (pos >= 0 && /\s/.test(text[pos])) {
    pos--;
  }

  // Expect the closing quote of the function name.
  if (pos < 0 || text[pos] !== '"') {
    return null;
  }

  const fnClose = pos;
  const fnOpen = text.lastIndexOf('"', fnClose - 1);

  if (fnOpen < 0) {
    return null;
  }

  const fnName = text.slice(fnOpen + 1, fnClose);

  if (fnName !== "add" && fnName !== "add-if") {
    return null;
  }

  // Walk backward from fnOpen, skip whitespace, expect `[`.
  pos = fnOpen - 1;

  while (pos >= 0 && /\s/.test(text[pos])) {
    pos--;
  }

  if (pos < 0 || text[pos] !== "[") {
    return null;
  }

  return { propName, nameStart: open + 1, nameEnd: close };
};

// ---------------------------------------------------------------------------
// findAllAddPropertyDefinitions
// ---------------------------------------------------------------------------

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds every place in `text` where `propName` is the first argument of an
 * `["add", ...]` or `["add-if", ...]` call.
 *
 * Returns character offset pairs `{start, end}` for the property name content
 * (not including the surrounding quotes).
 */
export const findAllAddPropertyDefinitions = (
  text: string,
  propName: string,
): Array<{ start: number; end: number }> => {
  const esc = escapeRegex(propName);
  const re = new RegExp(`\\["add(?:-if)?",\\s*"(${esc})"`, "g");
  const results: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    // Locate the `"propName"` substring within the match.
    const matchStr = m[0];
    const quoteIdx = matchStr.lastIndexOf(`"${propName}"`);
    const start = m.index + quoteIdx + 1;
    results.push({ start, end: start + propName.length });
  }

  return results;
};

// ---------------------------------------------------------------------------
// collectDocumentProperties
// ---------------------------------------------------------------------------

/**
 * Scans `text` for all `["add"/"add-if", "propName", ...]` calls and returns
 * a deduplicated list of property names together with the offset of their
 * **first** definition in document order.
 */
export const collectDocumentProperties = (
  text: string,
): Array<{ propName: string; start: number; end: number }> => {
  const re = /\["add(?:-if)?",\s*"([^"]+)"/g;
  const seen = new Map<string, { start: number; end: number }>();
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const propName = m[1];

    if (!seen.has(propName)) {
      const matchStr = m[0];
      const quoteIdx = matchStr.lastIndexOf(`"${propName}"`);
      const start = m.index + quoteIdx + 1;
      seen.set(propName, { start, end: start + propName.length });
    }
  }

  return [...seen.entries()].map(([propName, range]) => ({ propName, ...range }));
};
