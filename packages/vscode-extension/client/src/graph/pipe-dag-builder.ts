/**
 * Pipe DAG Builder
 * Pure functions for building the pipe dependency graph from parsed Sesam
 * config files. No VS Code API dependencies — fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FullPipeInfo {
  id: string;
  /** file:// URI string. */
  fileUri: string;
  kind: "pipe" | "system";
  /** Primary upstream dataset IDs (aliases stripped). */
  sourceDatasets: string[];
  /** The source.type value (e.g. "dataset", "merge", "http_endpoint"). */
  sourceType: string;
  /** System _id referenced in source.system (null if absent). */
  sourceSystem: string | null;
  /** System _id referenced in sink.system (null if absent). */
  sinkSystem: string | null;
  /** System _ids referenced in rest-transform steps inside transform[]. */
  transformSystems: string[];
  /** Dataset IDs joined via hops in the transform. */
  hopDatasets: string[];
  /** Named rules in transform.rules. */
  ruleNames: string[];
}

/** A parsed system config entry (kind === "system"). */
export interface SystemEntry {
  id: string;
  fileUri: string;
  /** The raw type string, e.g. "system:rest", "system:microservice". */
  systemType: string;
}

export interface DagIndex {
  /** Pipe id → FullPipeInfo (systems excluded). */
  byId: Map<string, FullPipeInfo>;
  /** Dataset/pipe id → list of pipe ids that list it in sourceDatasets. */
  sourceDependents: Map<string, string[]>;
  /** Dataset/pipe id → list of pipe ids that list it in hopDatasets. */
  hopConsumers: Map<string, string[]>;
  /** System id → list of pipe ids that have source.system = this id. */
  sourceSystemPipes: Map<string, string[]>;
  /** System id → list of pipe ids that have sink.system = this id. */
  sinkSystemPipes: Map<string, string[]>;
  /** System id → list of pipe ids that reference it in a rest-transform step. */
  transformSystemPipes: Map<string, string[]>;
}

/** Source types that reference internal datasets (and have no external origin). */
export const DATASET_SOURCE_TYPES = new Set([
  "dataset",
  "merge",
  "merge_datasets",
  "union_datasets",
]);

export type DagItemPayload =
  | { type: "pipe"; id: string; depth: number; visited: ReadonlySet<string> }
  | { type: "hops-group"; parentId: string }
  | { type: "hop-consumers-group"; parentId: string }
  /** Leaf: resolved reference shown without further expansion (hops or hop-consumer) */
  | { type: "hop-ref"; id: string }
  /** Leaf: external source (http_endpoint, sql, etc.) */
  | { type: "external"; sourceType: string }
  /** Leaf: dataset name not found in workspace index */
  | { type: "unresolved"; datasetId: string }
  /** Leaf: cycle detected in upstream/downstream traversal */
  | { type: "cycle"; id: string }
  /** Leaf: max depth reached */
  | { type: "depth-limit"; id: string }
  /** Leaf: empty state message */
  | { type: "empty"; message: string };

// ---------------------------------------------------------------------------
// Source dataset extraction
// ---------------------------------------------------------------------------

/**
 * Extract primary source dataset IDs from a source config object.
 * Strips "id alias" syntax used by the merge source type.
 *
 * Handles:
 *  - dataset     → source.dataset (single string)
 *  - merge_datasets / union_datasets → source.datasets (plain string array)
 *  - merge       → source.datasets (optional "id alias" items) or source.sources[]
 */
export function extractSourceDatasets(source: Record<string, unknown>): string[] {
  const type = typeof source["type"] === "string" ? source["type"] : "";

  if (type === "dataset") {
    const ds = source["dataset"];
    return typeof ds === "string" && ds ? [ds] : [];
  }

  if (type === "merge_datasets" || type === "union_datasets") {
    const datasets = source["datasets"];
    if (!Array.isArray(datasets)) {
      return [];
    }
    return datasets.flatMap((ds) => {
      if (typeof ds !== "string") {
        return [];
      }
      const id = ds.trim();
      return id ? [id] : [];
    });
  }

  if (type === "merge") {
    // "merge" source datasets entries may be "id alias" strings — take first token
    const datasets = source["datasets"];
    if (Array.isArray(datasets)) {
      return datasets.flatMap((ds) => {
        if (typeof ds !== "string") {
          return [];
        }
        const id = ds.trim().split(/\s+/)[0];
        return id ? [id] : [];
      });
    }
    // merge source can also hold a "sources" array of sub-source objects
    const sources = source["sources"];
    if (Array.isArray(sources)) {
      return sources.flatMap((s) => {
        if (typeof s !== "object" || s === null) {
          return [];
        }
        return extractSourceDatasets(s as Record<string, unknown>);
      });
    }
    return [];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Hop dataset extraction
// ---------------------------------------------------------------------------

/** Recursively collect dataset names from ["hops",...] / ["apply-hops",...] in a DTL array. */
export function collectHopDatasets(arr: unknown[], out: Set<string>): void {
  for (const item of arr) {
    if (!Array.isArray(item)) {
      continue;
    }
    const head = item[0];
    if (head === "hops" || head === "apply-hops") {
      const specIdx = head === "hops" ? 1 : 2;
      const spec = item[specIdx];
      if (typeof spec === "object" && spec !== null && !Array.isArray(spec)) {
        const datasets = (spec as Record<string, unknown>)["datasets"];
        if (Array.isArray(datasets)) {
          for (const ds of datasets) {
            if (typeof ds === "string") {
              const id = ds.trim().split(/\s+/)[0];
              if (id) {
                out.add(id);
              }
            }
          }
        }
      }
    }
    for (const child of item) {
      if (Array.isArray(child)) {
        collectHopDatasets([child] as unknown[], out);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

/** Parse a raw JSON object into a FullPipeInfo, or null if not a valid config. */
export function extractFullPipeInfo(parsed: unknown, fileUri: string): FullPipeInfo | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const id = typeof obj["_id"] === "string" ? obj["_id"] : null;
  if (!id) {
    return null;
  }

  const rootType = typeof obj["type"] === "string" ? obj["type"] : "pipe";
  const kind: "pipe" | "system" = rootType.startsWith("system") ? "system" : "pipe";

  const sourceRaw = obj["source"];
  let sourceDatasets: string[] = [];
  // For systems, store the root type (e.g. "system:rest") in sourceType since they have no source.
  let sourceType = kind === "system" ? rootType : "";
  let sourceSystem: string | null = null;
  if (typeof sourceRaw === "object" && sourceRaw !== null && !Array.isArray(sourceRaw)) {
    const src = sourceRaw as Record<string, unknown>;
    sourceType = typeof src["type"] === "string" ? src["type"] : "";
    sourceDatasets = extractSourceDatasets(src);
    sourceSystem = typeof src["system"] === "string" ? src["system"] : null;
  }

  const sinkRaw = obj["sink"];
  let sinkSystem: string | null = null;
  if (typeof sinkRaw === "object" && sinkRaw !== null && !Array.isArray(sinkRaw)) {
    const snk = sinkRaw as Record<string, unknown>;
    sinkSystem = typeof snk["system"] === "string" ? snk["system"] : null;
  }

  const hopDatasets = new Set<string>();
  const ruleNames: string[] = [];
  const transformSystems: string[] = [];
  const transformRaw = obj["transform"];

  if (typeof transformRaw === "object" && transformRaw !== null) {
    if (Array.isArray(transformRaw)) {
      // Array of transform steps
      for (const step of transformRaw as unknown[]) {
        if (typeof step !== "object" || step === null || Array.isArray(step)) {
          continue;
        }
        const s = step as Record<string, unknown>;
        // Collect system from rest-transform steps
        if (typeof s["system"] === "string" && s["system"]) {
          transformSystems.push(s["system"]);
        }
        // Collect hop datasets and rule names from dtl steps
        const rules = s["rules"];
        if (typeof rules === "object" && rules !== null && !Array.isArray(rules)) {
          ruleNames.push(...Object.keys(rules as Record<string, unknown>));

          for (const ruleArr of Object.values(rules as Record<string, unknown>)) {
            if (Array.isArray(ruleArr)) {
              collectHopDatasets(ruleArr, hopDatasets);
            }
          }
        }
      }
    } else {
      // Plain-object transform
      const rules = (transformRaw as Record<string, unknown>)["rules"];
      if (typeof rules === "object" && rules !== null) {
        ruleNames.push(...Object.keys(rules as Record<string, unknown>));

        for (const ruleArr of Object.values(rules as Record<string, unknown>)) {
          if (Array.isArray(ruleArr)) {
            collectHopDatasets(ruleArr, hopDatasets);
          }
        }
      }
    }
  }

  return {
    id,
    fileUri,
    kind,
    sourceDatasets,
    sourceType,
    sourceSystem,
    sinkSystem,
    transformSystems,
    hopDatasets: [...hopDatasets],
    ruleNames,
  };
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

/** Build a DagIndex from a flat list of parsed FullPipeInfo values. Pure function. */
export function buildDagIndex(pipes: FullPipeInfo[]): DagIndex {
  const byId = new Map<string, FullPipeInfo>();
  const sourceDependents = new Map<string, string[]>();
  const hopConsumers = new Map<string, string[]>();
  const sourceSystemPipes = new Map<string, string[]>();
  const sinkSystemPipes = new Map<string, string[]>();
  const transformSystemPipes = new Map<string, string[]>();

  const pushTo = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };

  for (const pipe of pipes) {
    if (pipe.kind === "pipe") {
      byId.set(pipe.id, pipe);
    }
  }

  for (const pipe of byId.values()) {
    for (const ds of pipe.sourceDatasets) {
      pushTo(sourceDependents, ds, pipe.id);
    }

    for (const ds of pipe.hopDatasets) {
      pushTo(hopConsumers, ds, pipe.id);
    }

    if (pipe.sourceSystem) {
      pushTo(sourceSystemPipes, pipe.sourceSystem, pipe.id);
    }

    if (pipe.sinkSystem) {
      pushTo(sinkSystemPipes, pipe.sinkSystem, pipe.id);
    }

    for (const sys of pipe.transformSystems) {
      pushTo(transformSystemPipes, sys, pipe.id);
    }
  }

  return {
    byId,
    sourceDependents,
    hopConsumers,
    sourceSystemPipes,
    sinkSystemPipes,
    transformSystemPipes,
  };
}

/** Build a system id → SystemEntry map from a list of all parsed configs. Pure function. */
export function buildSystemIndex(infos: FullPipeInfo[]): Map<string, SystemEntry> {
  const map = new Map<string, SystemEntry>();
  for (const info of infos) {
    if (info.kind === "system") {
      map.set(info.id, {
        id: info.id,
        fileUri: info.fileUri,
        systemType: info.sourceType,
      });
    }
  }
  return map;
}
