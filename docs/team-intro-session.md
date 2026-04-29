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

### Steps to show

1. Run the install script:
   ```bash
   bash scripts/install-extension.sh
   ```
2. Reload VS Code — note the new **Sesam** activity-bar icon.
3. Point to a project folder that has `pipes/` and `systems/` subdirectories.
4. Open the Explorer — show the `.conf.pipe` / `.conf.system` file icons.

### Key talking points

- File extensions `.conf.pipe` (pipes) and `.conf.system` (systems) are the canonical Sesam format; `.conf.json` is still supported for backwards compatibility.
- All three map to the `sesam-config` language ID, which drives all the intelligence features.
- The activity-bar sidebar contains three panels: **Pipe Lineage**, **Pipe Dependents**, **System Pipes**.

---

## 3. File Types & the Formatter
**5 minutes | Demo**

### Create a new config file

1. Right-click `pipes/` in the Explorer → **DTL: New Sesam Config File**.
2. Walk through the wizard:
   - Template: *Pipe with DTL transform*
   - Source type: `dataset`
   - `_id`: `demo-pipe`
3. File opens immediately — **no boilerplate typing**.

### Formatter

- **Save the file** — canonical key order is applied automatically on save.
- Show the before/after: keys reorder to `_id → type → source → transform → …`.
- Manual trigger: **Shift+Alt+F** or `Sesam: Format Document`.
- Explain the DTL array layout: each rule on its own line, keeping diffs minimal.

### Key talking points

- Key reordering matches the sesam-py convention so downloaded configs always look consistent.
- The formatter is shared between the editor client and the LSP server — same output everywhere.

---

## 4. Editing Intelligence — Completions, Hover, Linting
**10 minutes | Demo**

### 4a. Config property completions (3 min)

1. Inside the empty `"source": {}`, press `"` — show the property suggestions (`type`, `dataset`, …).
2. Type `"type": "` — show **source type completions** (all 18 types with descriptions).
3. Accept `"dataset"`, then add a new line inside `source` — show `"dataset"` is now suggested.
4. Note: already-present keys are excluded from suggestions.

### 4b. DTL function completions (3 min)

1. Inside a rules array, type `["` — show the full function list with signatures.
2. Accept `"add"` — show the snippet expands with tab stops.
3. Show variable completions: type `_` → `_S`, `_T`, `_P` completions appear.
4. Show reserved field completions: `_id`, `_deleted`, etc.

### 4c. Hover documentation (2 min)

1. Hover over a DTL function name — show the **signature**, description, parameter list, and link to Sesam docs.
2. Hover over `_S` — show the variable description.
3. Hover over `_id` — show the reserved field docs.

### 4d. Linting & quick fixes (2 min)

1. **Delete the `_id` field** — red squiggly appears immediately; the Sesam panel (bottom) updates.
2. Press **Ctrl+.** on the squiggly → pick **Add `"_id"`** — the field is inserted.
3. Type an unknown DTL function name (e.g. `["addd"`) — error underline appears.
4. Type a function with wrong argument count — warning appears.
5. Explain: diagnostics show in-editor + Sesam panel (not VS Code Problems view — keeps Sesam issues separate).

---

## 5. Navigation — Cross-file, Go-to-Definition, Rename
**10 minutes | Demo**

### 5a. Cross-file dataset navigation (4 min)

1. Open a pipe that reads from another dataset.
2. **Ctrl+Click** the dataset ID in `"source"` — jumps to the producing pipe's config file.
3. **Alt+F12** on the same ID — **Peek Definition** inline (stays in current file).
4. Right-click the `_id` of a pipe → **Find All References** — lists every pipe that sources or hop-joins this dataset.
5. Show document links: dataset IDs appear as **underlined clickable links** in the editor.

### 5b. Go to rule definition (3 min)

1. Open a pipe with `apply` or `apply-hops` calls.
2. **F12** on the rule name in `["apply", "my-rule", …]` — jumps to the rule definition.
3. **Shift+Alt+F12** — Peek References on the definition key.
4. Rename a rule: **F2** on the rule definition key → rename dialog → confirm. All call sites update atomically.

### 5c. Dataset alias support (3 min)

1. Open a pipe with `"datasets": ["my-dataset alias"]`.
2. Hover the alias token — shows the full dataset ID it stands for.
3. Hover any usage of `alias.field` — same tooltip.
4. **F2** on the alias — renames declaration + all usages in the file.

---

## 6. Sidebar Views — Lineage, Dependents, System Pipes
**5 minutes | Demo**

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

1. Open Command Palette (`Ctrl+Shift+P`) → **Sesam: Add/Edit Credentials**.
2. Show the profile picker — multiple environments (dev / test / prod).
3. Enter node URL and JWT — stored in VS Code **SecretStorage**, never written to disk.
4. Point out the status bar bottom-left: shows active profile hostname.

### 7b. Upload (3 min)

1. Make a small intentional error in a config (e.g. remove `_id`).
2. **Ctrl+Shift+U** → upload is **blocked** — the output channel opens with a grouped error report.
3. Fix the error.
4. **Ctrl+Shift+U** again — success notification shows pipe/system counts.
5. Mention **Upload File** (editor title bar button) for single-file upload.

### 7c. Download (2 min)

1. **Ctrl+Shift+D** → confirmation dialog before overwriting local files.
2. After download, open any file — show key-ordering applied automatically.
3. Mention **Download File** (title bar) for single-file.
4. Show **Download Guard**: if local files differ from node, the download warns you first.

### 7d. Run pipe (3 min)

1. Open any pipe config.
2. **Ctrl+Shift+R** (or title-bar play button) — pipe runs on the node.
3. Play button turns into a spinner; all other node commands are disabled during the run.
4. Show the status bar update: `$(sync~spin) Sesam: Checking node…` → `$(check) Sesam: Connected`.
5. If the node is hibernated, show the amber status indicator and the automatic provisioning poller.

---

## 8. Sync Status & Diff View
**5 minutes | Demo**

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

1. Open a pipe config.
2. Command Palette → **Sesam: Preview Pipe**.
3. Edit the input entity JSON in the left pane.
4. **Ctrl+Enter** (or ▶ Run preview) — output entity appears syntax-highlighted on the right.
5. Mention: if credentials are missing, the error banner has an **Open Settings** link.

### Node Status panel

1. Click the Node Status button in the Explorer toolbar.
2. Show the table: pipe ID, state badge (running/ok/failed/disabled), OK runs, failures, queued, last run.
3. Use a **filter pill** (e.g. Failed) — client-side filter, no network request.
4. Type in the **search box** to narrow by pipe ID. Use `"exact-id"` for exact match.
5. Show the **● Live** badge — Socket.IO connection; data updates in real time.
6. Click a pipe ID → opens local config file. Click 🌐 icon → opens pipe in Management Studio.

### Test Management (if time permits)

1. Open the VS Code **Testing** view (beaker icon in Activity Bar).
2. Show sesam test cases discovered from the `testdata/` / `expected/` folders.
3. Run a test — green/red inline decorations appear in the editor.

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

---

## Common Questions & Answers

**Q: Do I still need Python / sesam-py installed?**  
A: No. The extension bundles a full TypeScript reimplementation of sesam-py. Nothing extra to install.

**Q: Where are my credentials stored?**  
A: In VS Code's SecretStorage (OS keychain on Linux/macOS/Windows). Never written to disk or committed.

**Q: Can I have multiple node profiles (dev/test/prod)?**  
A: Yes. Use **Sesam: Add/Edit Credentials** to create named profiles and switch between them from the status bar or Command Palette.

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

## What's Coming Next

| Feature | Status |
|---|---|
| Inline diagnostics from node (F10) | Planned |
| Interactive pipe graph canvas (F15) | Planned |
| Config file intelligence — `.syncconfig`, `.authconfig` (F02) | Planned |
| Connector development tools (F08) | Planned |
| Management Studio features in VS Code (F11) | Long-term |

The full roadmap lives in [`agent/impl/README.md`](../packages/vscode-extension/agent/impl/README.md).
