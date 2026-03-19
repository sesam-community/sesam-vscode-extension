# F00: Bundle sesam-py (TypeScript Rewrite)

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP
> **Overarching Goal**: Overarching Goal 1 (TS rewrite) + Overarching Goal 2 (zero-install bundle)
> **Tracking**: [README.md](README.md)

---

## Summary

Users currently must have `sesam-py` installed globally (Python + PyPI). This feature eliminates that
requirement by reimplementing sesam-py in TypeScript/Node.js split across two packages:

| Package | Role | Who uses it |
|---|---|---|
| `@sesam/core` | Pure TypeScript library — typed functions, no CLI scaffolding | VS Code extension (bundled) |
| `@sesam/cli` | Thin shell on top of `@sesam/core` — adds argument parsing, chalk output, `process.exit` | Terminal users (drop-in sesam-py replacement) |

The extension bundles only `@sesam/core` — no CLI deps, no formatted strings to parse back, clean typed
API. `@sesam/cli` serves as the standalone terminal replacement for all users.

The `dtl.sesampy.executablePath` setting is retained as an escape hatch: when set, the extension spawns
`@sesam/cli` (or any custom binary) as a subprocess instead of calling `@sesam/core` in-process.

---

## Package Design

### `@sesam/core`

- No CLI dependencies (`commander`, `chalk`, `process.argv`, etc.)
- All functions return typed objects, throw on error (no `process.exit`)
- Tree-shakeable — the extension only bundles what it imports

**Public API (example):**
```ts
uploadPipes(node: string, jwt: string, opts?: UploadOptions): Promise<UploadResult>
downloadPipes(node: string, jwt: string, opts?: DownloadOptions): Promise<DownloadResult>
runPipe(node: string, jwt: string, pipeId: string): Promise<RunResult>
getStatus(node: string, jwt: string): Promise<PipeStatus[]>
validate(dir: string): Promise<ValidationResult>
```

### `@sesam/cli`

- Depends on `@sesam/core`
- Adds `commander`/`yargs` argument parsing + `chalk` output formatting + `process.exit` codes
- Drop-in replacement for the `sesam` terminal command
- Matches all existing sesam-py CLI flags (`--node`, `--jwt`, `--single-mode`, etc.)

---

## Implementation Phases

### Phase A: `@sesam/core` Library

> Lives in a **monorepo** or **separate repository**.

1. Create `@sesam/core` package.
2. Port sesam-py commands to typed TypeScript functions using `node-fetch`/`axios`.
3. Publish to npm.

**Commands to port (priority order):**

| Command | Priority |
|---|---|
| `upload` | high |
| `download` | high |
| `run` | high |
| `test` | high |
| `validate` | high |
| `status` | medium |
| `format` | medium |
| `verify` | medium |
| `wipe` | low |
| `stop` | low |

### Phase B: `@sesam/cli` Terminal Tool

1. Create `@sesam/cli` package depending on `@sesam/core`.
2. Wrap each core function with argument parsing and formatted output.
3. Publish to npm as the sesam-py replacement.

### Phase C: Bundle `@sesam/core` in the VS Code Extension

1. Add `@sesam/core` as a dependency to the extension's `package.json`.
2. Add setting `dtl.sesampy.executablePath` (string, default: `""`) as an escape hatch:
   - Empty (default) -> call `@sesam/core` functions directly in-process.
   - Not empty -> spawn the user-provided path as a subprocess.
3. In `client/src/sesamRunner.ts`, implement `SesamRunner`:
   - Calls `@sesam/core` directly when `executablePath` is empty.
   - Falls back to subprocess otherwise.
4. On extension activation, verify `@sesam/core` is importable and surface version to status bar.
5. Gate all F01 commands on a successful runner check.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | Add `@sesam/core` dependency; add `dtl.sesampy.executablePath` setting |
| `client/src/extension.ts` | Instantiate `SesamRunner` on activation; surface version to status bar |
| `client/src/sesamRunner.ts` (new) | `SesamRunner` - direct `@sesam/core` calls or subprocess fallback |
| `.vscodeignore` | Ensure `@sesam/core` node_modules are included in the VSIX |

---

## Dependencies

- Phase A (`@sesam/core` published) must complete before Phase C can ship
- Phase B (`@sesam/cli` published) is independent — can ship in parallel with Phase C
- F01 depends on Phase C being complete (commands need `SesamRunner` to execute)
