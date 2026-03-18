# Plan: VS Code Extension — sesam-py Integration Features

**TL;DR**: The extension currently only covers DTL language editing in isolation. The biggest wins come from bridging the constant context-switch to the terminal, wiring the extension into the Sesam node directly, and adding a Copilot `@sesam` agent participant that understands the full Sesam ecosystem.

---

### A — sesam-py Command Integration
The most immediate pain point: developers run a constant loop of `sesam upload`, `sesam download`, `sesam run`, `sesam verify` in the terminal with no visibility in the editor.

**What to build:**
- Command Palette + toolbar buttons for all key sesam-py commands: `upload`, `download`, `run`, `test`, `verify`, `validate`, `status`, `format`, `wipe`, `stop`
- Dedicated **Output Channel** streaming sesam-py stdout/stderr in real time
- **Status bar item** showing the active NODE name and connection state (connected / offline / error)
- VS Code **Task Provider** so teams can share `sesam test` as a standard build task in `tasks.json`

**Key file:** New `client/src/sesam/SesamRunner.ts` — a thin wrapper around `child_process.spawn` calling the `sesam` binary; `client/src/extension.ts` registers the commands.

---

### B — Config File Intelligence
Developers manage 4 config files manually with zero IDE support:

| File | What to add |
|---|---|
| `.syncconfig` | Syntax validation; hover docs for NODE/JWT keys; quick-pick recently used nodes |
| `.sesamconfig.json` | JSON Schema with IntelliSense for all `formatstyle` properties (already documented in the README) |
| `.authconfig` | Syntax validation; mask secrets in hover; warn on committed credentials |
| `.jinja_vars` | Syntax highlighting; key=value pair autocompletion |
| `.test.json` | Full JSON Schema for `_id`, `type`, `pipe`, `file`, `blacklist`, `ignore`, `endpoint`, `stage`, `parameters` |

**Key file:** `server/src/server.ts` — add document handlers for these file types; `package.json` — register JSON schemas.

---

### C — Secure Credential Management
`.syncconfig` stores JWTs in plaintext. The extension should:
- Move JWT/secrets into VS Code's **SecretStorage API** (never on disk)
- Support **multi-environment** profiles (dev / test / prod node) with quick-switch in the status bar
- Warn when `.syncconfig` or `.authconfig` containing credentials is detected in a git-tracked file

**New file:** `client/src/sesam/CredentialManager.ts`

---

### D — Node-Connected Live Preview
The current `client/src/preview/PreviewPanel.ts` already works offline. The next step:
- Add a **"Connect to Node" toggle** — when enabled, use NODE+JWT to call the real Sesam REST API
- This unlocks `hops`, `apply-hops`, `lookup-entity` — currently these return `null` with a warning
- Show actual pipe output from the node alongside the offline evaluation

**New file:** `client/src/sesam/NodeClient.ts` — typed wrapper around the Sesam REST API

---

### E — Test Management (VS Code Testing API)
All test work currently happens in the terminal. The extension can register the project's `.test.json` + `expected/*.json` files with VS Code's **built-in Testing API**:
- Test Explorer panel with green/red per-pipe indicators
- Run individual tests or all tests from the editor
- **Diff view** on failure: expected vs actual side-by-side
- `.test.json` schema validation (see §B above)

**New file:** `client/src/testing/TestProvider.ts`

---

### F — Status / Diff View
`sesam status` output is currently just terminal text. Surface it as a proper diff:
- After `sesam download`, show a **git-style diff panel** (local vs node config) — clickable per file
- Inline **gutter indicators** on modified pipes (similar to git change decorations)
- Quick-action CodeLens on each pipe file: "Push to node" / "Pull from node"

---

### G — Pipe Graph Enhancements
The current `client/src/graph/PipeGraphProvider.ts` is a basic tree. Upgrade it:
- **Interactive graph visualization** in a Webview (D3 / vis-network) showing full data flow
- Node-status overlay: which pipes are failing, which datasets are stale
- Search/filter by pipe `_id`; expand/collapse subgraphs

---

### H — Connector Development Tools
Connector devs have a distinct multi-step workflow (`connectorpy init` → `expand` → edit templates → `collapse`). The extension can add:
- **Connector Init Wizard** — a form-based webview that runs `connectorpy init`
- **Template Expansion Preview** — shows the expanded `pipes/` + `systems/` before upload
- **OAuth2 flow in-editor** — launch the browser auth URL, capture the redirect token, write it to `.authconfig`
- **manifest.json schema validation** with IntelliSense

---

### I — Copilot `@sesam` Agent Participant ⭐ highest leverage
A custom chat participant that understands the entire Sesam domain:

| Capability | Example prompt |
|---|---|
| **Generate pipes** | `@sesam create a pipe that enriches person entities with company data via a hops to the company dataset` |
| **Explain transforms** | `@sesam what does this apply-hops block do?` (with selection) |
| **Fix lint errors** | `@sesam fix the unknown function error on line 14` |
| **Write test data** | `@sesam generate a testdata entity for the order-enrichment pipe` |
| **CLI guidance** | `@sesam I want to run only the failing pipes without resetting others` → suggests the right sesam-py flags |
| **Config help** | `@sesam what sesamconfig formatstyle setting controls array indentation?` |

The agent can use **tool calls** (VS Code chat tools API) to: read local pipe/system files, run `sesam validate` on the current file, and optionally query the node API for live dataset schemas.

**New file:** `client/src/chat/SesamChatParticipant.ts`

---

### J — Inline Output & Diagnostics from Node
- After `sesam run`, show per-pipe statistics inline (entities processed, errors)
- After `sesam download`, show diff notification with one-click open
- Surface node-side errors as diagnostics in the editor

---

## Suggested Priority Order

1. **A — sesam-py commands** (immediate daily-driver value, straightforward to build)
2. **I — @sesam agent** (high leverage, multiplies all other features)
3. **E — Test Management** (fills the biggest testing visibility gap)
4. **B — Config file intelligence** (daily friction, quick wins via JSON Schema)
5. **C — Credential security** (security correctness, currently a risk)
6. **D — Node-connected preview** (unlocks hops/apply-hops, high dev value)
7. **F — Status/diff view** (polishes the upload/download loop)
8. **G — Graph enhancements** (visual upgrade)
9. **H — Connector tools** (narrower audience, higher complexity)
