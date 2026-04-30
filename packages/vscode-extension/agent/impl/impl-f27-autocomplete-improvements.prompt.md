# F27: Autocomplete & Hover Improvements

> **Status**: `implemented`
> **Rollout Phase**: Phase 1 – MVP
> **Depends on**: F21 (Config Property Completions), F19 (Syntax Linting)
> **Tracking**: [README.md](README.md)

---

## Summary

A collection of targeted improvements to existing autocomplete, hover tooltips, and syntax
highlighting that make working with `hops`, `apply-hops`, `comment`, `permissions`, and config
reference values (e.g. `"dataset"`, `"system"`) noticeably better. No new LSP capability is
introduced; all changes are enhancements to existing providers.

---

## Changes Implemented

### 1. `hops` and `apply-hops` — rich LSP completion snippet

**Problem**: The auto-generated `insertText` for `hops` was `"${1:hops-spec}"` — a single
placeholder that gave no structural guidance.

**Fix**:
- Added an optional `snippet?: string` field to the `DtlFunction` type
  (`types/dtl-registry.types.ts`).
- `buildFunctionCompletions` in `server.utils.ts` now uses `fn.snippet ?? autoInsertText`.
- `hops` and `apply-hops` registry entries now carry a multi-line snippet with linked tab stops
  so the alias appears in both `datasets` and `where` simultaneously.
- Both `docUrl` fields were fixed to include proper anchors (`#hops`, `#apply-hops`).
- The `hops-spec` param description now documents all 6 keys:
  `datasets`, `where`, `return`, `recurse`, `exclude_root`, `max-depth`.

**New VS Code snippet**: `hops-recursive` (prefix `hops-recursive`) — adds `recurse: true`,
`exclude_root` choice, and `max-depth` tab stop.

---

### 2. `comment` — include text argument in LSP completion

**Problem**: `comment`'s `text` param was `optional: true`, so the auto-generated `insertText`
was just `"comment"` with no text argument.

**Fix**: Added `snippet: '"comment", "${1:Comment text}"'` to the registry entry.

---

### 3. Syntax highlighting — reference strings colored white (dark) / navy (light)

**Problem**: String values after reference keys (`"dataset"`, `"system"`, etc.) were uncolored.
The dataset-alias pattern was also too broad, incorrectly matching ordinary English sentences
like `"Comment text"`.

**Fixes** (`syntaxes/dtl-injection.tmLanguage.json`):

| Change | Detail |
|---|---|
| New pattern `entity.name.reference.sesam` | Matches string values after `"dataset":`, `"system":`, `"entity":`, `"master_dataset":`, `"dependency_dataset":` |
| Updated alias pattern | Now captures the dataset-id (group 1 → `entity.name.reference.sesam`) **and** alias (group 2 → `entity.name.tag.alias.sesam`); restricted to IDs starting with `[a-z]` to avoid false positives |

**Token colors** (`package.json` → `configurationDefaults`):

| Scope | Dark theme | Light theme | High Contrast |
|---|---|---|---|
| `entity.name.reference.sesam` | `#FFFFFF` | `#001080` | `#FFFFFF` |
| `entity.name.tag.alias.sesam` | `#9CDCFE` italic | `#0070C1` italic | `#9CDCFE` italic |

---

### 4. Reference value hover (`"dataset"`, `"system"`, etc.)

**New utility functions** (`server.utils.ts`):

- `getRefKeyAtValuePosition(prefix)` — detects cursor on a string value after a reference key;
  also scans for the enclosing block (`"source"`, `"sink"`, `"transform"`, `"pump"`).
- `buildRefValueHover(refKey, block, value)` — builds context-aware hover markdown with the
  correct label and doc URL:

| Key + Block | Label | Doc URL |
|---|---|---|
| `dataset` + `source` | *Source dataset* | `configuration-sources.html` |
| `dataset` + `sink` | *Sink dataset* | `configuration-sinks.html` |
| `system` + `source` | *Source system* | `configuration-sources.html` |
| `system` + `sink` | *Sink system* | `configuration-sinks.html` |
| `dataset` (no block) | *Dataset reference* | `configuration-sources.html` |

---

### 5. `permissions` property — completions, snippet, hover

**Problem**: The `permissions` ACL key was entirely absent from property completions and had no
hover or action completions.

**Registry entries added** (`server.utils.ts`):

| Prop table | `label` | `docUrl` anchor |
|---|---|---|
| `PIPE_ROOT_PROPS` | `"permissions"` | `#pipe-permissions` |
| `SYSTEM_ROOT_PROPS` | `"permissions"` | `#system-permissions` |

Both carry a `valueSnippet` that inserts the correct `["allow", [...], [...]]` skeleton.

**New VS Code snippet**: `sesam-permissions` with tab-stop choice list for the effect and
action.

**New utility functions** (`server.utils.ts`):

- `isPermissionsActionContext(prefix)` — returns `true` when the cursor is inside the actions
  array of a permissions entry.
- `buildPermissionsActionCompletions()` — returns `EnumMember` completion items for all 7
  actions.
- `buildPermissionsActionHover(word)` — tooltip that includes which resource type the action
  applies to.

**The 7 permission actions:**

| Action | Pipe | System |
|---|---|---|
| `read_config` | ✓ | ✓ |
| `write_config` | ✓ | ✓ |
| `read_data` | ✓ | ✓ |
| `write_data` | ✓ | ✓ |
| `run_pump_operation` | ✓ | — |
| `read_proxy` | — | ✓ |
| `write_proxy` | — | ✓ |

---

## Files Changed

| File | Change |
|---|---|
| `types/dtl-registry.types.ts` | Added `snippet?: string` to `DtlFunction` |
| `src/shared/dtl-registry.ts` | Updated `hops`, `apply-hops`, `comment` entries; added `snippet` fields |
| `server/src/utils/server.utils.ts` | `buildFunctionCompletions` uses `fn.snippet`; added `getRefKeyAtValuePosition`, `buildRefValueHover`, `isPermissionsActionContext`, `buildPermissionsActionCompletions`, `buildPermissionsActionHover`; added `permissions` to `PIPE_ROOT_PROPS` and `SYSTEM_ROOT_PROPS` |
| `server/src/server.ts` | Wired ref-value hover, permissions action completion, and permissions action hover |
| `syntaxes/dtl-injection.tmLanguage.json` | New `entity.name.reference.sesam` pattern; updated alias pattern |
| `snippets/dtl.code-snippets.json` | Updated `hops` description; added `hops-recursive` and `sesam-permissions` snippets |
| `package.json` | Added `configurationDefaults` with theme-split token color rules |
| `tests/server.utils.test.ts` | 18 new tests covering all new utilities |

---

## Tests Added

All tests live in `tests/server.utils.test.ts`:

- `permissions property completions` (2 cases)
- `getRefKeyAtValuePosition` (3 cases)
- `buildRefValueHover` (3 cases)
- `isPermissionsActionContext` (4 cases)
- `buildPermissionsActionCompletions` (2 cases)
- `buildPermissionsActionHover` (4 cases)
