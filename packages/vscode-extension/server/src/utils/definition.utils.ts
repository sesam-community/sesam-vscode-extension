import { findKeyOffset } from "./server.utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApplyRuleRef {
  ruleName: string;
  /** Offsets of the rule name text within the document, excluding surrounding quotes. */
  nameRange: { start: number; end: number };
}

export interface RuleKeyHit {
  ruleName: string;
  /** Offsets of the rule key text within the document, excluding surrounding quotes. */
  keyRange: { start: number; end: number };
}

export interface RuleLocation {
  /** Offset of the first character of the rule name (after the opening quote). */
  keyStart: number;
  /** Offset of the character after the last character of the rule name (before the closing quote). */
  keyEnd: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StepInfo {
  rulesKeyOff: number;
  /** Exclusive offset bounding this step (start of next step's "rules" key, or text.length). */
  boundary: number;
}

const buildStepInfos = (text: string, obj: Record<string, unknown>): StepInfo[] => {
  const rawTransform = obj["transform"];
  if (rawTransform == null || typeof rawTransform !== "object") {
    return [];
  }

  const allSteps: unknown[] = Array.isArray(rawTransform)
    ? (rawTransform as unknown[])
    : [rawTransform];

  const stepInfos: StepInfo[] = [];
  let searchFrom = 0;

  for (const step of allSteps) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      continue;
    }
    const rules = (step as Record<string, unknown>)["rules"];
    if (rules == null || typeof rules !== "object" || Array.isArray(rules)) {
      continue;
    }
    const rulesKeyOff = findKeyOffset(text, "rules", searchFrom);
    if (rulesKeyOff < 0) {
      continue;
    }
    stepInfos.push({ rulesKeyOff, boundary: 0 });
    searchFrom = rulesKeyOff + 7;
  }

  for (let i = 0; i < stepInfos.length; i++) {
    stepInfos[i].boundary = i + 1 < stepInfos.length ? stepInfos[i + 1].rulesKeyOff : text.length;
  }

  return stepInfos;
};

const parseConfig = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// findApplyRuleReference
// ---------------------------------------------------------------------------

/**
 * Detects if the cursor at `offset` is inside a string literal that is the
 * first argument of an `apply` or `apply-hops` call.
 *
 * Example: `["apply", "based-on", "_S."]`
 *                       ^ cursor → { ruleName: "based-on", nameRange: { start: 10, end: 18 } }
 */
export const findApplyRuleReference = (text: string, offset: number): ApplyRuleRef | null => {
  // Find the opening quote of the string containing the cursor.
  let stringOpen = -1;
  for (let i = offset - 1; i >= 0; i--) {
    if (text[i] === '"') {
      stringOpen = i;
      break;
    }
  }
  if (stringOpen === -1) {
    return null;
  }

  // Find the closing quote of that string.
  let stringClose = -1;
  for (let i = offset; i < text.length; i++) {
    if (text[i] === '"') {
      stringClose = i;
      break;
    }
  }
  if (stringClose === -1) {
    return null;
  }

  const ruleName = text.slice(stringOpen + 1, stringClose);

  // Verify the text before the opening quote ends with `["apply",` or `["apply-hops",`.
  // The regex is not anchored at the start so it correctly handles nested calls.
  const prefix = text.slice(0, stringOpen);
  if (!/\["(?:apply-hops|apply)"\s*,\s*$/.test(prefix)) {
    return null;
  }

  return {
    ruleName,
    nameRange: { start: stringOpen + 1, end: stringClose },
  };
};

// ---------------------------------------------------------------------------
// findRuleDefinition
// ---------------------------------------------------------------------------

/**
 * Finds the text offset range of a named rule's key in `transform.rules`.
 * For array transforms, scopes the search to the step that contains `cursorOffset`.
 *
 * Returns the character range of the rule name itself (excluding surrounding quotes),
 * or `null` if no definition can be found.
 */
export const findRuleDefinition = (
  text: string,
  ruleName: string,
  cursorOffset: number,
): RuleLocation | null => {
  const obj = parseConfig(text);
  if (!obj) {
    return null;
  }

  const stepInfos = buildStepInfos(text, obj);
  if (stepInfos.length === 0) {
    return null;
  }

  // Find the step that contains the cursor; fall back to the first step.
  let targetStep = stepInfos[0];
  for (const info of stepInfos) {
    if (cursorOffset >= info.rulesKeyOff && cursorOffset < info.boundary) {
      targetStep = info;
      break;
    }
  }

  const ruleOff = findKeyOffset(text, ruleName, targetStep.rulesKeyOff);
  if (ruleOff < 0 || ruleOff >= targetStep.boundary) {
    return null;
  }

  return {
    keyStart: ruleOff + 1,
    keyEnd: ruleOff + 1 + ruleName.length,
  };
};

// ---------------------------------------------------------------------------
// findRuleKeyAtOffset
// ---------------------------------------------------------------------------

/**
 * Detects if `offset` falls on a rule definition key inside `transform.rules`.
 *
 * Example: cursor on `"based-on"` in `rules: { "based-on": [...] }`
 *          → { ruleName: "based-on", keyRange: { start, end } }
 */
export const findRuleKeyAtOffset = (text: string, offset: number): RuleKeyHit | null => {
  const obj = parseConfig(text);
  if (!obj) {
    return null;
  }

  const rawTransform = obj["transform"];
  if (rawTransform == null || typeof rawTransform !== "object") {
    return null;
  }

  const allSteps: unknown[] = Array.isArray(rawTransform)
    ? (rawTransform as unknown[])
    : [rawTransform];

  let searchFrom = 0;

  for (const step of allSteps) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      continue;
    }
    const rules = (step as Record<string, unknown>)["rules"];
    if (rules == null || typeof rules !== "object" || Array.isArray(rules)) {
      continue;
    }
    const rulesObj = rules as Record<string, unknown>;
    const rulesKeyOff = findKeyOffset(text, "rules", searchFrom);
    if (rulesKeyOff < 0) {
      continue;
    }

    const nextSearchFrom = rulesKeyOff + 7;
    const nextRulesOff = findKeyOffset(text, "rules", nextSearchFrom);
    const boundary = nextRulesOff >= 0 ? nextRulesOff : text.length;

    let ruleSearchFrom = rulesKeyOff;
    for (const name of Object.keys(rulesObj)) {
      const nameOff = findKeyOffset(text, name, ruleSearchFrom);
      if (nameOff < 0 || nameOff >= boundary) {
        if (nameOff >= 0) {
          ruleSearchFrom = nameOff + name.length + 3;
        }
        continue;
      }
      const keyStart = nameOff + 1;
      const keyEnd = nameOff + 1 + name.length;
      if (offset >= keyStart && offset <= keyEnd) {
        return { ruleName: name, keyRange: { start: keyStart, end: keyEnd } };
      }
      ruleSearchFrom = nameOff + name.length + 3;
    }

    searchFrom = nextSearchFrom;
  }

  return null;
};

// ---------------------------------------------------------------------------
// findAllApplyReferences
// ---------------------------------------------------------------------------

/**
 * Returns offset ranges for every `apply` / `apply-hops` call whose first
 * argument matches `ruleName`.
 *
 * Each range covers the rule name text (excluding surrounding quotes).
 */
export const findAllApplyReferences = (
  text: string,
  ruleName: string,
): Array<{ start: number; end: number }> => {
  const escaped = ruleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\["(?:apply-hops|apply)"\\s*,\\s*"(${escaped})"`, "g");
  const refs: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    // m[0] ends with `"ruleName"`, so the name content starts at:
    // m.index + m[0].length - ruleName.length - 1  (skip the closing ")
    const start = m.index + m[0].length - ruleName.length - 1;
    const end = start + ruleName.length;
    refs.push({ start, end });
  }
  return refs;
};
