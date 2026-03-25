import { describe, it, expect } from "vitest";

import {
  buildDagIndex,
  collectHopDatasets,
  extractFullPipeInfo,
  extractSourceDatasets,
} from "../client/src/graph/pipe-dag-builder";

import type { FullPipeInfo } from "../client/src/graph/pipe-dag-builder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePipe(
  id: string,
  sourceDataset: string | null,
  opts: { sourceType?: string; hopDatasets?: string[] } = {},
): FullPipeInfo {
  const { sourceType, hopDatasets = [] } = opts;
  return {
    id,
    fileUri: `file:///pipes/${id}.json`,
    kind: "pipe",
    sourceDatasets: sourceDataset ? [sourceDataset] : [],
    sourceType: sourceType ?? (sourceDataset ? "dataset" : "http_endpoint"),
    hopDatasets,
    ruleNames: [],
  };
}

// ---------------------------------------------------------------------------
// extractSourceDatasets
// ---------------------------------------------------------------------------

describe("extractSourceDatasets", () => {
  it("dataset source — single dataset", () => {
    expect(extractSourceDatasets({ type: "dataset", dataset: "upstream" })).toEqual(["upstream"]);
  });

  it("dataset source — missing dataset key returns empty", () => {
    expect(extractSourceDatasets({ type: "dataset" })).toEqual([]);
  });

  it("merge_datasets source — plain string array", () => {
    expect(extractSourceDatasets({ type: "merge_datasets", datasets: ["foo", "bar"] })).toEqual([
      "foo",
      "bar",
    ]);
  });

  it("union_datasets source — plain string array", () => {
    expect(extractSourceDatasets({ type: "union_datasets", datasets: ["x", "y"] })).toEqual([
      "x",
      "y",
    ]);
  });

  it("merge source — strips aliases from datasets", () => {
    expect(extractSourceDatasets({ type: "merge", datasets: ["foo f", "baz"] })).toEqual([
      "foo",
      "baz",
    ]);
  });

  it("merge source — strips hyphenated aliases", () => {
    expect(
      extractSourceDatasets({
        type: "merge",
        datasets: ["difi-enhetsregisteret-enrich difer", "global-classification-vocabulary gcv"],
      }),
    ).toEqual(["difi-enhetsregisteret-enrich", "global-classification-vocabulary"]);
  });

  it("merge source — sources array of sub-source objects", () => {
    expect(
      extractSourceDatasets({
        type: "merge",
        sources: [
          { type: "dataset", dataset: "a" },
          { type: "dataset", dataset: "b" },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("external source types return empty", () => {
    expect(extractSourceDatasets({ type: "http_endpoint" })).toEqual([]);
    expect(extractSourceDatasets({ type: "sql" })).toEqual([]);
    expect(extractSourceDatasets({ type: "rest" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectHopDatasets
// ---------------------------------------------------------------------------

describe("collectHopDatasets", () => {
  it("collects dataset name from a hops expression", () => {
    const out = new Set<string>();
    collectHopDatasets([["hops", { datasets: ["lookup-table lt"], where: [] }]], out);
    expect([...out]).toEqual(["lookup-table"]);
  });

  it("collects dataset name from apply-hops expression", () => {
    const out = new Set<string>();
    collectHopDatasets([["apply-hops", "rule", { datasets: ["other-pipe"], where: [] }]], out);
    expect([...out]).toEqual(["other-pipe"]);
  });

  it("strips aliases in hops datasets", () => {
    const out = new Set<string>();
    collectHopDatasets([["hops", { datasets: ["my-dataset md"], where: [] }]], out);
    expect([...out]).toEqual(["my-dataset"]);
  });

  it("collects from nested arrays", () => {
    const out = new Set<string>();
    collectHopDatasets([["add", "x", ["hops", { datasets: ["nested-ds"], where: [] }]]], out);
    expect([...out]).toEqual(["nested-ds"]);
  });

  it("ignores non-hops arrays", () => {
    const out = new Set<string>();
    collectHopDatasets([["add", "foo", "bar"]], out);
    expect([...out]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFullPipeInfo
// ---------------------------------------------------------------------------

describe("extractFullPipeInfo", () => {
  const uri = "file:///pipes/my-pipe.json";

  it("returns null for non-object input", () => {
    expect(extractFullPipeInfo("string", uri)).toBeNull();
    expect(extractFullPipeInfo(null, uri)).toBeNull();
    expect(extractFullPipeInfo(42, uri)).toBeNull();
  });

  it("returns null when _id is missing", () => {
    expect(extractFullPipeInfo({ type: "pipe" }, uri)).toBeNull();
  });

  it("extracts id and fileUri", () => {
    const info = extractFullPipeInfo({ _id: "my-pipe", type: "pipe" }, uri);
    expect(info?.id).toBe("my-pipe");
    expect(info?.fileUri).toBe(uri);
  });

  it("sets kind=pipe for type=pipe", () => {
    const info = extractFullPipeInfo({ _id: "p", type: "pipe" }, uri);
    expect(info?.kind).toBe("pipe");
  });

  it("sets kind=system for system types", () => {
    const info = extractFullPipeInfo({ _id: "s", type: "system:rest" }, "file:///systems/s.json");
    expect(info?.kind).toBe("system");
  });

  it("extracts sourceDatasets from dataset source", () => {
    const info = extractFullPipeInfo(
      { _id: "p", type: "pipe", source: { type: "dataset", dataset: "upstream" } },
      uri,
    );
    expect(info?.sourceDatasets).toEqual(["upstream"]);
    expect(info?.sourceType).toBe("dataset");
  });

  it("extracts sourceDatasets from merge source with aliases", () => {
    const info = extractFullPipeInfo(
      { _id: "p", type: "pipe", source: { type: "merge", datasets: ["foo f", "bar b"] } },
      uri,
    );
    expect(info?.sourceDatasets).toEqual(["foo", "bar"]);
  });

  it("extracts sourceDatasets from merge_datasets source", () => {
    const info = extractFullPipeInfo(
      { _id: "p", type: "pipe", source: { type: "merge_datasets", datasets: ["a", "b"] } },
      uri,
    );
    expect(info?.sourceDatasets).toEqual(["a", "b"]);
  });

  it("has empty sourceDatasets for http_endpoint source", () => {
    const info = extractFullPipeInfo(
      { _id: "p", type: "pipe", source: { type: "http_endpoint" } },
      uri,
    );
    expect(info?.sourceDatasets).toEqual([]);
    expect(info?.sourceType).toBe("http_endpoint");
  });

  it("extracts hopDatasets from transform.rules", () => {
    const info = extractFullPipeInfo(
      {
        _id: "p",
        type: "pipe",
        source: { type: "dataset", dataset: "upstream" },
        transform: {
          rules: {
            default: [["hops", { datasets: ["lookup-table lt"], where: [] }]],
          },
        },
      },
      uri,
    );
    expect(info?.hopDatasets).toContain("lookup-table");
  });

  it("extracts ruleNames from transform.rules", () => {
    const info = extractFullPipeInfo(
      {
        _id: "p",
        type: "pipe",
        transform: { rules: { default: [], "my-rule": [] } },
      },
      uri,
    );
    expect(info?.ruleNames).toContain("default");
    expect(info?.ruleNames).toContain("my-rule");
  });
});

// ---------------------------------------------------------------------------
// buildDagIndex
// ---------------------------------------------------------------------------

describe("buildDagIndex", () => {
  it("byId contains only pipes (not systems)", () => {
    const pipes: FullPipeInfo[] = [
      makePipe("a", null),
      {
        id: "s",
        fileUri: "file:///systems/s.json",
        kind: "system",
        sourceDatasets: [],
        sourceType: "",
        hopDatasets: [],
        ruleNames: [],
      },
    ];
    const index = buildDagIndex(pipes);
    expect(index.byId.has("a")).toBe(true);
    expect(index.byId.has("s")).toBe(false);
  });

  it("sourceDependents reverse map is correct", () => {
    const pipes = [makePipe("b", "a"), makePipe("c", "a"), makePipe("d", "b")];
    const index = buildDagIndex(pipes);
    expect(index.sourceDependents.get("a")?.sort()).toEqual(["b", "c"]);
    expect(index.sourceDependents.get("b")).toEqual(["d"]);
  });

  it("hopConsumers reverse map is correct", () => {
    const pipes = [
      makePipe("a", null, { hopDatasets: ["lookup"] }),
      makePipe("b", null, { hopDatasets: ["lookup"] }),
    ];
    const index = buildDagIndex(pipes);
    expect(index.hopConsumers.get("lookup")?.sort()).toEqual(["a", "b"]);
  });

  it("pipe with no connections is indexed but has no reverse entries", () => {
    const index = buildDagIndex([makePipe("lone", null)]);
    expect(index.byId.has("lone")).toBe(true);
    expect(index.sourceDependents.size).toBe(0);
    expect(index.hopConsumers.size).toBe(0);
  });

  it("handles multiple source datasets from merge source", () => {
    const pipe: FullPipeInfo = {
      id: "merged",
      fileUri: "file:///pipes/merged.json",
      kind: "pipe",
      sourceDatasets: ["x", "y", "z"],
      sourceType: "merge",
      hopDatasets: [],
      ruleNames: [],
    };
    const index = buildDagIndex([pipe]);
    expect(index.sourceDependents.get("x")).toEqual(["merged"]);
    expect(index.sourceDependents.get("y")).toEqual(["merged"]);
    expect(index.sourceDependents.get("z")).toEqual(["merged"]);
  });

  it("empty input produces empty index", () => {
    const index = buildDagIndex([]);
    expect(index.byId.size).toBe(0);
    expect(index.sourceDependents.size).toBe(0);
    expect(index.hopConsumers.size).toBe(0);
  });
});
