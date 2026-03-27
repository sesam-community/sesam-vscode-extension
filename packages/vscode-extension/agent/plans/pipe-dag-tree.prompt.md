# F16: Pipe DAG Views

> **Status**: `implemented`
> **Rollout Phase**: Phase 2
> **Tracking**: [README.md](../impl/README.md)
> **Depends on**: [F14 — Cross-file Navigation](cross-file-navigation.prompt.md) (workspace index,
> `PipeInfo` scan)
> **Alternative to**: [F15 — Interactive Pipe Graph](interactive-pipe-graph.prompt.md) (vis-network
> canvas approach)

---

## Summary

Two context-aware sidebar tree views, inspired by the VS Code Source Control Graph, that let you
navigate a Sesam workspace as a directed acyclic graph (DAG) of pipes and datasets:

1. **Lineage** — upstream ancestors of the active pipe: "where does this data come from?"
2. **Dependents** — downstream consumers of the active pipe: "who uses my output?"

Both views update automatically when the active editor switches to a sesam-config file.
Systems are intentionally excluded — only pipes and datasets are shown.

A third **Workspace DAG Panel** (Phase B) renders the full workspace in a `git log --graph`-style
layout inside a webview, with no external library dependencies.

---

## Motivation

Understanding data flow in a Sesam workspace is hard when all files are flat in the filesystem.
The key questions developers ask are:

- "This pipe reads from `global-organisation` — what built that dataset?"
- "I just changed `hubspot-company-enrich` — which downstream pipes will be affected?"
- "What does the full chain look like from raw collect to final output?"

The VS Code Source Control Graph answers the equivalent question in Git: "what is the commit
history of this branch, and how do branches diverge and merge?" Our goal is the same mental
model applied to data pipelines.

### What makes Sesam DAG navigation tricky

| Challenge | Detail |
|---|---|
| **Multiple upstream sources** | A `merge` or `merge_datasets` source reads from N datasets simultaneously (branching lines converging) |
| **Hop joins** | A pipe can read a second dataset mid-transform via `["hops", ...]` — these are lookup joins, not primary sources |
| **Merge source alias syntax** | `"datasets": ["difi-enhetsregisteret-enrich difer"]` — each item is `"dataset-id alias"`, need first token only. See [merge_datasets source docs](https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources-merge-datasets.html) |
| **External sources** | Some pipes read from HTTP endpoints, SQL, etc. — they have no upstream pipe in the workspace |
| **Cycles** | Guard against infinite recursion (should not normally happen but possible with merge loops) |

---

## Architecture

### Component overview

```
┌───────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host (client/src/)                             │
│                                                                   │
│  graph/pipe-dag-builder.ts           ← pure data functions        │
│  ├── buildPipeInfo(files)            ← workspace scan             │
│  ├── buildLineage(id, index)         ← upstream ancestors         │
│  └── buildDependents(id, index)      ← downstream consumers       │
│                                                                   │
│  graph/PipeLineageProvider.ts        ← TreeDataProvider           │
│  graph/PipeDependentsProvider.ts     ← TreeDataProvider           │
│                                                                   │
│  [Phase B] graph/PipeDagPanel.ts     ← WebviewPanel               │
│  └── dist/graph/dag.js              ← bundled webview script      │
└───────────────────────────────────────────────────────────────────┘
```

### Shared data model

```
client/src/graph/pipe-dag-builder.ts
```

`FullPipeInfo` — extends the existing `PipeInfo` from `PipeGraphProvider.ts` with additional
fields extracted during the workspace scan, necessary for DAG construction:

```ts
interface FullPipeInfo {
  id: string;                    // pipe _id (= output dataset name)
  fileUri: vscode.Uri;
  kind: "pipe" | "system";
  // Source upstream datasets (primary data flow)
  sourceDatasets: string[];      // from source.dataset / source.datasets (stripped of aliases)
  sourceType: string;            // "dataset" | "merge_datasets" | "merge" | "union_datasets" | "http_endpoint" | …
  // Hop join datasets (secondary lookups in transforms)
  hopDatasets: string[];         // from ["hops", …] DTL expressions
  // Rule names (not needed for DAG, kept for compatibility)
  ruleNames: string[];
}
```

`DagIndex` — built once per workspace scan:

```ts
interface DagIndex {
  byId: Map<string, FullPipeInfo>;        // id → pipe info
  dependents: Map<string, string[]>;      // id → list of pipe ids that source from this id
}
```

### Source dataset extraction

All source types and their `sourceDatasets` extraction rules:

| Source type | Config key | Extraction |
|---|---|---|
| `dataset` | `source.dataset` | `[source.dataset]` |
| `merge_datasets` | `source.datasets` | `source.datasets` (plain string array) |
| `merge` | `source.datasets` | each item split on `" "`, take `[0]` (strip alias) |
| `union_datasets` | `source.datasets` | `source.datasets` (plain string array) |
| anything else | — | `[]` (external source, no upstream datasets in workspace) |

The `dependents` map is built in a single pass after all pipes are collected:
for each pipe, for each of its `sourceDatasets`, add the pipe's id to
`dependents.get(sourceDataset)`.

---

## View 1: Pipe Lineage (sidebar tree)

**Tree view ID**: `sesamPipeLineage`
**Provider**: `client/src/graph/PipeLineageProvider.ts`

Shows the upstream ancestry of the pipe in the **currently active editor**.

### Tree structure

```
▼ hubspot-company-enrich                  ← active pipe (root, bold)
  ▼ Sources
    ▼ hubspot-company-collect             ← source.dataset, resolves to a pipe
      ▼ Sources
        ○ hubspot (external — http_endpoint, leaf)
      ► Joins
    ► global-organisation                 ← merge source input #2
    ► global-contact                      ← merge source input #3
  ► Joins (hops)
    ○ hubspot-company-classification      ← hop dataset
    ○ global-country                      ← hop dataset
```

### Tree node types

| Node | Icon | Meaning |
|---|---|---|
| Active pipe | `$(git-commit)` bold | The root — the currently open pipe |
| Upstream pipe | `$(git-commit)` | A pipe in the workspace that produces the source dataset |
| External source | `$(cloud-download)` | source.type is not dataset-based (http, sql, etc.) |
| Unresolved dataset | `$(warning)` dim | Dataset name not found in workspace index |
| Joins group | `$(references)` | Collapsible group for hop datasets |
| Hop dataset | `$(database)` | Dataset joined via hops; resolved like upstream pipes |

### Behaviour

- The tree root updates **on `onDidChangeActiveTextEditor`** when the editor is a
  sesam-config file.
- If the active file is not a sesam-config file, the tree shows "Open a pipe config to see
  its lineage."
- Depth limit: 10 levels before inserting a `$(ellipsis)` node ("…more upstream — click to
  expand").
- **Cycle guard**: carry a `visited: Set<string>` through recursion; if `id` already visited,
  show `$(issue-opened) Cycle detected` node and stop.
- Clicking an upstream pipe node opens its config file (`vscode.open`).
- A "Refresh" toolbar button forces a full workspace re-scan.

---

## View 2: Pipe Dependents (sidebar tree)

**Tree view ID**: `sesamPipeDependents`
**Provider**: `client/src/graph/PipeDependentsProvider.ts`

Shows all pipes that **consume** the output of the currently open pipe (directly or
transitively).

### Tree structure

```
▼ hubspot-company-enrich                  ← active pipe (root)
  ▼ Direct consumers
    ▼ hubspot-company-insert-share-rest   ← has source.dataset = "hubspot-company-enrich"
        ○ (no further consumers)
    ▼ hubspot-company-classification      ← another consumer
      ► Direct consumers
  ► Hop consumers (joined via hops)
    ○ global-organisation-enrich          ← has this id in hopDatasets
```

### Behaviour

- Same active-editor trigger, depth limit, and cycle guard as Lineage.
- "Hop consumers" group is a separate collapsible section showing pipes that reference
  the current pipe's id in their hops (not as a primary source).
- Clicking a consumer pipe node opens its config file.

---

## Shared Workspace Scan

Both providers share one `DagIndex` instance. A `PipeDagScanner` singleton:

```ts
// client/src/graph/pipe-dag-builder.ts

async function scanWorkspace(folders: readonly vscode.WorkspaceFolder[]): Promise<DagIndex>
```

- Finds all `**/*.json`, `**/*.conf.pipe`, `**/*.conf.system` (excluding node_modules)
- Parses each, builds `FullPipeInfo`, indexes by `_id`
- Builds `dependents` reverse map
- Called once on activation; re-called on `onDidChangeWatchedFiles`

Both `PipeLineageProvider` and `PipeDependentsProvider` hold a reference to the shared
`DagIndex` and call `refresh()` when it changes.

---

## Phase B: Workspace DAG Panel (webview)

> **Optional / Phase B** — can be shipped independently after views 1 & 2.

A webview panel command (`dtl.openPipeDag`) that renders all pipes in a `git log --graph`
inspired layout:

```
  ●  hubspot-company-enrich
  │
  ├─●  hubspot-company-collect
  │    │
  │    ○  hubspot (external)
  │
  ├─●  global-organisation
  │    │
  │   …
  │
  ┊  (hop) hubspot-company-classification
```

### Rendering approach

- **No external dependencies** — pure SVG `<polyline>` elements drawn per row
- Topological sort (Kahn's algorithm) to order rows
- Lane assignment: each "open chain" occupies a column; merge points collapse lanes
- N-wide columns multiplied by a fixed `LANE_WIDTH` (e.g. 16px)
- Solid lines (`stroke-dasharray: none`) for source connections
- Dashed lines (`stroke-dasharray: 4 3`) for hop connections
- Each row: SVG lane column + pipe label + source type badge
- Click row → `vscode.open` the pipe file (via postMessage)
- Toolbar: "Lineage" | "Dependents" | "All" toggle (filters visible rows)
- Auto-refresh on file changes

### Vite build

Add a `vite.config.dag.ts` entry (separate from the existing `vite.config.client.ts`) that
bundles `client/src/graph/webview/dag.ts` → `dist/graph/dag.js` with no Node.js externals.

---

## Implementation Steps

### Phase A — Sidebar trees

1. **Create `pipe-dag-builder.ts`**
   - `extractFullPipeInfo(parsed, fileUri): FullPipeInfo | null` — extends existing
     `extractPipeInfo` with `sourceDatasets`, `sourceType`
   - `scanWorkspace(folders): Promise<DagIndex>` — scan + build reverse map
   - `buildLineageTree(id, index, depth, visited): LineageNode[]` — recursive upstream walk
   - `buildDependentsTree(id, index, depth, visited): DependentsNode[]` — recursive downstream
     walk

2. **Create `PipeLineageProvider.ts`**
   - Implements `vscode.TreeDataProvider<PipeTreeItem>`
   - Holds `DagIndex` ref, `currentPipeId: string | undefined`
   - Calls `buildLineageTree` in `getChildren`
   - Subscribes to `onDidChangeActiveTextEditor`

3. **Create `PipeDependentsProvider.ts`**
   - Same structure as PipeLineageProvider but calls `buildDependentsTree`
   - Adds "Hop consumers" group using reverse hop lookup from `DagIndex`

4. **Register views in `extension.ts`**
   - `vscode.window.createTreeView("sesamPipeLineage", { treeDataProvider: lineageProvider })`
   - `vscode.window.createTreeView("sesamPipeDependents", { treeDataProvider: dependentsProvider })`
   - Wire file watcher → `PipeDagScanner.rescan()` → fire both providers

5. **Add to `package.json`**
   - `contributes.views.sesam` (or a new `contributes.viewsContainers`) for both views
   - `contributes.commands`: `dtl.refreshPipeDag`

### Phase B — Workspace DAG webview

6. **Create `PipeDagPanel.ts`** following `PreviewPanel.ts` pattern
7. **Create `client/src/graph/webview/dag.ts`** — topological sort + SVG lane renderer
8. **Create `vite.config.dag.ts`** — bundles the webview script
9. **Register `dtl.openPipeDag` command** in `extension.ts`

### Phase C — Tests

10. **`tests/pipe-dag-builder.test.ts`**
    - `extractFullPipeInfo` handles `dataset`, `merge`, `merge_datasets`, `union_datasets`
    - Alias stripping: `"difi-enhetsregisteret-enrich difer"` → `"difi-enhetsregisteret-enrich"`
    - `buildLineageTree` with depth limit
    - `buildDependentsTree` cycle detection
    - `DagIndex.dependents` reverse map is correct

---

## Files

### New

| File | Purpose |
|---|---|
| `client/src/graph/pipe-dag-builder.ts` | Data model: `FullPipeInfo`, `DagIndex`, scan, tree builders |
| `client/src/graph/PipeLineageProvider.ts` | TreeDataProvider — upstream lineage |
| `client/src/graph/PipeDependentsProvider.ts` | TreeDataProvider — downstream dependents |
| `tests/pipe-dag-builder.test.ts` | Unit tests |
| `client/src/graph/webview/dag.ts` | Phase B — webview DAG renderer |
| `client/src/graph/PipeDagPanel.ts` | Phase B — WebviewPanel wrapper |
| `vite.config.dag.ts` | Phase B — Vite bundle config for webview |

### Modified

| File | Changes |
|---|---|
| `client/src/extension.ts` | Register both tree views, `dtl.openPipeDag` command, file watcher |
| `client/src/graph/PipeGraphProvider.ts` | Export `extractPipeInfo`; keep existing tree unchanged |
| `package.json` | Add view contributions and commands |

---

## Verification

1. **Open a pipe config** → Lineage tree populates with upstream sources
2. **Merge source** → root shows multiple children (one per dataset in `source.datasets`), aliases stripped
3. **Hops** → "Joins" group appears under each pipe with correct hop dataset names
4. **Dependents view** → shows correct downstream consumers including hop consumers in separate group
5. **Click node** → corresponding config file opens
6. **Cycle guard** → a pipe that (hypothetically) references itself shows `Cycle detected` instead of infinite recursion
7. **External source** → leaf node with cloud icon, no children, shows source type as description
8. **Unresolved dataset** → warning icon, no children
9. **File change** → both trees refresh within 1 second
10. **pnpm test** → all tests including `pipe-dag-builder.test.ts` pass

---

## Decisions

| Decision | Rationale |
|---|---|
| **TreeDataProvider** (not webview) for phase A | Uses native VS Code tree UI; keyboard navigation, theming, and accessibility for free; much simpler than a custom canvas |
| **Two separate views** (lineage + dependents) | The ancestor question and the descendant question have opposite tree shapes — merging them into one tree with both directions would be confusing |
| **Hop datasets as a sub-group, not inline** | Hops are secondary lookups, not primary data flow; grouping avoids visual noise |
| **Phase B webview uses SVG, not vis-network** | Avoids bundling a large external library; git-log column layout is achievable with simple polylines; consistent with "no canvas" direction |
| **Shared `DagIndex`** | One workspace scan serves both views; avoids redundant file reads |
| **Alias stripping (`"id alias"` → `"id"`)** | The `merge` source uses `"dataset-id alias"` syntax [docs](https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources-merge-datasets.html); the cross-reference utils already hit this bug — centralise the logic here |
| **Systems excluded** | Requested by design; simplifies the graph and focuses on data flow rather than connectivity infrastructure |
