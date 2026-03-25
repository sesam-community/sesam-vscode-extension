import { describe, it, expect } from "vitest";

import { collectDocumentLinks } from "../server/src/utils/document-links.utils";

import type { IndexEntry } from "../server/src/utils/workspace-index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const entry = (uri: string): IndexEntry => ({ uri, idOffset: 8 });

// ---------------------------------------------------------------------------
// collectDocumentLinks
// ---------------------------------------------------------------------------

describe("collectDocumentLinks", () => {
  it("creates a link for a single dataset reference", () => {
    const text = `{"_id": "consumer", "source": {"type": "dataset", "dataset": "producer"}}`;
    const pipeIndex = new Map([["producer", entry("file:///pipes/producer.json")]]);
    const links = collectDocumentLinks(text, pipeIndex, new Map());
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("file:///pipes/producer.json");
  });

  it("creates a link for a system reference", () => {
    const text = `{"_id": "my-pipe", "source": {"type": "rest", "system": "hr-system"}}`;
    const systemIndex = new Map([["hr-system", entry("file:///systems/hr-system.json")]]);
    const links = collectDocumentLinks(text, new Map(), systemIndex);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("file:///systems/hr-system.json");
  });

  it("creates links for datasets array items", () => {
    const text = `{"datasets": ["lookup-a", "lookup-b"]}`;
    const pipeIndex = new Map([
      ["lookup-a", entry("file:///pipes/lookup-a.json")],
      ["lookup-b", entry("file:///pipes/lookup-b.json")],
    ]);
    const links = collectDocumentLinks(text, pipeIndex, new Map());
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.target)).toContain("file:///pipes/lookup-a.json");
    expect(links.map((l) => l.target)).toContain("file:///pipes/lookup-b.json");
  });

  it("strips alias when creating link for datasets array item", () => {
    const text = `{"datasets": ["lookup-a la", "lookup-b"]}`;
    const pipeIndex = new Map([
      ["lookup-a", entry("file:///pipes/lookup-a.json")],
      ["lookup-b", entry("file:///pipes/lookup-b.json")],
    ]);
    const links = collectDocumentLinks(text, pipeIndex, new Map());
    expect(links).toHaveLength(2);
    expect(links[0].target).toBe("file:///pipes/lookup-a.json");
  });

  it("does not create a link for an unresolved dataset", () => {
    const text = `{"source": {"dataset": "unknown-pipe"}}`;
    const links = collectDocumentLinks(text, new Map(), new Map());
    expect(links).toHaveLength(0);
  });

  it("does not create a link for an unresolved system", () => {
    const text = `{"source": {"system": "unknown-system"}}`;
    const links = collectDocumentLinks(text, new Map(), new Map());
    expect(links).toHaveLength(0);
  });

  it("creates multiple links in one document", () => {
    const text = [
      `{`,
      `  "_id": "person-enrich",`,
      `  "source": {"type": "dataset", "dataset": "person-collect"},`,
      `  "transform": {"type": "dtl", "rules": {"default": [`,
      `    ["hops", {"datasets": ["address-lookup al"]}]`,
      `  ]}}`,
      `}`,
    ].join("\n");

    const pipeIndex = new Map([
      ["person-collect", entry("file:///pipes/person-collect.json")],
      ["address-lookup", entry("file:///pipes/address-lookup.json")],
    ]);
    const links = collectDocumentLinks(text, pipeIndex, new Map());
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.target)).toContain("file:///pipes/person-collect.json");
    expect(links.map((l) => l.target)).toContain("file:///pipes/address-lookup.json");
  });

  it("creates a link for a system reference in a rest-transform step", () => {
    const text = JSON.stringify({
      _id: "wikidata-collect",
      transform: [
        { type: "dtl", rules: {} },
        { type: "rest", system: "wikidata", trace: true },
        { type: "dtl", rules: {} },
      ],
    });

    const systemIndex = new Map([["wikidata", entry("file:///systems/wikidata.json")]]);
    const links = collectDocumentLinks(text, new Map(), systemIndex);

    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("file:///systems/wikidata.json");
  });

  it("link range points to the correct position in the document", () => {
    // Layout: {"dataset": "abc"}
    //          0123456789012345678
    // "abc" starts at char 12 (after the opening quote)
    const text = `{"dataset": "abc"}`;
    const pipeIndex = new Map([["abc", entry("file:///pipes/abc.json")]]);
    const links = collectDocumentLinks(text, pipeIndex, new Map());
    expect(links).toHaveLength(1);
    // All on line 0
    expect(links[0].range.start.line).toBe(0);
    expect(links[0].range.end.line).toBe(0);
    // Start should be right after the opening quote of "abc"
    const expectedStart = text.indexOf('"abc"') + 1;
    expect(links[0].range.start.character).toBe(expectedStart);
    expect(links[0].range.end.character).toBe(expectedStart + 3);
  });
});
