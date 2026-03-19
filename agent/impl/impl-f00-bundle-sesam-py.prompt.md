# F00: Bundle sesam-py (TypeScript Rewrite)

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP
> **Overarching Goal**: Overarching Goal 1 (TS rewrite) + Overarching Goal 2 (zero-install bundle)
> **Tracking**: [README.md](README.md)

---

## Summary

Users currently must have `sesam-py` installed globally (Python + PyPI). This feature eliminates that
requirement by reimplementing sesam-py in TypeScript/Node.js and bundling it directly inside the extension
as an npm dependency - no subprocess overhead, no platform binaries, no Python runtime needed.

The `dtl.sesampy.executablePath` setting is retained as an escape hatch for advanced users who want to
point to a custom build.

---

## Implementation Phases

### Phase A: TypeScript/Node.js CLI Rewrite

> Lives in a **separate repository** (e.g. `@sesam/cli`).

1. Create new repo `@sesam/cli` (scoped npm package).
2. Port sesam-py commands one by one to TypeScript using `node-fetch` / `axios` for REST calls.
3. Match sesam-py CLI flags exactly so existing scripts continue to work (`--node`, `--jwt`, `--single-mode`, etc.).
4. Publish to npm.

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

### Phase B: Bundle in the VS Code Extension

1. Add `@sesam/cli` as a dependency to the VS Code extension's `package.json`.
2. Add setting `dtl.sesampy.executablePath` (string, default: `""`) as an escape hatch:
   - Empty (default) -> use the bundled `@sesam/cli` module directly in-process.
   - Not empty -> spawn the user-provided binary as a subprocess (for custom/dev builds).
3. In `client/src/sesamRunner.ts`, implement a `SesamRunner` class that:
   - Calls `@sesam/cli` functions directly when `executablePath` is empty.
   - Falls back to spawning the provided binary path otherwise.
4. On extension activation, verify `@sesam/cli` is importable and surface version to status bar.
5. Gate all F01 commands on a successful runner check.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | Add `@sesam/cli` dependency; add `dtl.sesampy.executablePath` setting |
| `client/src/extension.ts` | Instantiate `SesamRunner` on activation; surface version to status bar |
| `client/src/sesamRunner.ts` (new) | `SesamRunner` - direct `@sesam/cli` calls or subprocess fallback |
| `.vscodeignore` | Ensure `@sesam/cli` node_modules are included in the VSIX |

---

## Dependencies

- Phase A (`@sesam/cli` npm package published) must complete before Phase B can ship
- F01 depends on Phase B being complete (commands need `SesamRunner` to execute)
