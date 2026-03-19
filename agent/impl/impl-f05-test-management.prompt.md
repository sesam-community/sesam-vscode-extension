# F05: Test Management (VS Code Testing API)

> **Status**: `planned`
> **Rollout Phase**: Phase 2 - Testing & Diff
> **Tracking**: [README.md](README.md)

---

## Summary

Integrate sesam-py's test system into the native VS Code Test Explorer. sesam-py tests live in `*.test.json`
files alongside `expected/` output directories. This feature discovers test files, surfaces them in the Test
Explorer, lets users run/debug individual tests, and shows diff output on failures.

---

## sesam-py Test Conventions

- Input entities: `<pipe-name>.test.json` (array of entity objects)
- Expected output: `expected/<pipe-name>.json`
- Run: `sesam test` - executes all pipes with test data and compares with expected
- Failure output: stdout prints a JSON diff of actual vs expected

---

## Implementation Phases

### Phase A: Test Discovery

1. Create `client/src/sesamTestProvider.ts` implementing `vscode.TestController`.
2. Use `vscode.workspace.findFiles('**/*.test.json')` to discover test files on activation and via
   `vscode.workspace.createFileSystemWatcher`.
3. For each discovered `*.test.json`, create a `TestItem` with:
   - `id`: pipe name derived from filename
   - `label`: pipe name
   - `uri`: path to the `.test.json` file
4. Group test items under a root `TestItem` named "Sesam Pipes".
5. Register the controller with `vscode.tests.createTestController('sesam', 'Sesam')`.

### Phase B: Test Execution

1. Implement `TestRunRequest` handler in `sesamTestProvider.ts`:
   - Running all tests: spawn `sesam test` (via F00/F01 binary mechanism).
   - Running a single test: spawn `sesam run <pipe-name> --use-test-data` (or equivalent flag).
2. Parse sesam-py test output to determine pass/fail per pipe.
3. Map pass/fail back to `TestItem` via `TestRun.passed()` / `TestRun.failed()`.
4. On failure, populate `TestMessage` with the diff string from sesam output.

### Phase C: Diff View on Failure

1. On test failure, extract the actual output JSON from sesam-py stderr/stdout.
2. Use `vscode.commands.executeCommand('vscode.diff', expectedUri, actualTempUri, 'Expected vs Actual')`
   to open a native diff editor.
3. Store actual output as a temp file in `os.tmpdir()` for the duration of the test run.
4. Clean up temp files when the `TestRun` is disposed.

### Phase D: Test Authoring Helpers

1. CodeLens above pipe JSON files: "Add test data" -> creates `<pipe-name>.test.json` from a template.
2. CodeLens above `<pipe-name>.test.json`: "Update expected output" -> runs the pipe and writes output
   to `expected/<pipe-name>.json` (useful after intentional logic changes).
3. Snippet for entity template in `.test.json` files (add to `snippets/dtl.code-snippets.json`).

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | `contributes.walkthroughs` or just activation event; no new contrib points needed |
| `client/src/extension.ts` | Register `sesamTestProvider` on activation |
| `client/src/sesamTestProvider.ts` (new) | Full `TestController` implementation |
| `client/src/testOutputParser.ts` (new) | Parse sesam-py test output to pass/fail/diff |
| `snippets/dtl.code-snippets.json` | Add entity template snippet for `.test.json` |

---

## Dependencies

- **F00/F01** - binary execution plumbing required for running tests
- **F06** - Status/Diff view can reuse the diff mechanism from Phase C
