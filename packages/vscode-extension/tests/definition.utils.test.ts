import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import {
  findApplyRuleReference,
  findRuleDefinition,
  findRuleKeyAtOffset,
  findAllApplyReferences,
} from "../server/src/utils/definition.utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_DIR = path.join(__dirname, "mock");
const loadMock = (rel: string): string => fs.readFileSync(path.join(MOCK_DIR, rel), "utf-8");

// ---------------------------------------------------------------------------
// findApplyRuleReference
// ---------------------------------------------------------------------------

describe("findApplyRuleReference", () => {
  it("detects cursor inside 1st arg of apply", () => {
    //  ["apply", "based-on", "_S."]
    //  0123456789012345678901234567
    const text = `["apply", "based-on", "_S."]`;
    // cursor at 'b' inside "based-on"
    const offset = text.indexOf("based-on");
    const result = findApplyRuleReference(text, offset);
    expect(result).not.toBeNull();
    expect(result!.ruleName).toBe("based-on");
    expect(text.slice(result!.nameRange.start, result!.nameRange.end)).toBe("based-on");
  });

  it("detects cursor at end of 1st arg of apply", () => {
    const text = `["apply", "based-on", "_S."]`;
    // cursor just before closing quote of "based-on"
    const offset = text.indexOf("based-on") + "based-on".length;
    const result = findApplyRuleReference(text, offset);
    expect(result?.ruleName).toBe("based-on");
  });

  it("detects cursor inside 1st arg of apply-hops", () => {
    const text = `["apply-hops", "my-rule", {}]`;
    const offset = text.indexOf("my-rule");
    const result = findApplyRuleReference(text, offset);
    expect(result).not.toBeNull();
    expect(result!.ruleName).toBe("my-rule");
    expect(text.slice(result!.nameRange.start, result!.nameRange.end)).toBe("my-rule");
  });

  it("returns null when cursor is on function name 'apply'", () => {
    const text = `["apply", "based-on", "_S."]`;
    // cursor inside "apply" (not a rule arg)
    const offset = text.indexOf("apply") + 1;
    expect(findApplyRuleReference(text, offset)).toBeNull();
  });

  it("returns null when cursor is on a non-apply function name", () => {
    const text = `["add", "foo", "bar"]`;
    const offset = text.indexOf("add") + 1;
    expect(findApplyRuleReference(text, offset)).toBeNull();
  });

  it("returns null when cursor is on the 2nd arg (entity) of apply", () => {
    const text = `["apply", "based-on", "_S."]`;
    // cursor inside "_S."
    const offset = text.indexOf("_S.");
    expect(findApplyRuleReference(text, offset)).toBeNull();
  });

  it("returns null when cursor is outside any string", () => {
    const text = `["apply", "based-on", "_S."]`;
    // cursor after the closing bracket
    expect(findApplyRuleReference(text, text.length)).toBeNull();
  });

  it("works for nested apply calls", () => {
    const text = `["merge", ["apply", "my-sub-rule", "_S."]]`;
    const offset = text.indexOf("my-sub-rule");
    const result = findApplyRuleReference(text, offset);
    expect(result?.ruleName).toBe("my-sub-rule");
  });

  it("handles rule names with hyphens and numbers", () => {
    const text = `["apply", "1-history", "_S."]`;
    const offset = text.indexOf("1-history");
    const result = findApplyRuleReference(text, offset);
    expect(result?.ruleName).toBe("1-history");
  });
});

// ---------------------------------------------------------------------------
// findRuleDefinition
// ---------------------------------------------------------------------------

describe("findRuleDefinition", () => {
  describe("single transform (multi-rule.json)", () => {
    const text = loadMock("pipes/multi-rule.json");

    it("finds the 'default' rule definition", () => {
      const result = findRuleDefinition(text, "default", 0);
      expect(result).not.toBeNull();
      expect(text.slice(result!.keyStart, result!.keyEnd)).toBe("default");
    });

    it("finds the 'order-ref' rule definition", () => {
      const result = findRuleDefinition(text, "order-ref", 0);
      expect(result).not.toBeNull();
      expect(text.slice(result!.keyStart, result!.keyEnd)).toBe("order-ref");
    });

    it("returns null for a non-existent rule name", () => {
      const result = findRuleDefinition(text, "does-not-exist", 0);
      expect(result).toBeNull();
    });

    it("keyStart points to the opening character of the rule name", () => {
      const result = findRuleDefinition(text, "default", 0);
      // The character just before keyStart should be the opening quote
      expect(text[result!.keyStart - 1]).toBe('"');
    });
  });

  describe("complex transform (difi-enhetsregisteret-classification-enrich.json)", () => {
    const text = loadMock("pipes/difi-enhetsregisteret-classification-enrich.json");

    it("finds '1-history' rule", () => {
      const result = findRuleDefinition(text, "1-history", 0);
      expect(result).not.toBeNull();
      expect(text.slice(result!.keyStart, result!.keyEnd)).toBe("1-history");
    });

    it("finds 'add-merge' rule", () => {
      const result = findRuleDefinition(text, "add-merge", 0);
      expect(result).not.toBeNull();
      expect(text.slice(result!.keyStart, result!.keyEnd)).toBe("add-merge");
    });

    it("finds 'mappings' rule", () => {
      const result = findRuleDefinition(text, "mappings", 0);
      expect(result).not.toBeNull();
      expect(text.slice(result!.keyStart, result!.keyEnd)).toBe("mappings");
    });

    it("returns null for a non-existent rule name", () => {
      expect(findRuleDefinition(text, "non-existent-rule", 0)).toBeNull();
    });
  });

  describe("array transform (multi-transform.json)", () => {
    const text = loadMock("pipes/multi-transform.json");

    it("finds 'default' in step 1 when cursor is in step 1", () => {
      // Both steps have "default". Cursor in step 1's rules block.
      const rules1Off = text.indexOf('"rules"');
      const cursorInStep1 = rules1Off + 10;
      const result = findRuleDefinition(text, "default", cursorInStep1);
      expect(result).not.toBeNull();
      expect(text.slice(result!.keyStart, result!.keyEnd)).toBe("default");

      // Should point to step 1's "default" (first occurrence after "rules")
      const default1Off = text.indexOf('"default"', rules1Off);
      expect(result!.keyStart).toBe(default1Off + 1);
    });

    it("finds 'default' in step 2 when cursor is in step 2", () => {
      const rules1Off = text.indexOf('"rules"');
      const rules2Off = text.indexOf('"rules"', rules1Off + 7);
      const cursorInStep2 = rules2Off + 10;
      const result = findRuleDefinition(text, "default", cursorInStep2);
      expect(result).not.toBeNull();
      expect(text.slice(result!.keyStart, result!.keyEnd)).toBe("default");

      // Should point to step 2's "default"
      const default2Off = text.indexOf('"default"', rules2Off);
      expect(result!.keyStart).toBe(default2Off + 1);
    });

    it("step 1 and step 2 definitions point to different offsets", () => {
      const rules1Off = text.indexOf('"rules"');
      const rules2Off = text.indexOf('"rules"', rules1Off + 7);
      const res1 = findRuleDefinition(text, "default", rules1Off + 10);
      const res2 = findRuleDefinition(text, "default", rules2Off + 10);
      expect(res1!.keyStart).not.toBe(res2!.keyStart);
    });
  });

  it("returns null for invalid JSON", () => {
    expect(findRuleDefinition("not json", "default", 0)).toBeNull();
  });

  it("returns null for a config without transform", () => {
    const text = JSON.stringify({ _id: "no-transform", type: "pipe" });
    expect(findRuleDefinition(text, "default", 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findRuleKeyAtOffset
// ---------------------------------------------------------------------------

describe("findRuleKeyAtOffset", () => {
  describe("single transform (multi-rule.json)", () => {
    const text = loadMock("pipes/multi-rule.json");

    it("detects cursor on 'default' key in rules", () => {
      // Find the "default" key that is inside "rules"
      const rulesOff = text.indexOf('"rules"');
      const defaultOff = text.indexOf('"default"', rulesOff);
      // cursor right after the opening quote
      const result = findRuleKeyAtOffset(text, defaultOff + 1);
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe("default");
      expect(result!.keyRange.start).toBe(defaultOff + 1);
      expect(result!.keyRange.end).toBe(defaultOff + 1 + "default".length);
    });

    it("detects cursor on 'order-ref' key in rules", () => {
      const rulesOff = text.indexOf('"rules"');
      const orderRefOff = text.indexOf('"order-ref"', rulesOff);
      const result = findRuleKeyAtOffset(text, orderRefOff + 3);
      expect(result?.ruleName).toBe("order-ref");
    });

    it("returns null when cursor is on '_id' key (outside rules)", () => {
      const idOff = text.indexOf('"_id"');
      expect(findRuleKeyAtOffset(text, idOff + 1)).toBeNull();
    });

    it("returns null when cursor is on a value string", () => {
      // "multi-rule" is the value of _id, not a rule key
      const valueOff = text.indexOf('"multi-rule"');
      expect(findRuleKeyAtOffset(text, valueOff + 1)).toBeNull();
    });
  });

  describe("array transform (multi-transform.json)", () => {
    const text = loadMock("pipes/multi-transform.json");

    it("detects cursor on 'default' key in step 1", () => {
      const rules1Off = text.indexOf('"rules"');
      const default1Off = text.indexOf('"default"', rules1Off);
      const result = findRuleKeyAtOffset(text, default1Off + 1);
      expect(result?.ruleName).toBe("default");
      expect(result?.keyRange.start).toBe(default1Off + 1);
    });

    it("detects cursor on 'default' key in step 2", () => {
      const rules1Off = text.indexOf('"rules"');
      const rules2Off = text.indexOf('"rules"', rules1Off + 7);
      const default2Off = text.indexOf('"default"', rules2Off);
      const result = findRuleKeyAtOffset(text, default2Off + 1);
      expect(result?.ruleName).toBe("default");
      expect(result?.keyRange.start).toBe(default2Off + 1);
    });

    it("step 1 and step 2 'default' keys resolve to different positions", () => {
      const rules1Off = text.indexOf('"rules"');
      const default1Off = text.indexOf('"default"', rules1Off);
      const rules2Off = text.indexOf('"rules"', rules1Off + 7);
      const default2Off = text.indexOf('"default"', rules2Off);
      const res1 = findRuleKeyAtOffset(text, default1Off + 1);
      const res2 = findRuleKeyAtOffset(text, default2Off + 1);
      expect(res1!.keyRange.start).not.toBe(res2!.keyRange.start);
    });
  });

  it("returns null for invalid JSON", () => {
    expect(findRuleKeyAtOffset("not json", 0)).toBeNull();
  });

  it("returns null when there is no transform", () => {
    const text = JSON.stringify({ _id: "no-transform" });
    expect(findRuleKeyAtOffset(text, 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAllApplyReferences
// ---------------------------------------------------------------------------

describe("findAllApplyReferences", () => {
  it("finds a single apply reference", () => {
    const text = `{ "rules": { "default": [["apply", "my-rule", "_S."]] } }`;
    const refs = findAllApplyReferences(text, "my-rule");
    expect(refs).toHaveLength(1);
    expect(text.slice(refs[0].start, refs[0].end)).toBe("my-rule");
  });

  it("finds multiple apply references to the same rule", () => {
    const text = [
      `["apply", "shared", "_S.a"]`,
      `["apply", "shared", "_S.b"]`,
      `["apply", "shared", "_S.c"]`,
    ].join("\n");
    const refs = findAllApplyReferences(text, "shared");
    expect(refs).toHaveLength(3);
    refs.forEach((r) => expect(text.slice(r.start, r.end)).toBe("shared"));
  });

  it("finds apply-hops references", () => {
    const text = `["apply-hops", "mappings", { "datasets": ["t"] }]`;
    const refs = findAllApplyReferences(text, "mappings");
    expect(refs).toHaveLength(1);
    expect(text.slice(refs[0].start, refs[0].end)).toBe("mappings");
  });

  it("finds mixed apply and apply-hops references", () => {
    const text = [`["apply-hops", "my-rule", {}]`, `["apply", "my-rule", "_S."]`].join("\n");
    const refs = findAllApplyReferences(text, "my-rule");
    expect(refs).toHaveLength(2);
    refs.forEach((r) => expect(text.slice(r.start, r.end)).toBe("my-rule"));
  });

  it("returns empty array when no references exist", () => {
    const text = `["add", "foo", "bar"]`;
    expect(findAllApplyReferences(text, "non-existent")).toHaveLength(0);
  });

  it("does not match partial rule name substrings", () => {
    const text = `["apply", "rule", "_S."] ["apply", "my-rule", "_S."]`;
    expect(findAllApplyReferences(text, "rule")).toHaveLength(1);
    expect(findAllApplyReferences(text, "my-rule")).toHaveLength(1);
  });

  it("does not match the 2nd arg of apply", () => {
    // "_S." is the entity arg, not the rule name
    const text = `["apply", "based-on", "_S."]`;
    expect(findAllApplyReferences(text, "_S.")).toHaveLength(0);
  });

  describe("complex fixture (difi-enhetsregisteret-classification-enrich.json)", () => {
    const text = loadMock("pipes/difi-enhetsregisteret-classification-enrich.json");

    it("finds 12 apply references to '1-history' (definition key excluded)", () => {
      const refs = findAllApplyReferences(text, "1-history");
      expect(refs).toHaveLength(12);
      refs.forEach((r) => expect(text.slice(r.start, r.end)).toBe("1-history"));
    });

    it("finds 4 apply references to 'add-merge' (definition key excluded)", () => {
      const refs = findAllApplyReferences(text, "add-merge");
      expect(refs).toHaveLength(4);
      refs.forEach((r) => expect(text.slice(r.start, r.end)).toBe("add-merge"));
    });

    it("finds all 3 apply-hops references to 'mappings'", () => {
      const refs = findAllApplyReferences(text, "mappings");
      expect(refs).toHaveLength(3);
      refs.forEach((r) => expect(text.slice(r.start, r.end)).toBe("mappings"));
    });

    it("finds apply references to 'match-dict'", () => {
      const refs = findAllApplyReferences(text, "match-dict");
      refs.forEach((r) => expect(text.slice(r.start, r.end)).toBe("match-dict"));
      expect(refs.length).toBeGreaterThan(0);
    });
  });
});
