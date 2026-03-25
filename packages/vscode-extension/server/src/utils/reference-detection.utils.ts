/**
 * Reference Detection Utilities
 * Pure functions that detect whether the cursor position in a Sesam pipe
 * config is on a dataset reference, system reference, or the pipe/system _id.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StringRef {
  /** The resolved name (alias stripped for hops datasets). */
  name: string;
  /** Character range of the name only (not the alias, not the surrounding quotes). */
  range: { start: number; end: number };
}

// ---------------------------------------------------------------------------
// Shared: find enclosing string at offset
// ---------------------------------------------------------------------------

/**
 * Finds the opening and closing quote positions of the string literal that
 * contains `offset`. Returns the range of the VALUE (excluding quotes), or
 * null if `offset` is not inside a string.
 */
const enclosingStringAt = (
  text: string,
  offset: number,
): { valueStart: number; valueEnd: number } | null => {
  // Walk backward to find opening quote
  let open = -1;
  for (let i = offset - 1; i >= 0; i--) {
    if (text[i] === '"') {
      open = i;
      break;
    }
    if (text[i] === "\n") {
      break;
    }
  }
  if (open === -1) {
    return null;
  }

  // Walk forward to find closing quote
  let close = -1;
  for (let i = offset; i < text.length; i++) {
    if (text[i] === '"') {
      close = i;
      break;
    }
    if (text[i] === "\n") {
      break;
    }
  }
  if (close === -1) {
    return null;
  }

  return { valueStart: open + 1, valueEnd: close };
};

// ---------------------------------------------------------------------------
// findDatasetReference
// ---------------------------------------------------------------------------

/**
 * Detects if the cursor at `offset` is on the value of a `"dataset"` key or
 * on an element inside a `"datasets"` array.
 *
 * For aliased datasets (`"pipe-name ALIAS"`), returns only the pipe name part.
 */
export const findDatasetReference = (text: string, offset: number): StringRef | null => {
  const encl = enclosingStringAt(text, offset);
  if (!encl) {
    return null;
  }

  const { valueStart, valueEnd } = encl;
  const rawValue = text.slice(valueStart, valueEnd);
  const prefix = text.slice(0, valueStart - 1); // text before the opening quote

  // Case 1: "dataset": "value"
  if (/"dataset"\s*:\s*$/.test(prefix)) {
    return { name: rawValue, range: { start: valueStart, end: valueEnd } };
  }

  // Case 2: inside a "datasets": [...] array — match up to the current position
  // without a closing `]` between the `[` and here.
  if (/"datasets"\s*:\s*\[([^\]]*)$/.test(prefix)) {
    const name = rawValue.split(/\s+/)[0]; // strip alias
    return { name, range: { start: valueStart, end: valueStart + name.length } };
  }

  return null;
};

// ---------------------------------------------------------------------------
// findSystemReference
// ---------------------------------------------------------------------------

/**
 * Detects if the cursor at `offset` is on the value of a `"system"` key.
 */
export const findSystemReference = (text: string, offset: number): StringRef | null => {
  const encl = enclosingStringAt(text, offset);
  if (!encl) {
    return null;
  }

  const { valueStart, valueEnd } = encl;
  const rawValue = text.slice(valueStart, valueEnd);
  const prefix = text.slice(0, valueStart - 1);

  if (/"system"\s*:\s*$/.test(prefix)) {
    return { name: rawValue, range: { start: valueStart, end: valueEnd } };
  }

  return null;
};

// ---------------------------------------------------------------------------
// findIdAtOffset
// ---------------------------------------------------------------------------

/**
 * Detects if the cursor at `offset` is on the value of the `"_id"` key.
 */
export const findIdAtOffset = (text: string, offset: number): StringRef | null => {
  const encl = enclosingStringAt(text, offset);
  if (!encl) {
    return null;
  }

  const { valueStart, valueEnd } = encl;
  const rawValue = text.slice(valueStart, valueEnd);
  const prefix = text.slice(0, valueStart - 1);

  if (/"_id"\s*:\s*$/.test(prefix)) {
    return { name: rawValue, range: { start: valueStart, end: valueEnd } };
  }

  return null;
};
