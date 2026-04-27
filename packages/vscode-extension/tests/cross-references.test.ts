import { describe, it, expect } from "vitest";

import {
  findAllCrossReferences,
  findAllDatasetCrossRefs,
  findAllSystemCrossRefs,
} from "../server/src/utils/cross-references.utils";

// ---------------------------------------------------------------------------
// findAllCrossReferences
// ---------------------------------------------------------------------------

describe("findAllCrossReferences", () => {
  it("finds a dataset reference", () => {
    const fileTexts = new Map([
      ["file:///a.json", `{"_id": "consumer", "source": {"dataset": "producer"}}`],
    ]);
    const refs = findAllCrossReferences("producer", fileTexts);
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe("file:///a.json");
  });

  it("finds a system reference", () => {
    const fileTexts = new Map([
      ["file:///b.json", `{"_id": "pipe", "source": {"type": "rest", "system": "my-sys"}}`],
    ]);
    const refs = findAllCrossReferences("my-sys", fileTexts);
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe("file:///b.json");
  });

  it("finds an unaliased datasets array item", () => {
    const fileTexts = new Map([["file:///c.json", `{"datasets": ["lookup-pipe"]}`]]);
    const refs = findAllCrossReferences("lookup-pipe", fileTexts);
    expect(refs).toHaveLength(1);
  });

  it("finds an aliased datasets array item", () => {
    const fileTexts = new Map([["file:///d.json", `{"datasets": ["lookup-pipe lp"]}`]]);
    const refs = findAllCrossReferences("lookup-pipe", fileTexts);
    expect(refs).toHaveLength(1);
  });

  it("finds references across multiple files", () => {
    const fileTexts = new Map([
      ["file:///p1.json", `{"source": {"dataset": "shared-source"}}`],
      ["file:///p2.json", `{"source": {"dataset": "shared-source"}}`],
      ["file:///p3.json", `{"source": {"dataset": "other-source"}}`],
    ]);
    const refs = findAllCrossReferences("shared-source", fileTexts);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.uri)).toContain("file:///p1.json");
    expect(refs.map((r) => r.uri)).toContain("file:///p2.json");
  });

  it("returns empty array when no references exist", () => {
    const fileTexts = new Map([
      ["file:///noop.json", `{"_id": "no-refs", "source": {"dataset": "something-else"}}`],
    ]);
    const refs = findAllCrossReferences("non-existent", fileTexts);
    expect(refs).toHaveLength(0);
  });

  it("nameStart points to the first character of the matched name", () => {
    const text = `{"source": {"dataset": "producer"}}`;
    const fileTexts = new Map([["file:///x.json", text]]);
    const refs = findAllCrossReferences("producer", fileTexts);
    expect(refs).toHaveLength(1);
    const { nameStart, nameEnd } = refs[0];
    expect(text.slice(nameStart, nameEnd)).toBe("producer");
  });

  it("does not confuse dataset 'foo' with 'foobar'", () => {
    const fileTexts = new Map([["file:///e.json", `{"source": {"dataset": "foobar"}}`]]);
    const refs = findAllCrossReferences("foo", fileTexts);
    expect(refs).toHaveLength(0);
  });

  it("finds both dataset and system references to the same id", () => {
    // A system id used as both system and dataset reference (unlikely but valid to test)
    const fileTexts = new Map([
      ["file:///f.json", `{"source": {"dataset": "shared-id"}}`],
      ["file:///g.json", `{"source": {"system": "shared-id"}}`],
    ]);
    const refs = findAllCrossReferences("shared-id", fileTexts);
    expect(refs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// findAllDatasetCrossRefs
// ---------------------------------------------------------------------------

describe("findAllDatasetCrossRefs", () => {
  it("finds a plain dataset reference in another file", () => {
    const fileTexts = new Map([
      ["file:///target.json", `{"_id": "my-pipe"}`],
      ["file:///consumer.json", `{"source": {"dataset": "my-pipe"}}`],
    ]);
    const refs = findAllDatasetCrossRefs("my-pipe", fileTexts, "file:///target.json");
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe("file:///consumer.json");
  });

  it("excludes the target file itself", () => {
    const fileTexts = new Map([["file:///target.json", `{"source": {"dataset": "my-pipe"}}`]]);
    const refs = findAllDatasetCrossRefs("my-pipe", fileTexts, "file:///target.json");
    expect(refs).toHaveLength(0);
  });

  it("finds a datasets array item with a hyphenated alias", () => {
    const text = `{"datasets": ["my-pipe-enrich my-pipe-alias"]}`;
    const fileTexts = new Map([["file:///merge.json", text]]);
    const refs = findAllDatasetCrossRefs("my-pipe-enrich", fileTexts, "file:///other.json");
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe("file:///merge.json");
    expect(text.slice(refs[0].nameStart, refs[0].nameEnd)).toBe("my-pipe-enrich");
  });

  it("finds datasets array item with long hyphenated real-world alias", () => {
    const text = `{"datasets": ["difi-enhetsregisteret-classification-enrich difi-enhetsregisteret-classification", "other-pipe other-alias"]}`;
    const fileTexts = new Map([["file:///global.json", text]]);
    const refs = findAllDatasetCrossRefs(
      "difi-enhetsregisteret-classification-enrich",
      fileTexts,
      "file:///difi.json",
    );
    expect(refs).toHaveLength(1);
    expect(text.slice(refs[0].nameStart, refs[0].nameEnd)).toBe(
      "difi-enhetsregisteret-classification-enrich",
    );
  });

  it("does not match a dataset ref to a system reference", () => {
    const fileTexts = new Map([["file:///s.json", `{"source": {"system": "my-pipe"}}`]]);
    const refs = findAllDatasetCrossRefs("my-pipe", fileTexts, "file:///other.json");
    expect(refs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findAllSystemCrossRefs
// ---------------------------------------------------------------------------

describe("findAllSystemCrossRefs", () => {
  it("finds a system reference by id", () => {
    const fileTexts = new Map([
      ["file:///a.json", `{"source": {"type": "rest", "system": "my-sys"}}`],
    ]);
    const refs = findAllSystemCrossRefs("my-sys", fileTexts);
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe("file:///a.json");
  });

  it("nameStart/nameEnd point to the system id in the source text", () => {
    const text = `{"source": {"system": "target-sys"}}`;
    const fileTexts = new Map([["file:///b.json", text]]);
    const refs = findAllSystemCrossRefs("target-sys", fileTexts);
    expect(refs).toHaveLength(1);
    expect(text.slice(refs[0].nameStart, refs[0].nameEnd)).toBe("target-sys");
  });

  it("finds multiple occurrences in one file", () => {
    const text = `{"a": {"system": "s1"}, "b": {"system": "s1"}}`;
    const fileTexts = new Map([["file:///c.json", text]]);
    const refs = findAllSystemCrossRefs("s1", fileTexts);
    expect(refs).toHaveLength(2);
  });

  it("finds references across multiple files", () => {
    const fileTexts = new Map([
      ["file:///p1.json", `{"source": {"system": "shared-sys"}}`],
      ["file:///p2.json", `{"source": {"system": "shared-sys"}}`],
      ["file:///p3.json", `{"source": {"system": "other-sys"}}`],
    ]);
    const refs = findAllSystemCrossRefs("shared-sys", fileTexts);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.uri)).toContain("file:///p1.json");
    expect(refs.map((r) => r.uri)).toContain("file:///p2.json");
  });

  it("returns empty array when no system references exist", () => {
    const fileTexts = new Map([["file:///d.json", `{"source": {"dataset": "ds"}}`]]);
    expect(findAllSystemCrossRefs("any-sys", fileTexts)).toHaveLength(0);
  });

  it("does not confuse 'sys' with 'sys-extra'", () => {
    const fileTexts = new Map([["file:///e.json", `{"source": {"system": "sys-extra"}}`]]);
    expect(findAllSystemCrossRefs("sys", fileTexts)).toHaveLength(0);
  });
});
