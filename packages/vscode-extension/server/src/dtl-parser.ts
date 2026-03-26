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
  /**
   * The first argument (arr[1]) when it is a string literal — used by
   * apply / apply-hops to identify the referenced rule name.
   */
  firstStringArg: string | null;
  /** All string literal arguments (arr[1..n] filtered to strings). */
  stringArgs: readonly string[];
}

/** A JSON syntax error produced during JSON.parse. */
export interface ParseError {
  message: string;
  /** Zero-based character offset of the error in the document, or -1 if unknown. */
  offset: number;
}

/** A structural error in the DTL rule tree (valid JSON but invalid DTL structure). */
export interface StructuralError {
  kind: "rule-not-array";
  range: DtlRange;
}

export interface ParseResult {
  calls: DtlCall[];
  errors: string[];
  /** Set when JSON.parse fails — no calls will be present. */
  parseError: ParseError | null;
  /** All rule names declared in any transform in the document. */
  ruleNames: Set<string>;
  /** Structural errors: items in a rules list that are not DTL call arrays. */
  structuralErrors: StructuralError[];
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
export function parseDtlText(text: string, fileExtension: "dtl" | "json"): ParseResult {
  const calls: DtlCall[] = [];
  const errors: string[] = [];
  const ruleNames: Set<string> = new Set();
  const structuralErrors: StructuralError[] = [];

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (err) {
    const parseError = extractParseError(err);
    return { calls, errors, parseError, ruleNames, structuralErrors };
  }

  // We still need positions, so we do a second pass using the raw text.
  // Strategy: walk the raw text with a simple scanner to locate array starts
  // after we know the structure from JSON.parse.
  const walker = new DtlWalker(text);

  if (fileExtension === "dtl") {
    // The file should be a JSON array (the rules list).
    if (Array.isArray(parsedJson)) {
      walker.walkRulesList(parsedJson as unknown[], true, calls, errors, structuralErrors);
    } else if (
      typeof parsedJson === "object" &&
      parsedJson !== null &&
      "transform" in (parsedJson as Record<string, unknown>)
    ) {
      // Full pipe config stored as .dtl — support both shapes
      walker.seekToKey("transform");
      const transform = (parsedJson as Record<string, unknown>)["transform"];
      extractTransformCalls(transform, walker, calls, errors, ruleNames, structuralErrors);
    }
  } else {
    // JSON file: look for transform rules
    if (typeof parsedJson === "object" && parsedJson !== null) {
      const obj = parsedJson as Record<string, unknown>;
      walker.seekToKey("transform");
      extractTransformCalls(obj["transform"], walker, calls, errors, ruleNames, structuralErrors);
    } else if (Array.isArray(parsedJson)) {
      // Array of pipe configs
      for (const item of parsedJson as unknown[]) {
        if (typeof item === "object" && item !== null) {
          walker.seekToKey("transform");
          extractTransformCalls(
            (item as Record<string, unknown>)["transform"],
            walker,
            calls,
            errors,
            ruleNames,
            structuralErrors,
          );
        }
      }
    }
  }

  return { calls, errors, parseError: null, ruleNames, structuralErrors };
}

/** Extract position and message from a JSON.parse SyntaxError. */
function extractParseError(err: unknown): ParseError {
  if (!(err instanceof SyntaxError)) {
    return { message: String(err), offset: -1 };
  }

  // Node ≥ 20 attaches a `position` property to SyntaxError
  const nodePosition = (err as SyntaxError & { position?: number }).position;
  if (typeof nodePosition === "number") {
    return { message: err.message, offset: nodePosition };
  }

  // Fallback: parse "at position N" from the message
  const matchPos = /at position (\d+)/.exec(err.message);
  if (matchPos) {
    return { message: err.message, offset: parseInt(matchPos[1], 10) };
  }

  // Fallback: parse "at line N column N" style messages
  // (V8 ≥ 12 uses "JSON Parse error: ..." with no position, older formats vary)
  return { message: err.message, offset: -1 };
}

function extractTransformCalls(
  transform: unknown,
  walker: DtlWalker,
  calls: DtlCall[],
  errors: string[],
  ruleNames: Set<string>,
  structuralErrors: StructuralError[],
): void {
  if (!transform || typeof transform !== "object") {
    return;
  }

  // Array of transform steps: [{ type: "dtl", rules: {...} }, ...]
  // OR shorthand inline rules list: [["add", ...], ...]
  if (Array.isArray(transform)) {
    const steps = transform as unknown[];
    if (steps.length > 0 && typeof steps[0] === "object" && !Array.isArray(steps[0])) {
      // Each element is a transform step object. Consume the outer "[" of the
      // transform array so that inner rule-list scans don't misidentify it.
      const exitArray = walker.enterArray();
      for (const step of steps) {
        extractTransformCalls(step, walker, calls, errors, ruleNames, structuralErrors);
      }
      exitArray?.();
    } else {
      // Treat as a bare list of DTL call arrays
      walker.walkRulesList(steps, true, calls, errors, structuralErrors);
    }
    return;
  }

  const t = transform as Record<string, unknown>;

  // Standard DTL transform: { "type": "dtl", "rules": { "default": [...] } }
  if (t["rules"] && typeof t["rules"] === "object") {
    walker.seekToKey("rules");
    const rules = t["rules"] as Record<string, unknown>;
    for (const ruleName of Object.keys(rules)) {
      ruleNames.add(ruleName);
      if (Array.isArray(rules[ruleName])) {
        walker.seekToKey(ruleName);
        walker.walkRulesList(rules[ruleName] as unknown[], true, calls, errors, structuralErrors);
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
   * Seek scanPos to just after the `"key":` pattern in the text, starting from
   * the current scanPos. Returns true if found, false if not found (scanPos
   * unchanged). Use this to align the scanner before entering a known JSON key.
   */
  seekToKey(key: string): boolean {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`"${escaped}"\\s*:`);
    const match = pattern.exec(this.text.slice(this.scanPos));
    if (match) {
      this.scanPos = this.scanPos + match.index + match[0].length;
      return true;
    }
    return false;
  }

  /**
   * Advance the scanner past the next "[" without recording a DtlCall and
   * return a callback that advances past the matching "]". Use this to bracket
   * a traversal of a non-rule array (e.g. a transform step array `[{...}]`).
   */
  enterArray(): (() => void) | null {
    const open = this.findNextArrayStart();
    if (open === -1) {
      return null;
    }
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
    structuralErrors: StructuralError[],
  ): void {
    // Consume the outer "[" that wraps this rules list in the raw text so that
    // each subsequent walkDtlArray call correctly locates its own "[" rather
    // than mis-matching against the outer bracket.
    const outerOpen = this.findNextArrayStart();

    if (outerOpen === -1) {
      return;
    }

    const outerClose = this.findMatchingClose(outerOpen);
    this.scanPos = outerOpen + 1;

    for (const rule of rules) {
      if (!Array.isArray(rule)) {
        // Non-array item in a rules list — record a structural error with best-effort position,
        // then advance the scanner past this value so subsequent arrays are found correctly.
        const range = this.consumeNextNonArrayValue();

        if (range !== null) {
          structuralErrors.push({ kind: "rule-not-array", range });
        }

        continue;
      }

      this.walkDtlArray(rule as unknown[], isTopLevel, calls, errors);
    }

    this.scanPos = outerClose + 1;
  }

  walkDtlArray(arr: unknown[], isTopLevel: boolean, calls: DtlCall[], errors: string[]): void {
    if (arr.length === 0) {
      return;
    }

    // If the first element is itself an array, this is an inline transform block
    // (e.g. the then/else branch of an "if" call). Walk all elements as DTL calls
    // rather than recording the block itself as a call with a missing function name.
    if (Array.isArray(arr[0])) {
      const blockStart = this.findNextArrayStart();

      if (blockStart === -1) {
        return;
      }

      const blockEnd = this.findMatchingClose(blockStart);
      this.scanPos = blockStart + 1;

      for (const elem of arr) {
        if (Array.isArray(elem)) {
          // Inline transform block elements inherit isTopLevel from the parent context
          // (e.g. the then-branch of a top-level "if" contains top-level transforms).
          this.walkDtlArray(elem as unknown[], isTopLevel, calls, errors);
        }
      }

      this.scanPos = blockEnd + 1;
      return;
    }

    const firstName = typeof arr[0] === "string" ? (arr[0] as string) : null;
    const argCount = arr.length - 1;
    const firstStringArg = typeof arr[1] === "string" ? (arr[1] as string) : null;
    const stringArgs = arr.slice(1).filter((x): x is string => typeof x === "string");

    // Find the position of this array in the raw text
    const arrayStart = this.findNextArrayStart();

    if (arrayStart === -1) {
      return;
    }

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
      firstStringArg,
      stringArgs,
    });

    // Advance scan position past the opening bracket so nested calls are found later
    this.scanPos = arrayStart + 1;

    // Recurse into any nested arrays (arguments that are themselves DTL calls)
    for (let i = 1; i < arr.length; i++) {
      if (Array.isArray(arr[i])) {
        // Branch arguments of a top-level "if" or "case" inherit isTopLevel so that
        // transform functions used as conditional branches are not mis-flagged as
        // transform-in-expression (e.g. ["if", cond, ["add", ...]]).
        // The condition argument (index 1 of "if") and all non-branch arguments stay false.
        const isBranch = (firstName === "if" || firstName === "case") && i >= 2;
        this.walkDtlArray(arr[i] as unknown[], isBranch ? isTopLevel : false, calls, errors);
      }
    }

    // After processing all children, advance past the closing bracket
    this.scanPos = arrayEnd + 1;
  }

  /**
   * Scan forward from the current position to find and consume the next
   * non-array JSON value (string, number, boolean, null, or object).
   * Returns the positional range of the value and advances `scanPos` past it.
   * Returns null if the next significant character is `[`, `]`, or end of text.
   */
  private consumeNextNonArrayValue(): DtlRange | null {
    // Skip whitespace and value separators
    while (this.scanPos < this.text.length && " \t\n\r,".includes(this.text[this.scanPos])) {
      this.scanPos++;
    }

    if (this.scanPos >= this.text.length) {
      return null;
    }

    const ch = this.text[this.scanPos];

    // Array — not a non-array value
    if (ch === "[" || ch === "]") {
      return null;
    }

    const start = this.scanPos;
    let end: number;

    if (ch === '"') {
      // String: scan to closing quote with escape handling
      let i = start + 1;

      while (i < this.text.length && this.text[i] !== '"') {
        if (this.text[i] === "\\") {
          i++;
        }

        i++;
      }

      end = i + 1; // include closing quote
    } else if (ch === "{") {
      // Object: find matching }
      end = this.findMatchingClose(start) + 1;
    } else {
      // Number, boolean (true/false), null: scan to delimiter
      let i = start;

      while (i < this.text.length && !" \t\n\r,]}".includes(this.text[i])) {
        i++;
      }

      end = i;
    }

    const range: DtlRange = {
      start: offsetToPosition(this.text, start),
      end: offsetToPosition(this.text, end),
    };

    this.scanPos = end;

    return range;
  }

  private findNextArrayStart(): number {
    for (let i = this.scanPos; i < this.text.length; i++) {
      if (this.text[i] === "[") {
        return i;
      }
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
      if (inString) {
        continue;
      }
      if (ch === "[" || ch === "{") {
        depth++;
      }
      if (ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
    return this.text.length - 1;
  }

  private findStringInside(arrayStart: number, str: string): number {
    const target = `"${str}"`;
    const searchFrom = arrayStart + 1;
    const idx = this.text.indexOf(target, searchFrom);
    // Make sure it's close enough to the array start (within a few tokens)
    if (idx !== -1 && idx < arrayStart + target.length + 5) {
      return idx;
    }
    return idx;
  }
}
