/**
 * Document Link Utilities
 * Produces underlined clickable links for all resolved dataset and system
 * references in a Sesam pipe config document.
 */

import { DocumentLink, Position, Range } from "vscode-languageserver/node";

import type { IndexEntry } from "./workspace-index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a zero-based character offset in `text` to an LSP Position. */
const offsetToPos = (text: string, offset: number): Position => {
  const clamped = Math.min(offset, text.length);
  let line = 0;
  let character = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return Position.create(line, character);
};

const makeLink = (
  text: string,
  valueStart: number,
  valueEnd: number,
  targetUri: string,
): DocumentLink =>
  DocumentLink.create(
    Range.create(offsetToPos(text, valueStart), offsetToPos(text, valueEnd)),
    targetUri,
  );

// ---------------------------------------------------------------------------
// collectDocumentLinks
// ---------------------------------------------------------------------------

/**
 * Scans the raw text of a Sesam pipe/system config and produces DocumentLink
 * entries for every resolved `"dataset"` value, `"datasets"` array element,
 * and `"system"` value.
 */
export const collectDocumentLinks = (
  text: string,
  pipeIndex: ReadonlyMap<string, IndexEntry>,
  systemIndex: ReadonlyMap<string, IndexEntry>,
): DocumentLink[] => {
  const links: DocumentLink[] = [];
  let m: RegExpExecArray | null;

  // "dataset": "value"
  const datasetRe = /"dataset"\s*:\s*"([^"]+)"/g;
  while ((m = datasetRe.exec(text)) !== null) {
    const value = m[1];
    const entry = pipeIndex.get(value);
    if (entry) {
      const valueStart = m.index + m[0].length - value.length - 1;
      links.push(makeLink(text, valueStart, valueStart + value.length, entry.uri));
    }
  }

  // "system": "value"
  const systemRe = /"system"\s*:\s*"([^"]+)"/g;
  while ((m = systemRe.exec(text)) !== null) {
    const value = m[1];
    const entry = systemIndex.get(value);
    if (entry) {
      const valueStart = m.index + m[0].length - value.length - 1;
      links.push(makeLink(text, valueStart, valueStart + value.length, entry.uri));
    }
  }

  // "datasets": [...] — one link per array element
  const datasetsRe = /"datasets"\s*:\s*\[([^\]]*)\]/gs;
  while ((m = datasetsRe.exec(text)) !== null) {
    const arrayContent = m[1];
    const arrayStart = m.index + m[0].indexOf("[") + 1;
    const itemRe = /"([^"]+)"/g;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(arrayContent)) !== null) {
      const name = im[1].split(/\s+/)[0]; // strip alias
      const entry = pipeIndex.get(name);
      if (entry) {
        const valueStart = arrayStart + im.index + 1; // +1 to skip opening quote
        links.push(makeLink(text, valueStart, valueStart + name.length, entry.uri));
      }
    }
  }

  return links;
};
