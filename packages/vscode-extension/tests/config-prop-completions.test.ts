import { describe, it, expect } from "vitest";

import { CompletionItemKind, InsertTextFormat } from "vscode-languageserver/node";

import {
  isPropKeyContext,
  getPropKeyContext,
  getConfigFileType,
  buildPropCompletions,
} from "../server/src/utils/server.utils";

// ---------------------------------------------------------------------------
// isPropKeyContext
// ---------------------------------------------------------------------------

describe("isPropKeyContext", () => {
  it("returns true when cursor is after opening brace and quote", () => {
    expect(isPropKeyContext('{"')).toBe(true);
  });

  it("returns true when cursor is after comma and quote", () => {
    expect(isPropKeyContext('{"_id":"x","')).toBe(true);
  });

  it("returns true for partial key typed so far (quoted)", () => {
    expect(isPropKeyContext('{"_i')).toBe(true);
  });

  it("returns true for unquoted word after opening brace", () => {
    expect(isPropKeyContext("{_id")).toBe(true);
  });

  it("returns true for unquoted word after comma", () => {
    expect(isPropKeyContext('{"_id":"x",type')).toBe(true);
  });

  it("returns true for unquoted word with whitespace after brace", () => {
    expect(isPropKeyContext("{\n  source")).toBe(true);
  });

  it("returns false when cursor is inside a value string", () => {
    expect(isPropKeyContext('{"type":"pip')).toBe(false);
  });

  it("returns false when cursor is after colon (value position)", () => {
    expect(isPropKeyContext('{"type":')).toBe(false);
  });

  it("returns false for empty prefix", () => {
    expect(isPropKeyContext("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getConfigFileType
// ---------------------------------------------------------------------------

describe("getConfigFileType", () => {
  it("detects .conf.pipe", () => {
    expect(getConfigFileType("file:///pipes/my-pipe.conf.pipe")).toBe("pipe");
  });

  it("detects .conf.system", () => {
    expect(getConfigFileType("file:///systems/my-system.conf.system")).toBe("system");
  });

  it("detects node-metadata.conf.json", () => {
    expect(getConfigFileType("file:///node-metadata.conf.json")).toBe("node-metadata");
  });

  it("returns unknown for other .conf.json files", () => {
    expect(getConfigFileType("file:///other.conf.json")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// getPropKeyContext
// ---------------------------------------------------------------------------

describe("getPropKeyContext", () => {
  it("returns root path for empty object", () => {
    const ctx = getPropKeyContext('{"');
    expect(ctx).not.toBeNull();
    expect(ctx!.path).toEqual([]);
  });

  it("returns nested path inside source object", () => {
    const ctx = getPropKeyContext('{"source":{"');
    expect(ctx).not.toBeNull();
    expect(ctx!.path).toEqual(["source"]);
  });

  it("returns nested path inside transform object", () => {
    const ctx = getPropKeyContext('{"transform":{"');
    expect(ctx!.path).toEqual(["transform"]);
  });

  it("returns nested path inside sink object", () => {
    const ctx = getPropKeyContext('{"sink":{"');
    expect(ctx!.path).toEqual(["sink"]);
  });

  it("returns nested path inside pump object", () => {
    const ctx = getPropKeyContext('{"pump":{"');
    expect(ctx!.path).toEqual(["pump"]);
  });

  it("returns null when cursor is at value position", () => {
    expect(getPropKeyContext('{"type":"')).toBeNull();
  });

  it("excludes already-present keys from presentKeys", () => {
    const ctx = getPropKeyContext('{"_id":"x","');
    expect(ctx).not.toBeNull();
    expect(ctx!.presentKeys.has("_id")).toBe(true);
  });

  it("does not exclude partial key being typed", () => {
    const ctx = getPropKeyContext('{"_id":"x","ty');
    expect(ctx).not.toBeNull();
    // "ty" is the key being typed — should NOT be in presentKeys
    expect(ctx!.presentKeys.has("ty")).toBe(false);
  });

  it("excludes multiple already-present keys", () => {
    const ctx = getPropKeyContext('{"_id":"x","type":"pipe","');
    expect(ctx).not.toBeNull();
    expect(ctx!.presentKeys.has("_id")).toBe(true);
    expect(ctx!.presentKeys.has("type")).toBe(true);
  });

  it("handles nested presentKeys separately from root", () => {
    const ctx = getPropKeyContext('{"source":{"type":"dataset","');
    expect(ctx).not.toBeNull();
    expect(ctx!.path).toEqual(["source"]);
    expect(ctx!.presentKeys.has("type")).toBe(true);
    // root key "source" should NOT appear in nested presentKeys
    expect(ctx!.presentKeys.has("source")).toBe(false);
  });

  it("returns hasOpenQuote: true when opening quote is present", () => {
    const ctx = getPropKeyContext('{"_i');
    expect(ctx).not.toBeNull();
    expect(ctx!.hasOpenQuote).toBe(true);
  });

  it("returns hasOpenQuote: false for unquoted word after brace", () => {
    const ctx = getPropKeyContext("{source");
    expect(ctx).not.toBeNull();
    expect(ctx!.hasOpenQuote).toBe(false);
  });

  it("returns hasOpenQuote: false for unquoted word after comma", () => {
    const ctx = getPropKeyContext('{"_id":"x",type');
    expect(ctx).not.toBeNull();
    expect(ctx!.hasOpenQuote).toBe(false);
  });

  it("returns correct path for unquoted nested key", () => {
    const ctx = getPropKeyContext('{"source":{type');
    expect(ctx).not.toBeNull();
    expect(ctx!.path).toEqual(["source"]);
    expect(ctx!.hasOpenQuote).toBe(false);
  });

  it("returns null for unquoted word when not preceded by { or ,", () => {
    expect(getPropKeyContext("type")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPropCompletions — file-type-specific root keys
// ---------------------------------------------------------------------------

describe("buildPropCompletions — root level", () => {
  const empty = new Set<string>();

  it("pipe file offers _id, type, source, transform, sink, pump", () => {
    const items = buildPropCompletions([], "pipe", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("_id");
    expect(labels).toContain("type");
    expect(labels).toContain("source");
    expect(labels).toContain("transform");
    expect(labels).toContain("sink");
    expect(labels).toContain("pump");
  });

  it("pipe file does NOT offer node-metadata-specific keys", () => {
    const items = buildPropCompletions([], "pipe", empty);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("pipe_defaults");
    expect(labels).not.toContain("system_defaults");
    expect(labels).not.toContain("feature_flags");
  });

  it("system file offers _id, type but NOT source, sink, pump", () => {
    const items = buildPropCompletions([], "system", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("_id");
    expect(labels).toContain("type");
    expect(labels).not.toContain("source");
    expect(labels).not.toContain("sink");
    expect(labels).not.toContain("pump");
    expect(labels).not.toContain("transform");
  });

  it("node-metadata file offers pipe_defaults, system_defaults, feature_flags", () => {
    const items = buildPropCompletions([], "node-metadata", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("_id");
    expect(labels).toContain("type");
    expect(labels).toContain("pipe_defaults");
    expect(labels).toContain("system_defaults");
    expect(labels).toContain("feature_flags");
    expect(labels).not.toContain("source");
  });

  it("unknown file type offers combined superset including source and _id", () => {
    const items = buildPropCompletions([], "unknown", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("_id");
    expect(labels).toContain("source");
    expect(labels).toContain("type");
  });

  it("all items have CompletionItemKind.Property", () => {
    const items = buildPropCompletions([], "pipe", empty);
    expect(items.every((i) => i.kind === CompletionItemKind.Property)).toBe(true);
  });

  it("required fields sort before optional fields", () => {
    const items = buildPropCompletions([], "pipe", empty);
    const idIdx = items.findIndex((i) => i.label === "_id");
    const pumpIdx = items.findIndex((i) => i.label === "pump");
    expect(idIdx).toBeLessThan(pumpIdx);
  });
});

// ---------------------------------------------------------------------------
// buildPropCompletions — nested paths
// ---------------------------------------------------------------------------

describe("buildPropCompletions — source props", () => {
  const empty = new Set<string>();

  it("offers type, dataset, system for source path", () => {
    const items = buildPropCompletions(["source"], "pipe", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("type");
    expect(labels).toContain("dataset");
    expect(labels).toContain("system");
    expect(labels).toContain("table");
  });

  it("does not offer root-level keys inside source", () => {
    const items = buildPropCompletions(["source"], "pipe", empty);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("_id");
    expect(labels).not.toContain("pump");
  });
});

describe("buildPropCompletions — transform props", () => {
  const empty = new Set<string>();

  it("offers type and rules for transform path", () => {
    const items = buildPropCompletions(["transform"], "pipe", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("type");
    expect(labels).toContain("rules");
    expect(labels).toContain("system");
  });

  it("does not offer sink or source keys in transform path", () => {
    const labels = buildPropCompletions(["transform"], "pipe", empty).map((i) => i.label);
    expect(labels).not.toContain("_id");
    expect(labels).not.toContain("dataset");
  });
});

describe("buildPropCompletions — sink props", () => {
  const empty = new Set<string>();

  it("offers type, dataset, system, table for sink path", () => {
    const items = buildPropCompletions(["sink"], "pipe", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("type");
    expect(labels).toContain("dataset");
    expect(labels).toContain("system");
    expect(labels).toContain("table");
  });
});

describe("buildPropCompletions — pump props", () => {
  const empty = new Set<string>();

  it("offers mode, schedule_interval, cron_expression for pump path", () => {
    const items = buildPropCompletions(["pump"], "pipe", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("mode");
    expect(labels).toContain("schedule_interval");
    expect(labels).toContain("cron_expression");
  });
});

describe("buildPropCompletions — node-metadata nested", () => {
  const empty = new Set<string>();

  it("pipe_defaults path returns pipe root props", () => {
    const items = buildPropCompletions(["pipe_defaults"], "node-metadata", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("source");
    expect(labels).toContain("transform");
    expect(labels).toContain("sink");
  });

  it("system_defaults path returns system root props", () => {
    const items = buildPropCompletions(["system_defaults"], "node-metadata", empty);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("_id");
    expect(labels).not.toContain("source");
  });
});

// ---------------------------------------------------------------------------
// buildPropCompletions — already-present key filtering
// ---------------------------------------------------------------------------

describe("buildPropCompletions — filters present keys", () => {
  it("excludes _id when already present", () => {
    const present = new Set(["_id"]);
    const items = buildPropCompletions([], "pipe", present);
    expect(items.every((i) => i.label !== "_id")).toBe(true);
  });

  it("excludes type and source when already present", () => {
    const present = new Set(["type", "source"]);
    const items = buildPropCompletions([], "pipe", present);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("type");
    expect(labels).not.toContain("source");
    expect(labels).toContain("transform");
  });

  it("excludes type from source props when already present", () => {
    const present = new Set(["type"]);
    const items = buildPropCompletions(["source"], "pipe", present);
    expect(items.every((i) => i.label !== "type")).toBe(true);
    expect(items.some((i) => i.label === "dataset")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Returns empty array for unknown deep paths
// ---------------------------------------------------------------------------

describe("buildPropCompletions — unknown path", () => {
  it("returns [] for deeply nested unknown path", () => {
    expect(buildPropCompletions(["source", "headers"], "pipe", new Set())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Snippet insertText
// ---------------------------------------------------------------------------

describe("buildPropCompletions — snippet insertText (hasOpenQuote=true)", () => {
  const empty = new Set<string>();

  it('string prop produces key": "$0" snippet', () => {
    const items = buildPropCompletions([], "pipe", empty, true);
    const id = items.find((i) => i.label === "_id")!;
    expect(id.insertText).toBe('_id": "$0"');
    expect(id.insertTextFormat).toBe(InsertTextFormat.Snippet);
  });

  it('object prop produces key": {$0} snippet', () => {
    const items = buildPropCompletions([], "pipe", empty, true);
    const src = items.find((i) => i.label === "source")!;
    expect(src.insertText).toBe('source": {$0}');
  });

  it('boolean prop produces key": ${0|true,false|} snippet', () => {
    const items = buildPropCompletions([], "pipe", empty, true);
    const ns = items.find((i) => i.label === "namespaces")!;
    expect(ns.insertText).toBe('namespaces": ${0|true,false|}');
  });

  it('integer prop produces key": $0 snippet (no quotes)', () => {
    const items = buildPropCompletions([], "pipe", empty, true);
    const bs = items.find((i) => i.label === "batch_size")!;
    expect(bs.insertText).toBe('batch_size": $0');
  });

  it('array prop produces key": [$0] snippet', () => {
    const items = buildPropCompletions(["source"], "pipe", empty, true);
    const ent = items.find((i) => i.label === "entities")!;
    expect(ent.insertText).toBe('entities": [$0]');
  });
});

describe("buildPropCompletions — snippet insertText (hasOpenQuote=false)", () => {
  const empty = new Set<string>();

  it('string prop produces "key": "$0" snippet', () => {
    const items = buildPropCompletions([], "pipe", empty, false);
    const id = items.find((i) => i.label === "_id")!;
    expect(id.insertText).toBe('"_id": "$0"');
    expect(id.insertTextFormat).toBe(InsertTextFormat.Snippet);
  });

  it('object prop produces "key": {$0} snippet', () => {
    const items = buildPropCompletions([], "pipe", empty, false);
    const src = items.find((i) => i.label === "source")!;
    expect(src.insertText).toBe('"source": {$0}');
  });

  it('boolean prop produces "key": ${0|true,false|} snippet', () => {
    const items = buildPropCompletions([], "pipe", empty, false);
    const ns = items.find((i) => i.label === "namespaces")!;
    expect(ns.insertText).toBe('"namespaces": ${0|true,false|}');
  });

  it("filterText is always just the key label", () => {
    const items = buildPropCompletions([], "pipe", empty, false);
    expect(items.every((i) => i.filterText === i.label)).toBe(true);
  });
});
