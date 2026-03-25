/**
 * Cross-Reference Search Utilities
 * Scans all indexed file texts for occurrences of a given pipe/system _id
 * used as a dataset name or system reference.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossRef {
  uri: string;
  /** Byte offset of the first character of the matched name (after the opening quote). */
  nameStart: number;
  /** Byte offset one past the last character of the matched name. */
  nameEnd: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// findAllCrossReferences
// ---------------------------------------------------------------------------

/**
 * Searches all cached file texts for occurrences of `targetId` used as:
 *   - `"dataset": "targetId"` (source/sink dataset reference)
 *   - `"system":  "targetId"` (system reference)
 *   - An element of a `"datasets": [...]` array (hops, with optional alias)
 *
 * Returns one CrossRef per match, across all files.
 */
export const findAllCrossReferences = (
  targetId: string,
  fileTexts: ReadonlyMap<string, string>,
): CrossRef[] => {
  const results: CrossRef[] = [];
  const esc = escapeRegex(targetId);

  for (const [uri, text] of fileTexts) {
    let m: RegExpExecArray | null;

    // "dataset": "targetId"
    const datasetRe = new RegExp(`"dataset"\\s*:\\s*"(${esc})"`, "g");
    while ((m = datasetRe.exec(text)) !== null) {
      const nameStart = m.index + m[0].length - targetId.length - 1;
      results.push({ uri, nameStart, nameEnd: nameStart + targetId.length });
    }

    // "system": "targetId"
    const systemRe = new RegExp(`"system"\\s*:\\s*"(${esc})"`, "g");
    while ((m = systemRe.exec(text)) !== null) {
      const nameStart = m.index + m[0].length - targetId.length - 1;
      results.push({ uri, nameStart, nameEnd: nameStart + targetId.length });
    }

    // "datasets": [..., "targetId", ...] or "targetId ALIAS"
    const datasetsRe = /"datasets"\s*:\s*\[([^\]]*)\]/gs;
    while ((m = datasetsRe.exec(text)) !== null) {
      const arrayContent = m[1];
      const arrayStart = m.index + m[0].indexOf("[") + 1;
      const itemRe = new RegExp(`"(${esc}(?:\\s+\\w+)?)"`, "g");
      let im: RegExpExecArray | null;
      while ((im = itemRe.exec(arrayContent)) !== null) {
        const name = im[1].split(/\s+/)[0];
        if (name === targetId) {
          const nameStart = arrayStart + im.index + 1; // +1 to skip opening quote
          results.push({ uri, nameStart, nameEnd: nameStart + targetId.length });
        }
      }
    }
  }

  return results;
};
