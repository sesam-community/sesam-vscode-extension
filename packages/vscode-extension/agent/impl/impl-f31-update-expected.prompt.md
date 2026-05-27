# F31: `sesam update` — Update Expected Output

> **Status**: `planned`
> **Rollout Phase**: Phase 2 - Testing & Diff
> **Depends on**: F05 (test infrastructure — `testPipes`, `test-comparator.ts`, `test-spec-reader.ts`)
> **Tracking**: [README.md](README.md)

---

## Summary

Implement `sesam update` — the snapshot-acceptance step in the sesam-py test loop:

```
sesam upload → sesam run → sesam update → sesam verify
```

`sesam update` runs the same upload-and-run pipeline as `sesam test`, but instead of comparing
actual output against `expected/*.json`, it **overwrites** those files with the actual output.
This is the "accept current results as golden" operation — equivalent to Jest's `--updateSnapshot`.

---

## sesam-py Behaviour (source of truth)

1. Validate local configs (same guard as `sesam upload`).
2. PUT env vars from `test-env.json`.
3. ZIP + PUT workspace config; wait for deploy.
4. POST testdata from `testdata/` to receivers.
5. `POST /pipes/run-all-pipes`; poll until all pipes are idle.
6. For each `expected/*.test.json` spec (respecting `whitelist` if supplied):
   - Skip specs with `"ignore": true` (no output expected — nothing to write).
   - Fetch actual entities from the node (`GET /pipes/{id}/entities` or publisher endpoint).
   - Apply the same **filter → ignore-deletes → sort → normalize → serialize** pipeline used
     by `compareTestOutput` so the written file will pass a subsequent `sesam verify` without diff.
   - Write serialized JSON to `expected/<file>` (create or overwrite).
7. Report: N files written.

---

## Implementation Plan

### Step 1 — Extract shared serialization helper in `test-comparator.ts`

`compareTestOutput` already contains the filter → sort → normalize → serialize pipeline.
Extract it into a named export so `update-expected.ts` can reuse it without duplication.

```ts
// packages/core/src/test-comparator.ts

/**
 * Apply the full sesam-py entity pipeline (filter, ignore-deletes, sort,
 * normalize, serialize) to `actual` using the spec's settings.
 *
 * Returns the serialized JSON string — the same format written to
 * `expected/*.json` files and used for diff comparison.
 */
export function serializeEntities(actual: Entity[], spec: TestSpec): string { ... }
```

Update `compareTestOutput` to call `serializeEntities` internally — no behaviour change.

---

### Step 2 — Create `packages/core/src/update-expected.ts`

```ts
import type { NodeCredentials, UpdateExpectedOptions, UpdateExpectedResult } from "./types.js";

export async function updateExpectedOutput(
  creds: NodeCredentials,
  workspaceDir: string,
  opts?: UpdateExpectedOptions,
): Promise<UpdateExpectedResult>
```

**Flow** (mirrors `testPipes` steps 1-5, then replaces verify with write):

1. Validate (unless `opts.skipValidate`).
2. PUT env vars from `test-env.json` + `opts.envVars`.
3. ZIP + PUT config; `waitForDeploy()`.
4. POST testdata from `testdata/` to receivers.
5. `runAllPipes()`.
6. `discoverTestSpecs(workspaceDir)` → filter by `opts.whitelist` if present.
7. For each spec:
   - Skip if `spec.ignore === true`.
   - Fetch actual entities using the same branch as `testPipes`:
     - `spec.endpoint === "json"` → `client.getPipeEntities(spec.pipe, spec.stage ?? undefined)`
       (`GET /pipes/{id}/entities`, optional `?stage=` query param)
     - any other endpoint → `client.getPublishedData(spec.pipe, spec.endpoint, spec.parameters ?? undefined)`
       (`GET /publishers/{id}/{endpoint}`, optional query params from `spec.parameters`)
     The `spec.endpoint` field (defaulting to `"json"`) and `spec.pipe` are read from the
     `.test.json` spec file — the same file that controls `sesam verify`.
   - Call `serializeEntities(actual, spec)` → `serialized`.
   - `fs.writeFile(expectedFilePath, serialized, "utf-8")` — create or overwrite.
   - Call `opts.onUpdated?.(spec.pipe, expectedFilePath)`.
8. Return `{ filesWritten, filePaths }`.

The `expectedFilePath` is resolved the same way as `readExpectedOutput` in
`test-spec-reader.ts`: `path.join(path.dirname(specPath), spec.file)`.

---

### Step 3 — Add types to `packages/core/src/types.ts`

```ts
export interface UpdateExpectedOptions {
  /** Only update specs whose pipe ID appears in this list. */
  whitelist?: string[];
  /** Skip pre-upload local validation. */
  skipValidate?: boolean;
  /** Extra env vars to PUT before uploading. */
  envVars?: Record<string, string>;
  /** Called at the start of each pipeline phase (for progress logging). */
  onPhase?: (phase: string) => void;
  /** Called after each expected file is written. */
  onUpdated?: (pipeId: string, filePath: string) => void;
}

export interface UpdateExpectedResult {
  filesWritten: number;
  filePaths: string[];
}
```

---

### Step 4 — Export from `packages/core/src/index.ts`

```ts
export { updateExpectedOutput } from "./update-expected.js";
export { serializeEntities } from "./test-comparator.js";
export type { UpdateExpectedOptions, UpdateExpectedResult } from "./types.js";
```

---

### Step 5 — VS Code command: `sesam.updateExpected`

Register in `client/src/extension.ts` alongside the other sesam commands:

```ts
commands.registerCommand("sesam.updateExpected", async () => {
  if (isSesamTestRunning()) {
    window.showWarningMessage("Sesam tests are running. Please wait for them to finish.");
    return;
  }

  const confirmed = await window.showWarningMessage(
    "This will overwrite all expected/*.json files with the current node output. Continue?",
    { modal: true },
    "Update Expected",
  );

  if (confirmed !== "Update Expected") return;

  const creds = await resolveCredentials(context, workspaceRoot);
  if (!creds) return;

  await withNetworkStatus("Updating expected output...", async () => {
    const result = await updateExpectedOutput(creds, workspaceRoot, {
      onPhase: (phase) => logToChannel(phase),
      onUpdated: (pipeId, filePath) => logToChannel(`Updated: ${filePath}`),
    });

    window.showInformationMessage(
      `Updated ${result.filesWritten} expected file(s).`,
    );
  });
});
```

Add to `package.json`:

```json
{
  "command": "sesam.updateExpected",
  "title": "Sesam: Update Expected Output",
  "icon": "$(refresh)"
}
```

Add to `menus.editor/title` (visible on `sesam-config` files, same group as test commands):

```json
{
  "command": "sesam.updateExpected",
  "when": "resourceLangId == sesam-config",
  "group": "navigation"
}
```

Add to `menus.commandPalette`:

```json
{ "command": "sesam.updateExpected" }
```

---

### Step 6 — Single-pipe update from CodeLens (F05 Step 16)

When the F05 CodeLens provider ("⟳ Update expected output" on `expected/*.json`) is implemented,
wire it to `sesam.updateExpectedFile` — a variant command that calls `updateExpectedOutput` with
`whitelist: [pipeId]` derived from the file name, skipping the confirmation dialog (the CodeLens
placement is already explicit enough).

```ts
commands.registerCommand("sesam.updateExpectedFile", async (pipeId: string) => {
  const creds = await resolveCredentials(context, workspaceRoot);
  if (!creds) return;

  await withNetworkStatus(`Updating expected output for ${pipeId}...`, async () => {
    const result = await updateExpectedOutput(creds, workspaceRoot, {
      whitelist: [pipeId],
      onPhase: (phase) => logToChannel(phase),
    });

    window.showInformationMessage(
      result.filesWritten > 0
        ? `Updated expected output for ${pipeId}.`
        : `No expected file found for ${pipeId}.`,
    );
  });
});
```

---

### Step 7 — Unit tests in `packages/core/tests/update-expected.test.ts`

| Test case | Description |
|---|---|
| Writes serialized output to expected file | Happy path — actual entities fetched and written |
| Skips `ignore: true` specs | File with `ignore: true` is not written |
| Respects `whitelist` | Only whitelisted pipe's file is updated |
| Creates file if not present | Works even if `expected/<pipe>.json` does not exist |
| Written file passes `compareTestOutput` | Round-trip: update → compare → `passed === true` |

---

## Files to Modify / Add

### `@sesam/core` (`packages/core/`)

| File | Change |
|---|---|
| `src/test-comparator.ts` | Extract and export `serializeEntities(actual, spec)` |
| `src/update-expected.ts` | New — `updateExpectedOutput()` |
| `src/types.ts` | Add `UpdateExpectedOptions`, `UpdateExpectedResult` |
| `src/index.ts` | Export new symbols |
| `tests/update-expected.test.ts` | New — Vitest unit tests |

### VS Code Extension (`packages/vscode-extension/`)

| File | Change |
|---|---|
| `package.json` | Add `sesam.updateExpected` command + `editor/title` menu entry |
| `client/src/extension.ts` | Register `sesam.updateExpected` and `sesam.updateExpectedFile` commands |

---

## Dependencies

- **F05** — `testPipes`, `discoverTestSpecs`, `readTestSpec`, `compareTestOutput`, `serializeEntities`
  must be in place before this feature can be implemented
- **F03** — `resolveCredentials` for the VS Code command

---

## Not In Scope

- `@sesam/cli` sub-command (`sesam update`) — follows automatically once
  `updateExpectedOutput` is exported from `@sesam/core`; add to F00/CLI work
- Interactive diff-and-accept UI (select which pipes to accept) — future enhancement
