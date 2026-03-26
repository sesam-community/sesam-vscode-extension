import { describe, it, expect } from "vitest";

import {
  findApplyRuleReference,
  findRuleKeyAtOffset,
  findRuleDefinition,
  findAllApplyReferences,
} from "../server/src/utils/definition.utils";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const PIPE = `{
  "_id": "my-pipe",
  "type": "pipe",
  "source": { "type": "dataset", "dataset": "input" },
  "transform": {
    "type": "dtl",
    "rules": {
      "default": [
        ["copy", "*"],
        ["apply", "enrich", "_S."],
        ["apply-hops", "enrich", { "datasets": ["other O"], "where": [] }]
      ],
      "enrich": [
        ["add", "foo", "_S.bar"]
      ]
    }
  }
}`;

// ---------------------------------------------------------------------------
// findRuleKeyAtOffset — detects cursor on a rule KEY definition
// ---------------------------------------------------------------------------

describe("findRuleKeyAtOffset", () => {
  it("detects cursor on the 'default' rule key", () => {
    const offset = PIPE.indexOf('"default"') + 1;
    const hit = findRuleKeyAtOffset(PIPE, offset);
    expect(hit).not.toBeNull();
    expect(hit!.ruleName).toBe("default");
  });

  it("detects cursor on the 'enrich' rule key", () => {
    // The second occurrence of "enrich" is the rule key; first is in apply.
    const keyIdx = PIPE.lastIndexOf('"enrich"');
    const hit = findRuleKeyAtOffset(PIPE, keyIdx + 1);
    expect(hit).not.toBeNull();
    expect(hit!.ruleName).toBe("enrich");
  });

  it("returns null when cursor is inside an apply call (not a key)", () => {
    const applyIdx = PIPE.indexOf('"enrich"');
    const hit = findRuleKeyAtOffset(PIPE, applyIdx + 1);
    expect(hit).toBeNull();
  });

  it("returns range that covers only the key text", () => {
    const keyIdx = PIPE.lastIndexOf('"enrich"');
    const hit = findRuleKeyAtOffset(PIPE, keyIdx + 1);
    expect(PIPE.slice(hit!.keyRange.start, hit!.keyRange.end)).toBe("enrich");
  });
});

// ---------------------------------------------------------------------------
// findApplyRuleReference — detects cursor inside apply / apply-hops arg
// ---------------------------------------------------------------------------

describe("findApplyRuleReference — rule rename context", () => {
  it("detects cursor on enrich inside apply call", () => {
    const offset = PIPE.indexOf('"enrich"');
    const hit = findApplyRuleReference(PIPE, offset + 1);
    expect(hit).not.toBeNull();
    expect(hit!.ruleName).toBe("enrich");
  });

  it("detects cursor on enrich inside apply-hops call", () => {
    const offset = PIPE.indexOf('"enrich"', PIPE.indexOf("apply-hops"));
    const hit = findApplyRuleReference(PIPE, offset + 1);
    expect(hit).not.toBeNull();
    expect(hit!.ruleName).toBe("enrich");
  });
});

// ---------------------------------------------------------------------------
// findAllApplyReferences — collects every apply / apply-hops use of a rule
// ---------------------------------------------------------------------------

describe("findAllApplyReferences", () => {
  it("finds both apply and apply-hops references to 'enrich'", () => {
    const refs = findAllApplyReferences(PIPE, "enrich");
    expect(refs).toHaveLength(2);
    refs.forEach((r) => expect(PIPE.slice(r.start, r.end)).toBe("enrich"));
  });

  it("returns empty array for a rule that is never applied", () => {
    const refs = findAllApplyReferences(PIPE, "default");
    expect(refs).toHaveLength(0);
  });

  it("returns empty array for an unknown rule name", () => {
    expect(findAllApplyReferences(PIPE, "nonexistent")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findRuleDefinition — locates the key in rules{}
// ---------------------------------------------------------------------------

describe("findRuleDefinition", () => {
  it("finds the definition of 'enrich'", () => {
    const offset = PIPE.lastIndexOf('"enrich"') + 1;
    const def = findRuleDefinition(PIPE, "enrich", offset);
    expect(def).not.toBeNull();
    expect(PIPE.slice(def!.keyStart, def!.keyEnd)).toBe("enrich");
  });

  it("finds the definition of 'default'", () => {
    const offset = PIPE.indexOf('"default"') + 1;
    const def = findRuleDefinition(PIPE, "default", offset);
    expect(def).not.toBeNull();
    expect(PIPE.slice(def!.keyStart, def!.keyEnd)).toBe("default");
  });

  it("returns null for an unknown rule", () => {
    expect(findRuleDefinition(PIPE, "nonexistent", 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full rename simulation: key + all apply references updated
// ---------------------------------------------------------------------------

describe("rule rename — full edit simulation", () => {
  const applyNewName = (text: string, ruleName: string, newName: string): string => {
    const def = findRuleDefinition(text, ruleName, text.lastIndexOf(`"${ruleName}"`));
    const refs = findAllApplyReferences(text, ruleName);

    // Build list of all [start, end] ranges in reverse order to preserve offsets.
    type Span = { start: number; end: number };
    const allSpans: Span[] = [];

    if (def) {
      allSpans.push({ start: def.keyStart, end: def.keyEnd });
    }

    allSpans.push(...refs);
    allSpans.sort((a, b) => b.start - a.start);

    let result = text;

    for (const span of allSpans) {
      result = result.slice(0, span.start) + newName + result.slice(span.end);
    }

    return result;
  };

  it("renames 'enrich' to 'augment' everywhere in the file", () => {
    const updated = applyNewName(PIPE, "enrich", "augment");
    expect(updated).toContain('"augment"');
    expect(updated).not.toContain('"enrich"');
    // Both apply and apply-hops updated
    expect(updated).toContain('["apply", "augment"');
    expect(updated).toContain('["apply-hops", "augment"');
    // Key definition updated
    expect(updated).toContain('"augment": [');
  });

  it("renames 'default' to 'main' — no apply refs, only key updated", () => {
    const updated = applyNewName(PIPE, "default", "main");
    expect(updated).toContain('"main": [');
    expect(updated).not.toContain('"default": [');
  });
});
