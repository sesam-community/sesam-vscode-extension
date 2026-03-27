# F21: Config Property Completions

> **Status**: `phase A+B+D implemented` — including full `"key": value` snippet insertText UX and `docUrl` documentation popup support
> **Rollout Phase**: Phase 1 – MVP
> **Depends on**: F19 (Phase E — config structure validation data already in `constants.ts`)
> **Tracking**: [README.md](README.md)

---

## Summary

Offer auto-complete suggestions for **JSON property keys** (not values) when the user is editing a
Sesam pipe or system config file. Today, completions exist only for values — source types, system
types, DTL variables, and DTL function names. There are no key completions: typing `"` inside
a config object yields nothing useful.

This feature makes the editor guide the user when constructing config objects by suggesting the
correct property names at the correct nesting level.

---

## User-Visible Behaviour

| Scenario | What is suggested |
|---|---|
| Typing `"` at the root of a **pipe** config (`.conf.pipe`) | `_id`, `type`, `source`, `transform`, `sink`, `pump`, … |
| Typing `"` at the root of a **system** config (`.conf.system`) | `_id`, `type` — system-oriented subset |
| Typing `"` at the root of `node-metadata.conf.json` | `_id`, `type`, `pipe_defaults`, `system_defaults`, … |
| Typing `"` at the root of an unknown `.conf.json` | Combined superset, no narrowing |
| Typing `"` inside a `"source": { … }` block | `type`, then type-specific props once `type` is set |
| Typing `"` inside a `"transform": { … }` block | `type`, then `rules` (dtl), `system`, `operation`, … |
| Typing `"` inside a `"sink": { … }` block | `type`, then dataset/sql/rest-specific props |
| Property already present in the object | It is **excluded** from suggestions |

Completion items use `CompletionItemKind.Property`, sorted with required fields first
(`0_*`) and optional fields second (`1_*`). A short `detail` string names the JSON value type
(`string`, `object`, `boolean`, …) and `documentation` gives a one-line description.

---

## Context Detection Algorithm

The core challenge: determine whether the cursor is at a **key position** and determine which
object the cursor is inside.

### Key-position detection

A cursor is at a key position when all of the following hold in the `prefix` string:

1. The cursor is inside an opening JSON string (`"…` with no closing `"` after the last `"`).
2. Looking backwards through the prefix (outside strings), the most recent non-whitespace
   character is `{` or `,`.

Simple regex heuristic (same style as existing predicates in `server.utils.ts`):

```ts
// Cursor is after { or , then whitespace then the opening " of a key
const KEY_POS_RE = /[{,]\s*"[^"]*$/;
```

This fires when the user types `"` after an object open or after a comma.

### Nesting path detection

Walk the prefix character by character, tracking:

- `depth` — brace `{}`/bracket `[]` nesting (only `{}` increments path depth)
- `inString`, `esc` — skip characters inside strings
- `isKeyPos` — cycling through `{ → key, : → value, , → key` back
- `lastKey` — the most recently fully-read key string at the current depth

On `{` push the `lastKey` (the key whose value this new object is) onto a path stack.
On `}` pop the stack.

At the end of the walk, if `isKeyPos` is true, return `{ depth, path: string[] }` where `path` is
the current stack. Examples:

| Document up to cursor | `path` | `depth` |
|---|---|---|
| `{ "` | `[]` | `1` |
| `{ "_id": "x", "source": { "` | `["source"]` | `2` |
| `{ "source": { "type": "dataset", "` | `["source"]` | `2` |
| `{ "transform": { "` | `["transform"]` | `2` |
| `{ "sink": { "type": "sql", "` | `["sink"]` | `2` |

### Already-present key extraction

After determining `depth` and `path`, collect the keys that already appear at the current depth
level by scanning the prefix for `"key"\s*:` patterns at the correct depth. Exclude those from
the suggestion list.

### File-type detection

The `onCompletion` handler receives `params.textDocument.uri` (e.g.
`file:///workspace/pipes/my-pipe.conf.pipe`). Use it to derive the **config file type** before
building root-level completions:

```ts
type ConfigFileType = "pipe" | "system" | "node-metadata" | "unknown";

const getConfigFileType = (uri: string): ConfigFileType => {
  if (uri.endsWith(".conf.pipe")) return "pipe";
  if (uri.endsWith(".conf.system")) return "system";
  if (uri.endsWith("node-metadata.conf.json")) return "node-metadata";
  return "unknown";
};
```

Pass `fileType` into `buildPropCompletions(path, fileType)` so the root-level property table
(depth = 1, path = []) is selected accordingly. Nested object completion (`source`, `transform`,
`sink`) is the same regardless of file type and does not need the file-type parameter.

---

## Property Data

### Root-level — pipe config (`.conf.pipe`, depth = 1)

Required fields sorted first.

| Key | Value type | Sort | Notes |
|---|---|---|---|
| `_id` | `string` | `0_01` | Required; pipe/system identifier |
| `type` | `string` | `0_02` | Required; `"pipe"` or `"system:*"` |
| `source` | `object` | `0_03` | Required for pipes |
| `transform` | `object \| array` | `1_01` | Optional; single transform or array |
| `sink` | `object` | `1_02` | Optional; defaults to dataset sink |
| `pump` | `object` | `1_03` | Optional; scheduling / pump config |
| `metadata` | `object` | `1_04` | Optional; arbitrary metadata |
| `description` | `string` | `1_05` | Optional; human-readable description |
| `comment` | `string` | `1_06` | Optional; internal note |
| `namespaces` | `boolean` | `1_07` | Optional; enable namespacing |
| `add_namespaces` | `boolean` | `1_08` | Optional |
| `remove_namespaces` | `boolean` | `1_09` | Optional |
| `batch_size` | `integer` | `1_10` | Optional |
| `checkpoint_interval` | `integer` | `1_11` | Optional |
| `compaction` | `object` | `1_12` | Optional |
| `expose_entity_id` | `boolean` | `1_13` | Optional |
| `merge_existing_namespaces` | `boolean` | `1_14` | Optional |
| `infer_pipe_entity_types` | `boolean` | `1_15` | Optional |

### Root-level — system config (`.conf.system`, depth = 1)

Systems have a minimal root schema — most configuration lives inside system-specific properties
that are `type`-dependent. Only the universally applicable fields are offered here; type-specific
system properties are deferred to Phase C.

| Key | Value type | Sort | Notes |
|---|---|---|
|---|---|
| `_id` | `string` | `0_01` | Required; unique system identifier |
| `type` | `string` | `0_02` | Required; must be a `system:*` value |
| `metadata` | `object` | `1_01` | Optional; arbitrary metadata |
| `description` | `string` | `1_02` | Optional; human-readable description |
| `comment` | `string` | `1_03` | Optional; internal note |

### Root-level — `node-metadata.conf.json` (depth = 1)

`node-metadata.conf.json` is a special singleton file that stores node-level configuration
applied across all pipes and systems. It has a completely different schema from a pipe or
system config.

| Key | Value type | Sort | Notes |
|---|---|---|---|
| `_id` | `string` | `0_01` | Required; typically `"node"` |
| `type` | `string` | `0_02` | Required; `"metadata:node"` |
| `pipe_defaults` | `object` | `0_03` | Default settings applied to every pipe |
| `system_defaults` | `object` | `0_04` | Default settings applied to every system |
| `global_defaults` | `object` | `1_01` | Global defaults for both |
| `feature_flags` | `object` | `1_02` | Enable/disable experimental features |
| `namespaces` | `object` | `1_03` | Namespace configuration |
| `metadata` | `object` | `1_04` | Node-level metadata tags |
| `description` | `string` | `1_05` | Optional description |
| `comment` | `string` | `1_06` | Optional internal note |

#### `pipe_defaults` / `system_defaults` sub-object properties (path = `["pipe_defaults"]` etc.)

These objects accept the same keys as a pipe / system root respectively — re-use the same
property tables but with a `depth = 2` path match on `"pipe_defaults"` or `"system_defaults"`.

### Source sub-object properties (path = `["source"]`)

Required `type` is always first. Additional properties are generic recommendations
independent of type (Phase B); type-specific properties come in Phase C.

| Key | Value type | Sort | Notes |
|---|---|---|---|
| `type` | `string` | `0_01` | Required; see source type completions |
| `dataset` | `string` | `1_01` | Used by `dataset` source |
| `system` | `string` | `1_02` | Used by `sql`, `rest`, `json`, `ldap`, `kafka`, … |
| `table` | `string` | `1_03` | Used by `sql` source |
| `query` | `string` | `1_04` | Used by `sql` source |
| `url` | `string` | `1_05` | Used by `json`, `http_endpoint` source |
| `operation` | `string` | `1_06` | Used by `rest`, `kafka` source |
| `headers` | `object` | `1_07` | Optional HTTP headers |
| `params` | `object` | `1_08` | Optional query parameters |
| `entities` | `array` | `1_09` | Used by `embedded` source |
| `datasets` | `array` | `1_10` | Used by `union_datasets`, `merge_datasets`, `merge` |
| `since_property_name` | `string` | `1_11` | REST since-tracking |
| `since_default` | `string` | `1_12` | REST since-tracking |
| `completeness` | `boolean` | `1_13` | Completeness tracking |
| `supports_signalling` | `boolean` | `1_14` | Signalling support |

### Transform sub-object properties (path = `["transform"]`)

| Key | Value type | Sort | Notes |
|---|---|---|---|
| `type` | `string` | `0_01` | Required |
| `rules` | `object` | `0_02` | Required for `dtl` transform |
| `system` | `string` | `1_01` | Used by `http`, `rest` transform |
| `operation` | `string` | `1_02` | Used by `http`, `rest` transform |
| `transform` | `array` | `1_03` | Sub-transforms for `conditional` |
| `condition` | `array` | `1_04` | Used by `conditional` |
| `side_effects` | `boolean` | `1_05` | Used by `http`, `rest` transform |
| `xml_config` | `object` | `1_06` | Used by `xml` transform |
| `template` | `string` | `1_07` | Used by `template` transform |

### Sink sub-object properties (path = `["sink"]`)

| Key | Value type | Sort | Notes |
|---|---|---|---|
| `type` | `string` | `0_01` | Required |
| `dataset` | `string` | `1_01` | Used by `dataset` sink (defaults to pipe id) |
| `system` | `string` | `1_02` | Used by `sql`, `rest`, `elasticsearch`, … |
| `table` | `string` | `1_03` | Used by `sql` sink |
| `operation` | `string` | `1_04` | Used by `rest` sink |
| `primary_key` | `array` | `1_05` | Used by `sql` sink |
| `batch_size` | `integer` | `1_06` | Used by `sql` sink |
| `set_initial_offset` | `string` | `1_07` | Used by `dataset` sink |
| `deletion_tracking` | `boolean` | `1_08` | Used by `dataset` sink |
| `enable_optimistic_locking` | `boolean` | `1_09` | Used by `dataset` sink |
| `side_effects` | `boolean` | `1_10` | Used by `rest` sink |

### Pump sub-object properties (path = `["pump"]`)

| Key | Value type | Sort | Notes |
|---|---|---|---|
| `mode` | `string` | `0_01` | `"scheduled"` or `"manual"` |
| `schedule_interval` | `integer` | `1_01` | Seconds between runs |
| `cron_expression` | `string` | `1_02` | Cron-style schedule |
| `run_at_startup` | `boolean` | `1_03` | Run immediately on node start |
| `max_retries` | `integer` | `1_04` | Retry on failure |
| `max_read_timeout_seconds` | `integer` | `1_05` | Timeout for source read |
| `max_write_timeout_seconds` | `integer` | `1_06` | Timeout for sink write |
| `rescan_run_count` | `integer` | `1_07` | Full rescan frequency |
| `fallback_to_single_entities_on_error` | `boolean` | `1_08` | Error recovery |

---

## Implementation Phases

### Phase A — Root-level + nested key completions (basic, no filtering)

**Scope:**
- Add `isPropKeyContext(prefix)` predicate to `server.utils.ts`
- Add `getPropKeyContext(prefix)` scanner to `server.utils.ts` (returns `{ depth, path }`)
- Add `getConfigFileType(uri)` helper to `server.utils.ts`
- Add `buildPropCompletions(path, fileType)` builder to `server.utils.ts`
- Wire into `onCompletion` handler in `server.ts` (new branch before existing checks, but after
  checking it's not a value context)
- Return file-type-appropriate root properties when `depth === 1 && path.length === 0`
- Return source/transform/sink properties when `depth === 2 && path[0] === "source"` etc.

**Not in Phase A**: filtering of already-present keys; type-aware narrowing.

**Acceptance criteria:**
- Typing `"` in empty root `{}` in a `.conf.pipe` file offers `_id`, `type`, `source`, …
- Typing `"` in empty root `{}` in a `.conf.system` file offers `_id`, `type` (no `source`/`sink`)
- Typing `"` in `node-metadata.conf.json` root offers `_id`, `type`, `pipe_defaults`, …
- Typing `"` inside `"source": {}` (any file type) offers `type`, `dataset`, `system`, …
- Existing value completions (source type, system type, functions) still work

---

### Phase B — Filter already-present keys

**Scope:**
- Add `extractPresentKeys(prefix, depth)` scanner to `server.utils.ts`
- Pass present-keys set to `buildPropCompletions` and filter
- Update `onCompletion` to pass present keys

**Acceptance criteria:**
- A root object with `"_id": "x"` already present → `_id` not offered again
- A `source` object with `"type": "dataset"` → `type` not offered again

---

### Phase D — File-type-aware narrowing (extend Phase A)

> Phase D is already folded into Phase A above (via `getConfigFileType`). It is listed separately
> to make the design decision explicit and to allow it to be deferred if needed.

**Scope:**
- Implement `getConfigFileType(uri)` in `server.utils.ts`
- Pass `fileType` through `buildPropCompletions` and switch on it for depth-1 suggestions
- Add `node-metadata` property table
- Wire `pipe_defaults` / `system_defaults` nested path to re-use pipe/system root tables

**Acceptance criteria:**
- `.conf.pipe` → `source`, `transform`, `sink`, `pump` offered at root
- `.conf.system` → no `source`, `sink`, `pump` at root
- `node-metadata.conf.json` → `pipe_defaults`, `system_defaults`, `feature_flags` at root; no `source`
- Unknown `.conf.json` → combined superset at root (fallback)

---

### Phase C — Type-aware narrowing for nested objects

**Scope:**
- Add `extractTypeValue(prefix, depth)` to read the `"type"` value from the current depth's
  object in the prefix
- Define type-specific property tables for `source`, `transform`, `sink`
- Narrow `buildPropCompletions` results by type when type is known

**Acceptance criteria:**
- When `"source": { "type": "sql", "` → suggests `system`, `table`, `query` (not `entities`
  or `supports_signalling`)
- When `"transform": { "type": "dtl", "` → suggests `rules` prominently

---

## Files Touched

| File | Change |
|---|---|
| `server/src/utils/server.utils.ts` | Add `isPropKeyContext`, `getPropKeyContext`, `getConfigFileType`, `extractPresentKeys`, `extractTypeValue`, `buildPropCompletions` |
| `server/src/server.ts` | New branch in `onCompletion` calling `isPropKeyContext`; pass `uri` to builder |
| `tests/config-prop-completions.test.ts` | New test file |
| `agent/impl/README.md` | Add F21 row |

No changes to `constants.ts`, `config-structure-validator.ts`, or dtl files — this feature is
additive and purely completion-side.

---

## Test Cases

### Phase A + D (file-type-aware root, no filtering)

| URI suffix | Input prefix | Expected items include | Expected items exclude |
|---|---|---|---|
| `.conf.pipe` | `{` + `"` | `_id`, `type`, `source`, `transform`, `sink`, `pump` | DTL function names |
| `.conf.system` | `{` + `"` | `_id`, `type`, `metadata` | `source`, `sink`, `pump`, `transform` |
| `node-metadata.conf.json` | `{` + `"` | `_id`, `type`, `pipe_defaults`, `system_defaults`, `feature_flags` | `source`, `sink`, `pump` |
| `.conf.pipe` | `{"_id":"x",` + `"` | `type`, `source`, `transform` | DTL function names |
| any | `{"source":{` + `"` | `type`, `dataset`, `system` | `_id`, `pump` |
| any | `{"transform":{` + `"` | `type`, `rules`, `system` | `_id`, `batch_size` |
| any | `{"sink":{` + `"` | `type`, `dataset`, `system` | `_id`, `source` |
| any | `{"source":{"type":"` + cursor | source value completions, NOT prop completions | prop keys |

### Phase B

| Input prefix | Expected items include | Expected items exclude |
|---|---|---|
| `{"_id":"x","` | `type`, `source` | `_id` (already present) |
| `{"source":{"type":"dataset","` | `dataset`, `system` | `type` (already present) |

### Phase C

| Input prefix | Expected items include | Expected items exclude |
|---|---|---|
| `{"source":{"type":"sql","` | `system`, `table`, `query` | `entities`, `supports_signalling` |
| `{"source":{"type":"embedded","` | `entities` | `system`, `table` |
| `{"transform":{"type":"dtl","` | `rules` | `xml_config`, `template` |
| `{"sink":{"type":"dataset","` | `dataset`, `deletion_tracking` | `table`, `primary_key` |

---

## Priority & Notes

- **Phases A + D** should be implemented together — file-type detection is cheap (single URI check)
  and makes the feature immediately useful without the noise of irrelevant suggestions.
- **Phase B** (filter present keys) makes the feature feel polished and avoids noise.
- **Phase C** (type narrowing) is a follow-on; the feature is already useful without it.
- **`node-metadata.conf.json`** is a singleton (only one per Sesam workspace) but warrants its own
  completion schema because its root properties are entirely different from pipe/system configs.
- No new VS Code contribution points are needed — completions work through the existing LSP
  provider already registered in `server.ts`.
- The `{` character should be added to `triggerCharacters` in `onInitialize` so that typing `{`
  after `"source":` immediately shows the `type` suggestion.
