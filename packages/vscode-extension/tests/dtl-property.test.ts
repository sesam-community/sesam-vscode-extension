import { describe, it, expect } from "vitest";

import {
  findAddPropertyAtOffset,
  findAllAddPropertyDefinitions,
  collectDocumentProperties,
} from "../server/src/utils/dtl-property.utils";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const PIPE = `{
  "_id": "my-pipe",
  "type": "pipe",
  "source": { "type": "embedded", "entities": [] },
  "transform": {
    "type": "dtl",
    "rules": {
      "default": [
        ["add", "name", "_S.full_name"],
        ["add-if", "age", "_S.dob"],
        ["add", "name", "_S.alternate_name"]
      ],
      "my-rule": [
        ["add", "label", "_S.foo"]
      ]
    }
  }
}`;

// ---------------------------------------------------------------------------
// findAddPropertyAtOffset
// ---------------------------------------------------------------------------

describe("findAddPropertyAtOffset", () => {
  it("detects 'name' in first add call", () => {
    const idx = PIPE.indexOf('"name"', PIPE.indexOf('"add"'));
    const result = findAddPropertyAtOffset(PIPE, idx + 1);
    expect(result).not.toBeNull();
    expect(result!.propName).toBe("name");
    expect(PIPE.slice(result!.nameStart, result!.nameEnd)).toBe("name");
  });

  it("detects 'age' in add-if call", () => {
    const addIfIdx = PIPE.indexOf('"add-if"');
    const ageIdx = PIPE.indexOf('"age"', addIfIdx);
    const result = findAddPropertyAtOffset(PIPE, ageIdx + 1);
    expect(result).not.toBeNull();
    expect(result!.propName).toBe("age");
  });

  it("detects 'label' in secondary rule", () => {
    const labelIdx = PIPE.indexOf('"label"');
    const result = findAddPropertyAtOffset(PIPE, labelIdx + 1);
    expect(result).not.toBeNull();
    expect(result!.propName).toBe("label");
  });

  it("returns null when cursor is on 'add' function name", () => {
    const addIdx = PIPE.indexOf('"add"');
    const result = findAddPropertyAtOffset(PIPE, addIdx + 1);
    expect(result).toBeNull();
  });

  it("returns null when cursor is on _S.full_name (third arg)", () => {
    const idx = PIPE.indexOf('"_S.full_name"');
    const result = findAddPropertyAtOffset(PIPE, idx + 1);
    expect(result).toBeNull();
  });

  it("returns null when cursor is on a rule name key", () => {
    const idx = PIPE.indexOf('"default"');
    const result = findAddPropertyAtOffset(PIPE, idx + 1);
    expect(result).toBeNull();
  });

  it("returns null for arbitrary JSON string (not inside add/add-if)", () => {
    const idx = PIPE.indexOf('"my-pipe"');
    const result = findAddPropertyAtOffset(PIPE, idx + 1);
    expect(result).toBeNull();
  });

  it("detects 'name' when cursor is exactly on the opening quote", () => {
    const idx = PIPE.indexOf('"name"', PIPE.indexOf('"add"'));
    // idx is the position of the opening `"` — the edge case we fixed
    const result = findAddPropertyAtOffset(PIPE, idx);
    expect(result).not.toBeNull();
    expect(result!.propName).toBe("name");
  });

  it("detects 'name' when cursor is on the closing quote", () => {
    const openIdx = PIPE.indexOf('"name"', PIPE.indexOf('"add"'));
    const closeIdx = openIdx + 5; // `"name"` — closing `"` is at openIdx + 5
    const result = findAddPropertyAtOffset(PIPE, closeIdx);
    expect(result).not.toBeNull();
    expect(result!.propName).toBe("name");
  });

  it("detects 'age' when cursor is exactly on the opening quote", () => {
    const addIfIdx = PIPE.indexOf('"add-if"');
    const ageIdx = PIPE.indexOf('"age"', addIfIdx);
    const result = findAddPropertyAtOffset(PIPE, ageIdx);
    expect(result).not.toBeNull();
    expect(result!.propName).toBe("age");
  });
});

// ---------------------------------------------------------------------------
// findAllAddPropertyDefinitions
// ---------------------------------------------------------------------------

describe("findAllAddPropertyDefinitions", () => {
  it("finds all 'name' definitions (two add calls)", () => {
    const refs = findAllAddPropertyDefinitions(PIPE, "name");
    expect(refs).toHaveLength(2);
    refs.forEach(({ start, end }) => {
      expect(PIPE.slice(start, end)).toBe("name");
    });
  });

  it("finds single 'age' add-if definition", () => {
    const refs = findAllAddPropertyDefinitions(PIPE, "age");
    expect(refs).toHaveLength(1);
    expect(PIPE.slice(refs[0].start, refs[0].end)).toBe("age");
  });

  it("finds single 'label' definition in secondary rule", () => {
    const refs = findAllAddPropertyDefinitions(PIPE, "label");
    expect(refs).toHaveLength(1);
  });

  it("returns empty for unknown property", () => {
    const refs = findAllAddPropertyDefinitions(PIPE, "does-not-exist");
    expect(refs).toHaveLength(0);
  });

  it("does not confuse 'name' with 'full_name'", () => {
    const refs = findAllAddPropertyDefinitions(PIPE, "full_name");
    expect(refs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectDocumentProperties
// ---------------------------------------------------------------------------

describe("collectDocumentProperties", () => {
  it("returns deduplicated list — 'name' appears only once", () => {
    const props = collectDocumentProperties(PIPE);
    const names = props.map((p) => p.propName);
    expect(names.filter((n) => n === "name")).toHaveLength(1);
  });

  it("contains age and label", () => {
    const props = collectDocumentProperties(PIPE);
    const names = props.map((p) => p.propName);
    expect(names).toContain("age");
    expect(names).toContain("label");
  });

  it("offset points to the content of the first definition", () => {
    const props = collectDocumentProperties(PIPE);
    const nameProp = props.find((p) => p.propName === "name")!;
    expect(PIPE.slice(nameProp.start, nameProp.end)).toBe("name");
  });

  it("returns empty array for text with no add/add-if", () => {
    const text = `{"_id": "dummy", "type": "pipe", "source": {"type": "empty"}}`;
    expect(collectDocumentProperties(text)).toHaveLength(0);
  });
});
