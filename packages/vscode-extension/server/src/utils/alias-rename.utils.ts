/**
 * Dataset Alias Utilities
 *
 * In Sesam pipe configs, "datasets" array entries may use the syntax:
 *   "dataset-id alias"
 *
 * The alias is a local shorthand used within the same file as a variable
 * prefix, e.g. "alias.$ids", "alias._id". These utilities detect and
 * collect alias occurrences for hover, rename, and find-all-references.
 */

import { Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AliasRef {
  /** The short alias token, e.g. "wct". */
  alias: string;
  /** The full dataset-id this alias stands for, e.g. "wikidata-classification-transform". */
  datasetId: string;
  /** Character offset of the first character of the alias token (inside the quotes). */
  aliasStart: number;
  /** Character offset just past the last character of the alias token. */
  aliasEnd: number;
}

// ---------------------------------------------------------------------------
// findAliasAtOffset
// ---------------------------------------------------------------------------

/**
 * Detects whether `offset` falls on the alias token of a `"dataset-id alias"`
 * string inside a `"datasets"` array value.
 *
 * Returns `{ alias, datasetId, aliasStart, aliasEnd }` or `null`.
 */
export const findAliasAtOffset = (text: string, offset: number): AliasRef | null => {
  // Walk backward to find the opening quote of the enclosing string.
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

  // Walk forward to find the closing quote.
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

  const value = text.slice(open + 1, close);
  const spaceIdx = value.indexOf(" ");

  // No space → single token, no alias.
  if (spaceIdx === -1) {
    return null;
  }

  const datasetId = value.slice(0, spaceIdx);
  const alias = value.slice(spaceIdx + 1).trim();

  // Alias must be a valid identifier.
  if (!alias || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) {
    return null;
  }

  const aliasStart = open + 1 + spaceIdx + 1;
  const aliasEnd = aliasStart + alias.length;

  // The cursor must be on the alias portion (after the space).
  if (offset <= open + spaceIdx) {
    return null;
  }

  // Confirm we are inside a "datasets": [...] context by scanning backward from `open`.
  const prefix = text.slice(0, open);

  if (!/"datasets"\s*:\s*\[([^\]]*)$/.test(prefix)) {
    return null;
  }

  return { alias, datasetId, aliasStart, aliasEnd };
};

// ---------------------------------------------------------------------------
// findAliasUsageAtOffset
// ---------------------------------------------------------------------------

/**
 * Detects whether `offset` falls on an alias _usage_ — either a prefixed form
 * `"alias.something"` or a bare standalone string `"alias"`.  When a match is
 * found the function looks up the alias declaration in the same document and
 * returns an `AliasRef` (with `aliasStart`/`aliasEnd` pointing to the usage,
 * not the declaration).
 *
 * Returns `null` when the cursor is not on a known alias.
 */
export const findAliasUsageAtOffset = (text: string, offset: number): AliasRef | null => {
  // Find the enclosing string.
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

  const value = text.slice(open + 1, close);

  // Extract the alias candidate: the part before the first `.` (or the whole value).
  const dotIdx = value.indexOf(".");
  const candidate = dotIdx === -1 ? value : value.slice(0, dotIdx);

  if (!candidate || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(candidate)) {
    return null;
  }

  // Skip if the string has a space → it looks like a declaration, handled by findAliasAtOffset.
  if (value.includes(" ")) {
    return null;
  }

  // Look for a matching declaration in the same document.
  const declRe = new RegExp(`"[^"\\s]+ (${escRe(candidate)})"`, "g");
  let m: RegExpExecArray | null;

  while ((m = declRe.exec(text)) !== null) {
    const prefix = text.slice(0, m.index);

    if (!/"datasets"\s*:\s*\[([^\]]*)$/.test(prefix)) {
      continue;
    }

    const spaceInMatch = m[0].indexOf(" ");
    const datasetId = m[0].slice(1, spaceInMatch); // strip leading quote

    const aliasStart = open + 1;
    const aliasEnd = aliasStart + candidate.length;

    return { alias: candidate, datasetId, aliasStart, aliasEnd };
  }

  return null;
};

// ---------------------------------------------------------------------------
// collectAliasRanges
// ---------------------------------------------------------------------------

/**
 * Finds all character-offset ranges in `text` that represent the alias
 * `alias`:
 *
 * 1. Declaration: the alias token inside `"dataset-id alias"` strings in
 *    `"datasets"` arrays.
 * 2. Prefixed usage: any string `"alias.something"` or `"alias.$field"`.
 * 3. Bare usage: any standalone string `"alias"` (not followed by a space,
 *    which would make it a dataset-id itself).
 *
 * Returns an array of `{ start, end }` pairs (exclusive end, character offset).
 * Pure function — no side effects.
 */
export const collectAliasRanges = (
  text: string,
  alias: string,
): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];

  // 1. Declaration: "dataset-id alias" inside datasets arrays.
  const declRe = new RegExp(`"[^"\\s]+ (${escRe(alias)})"`, "g");
  let m: RegExpExecArray | null;

  while ((m = declRe.exec(text)) !== null) {
    // Verify it is inside a datasets array context.
    const prefix = text.slice(0, m.index);

    if (!/"datasets"\s*:\s*\[([^\]]*)$/.test(prefix)) {
      continue;
    }

    // Offset of alias token inside the quotes.
    const spaceInMatch = m[0].indexOf(" ");
    const start = m.index + spaceInMatch + 1; // skip opening quote + id + space
    ranges.push({ start, end: start + alias.length });
  }

  // 2. Prefixed usage: "alias.something" or "alias.$field"
  const prefixRe = new RegExp(`"(${escRe(alias)})\\.`, "g");

  while ((m = prefixRe.exec(text)) !== null) {
    const start = m.index + 1; // skip opening quote
    ranges.push({ start, end: start + alias.length });
  }

  // 3. Bare usage: standalone "alias" (whole string, not part of "alias ...")
  const bareRe = new RegExp(`"(${escRe(alias)})"`, "g");

  while ((m = bareRe.exec(text)) !== null) {
    const start = m.index + 1;

    // Skip if this is a declaration (already captured above).
    const alreadyCaptured = ranges.some((r) => r.start === start);

    if (!alreadyCaptured) {
      ranges.push({ start, end: start + alias.length });
    }
  }

  return ranges;
};

// ---------------------------------------------------------------------------
// offsetRangeToLsp
// ---------------------------------------------------------------------------

/**
 * Convert a `{ start, end }` character-offset range to an LSP `Range` using
 * the given `TextDocument`.
 */
export const offsetRangeToLsp = (doc: TextDocument, range: { start: number; end: number }): Range =>
  Range.create(doc.positionAt(range.start), doc.positionAt(range.end));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
