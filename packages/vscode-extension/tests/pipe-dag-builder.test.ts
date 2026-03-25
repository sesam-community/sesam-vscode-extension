import { describe, it, expect } from "vitest";

import {
  buildDagIndex,
  buildSystemIndex,
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
  opts: {
    sourceType?: string;
    hopDatasets?: string[];
    sourceSystem?: string;
    sinkSystem?: string;
    transformSystems?: string[];
  } = {},
): FullPipeInfo {
  const {
    sourceType,
    hopDatasets = [],
    sourceSystem = null,
    sinkSystem = null,
    transformSystems = [],
  } = opts;
  return {
    id,
    fileUri: `file:///pipes/${id}.json`,
    kind: "pipe",
    sourceDatasets: sourceDataset ? [sourceDataset] : [],
    sourceType: sourceType ?? (sourceDataset ? "dataset" : "http_endpoint"),
    sourceSystem,
    sinkSystem,
    transformSystems,
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
        sourceSystem: null,
        sinkSystem: null,
        transformSystems: [],
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
      sourceSystem: null,
      sinkSystem: null,
      transformSystems: [],
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

  it("sourceSystemPipes reverse map is correct", () => {
    const pipes = [
      makePipe("collect-a", null, { sourceSystem: "my-system" }),
      makePipe("collect-b", null, { sourceSystem: "my-system" }),
      makePipe("collect-c", null, { sourceSystem: "other-system" }),
    ];
    const index = buildDagIndex(pipes);
    expect(index.sourceSystemPipes.get("my-system")?.sort()).toEqual(["collect-a", "collect-b"]);
    expect(index.sourceSystemPipes.get("other-system")).toEqual(["collect-c"]);
  });

  it("sinkSystemPipes reverse map is correct", () => {
    const pipes = [
      makePipe("share-a", "upstream", { sinkSystem: "crm" }),
      makePipe("share-b", "upstream", { sinkSystem: "crm" }),
    ];
    const index = buildDagIndex(pipes);
    expect(index.sinkSystemPipes.get("crm")?.sort()).toEqual(["share-a", "share-b"]);
  });

  it("pipe with neither source nor sink system leaves maps empty", () => {
    const index = buildDagIndex([makePipe("p", "ds")]);
    expect(index.sourceSystemPipes.size).toBe(0);
    expect(index.sinkSystemPipes.size).toBe(0);
    expect(index.transformSystemPipes.size).toBe(0);
  });

  it("transformSystemPipes reverse map is correct for rest-transform systems", () => {
    const pipes = [
      makePipe("wikidata-collect", null, { transformSystems: ["wikidata"] }),
      makePipe("wikidata-enrich", null, { transformSystems: ["wikidata"] }),
      makePipe("other-pipe", null, { transformSystems: ["other-system"] }),
    ];
    const index = buildDagIndex(pipes);
    expect(index.transformSystemPipes.get("wikidata")?.sort()).toEqual([
      "wikidata-collect",
      "wikidata-enrich",
    ]);
    expect(index.transformSystemPipes.get("other-system")).toEqual(["other-pipe"]);
  });
});

// ---------------------------------------------------------------------------
// extractFullPipeInfo — system fields
// ---------------------------------------------------------------------------

describe("extractFullPipeInfo — system fields", () => {
  const uri = "file:///pipes/my-pipe.json";

  it("extracts sourceSystem from source.system", () => {
    const info = extractFullPipeInfo(
      { _id: "p", type: "pipe", source: { type: "rest", system: "my-rest" } },
      uri,
    );
    expect(info?.sourceSystem).toBe("my-rest");
    expect(info?.sinkSystem).toBeNull();
  });

  it("extracts sinkSystem from sink.system", () => {
    const info = extractFullPipeInfo(
      {
        _id: "p",
        type: "pipe",
        source: { type: "dataset", dataset: "x" },
        sink: { type: "rest", system: "target-system" },
      },
      uri,
    );
    expect(info?.sinkSystem).toBe("target-system");
    expect(info?.sourceSystem).toBeNull();
  });

  it("both sourceSystem and sinkSystem can be set at once", () => {
    const info = extractFullPipeInfo(
      {
        _id: "p",
        type: "pipe",
        source: { type: "sql", system: "oracle" },
        sink: { type: "rest", system: "crm" },
      },
      uri,
    );
    expect(info?.sourceSystem).toBe("oracle");
    expect(info?.sinkSystem).toBe("crm");
  });

  it("both fields are null for a pure dataset pipe", () => {
    const info = extractFullPipeInfo(
      { _id: "p", type: "pipe", source: { type: "dataset", dataset: "x" } },
      uri,
    );
    expect(info?.sourceSystem).toBeNull();
    expect(info?.sinkSystem).toBeNull();
    expect(info?.transformSystems).toEqual([]);
  });

  it("system config stores root type in sourceType", () => {
    const info = extractFullPipeInfo({ _id: "s", type: "system:rest" }, "file:///systems/s.json");
    expect(info?.kind).toBe("system");
    expect(info?.sourceType).toBe("system:rest");
  });

  it("extracts transformSystems from a rest step in an array transform", () => {
    const info = extractFullPipeInfo(
      {
        _id: "wikidata-collect",
        type: "pipe",
        source: { type: "dataset", dataset: "upstream" },
        transform: [
          { type: "dtl", rules: { default: [["add", "x", 1]] } },
          { type: "rest", system: "wikidata", trace: true },
          { type: "dtl", rules: { default: [["merge", "_S."]] } },
        ],
      },
      uri,
    );
    expect(info?.transformSystems).toEqual(["wikidata"]);
    expect(info?.sourceSystem).toBeNull();
    expect(info?.sinkSystem).toBeNull();
  });

  it("collects multiple rest steps in an array transform", () => {
    const info = extractFullPipeInfo(
      {
        _id: "multi-rest",
        type: "pipe",
        source: { type: "dataset", dataset: "upstream" },
        transform: [
          { type: "rest", system: "system-a" },
          { type: "dtl", rules: {} },
          { type: "rest", system: "system-b" },
        ],
      },
      uri,
    );
    expect(info?.transformSystems).toEqual(["system-a", "system-b"]);
  });

  it("plain-object transform has empty transformSystems", () => {
    const info = extractFullPipeInfo(
      {
        _id: "p",
        type: "pipe",
        source: { type: "dataset", dataset: "x" },
        transform: { type: "dtl", rules: { default: [["copy", "*"]] } },
      },
      uri,
    );
    expect(info?.transformSystems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildSystemIndex
// ---------------------------------------------------------------------------

describe("buildSystemIndex", () => {
  it("indexes only system kind entries", () => {
    const infos: FullPipeInfo[] = [
      makePipe("p", null),
      {
        id: "my-rest",
        fileUri: "file:///systems/my-rest.json",
        kind: "system",
        sourceDatasets: [],
        sourceType: "system:rest",
        sourceSystem: null,
        sinkSystem: null,
        transformSystems: [],
        hopDatasets: [],
        ruleNames: [],
      },
    ];
    const map = buildSystemIndex(infos);
    expect(map.has("p")).toBe(false);
    expect(map.has("my-rest")).toBe(true);
    expect(map.get("my-rest")?.systemType).toBe("system:rest");
  });

  it("empty input produces empty map", () => {
    expect(buildSystemIndex([]).size).toBe(0);
  });
});
