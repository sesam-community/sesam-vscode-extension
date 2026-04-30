# Sesam VS Code Extension — Team Introduction Session

**Duration:** 60 minutes  
**Format:** Live demo + Q&A  
**Prerequisites:** VS Code installed, extension installed (`.vsix` via `scripts/install-extension.sh`), a Sesam node available

---

## Agenda at a Glance

| # | Block | Duration |
|---|---|---|
| 1 | [What problem does this solve?](#1-what-problem-does-this-solve) | 5 min |
| 2 | [Installation & first look](#2-installation--first-look) | 5 min |
| 3 | [File types & the formatter](#3-file-types--the-formatter) | 5 min |
| 4 | [Editing intelligence — completions, hover, linting](#4-editing-intelligence--completions-hover-linting) | 10 min |
| 5 | [Navigation — cross-file, go-to-definition, rename](#5-navigation--cross-file-go-to-definition-rename) | 10 min |
| 6 | [Sidebar views — Lineage, Dependents, System Pipes](#6-sidebar-views--lineage-dependents-system-pipes) | 5 min |
| 7 | [Node integration — credentials, upload/download, run](#7-node-integration--credentials-uploaddownload-run) | 10 min |
| 8 | [Sync status & diff view](#8-sync-status--diff-view) | 5 min |
| 9 | [Testing, Pipe Preview, Node Status](#9-testing-pipe-preview-node-status) | 5 min |
| 10 | [Copilot chat participant — @sesam](#10-copilot-chat-participant--sesam) | 5 min |
| Q&A | Open discussion | 0 min (buffer for overflow) |

---

## 1. What Problem Does This Solve?
**5 minutes | No demo — talk track only**

### Pain points before the extension

The classic Sesam developer loop looked like this:

```
Management Studio → download → edit raw JSON → upload → check logs → repeat
```

Concretely that meant:
- No autocomplete or inline docs — looking up function signatures in browser tabs
- No linting — JSON syntax errors only surfaced on upload
- Constant terminal context-switch to run `sesam upload` / `sesam run` / `sesam test`
- Navigating between pipe dependencies by hand (Ctrl+F in Explorer)
- Zero diff visibility — you never knew what was out of sync until upload blew up

### What the extension gives you

> **One tool. No terminal. No Management Studio tab.**

- Full DTL language intelligence (completions, hover docs, linting) baked into the editor
- Bundled `sesam-py` reimplemented in TypeScript — **no `pip install`**, no PATH setup, no version mismatch
- Upload / download / run / test directly from VS Code command palette or keyboard shortcuts
- Live sync status sidebar — see at a glance what's changed locally vs. the node
- Navigation graph (lineage, dependents, system pipes) as sidebar tree views

---

## 2. Installation & First Look
**5 minutes | Demo**

Follow the steps at: [packages/vscode-extension#installation](https://github.com/datanav/sesam-ts/tree/main/packages/vscode-extension#installation)

---

## 3. File Types & the Formatter
**5 minutes | Demo**  
Spec: [impl-f12-conf-json-formatter](../packages/vscode-extension/agent/impl/impl-f12-conf-json-formatter.prompt.md)

### Create a new config file

**Command:** `dtl.newConfFile` (`Sesam: New Sesam Config File`)  
**Invoke via:** Explorer right-click → *Sesam: New Sesam Config File* · Command Palette · keybinding

1. Right-click `pipes/` in the Explorer → **Sesam: New Sesam Config File**.
2. Walk through the wizard:
   - Template: *Pipe with DTL transform*
   - Source type: `dataset`
   - `_id`: `demo-pipe`
3. File opens immediately — **no boilerplate typing**.

### Formatter

**Command:** `sesam.formatDocument` (`Sesam: Format Document`)  
**Keyboard:** `Shift+Alt+F`  
**Auto-triggers:** on save for all `sesam-config` files

- **Save the file** — canonical key order is applied automatically on save.
- Show the before/after: keys reorder to `_id → type → source → transform → …`.
- Manual trigger: **Shift+Alt+F** or `Sesam: Format Document`.
- Explain the DTL array layout: each rule on its own line, keeping diffs minimal.
- Controlled by setting: `dtl.format.reorderKeys` (default `true`)

### Key talking points

- Key reordering matches the sesam-py convention so downloaded configs always look consistent.
- The formatter is shared between the editor client and the LSP server — same output everywhere.

---

## 4. Editing Intelligence — Completions, Hover, Linting
**10 minutes | Demo**

### 4a. Config property completions (3 min)
Spec: [impl-f21-config-prop-completions](../packages/vscode-extension/agent/impl/impl-f21-config-prop-completions.prompt.md)

1. Inside the empty `"source": {}`, press `"` — show the property suggestions (`type`, `dataset`, …).
2. Type `"type": "` — show **source type completions** (all 18 types with descriptions).
3. Accept `"dataset"`, then add a new line inside `source` — show `"dataset"` is now suggested.
4. Note: already-present keys are excluded from suggestions.

### 4b. DTL function completions (3 min)

1. Inside a rules array, type `["` — show the full function list with signatures.
2. Accept `"add"` — show the snippet expands with tab stops.
3. Show variable completions: type `_` → `_S`, `_T`, `_P` completions appear.
4. Show reserved field completions: `_id`, `_deleted`, etc.

Trigger characters: `"`, `[`, `_`, `.`, `:`

### 4c. Hover documentation (2 min)

1. Hover over a DTL function name — show the **signature**, description, parameter list, and link to [Sesam docs](https://docs.sesam.io).
2. Hover over `_S` — show the variable description.
3. Hover over `_id` — show the reserved field docs.

### 4d. Linting & quick fixes (2 min)
Spec: [impl-f19-syntax-linting](../packages/vscode-extension/agent/impl/impl-f19-syntax-linting.prompt.md)

**Copilot tools:** `#sesamLintDocument` · `#sesamLintWorkspace`  
See [copilot-agent.md — Available Tools](../packages/vscode-extension/docs/copilot-agent.md)

1. **Delete the `_id` field** — red squiggly appears immediately; the Sesam panel (bottom) updates.
2. Press **Ctrl+.** on the squiggly → pick **Add `"_id"`** — the field is inserted.
3. Type an unknown DTL function name (e.g. `["addd"`) — error underline appears.
4. Type a function with wrong argument count — warning appears.
5. Explain: diagnostics show in-editor + Sesam panel (not VS Code Problems view — keeps Sesam issues separate).

---

## 5. Navigation — Cross-file, Go-to-Definition, Rename
**10 minutes | Demo**

### 5a. Cross-file dataset navigation (4 min)
Spec: [cross-file-navigation](../packages/vscode-extension/agent/plans/cross-file-navigation.prompt.md)

1. Open a pipe that reads from another dataset.
2. **Ctrl+Click** the dataset ID in `"source"` — jumps to the producing pipe's config file.
3. **Alt+F12** on the same ID — **Peek Definition** inline (stays in current file).
4. Right-click the `_id` of a pipe → **Find All References** — lists every pipe that sources or hop-joins this dataset.
5. Show document links: dataset IDs appear as **underlined clickable links** in the editor.

### 5b. Go to rule definition (3 min)
Spec: [go-to-rule-definition](../packages/vscode-extension/agent/plans/go-to-rule-definition.prompt.md)

1. Open a pipe with `apply` or `apply-hops` calls.
2. **F12** on the rule name in `["apply", "my-rule", …]` — jumps to the rule definition.
3. **Shift+Alt+F12** — Peek References on the definition key.
4. Rename a rule: **F2** on the rule definition key → rename dialog → confirm. All call sites update atomically.

### 5c. Dataset alias support (3 min)
Spec: [dataset-alias-support](../packages/vscode-extension/agent/plans/dataset-alias-support.prompt.md)

1. Open a pipe with `"datasets": ["my-dataset alias"]`.
2. Hover the alias token — shows the full dataset ID it stands for.
3. Hover any usage of `alias.field` — same tooltip.
4. **F2** on the alias — renames declaration + all usages in the file.

---

## 6. Sidebar Views — Lineage, Dependents, System Pipes
**5 minutes | Demo**  
Spec: [pipe-dag-tree](../packages/vscode-extension/agent/plans/pipe-dag-tree.prompt.md) · [system-pipes-view](../packages/vscode-extension/agent/plans/system-pipes-view.prompt.md)

**Command:** `dtl.refreshDag` (`Sesam: Refresh Pipe DAG`)

### Pipe Lineage

1. Open any non-trivial pipe.
2. Click the **Pipe Lineage** panel in the sidebar.
3. Show the upstream ancestry tree — each node is the pipe producing the dataset this pipe reads.
4. Click a node → opens that pipe's config file.
5. Mention: hop-joined datasets appear under a **Joins** group; cycles show as `(cycle)`; depth limit = 8.

### Pipe Dependents

1. Switch to the **Pipe Dependents** panel.
2. Show downstream consumers (pipes that read *this* pipe's output).
3. Mention the **Hop consumers** sub-group.

### System Pipes

1. Open a system config.
2. Switch to the **System Pipes** panel.
3. Show **Source pipes**, **Sink pipes**, **Transform pipes** grouped by how they use the system.
4. Switch to a pipe config — view flips to show **Source systems**, **Sink systems**, **Transform systems**.

---

## 7. Node Integration — Credentials, Upload/Download, Run
**10 minutes | Demo**

### 7a. Credential setup (2 min)
Spec: [impl-f03-credential-management](../packages/vscode-extension/agent/impl/impl-f03-credential-management.prompt.md) · [credential-safety](../packages/vscode-extension/agent/plans/credential-safety.prompt.md) · [impl-f26-switch-profile](../packages/vscode-extension/agent/impl/impl-f26-switch-profile.prompt.md)

**Command:** `sesam.addProfile` (`Sesam: Add Profile`)

1. Open Command Palette (`Ctrl+Shift+P`) → **Sesam: Add Profile**.
2. Show the profile picker — multiple environments (dev / test / prod).
3. Enter node URL and JWT — stored in VS Code **SecretStorage**, never written to disk.
4. Point out the status bar bottom-left: shows active profile hostname.

### 7b. Upload (3 min)
Spec: [impl-f01-sesam-commands](../packages/vscode-extension/agent/impl/impl-f01-sesam-commands.prompt.md)

**Command:** `sesam.upload` (`Sesam: Upload to Node`) — `Ctrl+Shift+U`  
**Command:** `sesam.uploadFile` (`Sesam: Upload This Config to Node`) — editor title bar

1. Make a small intentional error in a config (e.g. remove `_id`).
2. **Ctrl+Shift+U** → upload is **blocked** — the output channel opens with a grouped error report.
3. Error notification includes **Fix with Copilot** button → opens `@sesam /fix` in chat.  
   See [copilot-agent.md — @sesam Chat Participant](../packages/vscode-extension/docs/copilot-agent.md#sesam-chat-participant).
4. Fix the error.
5. **Ctrl+Shift+U** again — success notification shows pipe/system counts.
6. Mention **Upload File** (editor title bar button) for single-file upload.

### 7c. Download (2 min)

**Command:** `sesam.download` (`Sesam: Download from Node`) — `Ctrl+Shift+D`  
**Command:** `sesam.downloadFile` (`Sesam: Download This Config from Node`) — editor title bar

1. **Ctrl+Shift+D** → confirmation dialog before overwriting local files.
2. After download, open any file — show key-ordering applied automatically.
3. Mention **Download File** (title bar) for single-file.
4. Show **Download Guard**: if local files differ from node, the download warns you first.

### 7d. Run pipe (3 min)
Spec: [impl-f23-network-status](../packages/vscode-extension/agent/impl/impl-f23-network-status.prompt.md) · [impl-f24-live-updates](../packages/vscode-extension/agent/impl/impl-f24-live-updates.prompt.md)

**Command:** `sesam.runPipe` (`Sesam: Run Pipe`) — `Ctrl+Shift+R` · editor title bar play button

1. Open any pipe config.
2. **Ctrl+Shift+R** (or title-bar play button) — pipe runs on the node.
3. Play button turns into a spinner; all other node commands are disabled during the run.
4. Show the status bar update: `$(sync~spin) Sesam: Checking node…` → `$(check) Sesam: Connected`.
5. If the node is hibernated, show the amber status indicator and the automatic provisioning poller.

---

## 8. Sync Status & Diff View
**5 minutes | Demo**  
Spec: [impl-f06-status-diff-view](../packages/vscode-extension/agent/impl/impl-f06-status-diff-view.prompt.md)

**Command:** `sesam.showStatus` (`Sesam: Show Sync Status`) — sidebar panel

1. Open the **Sesam Sync Status** sidebar panel.
2. Show the three groups: **Modified**, **Node only**, **Local only**.
3. Click a **Modified** item → side-by-side diff editor (local ↔ node) opens.
4. Show the inline **Revert** (⊘) button on a Modified item — confirm modal, then reverts to node version.
5. Point out: view auto-refreshes 500ms after any Sesam config save, so it's always current.
6. Mention **System Status** (`sesam.systemStatus`) — same table + **Config Status** column that shows sync state for systems.

---

## 9. Testing, Pipe Preview, Node Status
**5 minutes | Demo**

### Pipe Preview
Spec: [impl-f04-node-preview](../packages/vscode-extension/agent/impl/impl-f04-node-preview.prompt.md)

**Command:** `dtl.previewPipe` (`Sesam: Preview Pipe`) — editor title bar

1. Open a pipe config.
2. Command Palette → **Sesam: Preview Pipe Output**.
3. Edit the input entity JSON in the left pane.
4. **Ctrl+Enter** (or ▶ Run preview) — output entity appears syntax-highlighted on the right.
5. Mention: if credentials are missing, the error banner has an **Open Settings** link.

### Node Status panel
Spec: [impl-f23-network-status](../packages/vscode-extension/agent/impl/impl-f23-network-status.prompt.md) · [impl-f24-live-updates](../packages/vscode-extension/agent/impl/impl-f24-live-updates.prompt.md)

**Command:** `sesam.nodeStatus` (`Sesam: Open Node Status Panel`) — Explorer toolbar · editor title bar

1. Click the Node Status button in the Explorer toolbar.
2. Show the table: pipe ID, state badge (running/ok/failed/disabled), OK runs, failures, queued, last run.
3. Use a **filter pill** (e.g. Failed) — client-side filter, no network request.
4. Type in the **search box** to narrow by pipe ID. Use `"exact-id"` for exact match.
5. Click a pipe ID → opens local config file. Click 🌐 icon → opens pipe in Management Studio.

#### Live updates via Socket.IO

6. Point to the **● Live** badge (green) in the toolbar — the panel is connected to the node via Socket.IO and receives real-time push events (`pipes_updated`, `pipes_added`, `pipes_deleted`), exactly like Management Studio does.
7. Trigger a pipe run from the terminal or another browser tab — watch the row update **without any manual refresh**.
8. Click the **Live updates toggle** (checkbox) to pause the connection → badge turns grey (● Paused); a **Refresh** button appears for manual reload.
9. Re-enable the toggle — badge goes green again and the panel catches up.
10. Explain the fallback: if the node doesn't support Socket.IO the badge shows **○ Not supported** (red) and the manual **Refresh** button is always visible. There is no polling fallback — the node must support WebSocket for live mode.

### Test Management (if time permits)
Spec: [impl-f05-test-management](../packages/vscode-extension/agent/impl/impl-f05-test-management.prompt.md)

**Command:** `sesam.runPipeTests` (`Sesam: Run Pipe Tests`) — VS Code Testing view (beaker icon in Activity Bar)

1. Open the VS Code **Testing** view (beaker icon in Activity Bar).
2. Show sesam test cases discovered from the `testdata/` / `expected/` folders.
3. Run a test — green/red inline decorations appear in the editor.

---

## 10. Copilot Chat Participant — @sesam
**5 minutes | Demo**  
Spec: [impl-f09-copilot-agent](../packages/vscode-extension/agent/impl/impl-f09-copilot-agent.prompt.md)  
See also: [copilot-agent.md](../packages/vscode-extension/docs/copilot-agent.md)

> **Requires:** GitHub Copilot extension signed in. Other AI extensions (Continue, Cline, etc.) cannot invoke `@sesam`.

### What it is

`@sesam` is a Sesam-aware Copilot chat participant. Unlike `#sesamLintDocument` / `#sesamLintWorkspace` (which Copilot's agent calls automatically), `@sesam` is always **user-initiated** and supports richer, multi-step interaction — it embeds the DTL function reference and your active file into the system prompt.

### How to invoke

1. Open Copilot Chat (`Ctrl+Alt+I`) and switch the mode selector to **Agent**.
2. Type `@sesam` — *Sesam Assistant* appears in the autocomplete.

### Slash commands

| Command | What it does |
|---|---|
| `/generate` | Generate a new Sesam pipe config |
| `/explain` | Explain the active pipe config or a dragged-in file |
| `/test` | Generate `testdata/<pipe-id>-input.json` + `expected.json` |
| `/fix` | Fix DTL errors in the active file (also triggered by the upload failure button) |
| `/cli` | Get sesam-py CLI command syntax and examples |

### Demo steps

1. **Generate** — type `@sesam /generate a pipe that reads from a REST system "hr-api" and maps employeeId to _T.id`.
   - `@sesam` generates the JSON, lints it automatically, and shows a **Save as hr-api.conf.json** button — click to write the file directly into `pipes/`.
2. **Explain** — open a complex pipe, then type `@sesam /explain`.
   - `@sesam` reads the active file and explains each transform rule in plain language.
3. **Fix** — introduce an error (e.g. wrong function name), run `Ctrl+Shift+U` to get the upload error notification, click **Fix with Copilot**.
   - Equivalent to typing `@sesam /fix` manually in chat — Copilot reads the broken file and applies corrections to disk.
4. **Lint tools** — ask naturally: *"Are there any errors across all my pipe configs?"*
   - Copilot calls `#sesamLintWorkspace` automatically and returns a grouped per-file summary.

### Key talking point

`@sesam` is always context-aware — it knows your DTL functions, your active file, and your attached files. You never have to paste JSON into chat.

---

## All Commands Reference

| Command ID | Title | Shortcut |
|---|---|---|
| `sesam.upload` | Sesam: Upload to Node | `Ctrl+Shift+U` |
| `sesam.download` | Sesam: Download from Node | `Ctrl+Shift+D` |
| `sesam.runPipe` | Sesam: Run Pipe | `Ctrl+Shift+R` |
| `sesam.uploadFile` | Sesam: Upload This Config to Node | — |
| `sesam.downloadFile` | Sesam: Download This Config from Node | — |
| `sesam.pipeStatus` | Sesam: Show Pipe Status | — |
| `sesam.nodeStatus` | Sesam: Open Node Status Panel | — |
| `sesam.systemStatus` | Sesam: Open System Status | — |
| `sesam.showStatus` | Sesam: Show Sync Status | — |
| `dtl.refreshDag` | Sesam: Refresh Pipe DAG | — |
| `sesam.addProfile` | Sesam: Add Profile | — |
| `sesam.fixWithCopilot` | Sesam: Fix with Copilot | — |
| `sesam.runPipeTests` | Sesam: Run Pipe Tests | — |
| `dtl.newConfFile` | Sesam: New Sesam Config File | — |
| `sesam.formatDocument` | Sesam: Format Document | `Shift+Alt+F` |
| `dtl.previewPipe` | Sesam: Preview Pipe Output | — |

---

## Quick Reference Card

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Command Palette (all Sesam commands) |
| `Ctrl+Shift+U` | Upload all configs to node |
| `Ctrl+Shift+D` | Download all configs from node |
| `Ctrl+Shift+R` | Run active pipe on node |
| `Shift+Alt+F` | Format document (Sesam formatter) |
| `F12` | Go to Definition (dataset / rule) |
| `Alt+F12` | Peek Definition |
| `Shift+Alt+F12` | Peek References |
| `F2` | Rename symbol (rule, alias) |
| `Ctrl+.` | Quick Fix (on squiggly underline) |
| `Ctrl+Enter` | Run preview (Pipe Preview panel) |
| `Ctrl+Alt+I` | Open Copilot Chat |

---

## Common Questions & Answers

**Q: Do I still need Python / sesam-py installed?**  
A: No. The extension bundles a full TypeScript reimplementation of sesam-py. Nothing extra to install.

**Q: Where are my credentials stored?**  
A: In VS Code's SecretStorage (OS keychain on Linux/macOS/Windows). Never written to disk or committed.

**Q: Can I have multiple node profiles (dev/test/prod)?**  
A: Yes. Use **Sesam: Add Profile** to create named profiles and switch between them from the status bar or Command Palette.

**Q: The formatter re-orders my keys — can I turn that off?**  
A: Yes. Set `dtl.format.reorderKeys` to `false` in VS Code settings. Formatting will still run on save but preserve insertion order.

**Q: Can I upload a single file without touching the rest?**  
A: Yes — use **Sesam: Upload File** from the editor title bar or Command Palette. It validates only that file before uploading.

**Q: The Sesam panel shows errors but Problems (Ctrl+Shift+M) doesn't — is that a bug?**  
A: By design. Sesam diagnostics are shown in the dedicated Sesam panel (bottom tab) rather than the VS Code Problems view, so Sesam issues don't mix with TypeScript/ESLint errors.

**Q: Why do I see `(cycle)` in the Lineage tree?**  
A: It means two pipes circularly depend on each other's datasets. The extension detects cycles and stops recursing to prevent infinite expansion.

**Q: How do I get Copilot to help with a broken pipe?**  
A: If upload fails, the notification includes a **Fix with Copilot** button. It opens `@sesam /fix` in the chat panel, which reads the broken files and applies corrections automatically. You can also use `@sesam` in chat for any question about your configs.

---

## Further Reading

| Doc | Link |
|---|---|
| Full feature reference | [README.md](../packages/vscode-extension/README.md) |
| Setup & build guide | [docs/development.md](../packages/vscode-extension/docs/development.md) |
| Copilot agent & tools | [docs/copilot-agent.md](../packages/vscode-extension/docs/copilot-agent.md) |
| Feature roadmap | [agent/impl/README.md](../packages/vscode-extension/agent/impl/README.md) |
| Product plan | [agent/sesam-extension-plan.prompt.md](../packages/vscode-extension/agent/sesam-extension-plan.prompt.md) |

---

## What's Coming Next

| Feature | Status |
|---|---|
| Inline diagnostics from node (F10) | Planned |
| Interactive pipe graph canvas (F15) | Planned |
| Config file intelligence — `.syncconfig`, `.authconfig` (F02) | Planned |
| Connector development tools (F08) | Planned |
| Management Studio features in VS Code (F11) | Long-term |

The full roadmap lives in [`agent/impl/README.md`](../packages/vscode-extension/agent/impl/README.md).
