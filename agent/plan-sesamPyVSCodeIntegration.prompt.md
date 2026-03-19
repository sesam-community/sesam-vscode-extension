# Plan: VS Code Extension Feature Suggestions for sesam-py Integration

**TL;DR**: The extension currently only covers DTL language editing in isolation. The overarching goal is to bundle sesam-py inside the extension so users never need a separate install, then progressively bridge the terminal context-switch, wire the editor into the Sesam node, and add a Copilot `@sesam` agent. The work is broken into 4 phases : starting with a lean MVP, then adding test integration, node connectivity, and AI features.

## Context

**sesam-py** is the Sesam CLI tool. Developer workflow:
- Maintains local folders: `pipes/`, `systems/`, `testdata/`, `expected/`
- Config files: `.syncconfig` (NODE+JWT), `.authconfig` (OAuth2/API key/Tripletex), `.sesamconfig.json` (format options), `.jinja_vars` (Jinja template vars)
- Core loop: `sesam upload` → edit in Management Studio → `sesam download` → `sesam run` → `sesam update` → `sesam verify`
- CI: `sesam test`
- Connector devs: `connectorpy init` → expand → edit → collapse

**VS Code Extension** (current): DTL language support : syntax highlighting, autocompletion, hover docs, linting, formatter, Pipe Graph sidebar, offline Pipe Preview.

**Gap**: The extension is isolated from the actual sesam-py CLI and Sesam node. Developers constantly context-switch to terminal and have no IDE-level integration with their node or tests.

## Overarching Goal

**Bundle sesam-py inside the extension.** Users should be able to install the VS Code extension and immediately use all sesam-py functionality : no separate `pip install`, no PATH configuration, no version mismatch. The extension ships with a pinned sesam-py binary (or Python wheel) for each supported platform (Linux, macOS, Windows) and invokes it internally. A setting allows advanced users to point to their own installation instead.

## Feature Groups

### 1. sesam-py Command Integration
- Command palette + toolbar buttons: upload, download, run, test, verify, validate, status, format, wipe, stop
- Status bar: show active NODE name, connection status
- Output panel: stream sesam-py output in a dedicated channel
- Task provider: define sesam tasks in tasks.json

### 2. Config File Intelligence
- `.syncconfig` : syntax validation, hover docs for NODE/JWT keys, quick-pick known node names
- `.sesamconfig.json` : JSON schema for formatstyle options, IntelliSense
- `.authconfig` : syntax validation, secure credential masking
- `.jinja_vars` : syntax highlighting, key-value completion

### 3. Secure Credential Management
- Store JWT/secrets via VS Code SecretStorage API (not plaintext .syncconfig)
- Multi-environment support: quick-switch between dev/test/prod nodes
- Credential status in status bar

### 4. Node-Connected Live Preview
- Extend PreviewPanel to optionally connect to the Sesam node (use NODE+JWT from .syncconfig)
- Enable hops, apply-hops, lookup-entity to resolve against real node data
- Show actual pipe output from the node inline

### 5. Test Management (Testing API)
- Register `.test.json` files with VS Code Testing API (test explorer panel)
- Run individual tests or all tests with green/red inline indicators
- Show expected vs actual diff when a test fails
- `.test.json` schema validation: `_id`, `type`, `pipe`, `file`, `blacklist`, `ignore`, `endpoint`, `stage`, `parameters`

### 6. Status / Diff View
- `sesam status` shown as a git-style diff panel (local vs node config)
- Inline gutter indicators for modified pipes
- Quick action to sync individual pipe up or down

### 7. Pipe Graph Enhancements
- Full interactive graph visualization (D3/vis-network in webview) vs current tree
- Visual indicators: which pipes are failing on node, which have unresolved hops
- Filter/search by pipe _id

### 8. Connector Development Tools
- Connector init wizard (form-based UI for connectorpy init)
- Template expansion preview (`connectorpy expand` output shown in sidebar)
- OAuth2 flow: launch browser auth from a VS Code command, capture tokens, update .authconfig
- manifest.json schema validation with IntelliSense

### 9. Copilot Agent Participant (@sesam)
- `@sesam` chat participant that understands DTL, pipe configs, sesam-py commands
- Skills: generate pipe configs from natural language, explain transforms, fix lint errors, write test entities + expected outputs, recommend sesam-py command for a task
- Tool calls: read local pipes/systems, validate DTL, call node API for live data

### 10. Inline Output & Diagnostics from Node
- After `sesam run`, show per-pipe statistics inline (entities processed, errors)
- After `sesam download`, show diff notification with one-click open
- Surface node-side errors as diagnostics in the editor

## Key Files to Modify/Add

- `client/src/extension.ts` : register all new commands, status bar, task provider
- `client/src/graph/PipeGraphProvider.ts` : enhance with graph viz, node status
- `client/src/preview/PreviewPanel.ts` : add node-connected mode
- `server/src/server.ts` : add .syncconfig, .authconfig, .sesamconfig.json, .test.json language support
- `package.json` : add new commands, config schema, activation events, taskDefinitions
- New: `client/src/sesam/SesamRunner.ts` : sesam-py CLI wrapper
- New: `client/src/sesam/NodeClient.ts` : Sesam REST API client
- New: `client/src/sesam/CredentialManager.ts` : SecretStorage-backed credential store
- New: `client/src/testing/TestProvider.ts` : VS Code Testing API provider
- New: `client/src/chat/SesamChatParticipant.ts` : Copilot @sesam agent

## Phased Rollout

### Phase 1 : MVP: The Daily Command Loop
> Goal: ship a zero-install experience and eliminate the terminal context-switch for the core sesam-py workflow.

- **0. Bundle sesam-py** : embed platform-specific sesam-py binaries in the extension; auto-select at runtime; fall back to user-installed binary via a `dtl.sesampy.executablePath` setting
- **1. sesam-py Command Integration** : upload, download, run, test, verify, validate, status, format, wipe, stop from Command Palette + status bar
- **2. Config File Intelligence** : schema + IntelliSense for `.syncconfig`, `.sesamconfig.json`, `.authconfig`, `.jinja_vars` (quick wins, zero setup required)
- **3. Secure Credential Management** : move JWTs out of plaintext files into SecretStorage; warn on committed credentials

**New files:** `SesamRunner.ts`, `CredentialManager.ts`
**Build change:** add platform binary download step to `vite.config.client.ts` / CI pipeline

### Phase 2 : Close the Testing & Diff Loop
> Goal: surface test results and config drift directly in the editor.

- **5. Test Management** : VS Code Testing API integration for `.test.json` + `expected/` files; green/red per pipe; diff on failure
- **6. Status / Diff View** : git-style local-vs-node diff panel; gutter indicators; CodeLens push/pull per pipe

**New file:** `TestProvider.ts`

### Phase 3 : Node Connectivity
> Goal: connect the editor to the live Sesam node for real-time feedback.

- **4. Node-Connected Live Preview** : "Connect to Node" toggle in PreviewPanel; unlock `hops`, `apply-hops`, `lookup-entity`
- **10. Inline Output & Diagnostics from Node** : per-pipe run statistics inline; node-side errors as editor diagnostics

**New file:** `NodeClient.ts`

### Phase 4 : AI & Visual Polish
> Goal: leverage all previous phases to provide intelligent assistance and richer visualisation.

- **9. Copilot Agent Participant (@sesam)** : `@sesam` chat participant; generate pipes, explain transforms, write test data, suggest CLI flags
- **7. Pipe Graph Enhancements** : interactive D3/vis-network graph; node-status overlay; search/filter
- **8. Connector Development Tools** : connector init wizard; template expansion preview; OAuth2 in-editor flow

**New file:** `SesamChatParticipant.ts`
