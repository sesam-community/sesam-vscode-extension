# F00: Bundle sesam-py (Binary + TypeScript Rewrite)

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP
> **Overarching Goal**: Overarching Goal 1 (TS rewrite) + Overarching Goal 2 (zero-install bundle)
> **Tracking**: [impl-plan.prompt.md](impl-plan.prompt.md)

---

## Summary

Users currently must have `sesam-py` installed globally (Python + PyPI). This feature eliminates that
requirement in two steps:

1. **Phase A (short-term)**: Detect or fall back to a bundled binary built from the existing Python sesam-py
   project via PyInstaller. Ship platform-specific binaries in the extension's VSIX.
2. **Phase B (long-term)**: Reimplement sesam-py in TypeScript/Node.js as a separate package, then bundle it
   as a direct dependency - no subprocess overhead, no binary size, full parity.

---

## Implementation Phases

### Phase A: Bundle Platform Binaries

1. Fork/clone sesam-py; add a CI step that calls `pyinstaller` to produce `sesam-linux`, `sesam-mac`,
   `sesam-win.exe`.
2. Publish the artifacts to GitHub Releases.
3. Add a `postinstall` or `download-sesam-binary` script to the extension's `package.json` that downloads
   the correct platform binary to `resources/bin/`.
4. Add setting `dtl.sesampy.executablePath` (string, default: `""`):
   - Not empty -> use the user-provided path.
   - Empty -> resolve `resources/bin/sesam[-linux|-mac|-win.exe]` relative to the extension's install dir.
5. On activation, health-check the resolved binary with `sesam-py --version`; surface errors via status bar.
6. Gate all `F01` commands on a successful binary check.

**Key files to touch:**
- `package.json` - add `dtl.sesampy.executablePath` contribution point + `scripts.download-sesam-binary`
- `client/src/extension.ts` - binary resolution + health check on activation
- `resources/bin/` - gitignored directory for bundled binaries

### Phase B: TypeScript/Node.js Rewrite

> Prerequisite: Phase A shipped and stable. Rewrite lives in a **separate repository** (e.g.
> `sesam-node` or `@sesam/cli`).

1. Create new repo `@sesam/cli` (scoped npm package).
2. Port sesam-py commands one by one to TypeScript using `node-fetch` / `axios` for REST calls.
3. Match sesam-py CLI flags exactly so existing scripts continue to work (`--node`, `--jwt`, `--single-mode`, etc.).
4. Publish to npm.
5. Add `@sesam/cli` as a dependency to the VS Code extension's `package.json`.
6. Replace binary subprocess calls with direct `import { sesamRun } from '@sesam/cli'` calls in the
   extension host process.
7. Retire Phase A binary download script.

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

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | `dtl.sesampy.executablePath` setting, `download-sesam-binary` script |
| `client/src/extension.ts` | Binary resolution util, activation check |
| `client/src/sesamBinary.ts` (new) | `resolveBinary()`, `checkBinaryHealth()` |
| `resources/bin/.gitkeep` (new) | Placeholder; actual binaries gitignored |
| `.vscodeignore` | Exclude `.py` sources, keep `resources/bin/` |

---

## Dependencies

- F01 depends on Phase A being complete (commands need a binary to invoke)
- Phase B depends on the `@sesam/cli` npm package being published
