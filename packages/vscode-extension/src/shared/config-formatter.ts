/**
 * DTL / Sesam pipe config formatter.
 *
 * Formats a parsed JSON value as a Sesam pipe config:
 *   - Object keys sorted alphabetically at every level
 *   - Object properties each on their own line with indentation
 *   - Array items (DTL rule lists) separated by spaces; each sub-array
 *     opened on a new line when nested inside another array
 *
 * Ported from https://github.com/BaardBouvet/dtl-vscode-extension
 */

/** Context stack entries used by the character-by-character formatter. */
const enum FmtContext {
  Root,
  String,
  Array,
  Object,
  Escape,
}

export const sortObjectKeysRecursively = (obj: unknown): unknown => {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeysRecursively);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeysRecursively((obj as Record<string, unknown>)[key]);
  }
  return sorted;
};

export const formatSesamJson = (value: unknown, tabSize: number): string => {
  const indentation = " ".repeat(tabSize);
  const compact = JSON.stringify(value, null, 0);

  let output = "";
  let indent = 0;
  const stack: FmtContext[] = [FmtContext.Object];
  let prev = "";

  for (let i = 0; i < compact.length; i++) {
    const c = compact[i];

    const peek = (): string | undefined => (i < compact.length - 1 ? compact[i + 1] : undefined);
    const peekStack = (): FmtContext => stack[stack.length - 1];

    // ── Context tracking ──────────────────────────────────────────────────
    if (peekStack() === FmtContext.Escape) {
      stack.pop();
    }

    if (peekStack() === FmtContext.String) {
      if (c === '"') {
        stack.pop();
      } else if (c === "\\") {
        stack.push(FmtContext.Escape);
      }
    } else {
      if (c === '"') {
        stack.push(FmtContext.String);
      } else if (c === "{") {
        if (peekStack() === FmtContext.Object) {
          indent++;
        }
        stack.push(FmtContext.Object);
      } else if (c === "}") {
        stack.pop();
        if (peekStack() === FmtContext.Object) {
          indent--;
        }
      } else if (c === "[") {
        stack.push(FmtContext.Array);
        indent++;
      } else if (c === "]") {
        stack.pop();
        indent--;
      }
    }

    const ctx = peekStack(); // context AFTER stack update

    // ── Whitespace BEFORE char ─────────────────────────────────────────────
    if (ctx !== FmtContext.String && ctx !== FmtContext.Escape) {
      // Newline before closing `}` (unless empty object)
      if (c === "}" && prev !== "{") {
        output += "\n";
        output +=
          ctx === FmtContext.Array
            ? indentation.repeat(Math.max(0, indent - 1))
            : indentation.repeat(Math.max(0, indent));
      }

      // Newline before `[` when it opens an array inside another array
      if (c === "[" && stack.length > 1 && stack[stack.length - 2] === FmtContext.Array) {
        output += "\n";
        output += indentation.repeat(Math.max(0, indent - 1));
      }

      // Extra newline before closing `]` when the previous char was also `]`
      // (aligns the end of the outer rules list)
      if (c === "]" && prev === "]") {
        output += "\n";
        output += indentation.repeat(Math.max(0, indent));
      }
    }

    output += c;

    // ── Whitespace AFTER char ──────────────────────────────────────────────
    if (ctx !== FmtContext.String && ctx !== FmtContext.Escape) {
      // Newline after `{` (unless empty object)
      if (c === "{" && peek() !== "}") {
        output += "\n";
        output += indentation.repeat(indent);
      }
      if (c === ",") {
        if (ctx === FmtContext.Object) {
          output += "\n";
          output += indentation.repeat(indent);
        } else if (ctx === FmtContext.Array) {
          output += " ";
        }
      }
      if (c === ":") {
        output += " ";
      }
    }

    prev = c;
  }

  return output;
};
