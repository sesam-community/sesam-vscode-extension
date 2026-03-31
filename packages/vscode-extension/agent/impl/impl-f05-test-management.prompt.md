# F05: Test Management (VS Code Testing API)

> **Status**: `planned`
> **Rollout Phase**: Phase 2 - Testing & Diff
> **Tracking**: [README.md](README.md)

---

## Summary

Faithfully reimplement sesam-py's `test` command flow across the monorepo: core logic lives in `@sesam/core`
(NodeClient, TestSpec reader, entity filter/compare, `testPipes()` orchestration) and the VS Code extension
adds only the thin VS Code-specific layer (credential resolution, Testing API wiring, CodeLens).

No subprocess dependency on F00/F01 — all Sesam node API calls are made in-process from `@sesam/core`.
`@sesam/cli` will reuse `testPipes()` for its `test` sub-command at no extra cost.

---

## sesam-py Test Folder Structure

A sesam-py test suite lives in a single directory. The extension discovers the `expected/` folder to find
tests:

```
<test-suite>/
├── pipes/                    ← pipe configs uploaded to the node (*.conf.json)
├── systems/                  ← system configs (optional, *.conf.json)
├── expected/                 ← spec files + expected output (same level as pipes/)
│   ├── <pipe-id>.test.json   ← test spec; minimal: {"pipe": "output-pipe1"}
│   ├── <pipe-id>.json        ← expected entity array (JSON endpoint, default)
│   └── <pipe-id>.csv         ← expected output for non-JSON endpoints
├── testdata/                 ← (optional) input entities POSTed to pipe HTTP receivers
│   └── <pipe-id>.json
├── node-metadata.conf.json
├── test-env.json             ← env vars uploaded before run
└── whitelist.txt             ← (optional) pipe IDs to include
```

**Notes:**
- `testdata/` is absent when pipes use `embedded` or `http_endpoint` sources
- The `"file"` field in a `.test.json` spec defaults to `<name>.json`; override for non-JSON outputs
  (e.g. `"file": "output-pipe-csv.csv"`)
- Test discovery: enumerate all `expected/*.test.json` files — each one is a test case

### `.test.json` spec fields

| Field | Default | Description |
|---|---|---|
| `pipe` | filename stem | Pipe ID to test |
| `file` | `<name>.json` | Expected output filename |
| `endpoint` | `"json"` | Output type: `json`, `csv`, `xml`, etc. |
| `ignore` | `false` | If true, output file should NOT exist |
| `ignore_deletes` | `true` | Filter unexpected `_deleted: true` entities |
| `stage` | `null` | Pipeline stage parameter for entity fetch |
| `blacklist` | `null` | fnmatch path patterns to exclude from comparison |
| `parameters` | `null` | Query params for published data endpoint |
| `fields_to_sort_by` | `["_id"]` | Sort fields (full JSON dump used as tiebreaker) |

---

## sesam-py Execution Flow (ported faithfully)

1. **`upload()`**: PUT env vars → PUT config ZIP → wait for pipes to deploy → POST testdata to receivers
2. **`run()`**: `POST /pipes/run-all-pipes` (`extra_zero_runs=2`, `max_runs=100`)
3. **`verify()`** per spec:
   - `GET /pipes/{id}/entities` (or `GET /publishers/{id}/{endpoint}` for non-JSON)
   - Filter: remove `_*` keys except `_id` and `_deleted=true`; apply `blacklist` fnmatch patterns
     (`[].` → `*.` replacement before matching)
   - Apply `ignore_deletes`: skip unexpected `_deleted: true` entities
   - Sort by `fields_to_sort_by` + full JSON dump as tiebreaker
   - Normalize: float `x.0` → int; large int > 9007199254740991 → float-rounded int (Go client compat)
   - Serialize: `JSON.stringify` with `indent=2`, sorted keys + HTML-escape `< > &`
     → `\u003c \u003e \u0026`
   - Unified diff on mismatch

---

## Implementation Phases

### Phase 1: `@sesam/core` — Types + NodeClient + Config ZIP

**Step 1** — Add `packages/core/src/types.ts`:
- `NodeCredentials`: `{ nodeUrl, jwtToken, sslVerify }`
- `TestSpec`: all fields above with sesam-py defaults baked in
- `TestResult`: `{ spec: TestSpec, passed: boolean, diff?: string, error?: string }`
- `RunOptions`: `{ extraZeroRuns?, maxRuns?, maxRunTime? }`

**Step 2** — Create `packages/core/src/node-client.ts` — `NodeClient(creds)` class:
- `putEnvVars(vars)` → `PUT /environment-variables`
- `putConfig(zipBuffer, force?)` → config upload endpoint
- `waitForDeploy(timeoutMs?)` → poll `GET /pipes`; wait until no pipe has `runtime.state === "Deploying"`
- `postToReceiver(pipeId, entities)` → POST testdata; 503-retry for up to 60 s
- `runAllPipes(opts?)` → `POST /pipes/run-all-pipes`; polls async token when needed
- `getPipeEntities(pipeId, stage?)` → `GET /pipes/{id}/entities`
- `getPublishedData(pipeId, type, params?, binary?)` → `GET /publishers/{id}/{type}`
- All requests: `Authorization: Bearer {jwtToken}`; uses native `fetch` (Node 18+)

**Step 3** — Create `packages/core/src/config-zipper.ts`:
- `zipWorkspaceConfig(dir: string): Promise<Buffer>` — ZIPs `pipes/*.conf.*` + `systems/*.conf.*` +
  `node-metadata.conf.json`
- Uses `jszip` (pure-JS, no native bindings)

**Step 4** — Create `packages/core/src/test-spec-reader.ts`:
- `readTestSpec(specFilePath: string): TestSpec` — parse `.test.json`, apply all sesam-py defaults
- `readExpectedOutput(specFilePath: string): Promise<unknown[]>` — load `expected/<name>.json`
  relative to the spec file

### Phase 2: `@sesam/core` — Entity Filter + Comparison Engine + Orchestration

**Step 5** — Create `packages/core/src/test-entity-filter.ts`:
- `filterEntity(entity, blacklist?)` — removes `_*` keys except `_id` and `_deleted=true`;
  applies fnmatch blacklist (`[].` → `*.` before matching; use `micromatch` or manual implementation)
- `applyIgnoreDeletes(current, expected)` — drops unexpected `_deleted: true` entities from current
- `sortEntities(entities, fieldsToSortBy)` — sort key = `[...fieldValues, JSON.stringify(entity)]`
- `normalizeDecimals(value)` — float `x.0` → int; large int → float-rounded int

**Step 6** — Create `packages/core/src/test-comparator.ts`
  — `compareTestOutput(current, expected, spec): TestCompareResult`:
- Calls filter → ignore-deletes → sort → normalize in sequence
- Serializes with `JSON.stringify(..., null, 2)` + sorted keys + HTML-escape `< > &`
- Unified diff via `diff` npm package `createTwoFilesPatch`
- Returns `{ passed, diff?, lengthMismatch? }`

**Step 7** — Create `packages/core/src/test-runner.ts`
  — `testPipes(creds, workspaceDir, opts?: { whitelist?: string[] }): Promise<TestResult[]>`:
- Runs the full `upload() → run() → verify()` cycle described above
- No VS Code imports anywhere in this file

**Step 8** — Update `packages/core/src/index.ts` to export all new symbols; add `jszip` and `diff` to
  `packages/core/package.json` dependencies

**Step 9** — Unit tests in `packages/core/tests/`:
- `test-entity-filter.test.ts`: blacklist matching, `ignore_deletes`, sort, decimal normalization
- `test-comparator.test.ts`: HTML escaping, length mismatch, content mismatch diff output, pass case

### Phase 3: VS Code Extension — Credential Resolution + Testing API

**Step 10** — Add `"@sesam/core": "workspace:*"` to `packages/vscode-extension/package.json`

**Step 11** — Create `client/src/testing/credential-resolver.ts`:
- `resolveCredentials(context, workspaceRoot): Promise<NodeCredentials | null>`
- Priority: VS Code SecretStorage keys `sesam.nodeUrl` / `sesam.jwtToken`
  → fall back to `.syncconfig` file parse (`NODE=...` / `JWT=...`)

**Step 12** — Create `client/src/testing/sesam-test-controller.ts`
  — `registerSesamTestController(context)`:
- `vscode.tests.createTestController('sesam-pipes', 'Sesam Pipes')`
- Discovery: `findFiles('**/expected/*.test.json')` → one `TestItem` per spec
  - `id`: pipe name (filename stem minus `.test.json`)
  - `label`: pipe name; `uri`: spec file URI
  - Grouped under a root `TestItem` per workspace folder
- File watcher: `createFileSystemWatcher('**/expected/*.test.json')` → live add/remove TestItems

**Step 13** — Implement `TestRunRequest` handler in `sesam-test-controller.ts`:
- Missing credentials → `run.errored(item, message)` for all items
- Calls `testPipes(creds, workspaceRoot, { whitelist })` from `@sesam/core`
- Maps each `TestResult` → `run.passed(item)` or `run.failed(item, TestMessage)`
- On failure: `vscode.TestMessage.diff(pipeName, expectedJson, actualJson)`

**Step 14** — Call `registerSesamTestController(context)` at the bottom of `client/src/extension.ts`

### Phase 4: Failure Diff View

**Step 15** — On failure, also open the VS Code native diff editor:
- Write actual JSON to a temp file under `context.globalStorageUri`
- `vscode.commands.executeCommand('vscode.diff', expectedUri, actualUri, 'Expected vs Actual: {pipe}')`
- Clean up temp files on `TestRun` dispose

### Phase 5: Test Authoring Helpers (CodeLens)

**Step 16** — Create `client/src/testing/test-codelens-provider.ts`:
- "▶ Run pipe test" CodeLens above `_id` in `pipes/**/*.json` → `sesam.runPipeTest` command
- "⟳ Update expected output" CodeLens on `expected/*.json` → calls `testPipes` for that pipe and
  overwrites the expected file

**Step 17** — Register the CodeLens provider in `client/src/extension.ts`

### Phase 6: `@sesam /test` Chat Participant Integration (depends on F09)

**Step 18** — Update `client/src/sesam-chat-participant.ts`:
- Rename the existing `test` intent → `generate-test` (keep LM-based test data generation under `/generate-test`)
- Add new `run-tests` intent wired to the `/test` slash command
- `handleRunTests()`: resolves credentials → calls `testPipes(creds, workspaceRoot)` from
  `@sesam/core` → streams a Markdown summary of pass/fail results per pipe
- On any failure: streams the unified diff inline in the chat response and offers a
  `$(diff) Open diff` button that runs `sesam.openTestDiff` for that pipe

**Step 19** — Update the `chatParticipants` contribution in `package.json`:
- Add slash command `"test"` with description `"Run all pipe tests against the Sesam node"`
- Rename existing `"test"` command to `"generate-test"` with description
  `"Generate test data and expected output for a pipe using AI"`

---

## Files to Modify / Add

### `@sesam/core` (`packages/core/`)

| File | Change |
|---|---|
| `src/types.ts` | new — `NodeCredentials`, `TestSpec`, `TestResult`, `RunOptions` |
| `src/node-client.ts` | new — Sesam REST API client |
| `src/config-zipper.ts` | new — ZIP workspace configs via `jszip` |
| `src/test-spec-reader.ts` | new — read `.test.json` with sesam-py defaults |
| `src/test-entity-filter.ts` | new — filter / sort / normalize entities |
| `src/test-comparator.ts` | new — comparison + unified diff |
| `src/test-runner.ts` | new — `testPipes()` orchestration |
| `src/index.ts` | add exports for all new symbols |
| `package.json` | add `jszip`, `diff` to `dependencies` |
| `tests/test-entity-filter.test.ts` | new — Vitest unit tests |
| `tests/test-comparator.test.ts` | new — Vitest unit tests |

### VS Code Extension (`packages/vscode-extension/`)

| File | Change |
|---|---|
| `package.json` | add `"@sesam/core": "workspace:*"` to `dependencies` |
| `client/src/extension.ts` | call `registerSesamTestController(context)` |
| `client/src/testing/credential-resolver.ts` | new — SecretStorage + `.syncconfig` |
| `client/src/testing/sesam-test-controller.ts` | new — `TestController`, discovery, watcher, run handler |
| `client/src/testing/test-codelens-provider.ts` | new — run + update CodeLens |
| `client/src/sesam-chat-participant.ts` | add `run-tests` intent for `/test`; rename `test` → `generate-test` |
| `package.json` | add `/test` and rename `/generate-test` in `chatParticipants` contribution |

---

## Dependencies

- **`@sesam/core`** — all portable test logic lives here; no VS Code imports
- **`@sesam/cli`** — will wrap `testPipes()` with a `test` sub-command (no code duplication)
- **F03** — when implemented, replace inline `context.secrets` calls in `credential-resolver.ts`
  with the `CredentialManager` class (same `NodeCredentials` interface)
- **F06** — the diff mechanism in Phase 4 can be shared with the Status/Diff view
- **F09** — `@sesam /test` triggers `testPipes()` in-chat; `@sesam /generate-test` is the renamed
  LM-based test data generator (previously `/test`)

---

## Verification

1. Open a workspace with `expected/*.test.json` → Test Explorer shows one item per spec
2. Delete a `.test.json` file → item removed from Test Explorer in real time
3. Run a single test → only that pipe is verified; others are skipped
4. Run all tests → full `upload → run → verify` cycle completes
5. Introduce a deliberate mismatch in expected output → test fails with unified diff + diff editor opens
6. `pnpm test` from repo root → `packages/core/tests/` all pass
7. No `.syncconfig` and no SecretStorage → clear error message shown, extension does not crash
8. `.syncconfig` with `NODE=` and `JWT=` present → credentials auto-loaded, tests run
9. `@sesam /test` in Copilot Chat → streams pass/fail summary; failures show unified diff inline
10. `@sesam /generate-test` still works as before (LM-generated test data)
