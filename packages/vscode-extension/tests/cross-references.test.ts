import { describe, it, expect } from "vitest";

import { findAllCrossReferences } from "../server/src/utils/cross-references.utils";

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
