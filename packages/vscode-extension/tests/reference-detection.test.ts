import { describe, it, expect } from "vitest";

import {
  findDatasetReference,
  findSystemReference,
  findIdAtOffset,
} from "../server/src/utils/reference-detection.utils";

// ---------------------------------------------------------------------------
// findDatasetReference
// ---------------------------------------------------------------------------

describe("findDatasetReference", () => {
  it("detects a single dataset key value", () => {
    const text = `{"source": {"type": "dataset", "dataset": "person-collect"}}`;
    const offset = text.indexOf("person-collect") + 3;
    const result = findDatasetReference(text, offset);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("person-collect");
    expect(result!.range.start).toBe(text.indexOf("person-collect"));
    expect(result!.range.end).toBe(text.indexOf("person-collect") + "person-collect".length);
  });

  it("detects a datasets array element without alias", () => {
    const text = `{"datasets": ["lookup-pipe"]}`;
    const offset = text.indexOf("lookup-pipe") + 3;
    const result = findDatasetReference(text, offset);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("lookup-pipe");
  });

  it("detects a datasets array element and strips alias", () => {
    const text = `{"datasets": ["addr-lookup a"]}`;
    const offset = text.indexOf("addr-lookup") + 3;
    const result = findDatasetReference(text, offset);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("addr-lookup");
    // range covers only the name, not " a"
    expect(result!.range.end - result!.range.start).toBe("addr-lookup".length);
  });

  it("detects second element in datasets array", () => {
    const text = `{"datasets": ["first-pipe fp", "second-pipe"]}`;
    const offset = text.indexOf("second-pipe") + 3;
    const result = findDatasetReference(text, offset);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("second-pipe");
  });

  it("returns null for DTL function name", () => {
    const text = `["add", "foo", "bar"]`;
    const offset = text.indexOf("foo") + 1;
    expect(findDatasetReference(text, offset)).toBeNull();
  });

  it("returns null for _id value", () => {
    const text = `{"_id": "my-pipe", "source": {"type": "dataset", "dataset": "other"}}`;
    const offset = text.indexOf("my-pipe") + 3;
    expect(findDatasetReference(text, offset)).toBeNull();
  });

  it("returns null when cursor is outside any string", () => {
    const text = `{"dataset": "foo"}`;
    // cursor on the colon between key and value
    const offset = text.indexOf(":") + 1;
    expect(findDatasetReference(text, offset)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findSystemReference
// ---------------------------------------------------------------------------

describe("findSystemReference", () => {
  it("detects a system key value", () => {
    const text = `{"source": {"type": "rest", "system": "hr-system"}}`;
    const offset = text.indexOf("hr-system") + 3;
    const result = findSystemReference(text, offset);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("hr-system");
    expect(result!.range.start).toBe(text.indexOf("hr-system"));
    expect(result!.range.end).toBe(text.indexOf("hr-system") + "hr-system".length);
  });

  it("detects a system key value inside a rest-transform step", () => {
    const text = `{"transform": [{"type": "rest", "system": "wikidata"}]}`;
    const offset = text.indexOf("wikidata") + 3;
    const result = findSystemReference(text, offset);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("wikidata");
  });

  it("returns null for a dataset key value", () => {
    const text = `{"dataset": "some-pipe"}`;
    const offset = text.indexOf("some-pipe") + 3;
    expect(findSystemReference(text, offset)).toBeNull();
  });

  it("returns null for _id value", () => {
    const text = `{"_id": "my-system", "type": "system"}`;
    const offset = text.indexOf("my-system") + 3;
    expect(findSystemReference(text, offset)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findIdAtOffset
// ---------------------------------------------------------------------------

describe("findIdAtOffset", () => {
  it("detects the _id value", () => {
    const text = `{"_id": "my-pipe", "type": "pipe"}`;
    const offset = text.indexOf("my-pipe") + 3;
    const result = findIdAtOffset(text, offset);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-pipe");
    expect(result!.range.start).toBe(text.indexOf("my-pipe"));
    expect(result!.range.end).toBe(text.indexOf("my-pipe") + "my-pipe".length);
  });

  it("returns null when cursor is on type value", () => {
    const text = `{"_id": "my-pipe", "type": "pipe"}`;
    // cursor on "pipe" value (type field, not _id)
    const offset = text.lastIndexOf("pipe") + 1;
    expect(findIdAtOffset(text, offset)).toBeNull();
  });

  it("returns null when cursor is on the _id key itself", () => {
    const text = `{"_id": "my-pipe"}`;
    // cursor on "_id" key
    const offset = text.indexOf("_id") + 1;
    expect(findIdAtOffset(text, offset)).toBeNull();
  });

  it("works for system configs", () => {
    const text = `{"_id": "oracle-db", "type": "system:oracle"}`;
    const offset = text.indexOf("oracle-db") + 3;
    const result = findIdAtOffset(text, offset);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("oracle-db");
  });
});
