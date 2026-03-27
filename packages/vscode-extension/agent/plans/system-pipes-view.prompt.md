# F17: System Pipes View

> **Status**: `implemented`
> **Rollout Phase**: Phase 2
> **Tracking**: [README.md](../impl/README.md)
> **Depends on**: [F16 — Pipe DAG Views](pipe-dag-tree.prompt.md) (`FullPipeInfo`,
> `pipe-dag-builder.ts`, workspace scan with `buildDagFromWorkspace`)

---

## Summary

A single sidebar tree view — **System Pipes** — that answers the question:
"Which pipes are connected to this system?"

When the active editor is a **system config file**, the view shows all pipes in the workspace
that reference that system's `_id`, grouped by the role the system plays:

```
▼ my-rest-api                     ← active system (root)
  ▼ Source pipes (5)              ← pipes where source.system = this id
    ● rest-collect-orders         ← click → opens pipe file
    ● rest-collect-products
    …
  ▼ Sink pipes (2)                ← pipes where sink.system = this id
    ● orders-to-rest
    …
  ▼ Transform pipes (1)           ← pipes that reference this id inside a transform
    ● orders-enrich               ← (e.g. a lookup microservice call)
```

When the active editor is a **pipe config file**, the view shows every system that pipe
references, grouped symmetrically:

```
▼ orders-collect                  ← active pipe (root)
  ▼ Source systems                ← pipe's source.system
    ● my-rest-api
  ▼ Sink systems                  ← pipe's sink.system (if any — systems not in scope
    ● smtp-server                   but shown for completeness)
```

---

## Motivation

In a Sesam workspace there is a many-to-many relationship between systems (HTTP endpoints,
databases, microservices) and pipes. The existing views and LSP features show dataset/pipe
lineage well, but systems fall outside that DAG. Developers frequently need to answer:

- "I'm about to delete `crm-system` — which collect and share pipes will break?"
- "I'm looking at `rest-collect-orders` — what is the base URL for its source system?"
- "We're upgrading the Oracle database system — which pipes send data to it?"

---

## Architecture

### Extending `FullPipeInfo` (in `pipe-dag-builder.ts`)

Add two new fields to the existing `FullPipeInfo` interface:

```ts
interface FullPipeInfo {
  // …existing fields…
  sourceSystem: string | null;  // from source.system
  sinkSystem: string | null;    // from sink.system
}
```

**Extraction logic in `extractFullPipeInfo`:**

```
source.system  → string when source type is system-backed (rest, sql, json, csv, etc.)
sink.system    → string when sink type is system-backed (rest, sparql, sdshare, etc.)
```

Both are already present as plain `source.system` / `sink.system` string fields in the config
object — no alias stripping needed.

### Extending `DagIndex` (in `pipe-dag-builder.ts`)

Add two new reverse maps:

```ts
interface DagIndex {
  // …existing fields…
  /** System id → pipe ids that use it as source */
  sourceSystemPipes: Map<string, string[]>;
  /** System id → pipe ids that use it as sink */
  sinkSystemPipes: Map<string, string[]>;
}
```

Built in one extra pass during `buildDagIndex`:

```ts
for (const pipe of byId.values()) {
  if (pipe.sourceSystem) {
    push(sourceSystemPipes, pipe.sourceSystem, pipe.id);
  }
  if (pipe.sinkSystem) {
    push(sinkSystemPipes, pipe.sinkSystem, pipe.id);
  }
}
```

### New `SystemIndex`

A separate flat map of all **system** configs (kind = "system"):

```ts
interface SystemEntry {
  id: string;
  fileUri: string;
  systemType: string;  // "system:rest", "system:microservice", etc.
}
```

Populated from the same `buildDagFromWorkspace` scan (already processes all JSON files).
Stored alongside `DagIndex`.

---

## View: System Pipes

**Tree view ID**: `sesamSystemPipes`
**Provider**: `client/src/graph/SystemPipesProvider.ts`

### Active-editor trigger logic

| Active file kind | Root shown |
|---|---|
| System config (`type` starts with `"system:"`) | The system `_id` — shows which pipes use it |
| Pipe config | The pipe `_id` — shows which systems it uses |
| Neither | Placeholder: "Open a system or pipe config to see system connections." |

### Tree node types

| Node | Icon | Meaning |
|---|---|---|
| Active system root | `$(server)` bold | The root when a system file is open |
| Active pipe root | `$(git-commit)` bold | The root when a pipe file is open |
| "Source pipes" group | `$(cloud-download)` | Collapsible group — pipes that source from this system |
| "Sink pipes" group | `$(cloud-upload)` | Collapsible group — pipes that sink to this system |
| "Source systems" group | `$(cloud-download)` | Collapsible group — systems used as source by this pipe |
| "Sink systems" group | `$(cloud-upload)` | Collapsible group — systems used as sink by this pipe |
| Pipe leaf | `$(git-commit)` | A pipe; click opens file |
| System leaf | `$(server)` | A system; click opens file |
| Unresolved | `$(warning)` dim | System/pipe id not found in workspace |
| Empty group | `$(info)` | "None" placeholder inside a group |

Groups show a count badge in the description: e.g. `"(3)"`.

### Behaviour

- Updates on `onDidChangeActiveTextEditor` (same pattern as Lineage / Dependents).
- Clicking any pipe or system node opens the corresponding config file (`vscode.open`).
- Shares the same `dagRef` (from extension.ts) — no second workspace scan.
- A new `systemRef: { current: Map<string, SystemEntry> | null }` shared ref holds the
  system index, also built in `buildDagFromWorkspace`.
- Toolbar "Refresh" button calls `dtl.refreshDag` (existing command).

---

## Changes Required

### `pipe-dag-builder.ts`

1. Add `sourceSystem: string | null` and `sinkSystem: string | null` to `FullPipeInfo`.
2. Extend `extractFullPipeInfo` to read `source.system` and `sink.system`.
3. Add `sourceSystemPipes` and `sinkSystemPipes` to `DagIndex`.
4. Extend `buildDagIndex` to populate those maps.
5. Add `SystemEntry` type.
6. Export a pure `buildSystemIndex(infos: FullPipeInfo[]): Map<string, SystemEntry>` that
   collects all `kind === "system"` entries.

### `extension.ts`

1. Add `systemRef: { current: Map<string, SystemEntry> | null }` alongside `dagRef`.
2. Update `buildDagFromWorkspace` return type to also carry the system index.
3. Construct and register `SystemPipesProvider`.
4. Register `sesamSystemPipes` tree view.
5. `syncActivePipe` → rename to `syncActiveConfig`; also call
   `systemPipesProvider.setCurrentConfig(id, kind)`.

### `package.json`

- Add `sesamSystemPipes` view under `contributes.views.explorer`.

---

## Implementation Steps

1. **Extend `pipe-dag-builder.ts`** — add fields, extraction, new maps, `buildSystemIndex`
2. **Create `SystemPipesProvider.ts`** — `client/src/graph/SystemPipesProvider.ts`
3. **Update `extension.ts`** — register view, wire active-editor listener and scan
4. **Update `package.json`** — add view contribution
5. **Extend `pipe-dag-builder.test.ts`** — tests for new extractions and reverse maps

---

## Files

### New

| File | Purpose |
|---|---|
| `client/src/graph/SystemPipesProvider.ts` | TreeDataProvider for the System Pipes view |

### Modified

| File | Changes |
|---|---|
| `client/src/graph/pipe-dag-builder.ts` | `sourceSystem`/`sinkSystem` fields, reverse maps, `SystemEntry`, `buildSystemIndex` |
| `client/src/extension.ts` | Register view, update scan, wire listener |
| `package.json` | Add `sesamSystemPipes` view |
| `tests/pipe-dag-builder.test.ts` | Tests for new fields and maps |

---

## Verification

1. **Open a system config** → view shows "Source pipes" and "Sink pipes" groups with correct
   pipe counts; clicking a pipe opens its file
2. **Open a pipe config** → view shows "Source systems" and "Sink systems" groups;
   clicking a system opens its file
3. **System with no pipes** → groups show "None" placeholder
4. **Pipe with no systems** → groups show "None" placeholder
5. **Unresolved system id** → warning icon, no navigation
6. **File change** → view refreshes (same `rescanDag` hook)
7. **`pnpm test`** → all tests pass including new `pipe-dag-builder.test.ts` cases
