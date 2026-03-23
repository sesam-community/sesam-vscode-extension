/**
 * DTL Parser
 * Parses DTL arrays from document text and returns a position-aware node structure.
 * Handles both bare .dtl files (a JSON array of transform arrays) and
 * Sesam pipe/system .json configs (looks for transform.rules arrays).
 */

export interface DtlPosition {
  /** Zero-based offset in the document */
  offset: number;
  line: number;
  character: number;
}

export interface DtlRange {
  start: DtlPosition;
  end: DtlPosition;
}

/** A single parsed DTL call: ["functionName", arg1, arg2, ...] */
export interface DtlCall {
  /** The function name string, or null if first element is not a string */
  functionName: string | null;
  /** Full range of the enclosing [...] array */
  range: DtlRange;
  /** Range covering just the function name string token */
  nameRange: DtlRange | null;
  /** Number of arguments (excluding the function name) */
  argCount: number;
  /** Whether this call is at the top level of a transform rules list */
  isTopLevel: boolean;
}

export interface ParseResult {
  calls: DtlCall[];
  errors: string[];
}

/** Converts a linear offset in text into {line, character}. */
function offsetToPosition(text: string, offset: number): DtlPosition {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { offset, line, character };
}

/**
 * Very lightweight structural parser that finds DTL array invocations.
 * We use a token-scanning approach rather than full JSON.parse so we can
 * retain character positions that JSON.parse drops.
 */
export function parseDtlText(
  text: string,
  fileExtension: "dtl" | "json",
): ParseResult {
  const calls: DtlCall[] = [];
  const errors: string[] = [];

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (e) {
    // Document not valid JSON yet — skip validation
    return { calls, errors };
  }

  // We still need positions, so we do a second pass using the raw text.
  // Strategy: walk the raw text with a simple scanner to locate array starts
  // after we know the structure from JSON.parse.
  const walker = new DtlWalker(text);

  if (fileExtension === "dtl") {
    // The file should be a JSON array (the rules list).
    if (Array.isArray(parsedJson)) {
      walker.walkRulesList(parsedJson as unknown[], true, calls, errors);
    } else if (
      typeof parsedJson === "object" &&
      parsedJson !== null &&
      "transform" in (parsedJson as Record<string, unknown>)
    ) {
      // Full pipe config stored as .dtl — support both shapes
      const transform = (parsedJson as Record<string, unknown>)["transform"];
      extractTransformCalls(transform, walker, calls, errors);
    }
  } else {
    // JSON file: look for transform rules
    if (typeof parsedJson === "object" && parsedJson !== null) {
      const obj = parsedJson as Record<string, unknown>;
      extractTransformCalls(obj["transform"], walker, calls, errors);
    } else if (Array.isArray(parsedJson)) {
      // Array of pipe configs
      for (const item of parsedJson as unknown[]) {
        if (typeof item === "object" && item !== null) {
          extractTransformCalls(
            (item as Record<string, unknown>)["transform"],
            walker,
            calls,
            errors,
          );
        }
      }
    }
  }

  return { calls, errors };
}

function extractTransformCalls(
  transform: unknown,
  walker: DtlWalker,
  calls: DtlCall[],
  errors: string[],
): void {
  if (!transform || typeof transform !== "object") return;

  // Array of transform steps: [{ type: "dtl", rules: {...} }, ...]
  // OR shorthand inline rules list: [["add", ...], ...]
  if (Array.isArray(transform)) {
    const steps = transform as unknown[];
    if (
      steps.length > 0 &&
      typeof steps[0] === "object" &&
      !Array.isArray(steps[0])
    ) {
      // Each element is a transform step object. Consume the outer "[" of the
      // transform array so that inner rule-list scans don't misidentify it.
      const exitArray = walker.enterArray();
      for (const step of steps) {
        extractTransformCalls(step, walker, calls, errors);
      }
      exitArray?.();
    } else {
      // Treat as a bare list of DTL call arrays
      walker.walkRulesList(steps, true, calls, errors);
    }
    return;
  }

  const t = transform as Record<string, unknown>;

  // Standard DTL transform: { "type": "dtl", "rules": { "default": [...] } }
  if (t["rules"] && typeof t["rules"] === "object") {
    const rules = t["rules"] as Record<string, unknown>;
    for (const ruleName of Object.keys(rules)) {
      if (Array.isArray(rules[ruleName])) {
        walker.walkRulesList(rules[ruleName] as unknown[], true, calls, errors);
      }
    }
  }
}

/**
 * Walks the raw text to assign source positions to DTL calls found by JSON.parse.
 * This is a best-effort position finder: it scans for opening '[' characters and
 * tries to correlate them with the parsed structure. Accurate enough for diagnostics.
 */
class DtlWalker {
  private text: string;
  private scanPos = 0;

  constructor(text: string) {
    this.text = text;
  }

  /**
   * Advance the scanner past the next "[" without recording a DtlCall and
   * return a callback that advances past the matching "]". Use this to bracket
   * a traversal of a non-rule array (e.g. a transform step array `[{...}]`).
   */
  enterArray(): (() => void) | null {
    const open = this.findNextArrayStart();
    if (open === -1) return null;
    const close = this.findMatchingClose(open);
    this.scanPos = open + 1;
    return () => {
      this.scanPos = close + 1;
    };
  }

  walkRulesList(
    rules: unknown[],
    isTopLevel: boolean,
    calls: DtlCall[],
    errors: string[],
  ): void {
    // Consume the outer "[" that wraps this rules list in the raw text so that
    // each subsequent walkDtlArray call correctly locates its own "[" rather
    // than mis-matching against the outer bracket.
    const outerOpen = this.findNextArrayStart();
    if (outerOpen === -1) return;
    const outerClose = this.findMatchingClose(outerOpen);
    this.scanPos = outerOpen + 1;

    for (const rule of rules) {
      if (!Array.isArray(rule)) continue;
      this.walkDtlArray(rule as unknown[], isTopLevel, calls, errors);
    }

    this.scanPos = outerClose + 1;
  }

  walkDtlArray(
    arr: unknown[],
    isTopLevel: boolean,
    calls: DtlCall[],
    errors: string[],
  ): void {
    if (arr.length === 0) return;

    const firstName = typeof arr[0] === "string" ? (arr[0] as string) : null;
    const argCount = arr.length - 1;

    // Find the position of this array in the raw text
    const arrayStart = this.findNextArrayStart();
    if (arrayStart === -1) return;

    const arrayEnd = this.findMatchingClose(arrayStart);

    const startPos = offsetToPosition(this.text, arrayStart);
    const endPos = offsetToPosition(this.text, arrayEnd + 1);

    let nameRange: DtlRange | null = null;
    if (firstName !== null) {
      // Find the string inside the array
      const nameStart = this.findStringInside(arrayStart, firstName);
      if (nameStart !== -1) {
        nameRange = {
          start: offsetToPosition(this.text, nameStart),
          end: offsetToPosition(this.text, nameStart + firstName.length + 2), // +2 for quotes
        };
      }
    }

    calls.push({
      functionName: firstName,
      range: {
        start: startPos,
        end: endPos,
      },
      nameRange,
      argCount,
      isTopLevel,
    });

    // Advance scan position past the opening bracket so nested calls are found later
    this.scanPos = arrayStart + 1;

    // Recurse into any nested arrays (arguments that are themselves DTL calls)
    for (let i = 1; i < arr.length; i++) {
      if (Array.isArray(arr[i])) {
        this.walkDtlArray(arr[i] as unknown[], false, calls, errors);
      }
    }

    // After processing all children, advance past the closing bracket
    this.scanPos = arrayEnd + 1;
  }

  private findNextArrayStart(): number {
    for (let i = this.scanPos; i < this.text.length; i++) {
      if (this.text[i] === "[") return i;
    }
    return -1;
  }

  private findMatchingClose(openPos: number): number {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = openPos; i < this.text.length; i++) {
      const ch = this.text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return this.text.length - 1;
  }

  private findStringInside(arrayStart: number, str: string): number {
    const target = `"${str}"`;
    const searchFrom = arrayStart + 1;
    const idx = this.text.indexOf(target, searchFrom);
    // Make sure it's close enough to the array start (within a few tokens)
    if (idx !== -1 && idx < arrayStart + target.length + 5) return idx;
    return idx;
  }
}
