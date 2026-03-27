# F14: Cross-file Pipe / Dataset / System Navigation

> **Status**: `implemented`
> **Rollout Phase**: Phase 1 - MVP
> **Tracking**: [README.md](../impl/README.md)

---

## Summary

Add cross-file **Go to Definition** (Ctrl+Click / F12), **DocumentLink** (underlined clickable
references), and **Find All References** for dataset and system references in Sesam pipe configs.

Ctrl+Click on `"dataset": "foo"` in a source, sink, or hops section navigates to the pipe file
defining `_id: "foo"`. Same for `"system"` references → system config file. Right-click a pipe's
`_id` → **Find All References** lists every file that references it as a dataset or system.

---

## Motivation

Sesam projects consist of many interconnected pipes. A pipe's source reads from a dataset produced
by another pipe; hops join against lookup datasets from other pipes; systems are shared across
pipes. In the Management Studio, users navigate between pipes via graph views and upstream/downstream
buttons. Locally, developers must manually search for file names — breaking flow.

IDE-native cross-file navigation (F12, Ctrl+Click, underlined links, Find All References) brings
the same interconnected experience to local development.

### How it works in the Management Studio (webconsole)

The webconsole maintains three resolution maps built from all pipe configs:

| Map | Structure | Purpose |
|---|---|---|
| `upstreams` | `{ datasetId → pipeId }` | Which pipe produces this dataset |
| `downstreams` | `{ datasetId → { pipeId → true } }` | Which pipes consume this dataset |
| `lookups` | `{ datasetId → { pipeId → true } }` | Which pipes hop/lookup this dataset |

Key functions (`src/internals/pipes.ts`):
- `getSinkDatasetId(pipe)` — reads `pipe.config.effective.sink.dataset`
- `getSourceDatasetIds(pipe)` — reads source dataset(s)
- `collectDatasets(pipe)` — walks DTL transform for `datasets` arrays in hops
- `getSourceSystemId(pipe)` / `getSinkSystemId(pipe)` — reads system references

### Convention

**Pipe `_id` = dataset name.** A pipe with `"_id": "foo"` always produces dataset `"foo"`.
No need to inspect `sink.dataset`. This matches the projects local convention.

### Example — source.dataset

```json
{
  "_id": "person-enrich",
  "source": {
    "type": "dataset",
    "dataset": "person-collect"       ← Ctrl+Click → opens file with _id "person-collect"
  }
}
```

### Example — hops datasets

```json
["hops", {
  "datasets": ["address-lookup a"],   ← Ctrl+Click → opens file with _id "address-lookup"
  "where": ["eq", "_S.addr_id", "a.id"]
}]
```

### Example — system reference

```json
{
  "_id": "person-collect",
  "source": {
    "type": "rest",
    "system": "hr-system",            ← Ctrl+Click → opens file with _id "hr-system"
    "url": "/api/persons"
  }
}
```

---

## Architecture

### Where it runs

**LSP server** (`server/src/`) for Go to Definition, DocumentLink, and Find All References.
**VS Code client** (`client/src/`) only for registering file watchers so the server's workspace
index stays up to date.

### New concept: Workspace Index

The LSP server currently operates on single documents only — it has no awareness of other files.
This feature introduces a **workspace-scoped index** that maps pipe/system `_id` values to their
file URIs and character offsets.

```
WorkspaceIndex
├── pipeIndex:   Map<pipeId,   { uri: string, idOffset: number }>
├── systemIndex: Map<systemId, { uri: string, idOffset: number }>
├── fileTexts:   Map<uri, string>   (cached file contents for cross-ref search)
├── scanWorkspace(folders)          → full scan on startup
├── updateFile(uri, text)           → incremental update on save/create
└── removeFile(uri)                 → remove on delete
```

### Data flow — Go to Definition (cross-file)

```
User Ctrl+Click on "person-collect" in "dataset": "person-collect"
  → VS Code sends textDocument/definition { position }
  → LSP server handler:
     1. Existing check: findApplyRuleReference → same-file rule navigation (unchanged)
     2. NEW: findDatasetReference(text, offset) → { name: "person-collect", range }
     3. Look up pipeIndex.get("person-collect") → { uri: "file:///…/person-collect.conf.pipe", idOffset: 42 }
     4. Return Location { uri, range pointing to _id value }
  → VS Code opens person-collect.conf.pipe and highlights the _id
```

### Data flow — DocumentLink

```
User opens a pipe config file
  → VS Code sends textDocument/documentLink
  → LSP server handler:
     1. Parse JSON, walk structure for "dataset", "datasets", "system" values
     2. For each value, check pipeIndex / systemIndex
     3. Return DocumentLink[] with target URIs
  → VS Code renders matched values as underlined clickable links
```

### Data flow — Find All References (cross-file)

```
User right-clicks _id "person-collect" → Find All References
  → VS Code sends textDocument/references { position }
  → LSP server handler:
     1. Detect cursor is on _id value → targetId = "person-collect"
     2. Scan all cached file texts for "dataset": "person-collect",
        "datasets" arrays containing "person-collect", "system": "person-collect"
     3. Return Location[] across multiple files
  → VS Code shows results in References panel
```

---

## Implementation Steps

### Phase A — Workspace Index Infrastructure

#### Step 1: Create `workspace-index.ts`

**File**: `server/src/utils/workspace-index.ts`

A module that maintains an in-memory index of all pipe and system configs in the workspace.

**Exports:**

##### `WorkspaceIndex` (object/class)

State:
- `pipeIndex: Map<string, { uri: string; idOffset: number }>` — maps pipe `_id` to file URI and
  byte offset of the `_id` value string (after the opening quote)
- `systemIndex: Map<string, { uri: string; idOffset: number }>` — same for systems
- `fileTexts: Map<string, string>` — cached file contents (needed for cross-file reference search)

Methods:
- `scanWorkspace(folders: WorkspaceFolder[]): Promise<void>` — reads all matching files
  (`**/*.conf.pipe`, `**/*.conf.system`, `**/*.conf.json`, `**/*.json`), parses each, and
  populates `pipeIndex`/`systemIndex`/`fileTexts`
- `updateFile(uri: string, text: string): void` — re-parse a single file and update indices
- `removeFile(uri: string): void` — remove all entries associated with a file URI
- `getFileText(uri: string): string | undefined` — retrieve cached text for cross-ref search

**Parsing logic per file:**
1. `JSON.parse(text)` — skip on failure
2. Extract `_id` (string) and `type` (string, default `"pipe"`)
3. Find offset of `_id` value: use `findKeyOffset(text, "_id", 0)` from `server.utils.ts`, then
   scan forward to the value string position
4. If `type === "system"` → insert into `systemIndex`, else → insert into `pipeIndex`
5. Cache `text` in `fileTexts`

#### Step 2: Initialize index on server startup

**File**: `server/src/server.ts`

- In `onInitialize`, capture `params.workspaceFolders` and store in a module-level variable
- Register `workspace.fileOperations` capability for `didChangeWatchedFiles`
- After `onInitialized`, call `workspaceIndex.scanWorkspace(workspaceFolders)`
- Add `connection.onDidChangeWatchedFiles(params => ...)` handler:
  - For each change event:
    - `Created` / `Changed` → read file contents, call `workspaceIndex.updateFile(uri, text)`
    - `Deleted` → call `workspaceIndex.removeFile(uri)`

#### Step 3: Client-side file watcher registration

**File**: `client/src/extension.ts`

Register file watchers so the server receives `didChangeWatchedFiles` notifications:

```ts
const clientOptions: LanguageClientOptions = {
  // ...existing options...
  synchronize: {
    fileEvents: [
      workspace.createFileSystemWatcher("**/*.conf.pipe"),
      workspace.createFileSystemWatcher("**/*.conf.system"),
      workspace.createFileSystemWatcher("**/*.conf.json"),
      workspace.createFileSystemWatcher("**/*.json"),
    ],
  },
};
```

---

### Phase B — Reference Detection Utils

*Can be implemented in parallel with Phase A.*

#### Step 4: Create `reference-detection.utils.ts`

**File**: `server/src/utils/reference-detection.utils.ts`

Pure functions to detect whether the cursor is on a dataset or system reference.

##### `findDatasetReference(text, offset)`

Detects if `offset` is inside a string literal that is the value of a `"dataset"` key or an
element of a `"datasets"` array.

- Find enclosing `"..."` string boundaries (same backward/forward scan as `findApplyRuleReference`)
- Extract the raw string value
- Check preceding text for patterns:
  - `"dataset"\s*:\s*$` → source/sink dataset reference
  - Inside a `"datasets"\s*:\s*\[` array → hops dataset reference
- For hops datasets, handle alias form: `"dataset-name ALIAS"` → extract `"dataset-name"`
- Return `{ name: string, range: { start: number, end: number } } | null`

##### `findSystemReference(text, offset)`

Same logic, but checks for `"system"\s*:\s*$` pattern preceding the string.

- Return `{ name: string, range: { start: number, end: number } } | null`

##### `findIdAtOffset(text, offset)`

Detects if `offset` is on the value of the `"_id"` key at the root level of the config.

- Find enclosing string, check preceding text for `"_id"\s*:\s*$`
- Return `{ name: string, range: { start: number, end: number } } | null`

#### Step 5: Unit tests for reference detection

**File**: `tests/reference-detection.test.ts`

Test cases:

**`findDatasetReference`:**
- Cursor on `"person-collect"` in `"dataset": "person-collect"` → `{ name: "person-collect" }`
- Cursor on `"addr-lookup"` in `"datasets": ["addr-lookup a"]` → `{ name: "addr-lookup" }` (alias stripped)
- Cursor on `"other-data"` in `"datasets": ["first", "other-data"]` → `{ name: "other-data" }`
- Cursor on `"add"` in `["add", "x", "y"]` → `null` (not a dataset context)
- Cursor on `"_id"` value → `null` (not a dataset reference)

**`findSystemReference`:**
- Cursor on `"hr-system"` in `"system": "hr-system"` → `{ name: "hr-system" }`
- Cursor on `"dataset"` value → `null`

**`findIdAtOffset`:**
- Cursor on `"person-enrich"` in `"_id": "person-enrich"` → `{ name: "person-enrich" }`
- Cursor on non-`_id` string → `null`

---

### Phase C — Cross-file Go to Definition

*Depends on Phase A + Phase B.*

#### Step 6: Extend `onDefinition` handler

**File**: `server/src/server.ts`

The existing handler chains: `findApplyRuleReference` → `findRuleDefinition` (same-file rules).
Add a fallback chain after the existing logic:

```
connection.onDefinition(params => {
  // 1. Existing: same-file rule navigation
  const ref = findApplyRuleReference(text, offset);
  if (ref) {
    const def = findRuleDefinition(text, ref.ruleName, offset);
    if (def) return Location.create(uri, ...);
  }

  // 2. NEW: dataset reference → cross-file
  const dsRef = findDatasetReference(text, offset);
  if (dsRef) {
    const target = workspaceIndex.pipeIndex.get(dsRef.name);
    if (target) return Location.create(target.uri, range from target.idOffset);
  }

  // 3. NEW: system reference → cross-file
  const sysRef = findSystemReference(text, offset);
  if (sysRef) {
    const target = workspaceIndex.systemIndex.get(sysRef.name);
    if (target) return Location.create(target.uri, range from target.idOffset);
  }

  return null;
});
```

---

### Phase D — DocumentLink Provider

*Depends on Phase A.*

#### Step 7: Create `document-links.utils.ts`

**File**: `server/src/utils/document-links.utils.ts`

##### `collectDocumentLinks(text, pipeIndex, systemIndex)`

Parse the config JSON and walk its structure to find all linkable references:

1. **`"dataset": "value"`** — in source or sink objects
2. **`"datasets": [...]`** — in hops specs, each array element is a link (strip alias)
3. **`"system": "value"`** — in source or sink objects

For each found value:
- Check if the name exists in `pipeIndex` (for datasets) or `systemIndex` (for systems)
- Find the character offset of the value string in the raw text
- Create a `DocumentLink` with `range` (character offsets → LSP Range) and `target` (file URI)

Return `DocumentLink[]`.

#### Step 8: Wire DocumentLink handler

**File**: `server/src/server.ts`

- In `onInitialize`, add `documentLinkProvider: { resolveProvider: false }` to capabilities
- Add handler:

```
connection.onDocumentLinks(params => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return collectDocumentLinks(
    doc.getText(),
    workspaceIndex.pipeIndex,
    workspaceIndex.systemIndex
  );
});
```

---

### Phase E — Cross-file Find All References

*Depends on Phase A.*

#### Step 9: Create `cross-references.utils.ts`

**File**: `server/src/utils/cross-references.utils.ts`

##### `findAllCrossReferences(targetId, fileTexts)`

Scan all cached file texts for references to `targetId`:

- For each file in `fileTexts`:
  1. Parse JSON (skip on failure)
  2. Walk the parsed structure for:
     - `"dataset": "targetId"` — in source/sink
     - `"datasets": [... "targetId" ...]` or `"targetId ALIAS"` — in hops
     - `"system": "targetId"` — in source/sink
  3. For each match, find the character offset in the raw text
  4. Create `Location { uri, range }` for each match

Return `Location[]`.

#### Step 10: Extend `onReferences` handler

**File**: `server/src/server.ts`

Add cross-file reference handling when cursor is on a pipe/system `_id`:

```
connection.onReferences(params => {
  // Existing: same-file rule references
  // ...existing logic...

  // NEW: if cursor is on _id value, do cross-file search
  const idHit = findIdAtOffset(text, offset);
  if (idHit) {
    const crossRefs = findAllCrossReferences(idHit.name, workspaceIndex.fileTexts);
    locations.push(...crossRefs);

    if (params.context.includeDeclaration) {
      // Include the _id itself as the declaration
      locations.push(Location.create(uri, range from idHit));
    }
  }

  return locations.length > 0 ? locations : null;
});
```

---

### Phase F — Tests

#### Step 11: Unit tests for document links

**File**: `tests/document-links.test.ts`

- Pipe with `source.dataset` → one DocumentLink
- Pipe with `hops.datasets` array → one link per dataset
- Pipe with `source.system` → one DocumentLink
- Unknown dataset/system → no link emitted
- Multiple references in one file → all collected

#### Step 12: Unit tests for cross-file references

**File**: `tests/cross-references.test.ts`

- Target ID referenced as `source.dataset` in another file → found
- Target ID referenced in `datasets` array → found
- Target ID referenced as `system` → found
- Target ID with alias (`"target-id someAlias"`) → found
- Target ID not referenced anywhere → empty array

---

## Relevant Files

### Files to create

| File | Purpose |
|---|---|
| `server/src/utils/workspace-index.ts` | Workspace scanning, pipe/system index maintenance |
| `server/src/utils/reference-detection.utils.ts` | Detect dataset/system/id refs at cursor position |
| `server/src/utils/document-links.utils.ts` | Collect all linkable references in a document |
| `server/src/utils/cross-references.utils.ts` | Find all files referencing a given pipe/system ID |
| `tests/reference-detection.test.ts` | Unit tests for reference detection |
| `tests/document-links.test.ts` | Unit tests for document link collection |
| `tests/cross-references.test.ts` | Unit tests for cross-file reference lookup |

### Files to modify

| File | Changes |
|---|---|
| `server/src/server.ts` | Capture workspace folders, init index, register `didChangeWatchedFiles`, extend `onDefinition`, add `onDocumentLinks`, extend `onReferences` |
| `client/src/extension.ts` | Add `synchronize.fileEvents` watchers to `LanguageClientOptions` |

### Files to reference (patterns)

| File | Useful pattern |
|---|---|
| `server/src/utils/definition.utils.ts` | Offset-based string detection (`findApplyRuleReference`) |
| `server/src/utils/server.utils.ts` | `findKeyOffset` helper |
| `client/src/graph/PipeGraphProvider.ts` | Workspace scanning, `extractPipeInfo`, `collectHopDatasets`, `datasetIndex` |

---

## Verification

1. **Unit tests** — `pnpm test` passes all new tests in `reference-detection.test.ts`,
   `document-links.test.ts`, `cross-references.test.ts`
2. **Existing tests** — `pnpm test` — no regressions
3. **Go to Definition: source.dataset** — Open pipe with `"dataset": "some-pipe"` → Ctrl+Click →
   navigates to `some-pipe.conf.pipe`
4. **Go to Definition: hops** — Ctrl+Click `"lookup-pipe"` inside
   `"datasets": ["lookup-pipe a"]` → navigates to `lookup-pipe.conf.pipe`
5. **Go to Definition: system** — Ctrl+Click `"system": "my-system"` → navigates to system config
6. **Go to Definition: sink.dataset** — Ctrl+Click dataset in sink → navigates to producing pipe
7. **DocumentLink** — dataset and system values appear underlined; clicking opens target file
8. **Find All References** — Right-click pipe `_id` → shows all files referencing it
9. **Index updates** — Create new pipe file → immediately navigable; delete → links become inactive
10. **Existing navigation** — Same-file rule Go to Definition (F13) still works unchanged

---

## Decisions

| Decision | Rationale |
|---|---|
| Pipe `_id` = dataset name | Matches project convention; no `sink.dataset` parsing needed |
| Server-side index | LSP handles all definition/reference requests; index must live in server process |
| Both Go to Definition AND DocumentLink | Discoverability (underlined) + keyboard navigation (F12) |
| Scan `.conf.pipe`, `.conf.system`, `.conf.json`, `.json` | Matches existing PipeGraphProvider scope |
| Separate from PipeGraphProvider | Tree view (client) and LSP (server) are different processes; keep both, unify later |

## Future considerations

- **`["lookup", "dataset-name", ...]`** — DTL lookup function also references datasets; could
  extend detection to cover this as a follow-up
- **PipeGraphProvider deduplication** — Client already scans workspace for tree view; could share
  data via custom LSP requests in the future
- **Large workspaces** — Eager scan on init is fine for typical Sesam projects (<200 files);
  add lazy/incremental indexing if perf becomes an issue
