# Sesam

## Table of Contents

- [Features](#features)
  - [Syntax Highlighting](#syntax-highlighting)
  - [Auto-Completion](#auto-completion)
  - [Hover Documentation](#hover-documentation)
  - [Diagnostics (Linting)](#diagnostics-linting)
  - [Quick Fixes](#quick-fixes)
  - [Formatter](#formatter)
  - [Code Snippets](#code-snippets)
  - [Go to Rule Definition](#go-to-rule-definition)
  - [Cross-file Navigation](#cross-file-navigation)
  - [Dataset Alias Support](#dataset-alias-support)
  - [Pipe Lineage](#pipe-lineage)
  - [Pipe Dependents](#pipe-dependents)
  - [System Pipes](#system-pipes)
  - [Sesam Panel](#sesam-panel)
  - [Pipe Preview](#pipe-preview) — live server-side evaluation with syntax-highlighted output
  - [Node Integration — Upload & Download](#node-integration--upload--download)
  - [Node Integration — Run Pipe](#node-integration--run-pipe)
  - [Node Status](#node-status)
  - [Sync Status & Diff View](#sync-status--diff-view)
  - [New Sesam Config File](#new-sesam-config-file)
  - [Credential Management](#credential-management)
  - [Copilot Agent Integration](#copilot-agent-integration)
- [Getting Started](#getting-started)
- [DTL Primer](#dtl-primer)
- [Extension Settings](#extension-settings)
- [Requirements](#requirements)
- [Known Limitations](#known-limitations)
- [Development](#development)
- [Installation](docs/installation.md)
- [Roadmap](#roadmap)
- [License](#license)

---

Full-featured VS Code extension for **Sesam Data Transformation Language (DTL)** — the declarative JSON-array language used to define pipe transformations in the [Sesam](https://sesam.io) integration platform.

The long-term goal is to make this extension the single tool Sesam developers need: bundling sesam-py so no separate install is required, integrating all CLI commands into the editor, and progressively replacing key [Management Studio](https://sesam.io) workflows with native VS Code panels. See the full plan in [`agent/sesam-extension-plan.prompt.md`](agent/sesam-extension-plan.prompt.md) and the implementation tracker in [`agent/impl/README.md`](agent/impl/README.md).

---

## Features

### Syntax Highlighting

- All ~160 built-in DTL functions highlighted by category (string, math, datetime, NI, …).
- Built-in variables `_S`, `_T`, `_P`, `_R`, `_B`, `_` highlighted with property-path continuation.
- Reserved entity fields (`_id`, `_deleted`, `_filtered`, …) distinguished from regular keys.
- Dataset alias tokens in `"datasets"` arrays coloured distinctly from the dataset ID.
- **DTL injection**: function names and variables are highlighted inside `.json` and `.conf.json` pipe configs.

---

### Auto-Completion

#### DTL expressions

- **Function name completions** triggered after `["` inside any array context — all ~160 built-in functions with signatures and docs.
- **Variable completions** (`_S`, `_T`, `_P`, `_R`, `_B`, `_`) triggered after `_`.
- **Reserved entity field completions** (`_id`, `_deleted`, `_filtered`, …).

#### Config property keys

When typing a key inside a config object, the extension suggests the correct properties for the current nesting level — including the full value snippet so only the actual value needs filling in.

| Context | Suggestions |
|---|---|
| Root of a **pipe** config (`.conf.pipe`) | `_id`, `type`, `source`, `transform`, `sink`, `pump`, … |
| Root of a **system** config (`.conf.system`) | `_id`, `type`, `description`, `metadata`, … |
| Root of `node-metadata.conf.json` | `_id`, `type`, `pipe_defaults`, `system_defaults`, `global_defaults`, … |
| Inside `"source": { … }` | `type`, `dataset`, `system`, `table`, `query`, `url`, … |
| Inside `"transform": { … }` | `type`, `rules`, `system`, `operation`, … |
| Inside `"sink": { … }` | `type`, `dataset`, `system`, `table`, `primary_key`, … |
| Inside `"pump": { … }` | `mode`, `schedule_interval`, `cron_expression`, … |

Keys already present in the object are automatically excluded from suggestions.
Required fields are sorted first. Value snippets are type-aware: strings get `"$0"`, objects get `{$0}`, booleans offer a `true`/`false` dropdown, and numbers/arrays get appropriate placeholders.

> Works whether you start typing with a `"` or without — both `"sou` and `sou` trigger suggestions.

#### Config value types

- **Source type completions** inside `"source": { "type": "…" }` — all 18 Sesam source types with descriptions.
- **System type completions** at root level — all supported system types with descriptions.

---

### Hover Documentation

Hover over any of the following to see its **signature**, description, parameter list, and a link to the official Sesam docs:

- DTL function names
- Built-in variables (`_S`, `_T`, …)
- Reserved entity fields
- Dataset alias tokens — shows which dataset the alias stands for

---

### Diagnostics (Linting)

#### DTL expression errors

| Diagnostic | Severity |
|---|---|
| Unknown function name | Error |
| Too few / too many arguments | Warning |
| Transform used as an expression | Warning |
| Unknown variable prefix (`_X.`) | Warning |

#### Config structure validation

The extension validates the overall structure of every `*.conf.pipe`, `*.conf.system`, and `*.conf.json` file:

| Diagnostic | Severity |
|---|---|
| Missing required field (`_id`, `type`, `source` for pipes) | Error |
| `type` value is not a valid pipe/system type | Error |
| `source.type` is an unknown Sesam source type | Warning |
| `metadata.conf.json` (`"type": "metadata"`) — no rules applied | — |

All diagnostics are shown as **squiggly underlines** in the editor, as **file badges** (red/yellow) in the Explorer, and in the **Sesam panel** (see below). They do not appear in the Problems view.

---

### Quick Fixes

Hover over any squiggly underline produced by the config structure validator and press **Ctrl+.** (or click the blue lightbulb that appears in the gutter) to open the quick-fix menu.

| Diagnostic | Fix offered |
|---|---|
| Missing `_id` | Add `"_id": ""` at the top of the config object |
| Missing `type` | Add `"type": "pipe"` **or** `"type": "system:rest"` |
| Missing `source` | Add a skeleton `source` block with `"type": "dataset"` |
| Missing `source.type` | Add `"type": "dataset"` inside the existing source object |
| Missing required source property | Add the specific property (e.g. `"dataset"`, `"system"`) inside source |
| Missing `default` rule | Add `"default": [["copy", "_S"]]` inside the rules object |

> **Note:** VS Code displays a **blue** autofix lightbulb (not yellow) for code actions attached to diagnostics. This is standard VS Code behaviour — the yellow lightbulb is reserved for refactoring suggestions that are unrelated to errors.

---

### Formatter

Format any Sesam config file with **Shift+Alt+F** (or **Format Document** / `Sesam: Format Document`). The formatter:

- Preserves insertion key order by default.
- **Canonical key reordering** on save: keys are sorted to match the sesam-py convention — `_id → type → name → description → source → sink → transform → pump → metadata → …` (convention keys), then unknown keys alphabetically, then internal `_*` keys last. Applied recursively to all nested objects. Controlled by `dtl.format.reorderKeys` (default `true`).
- Renders DTL rule arrays compactly (one rule per line) so diff output stays readable.
- Pretty-prints top-level config objects with standard indentation.
- Triggers automatically on save for `*.conf.pipe`, `*.conf.system`, and `*.conf.json` files.

---

### Code Snippets

35+ snippets covering all common patterns. Type the prefix and press Tab:

#### Config file templates

| Prefix | Inserts |
|---|---|
| `sesam-pipe` | Pipe config with source type choice (no transform) |
| `sesam-pipe-with-transform` | Pipe config with source + DTL rules block |
| `sesam-system` | System config with system type choice |
| `dtl-rules` | Standalone `transform` block with DTL rules |

#### DTL transforms

| Prefix | Inserts |
|---|---|
| `add` | `["add", "$field", value]` |
| `add-if` | Add with condition |
| `copy` | `["copy", "*"]` |
| `remove` | Remove a property |
| `rename` | Rename a property |
| `default` | Set property only if not already set |
| `merge` | Merge dict into target |
| `filter` | Filter transform |
| `discard` | Discard entity |
| `if` | If expression |
| `case` | Case expression |
| `case-eq` | Equality-based case expression |
| `create` | Create a new entity |
| `create-child` | Create child entities |
| `comment` | Inline no-op comment |
| `hops` | Full hops object with `datasets`/`where` |
| `apply-hops` | Apply-hops transform |
| `map` | Map over a list |
| `concat` | Concatenate strings |
| `eq` | Equality comparison |
| `coalesce` | First non-null value |
| `if-null` | Value or default if null |
| `datetime-format` | Format a datetime |
| `now` | Current UTC datetime |
| `integer` | Cast to integer |
| `string` | Cast to string |
| `ni` | Create namespaced identifier |
| `make-ni` | Create NI and add to target |
| `hash128` | 128-bit hash as hex string |

---

### Go to Rule Definition

Navigate between `apply`/`apply-hops` call sites and their rule definitions without leaving the editor.

| Action | How to invoke |
|---|---|
| **Go to Definition** | `F12` or `Ctrl+Click` on the rule name in `["apply", "<rule>", …]` |
| **Peek Definition** | `Alt+F12` on the rule name |
| **Find All References** | Right-click a rule definition key → **Find All References** |
| **Peek References** | `Shift+Alt+F12` on the rule definition key |
| **Rename rule** | `F2` on a rule key or any `apply`/`apply-hops` reference — renames the rule and all its call sites atomically |

> Rule definitions are always local to the transform block of a single config file.

---

### Cross-file Navigation

Navigate between pipe and system config files by clicking on dataset and system IDs.

| Action | How to invoke |
|---|---|
| **Go to Definition** | `F12` or `Ctrl+Click` on a dataset ID in `"source"`, a `hops.datasets` array, or a `"system"` value |
| **Peek Definition** | `Alt+F12` on a dataset or system ID |
| **Document Links** | Dataset IDs in sources and hops, and system IDs (including `"type": "rest"` transform steps), appear as underlined clickable links |
| **Find All References** | Right-click a pipe's `_id` value → **Find All References** — lists all pipes that source or hop-join this dataset |

The language server maintains a live workspace index of all config files, updated automatically on create, change, or delete.

---

### Dataset Alias Support

In Sesam pipe configs, entries in `"datasets"` arrays can use the syntax `"dataset-id alias"` to declare a local shorthand. The extension provides full IDE support for these aliases:

| Feature | Description |
|---|---|
| **Highlight** | The alias token is coloured distinctly from the dataset ID |
| **Hover** | Hovering any alias (declaration or usage) shows the full dataset ID it stands for |
| **Rename** | Press `F2` on any alias token to rename it everywhere in the file — declaration and all uses updated atomically |
| **Find All References** | Right-click an alias → **Find All References** — lists the declaration plus all prefixed (`alias.field`) and bare (`"alias"`) usages |

---

### Pipe Lineage

A sidebar panel showing the **upstream ancestry** of the pipe open in the active editor.

- Each node is the pipe that produces the dataset the active pipe reads from.
- Hop-joined datasets appear under a collapsible **Joins** group.
- Recursively expands ancestors up to a depth of 8; cycles are shown as `(cycle)`.
- Clicking a node opens the corresponding config file.
- Updates automatically when you switch files or files change; use **Sesam: Refresh Pipe DAG** to force a rescan.

---

### Pipe Dependents

A sidebar panel showing **downstream consumers** of the pipe open in the active editor.

- Lists all pipes that read the active pipe's output dataset as their primary source.
- A **Hop consumers** group lists pipes that join the dataset in their hops block.
- Same cycle-guard and depth limit as Pipe Lineage.

---

### System Pipes

A sidebar panel with a **dual-mode** view depending on the active file:

| Active file | Groups shown |
|---|---|
| A **system** config | Source pipes · Sink pipes · Transform pipes |
| A **pipe** config | Source systems · Sink systems · Transform systems |

Each group shows a count, and every item is a clickable link that opens the relevant config file.

---

### Sesam Panel

A dedicated **bottom panel tab** (alongside Terminal / Output) that shows all Sesam diagnostics grouped by file.

- Errors are listed first, followed by warnings, with exact line and column.
- Clicking any diagnostic navigates directly to the problem location in the editor.
- File badges (red/yellow) in the Explorer are driven by the same data.
- Use the **Clear All** (🗑) toolbar button to dismiss all entries until the next save.

---

### Pipe Preview

A live preview panel that evaluates DTL transforms against a sample input entity by posting to the configured Sesam node.

1. Open a pipe config file.
2. Run **Sesam: Preview Pipe** from the Command Palette (`Ctrl+Shift+P`).
3. Edit the **Input Entity** and press **▶ Run preview** (or `Ctrl+Enter`).
4. Both the **Input Entity** and **Output Entity** render with syntax-highlighted JSON.

The output pane renders JSON with token colours that match your VS Code theme:

| Token | Dark mode | Light mode |
|---|---|---|
| Object keys | green | teal |
| String values | yellow | dark green |
| Numbers, booleans | purple | blue |
| `null`, braces, brackets, commas, colons | purple | black |

> The panel requires a configured Sesam node URL and JWT token. If credentials are missing the error banner shows a **Open Settings** link to set them without leaving the panel.

---

### New Sesam Config File

Create a new `*.conf.json` pipe or system config from a template — no copy-pasting boilerplate.

**3 ways to invoke:** Explorer right-click → **DTL: New Sesam Config File** · Command Palette (`Ctrl+Shift+P`) → `DTL: New Sesam Config File` · custom keybinding to `dtl.newConfFile`.

**Wizard steps:**

1. **Pick a template** — Simple pipe · Pipe with DTL transform · System
2. **Choose a type:**
   - *Pipe* — pick from 18 source types: `binary`, `conditional`, `csv`, `dataset`, `embedded`, `empty`, `http_endpoint`, `json`, `kafka`, `ldap`, `merge`, `merge_datasets`, `rdf`, `rest`, `sdshare`, `sparql`, `sql`, `union_datasets`
   - *System* — pick from 13 system types: `elasticsearch`, `kafka`, `ldap`, `microservice`, `mssql`, `mysql`, `oracle`, `postgresql`, `rest`, `smtp`, `solr`, `twilio`, `url`
3. **Enter `_id`** — used as both the config `_id` and the filename (`<id>.conf.json`)

The file is written to the target folder and opened immediately.

---

### Node Integration — Upload & Download

Upload and download all pipe/system configs directly from VS Code — no terminal required.

#### Upload (`Ctrl+Shift+U`)

1. Validates all local configs **offline first** — upload is blocked if any file has errors.
2. If validation fails, the **Sesam output channel** opens with a grouped error report including clickable `file:///` links to each problem. A **Fix with Copilot** button in the notification opens `@sesam /fix` in the chat panel, which reads the broken files and applies corrections to disk automatically.
3. On success, a notification shows the pipe and system counts uploaded.

#### Upload single file

Upload only the config file open in the active editor — without replacing other configs on the node.

- Toolbar button in the editor title bar (when a Sesam config is open).
- Command: **Sesam: Upload File**.
- Validates the single file offline before uploading.

#### Download (`Ctrl+Shift+D`)

1. Confirms before overwriting local files (modal dialog).
2. Downloads all pipe and system configs from the node.
3. Formats and **key-orders** every file to match the sesam-py convention:
   - `_id → type → name → description → source → sink → transform → pump → metadata → …` (convention keys first)
   - Unknown keys sorted alphabetically after
   - Internal `_*` keys (except `_id`) and `$audit` moved last
   - Applied **recursively** — nested objects like `source` and `transform` are also reordered

Buttons for both commands appear in:
- **Editor title bar** (when a Sesam config is open)
- **File Explorer header** (`workbench.explorer.fileView`) — always available, even with no file open

All requests are logged to the **Sesam output channel**.

#### Download single file

Download only the config for the pipe/system open in the active editor.

- Toolbar button in the editor title bar (when a Sesam config is open).
- Command: **Sesam: Download File**.
- Shows a confirmation dialog before overwriting the local file.

---

### Node Integration — Run Pipe

Run the currently open pipe on the connected Sesam node.

| Action | How to invoke |
|---|---|
| **Run pipe** | `Ctrl+Shift+R` · Editor title bar play button |

- Works even when focus is in the terminal, output panel, or the preview webview — the extension remembers the last active Sesam config editor.
- The play button is replaced by a spinner while the run is in progress; all other node commands are disabled.
- On failure, a hint is shown about the node status; if the node is provisioning, the provisioning poller starts automatically.

#### Node status bar indicator

A shared status bar item (bottom-left) tracks the node connection lifecycle and updates automatically whenever any command contacts the node:

| Stage | Text | Background |
|---|---|---|
| Checking node | `$(sync~spin) Sesam: Checking node…` | Amber |
| Node hibernated | `$(warning) Sesam: Node hibernated` | Amber |
| Starting provisioning | `$(sync~spin) Sesam: Starting provisioning…` | Amber |
| Trying to connect | `$(sync~spin) Sesam: Trying to connect…` | Amber |
| Connected | `$(check) Sesam: Connected` | Default |

Each stage shows an informative **tooltip** on hover. The **Connected** state auto-hides after 2.5 seconds.

---

### Node Status

A live WebView panel showing the **runtime status of all pipes** on the connected Sesam node.

#### Node Status panel (`sesam.nodeStatus`)

Open from the **editor title bar** or the **Explorer toolbar** (always available).

| Column | Description |
|---|---|
| Pipe | Clickable pipe ID — opens the local config file; globe icon opens the pipe in Management Studio |
| State | Colour-coded badge: running · ok · failed · disabled |
| OK runs | Cumulative success count |
| Failures | Cumulative failure count (red when > 0) |
| Queued | Entities waiting in the queue |
| Last run | Human-readable timestamp |

**Controls:**
- **Filter pills** — All · Running · Failed · OK · Disabled — filter the current data client-side; no network request.
- **Search box** — type to filter by pipe ID (substring). Wrap in double-quotes for an exact match: `"my-pipe"` shows only that pipe.
- **Column headers** — click to sort ascending/descending.
- **Live updates** — the panel connects to the node over Socket.IO and receives real-time `pipes_updated` / `pipes_added` / `pipes_deleted` push events. A connection badge in the toolbar shows the current state:
  - **● Live** (green) — Socket.IO connected; data updates in real time
  - **○ Paused** (grey) — user has disabled live updates via the toggle; use **Refresh** to reload
  - **○ Not supported** (red) — connection failed or was lost; use **Refresh** to reload
- **Live updates toggle** — checkbox in the toolbar to pause or resume the Socket.IO connection. Hidden when the connection is not supported.
- **Refresh button** — visible only when live updates are paused or not supported.
- **Summary bar** — shows total pipe count with running / failure / disabled breakdowns.

**Pipe ID links:**
- Click the pipe name → opens the local config file in the leftmost editor column.
- Click the 🌐 icon → opens the pipe's edit page in Management Studio.

#### Pipe Status (`sesam.pipeStatus`)

Available from the **editor title bar** when a Sesam config file is open. Opens the same Node Status WebView but pre-filtered to show only the active pipe (using exact-match search). Fetches only the single pipe from the node — no full status scan.

Clicking the button for a different pipe while the panel is already open updates the search filter to the new pipe.

#### System Status (`sesam.systemStatus`)

Open from the **Explorer toolbar** or the Command Palette. Opens the same Node Status WebView with the **Systems tab** pre-selected.

**Systems tab columns:**

| Column | Description |
|---|---|
| System | System ID |
| Type | Sesam system type (`rest`, `microservice`, …) |
| Pipes In | Number of pipes that read from this system |
| Pipes Out | Number of pipes that write to this system |
| Config Status | `Modified` / `Node only` / `Local only` / `—` — same sync state as the Sync Status view |

The **Config Status** column updates automatically when the Sync Status view refreshes. Clicking the badge opens a diff panel (same behaviour as the Pipes tab).

---

### Sync Status & Diff View

A sidebar tree view (**Sesam Sync Status**) that compares local config files against the versions currently on the connected node.

#### Tree view

Items are grouped into three states:

| State | Description |
|---|---|
| **Modified** | File exists both locally and on the node, but the contents differ |
| **Node only** | Config exists on the node but has no matching local file |
| **Local only** | Config exists locally but is not present on the node |

Hovering any item shows a tooltip: `"<kind> '<id>' <state description>"`.

The view auto-populates 3 seconds after the extension activates, and refreshes automatically 500 ms after any Sesam config file is saved.

#### Opening a diff

- **Modified items** — click or press Enter to open a side-by-side VS Code diff editor (local ↔ node).
- **Node-only items** — opens the node version read-only with a prompt to download the file locally.

#### Reverting changes

Each **Modified** item has an inline **Revert** button (⊘). Clicking it:

1. Shows a confirmation modal.
2. Downloads the node version of the config.
3. Overwrites the local file with the node version (key-ordered and formatted).
4. Refreshes the sync status view silently.

#### Download guard

Running **Sesam: Download** or **Sesam: Download File** when there are local changes first fetches the sync status (or reuses the cached result) and, if any `Modified` or `Local-only` items are detected, shows a modal:

- **See Local Diffs** — focuses the Sync Status view (and auto-opens the diff if there is exactly one changed file).
- **Download Anyway** — proceeds with the download without reviewing diffs.

If no local differences are found the download proceeds silently.

---

### Credential Management

The extension stores your Sesam JWT tokens securely in VS Code **SecretStorage** (OS keychain on Linux/macOS/Windows) — tokens are never written to disk or committed to source control.

You can configure multiple named **profiles** (e.g. `dev`, `staging`, `prod`) and switch between them from the status bar.

#### Quick start

1. Run **Sesam: Add Profile** from the Command Palette.
2. Enter a profile name (e.g. `dev`), the portal URL (defaults to `https://portal.sesam.io`), your node URL, and your JWT.
3. The active profile name is shown in the status bar: `$(key) Sesam: [dev]`. Click it to switch profiles.

#### How to obtain a JWT

1. Open the [Sesam portal](https://portal.sesam.io) in a browser.
2. Navigate to your subscription → **Settings** → **JWT** (or use the portal's **Connect** token page).
3. Copy the token and paste it into the extension when prompted.

JWTs expire — re-run **Sesam: Set JWT Token** when yours is refreshed.

#### Available commands

| Command | Description |
|---|---|
| `Sesam: Add Profile` | 4-step wizard — name, portal URL (default: `https://portal.sesam.io`), node URL, JWT. Creates or replaces a full profile. |
| `Sesam: Delete Profile` | Remove a profile entirely (JWT from SecretStorage + node URL from workspace state). |
| `Sesam: Set JWT Token` | Quick command to store (or update) just the JWT for a named profile. |
| `Sesam: Delete JWT Token` | Remove only the stored JWT for a profile, keeping the node URL. |
| `Sesam: Switch Profile` | Switch the active profile from a QuickPick list. Same as clicking the status bar item. |
| `Sesam: List Profiles` | Print all configured profiles (name, node URL, portal URL, token status) to the Sesam output channel. |

#### Falling back to settings

If no JWT is stored in SecretStorage for the active profile, the extension falls back to the `sesam.jwt` workspace/user setting. This means existing setups continue to work without any changes — just migrate at your own pace by running **Sesam: Set JWT Token**.

> **Security note:** The `sesam.jwt` setting stores the token in plain text in VS Code settings files. Use **Sesam: Set JWT Token** or **Sesam: Add Profile** to move tokens to SecretStorage.

---

### Copilot Agent Integration

The extension registers two **Language Model Tools** that GitHub Copilot (and any VS Code-hosted AI agent)
can call automatically. This lets you ask Copilot questions about your Sesam configs and have it validate,
fix, and generate DTL pipes with full awareness of Sesam-specific rules.

#### Requirements

- GitHub Copilot extension installed and signed in
- VS Code 1.90 or later
- The Sesam extension active in your workspace

#### `@sesam` Chat Participant Commands

| Command | Description |
|---|---|
| `@sesam /generate <description>` | Generate a new pipe config from a natural-language description |
| `@sesam /explain` | Explain the active DTL transform or pipe config |
| `@sesam /test` | Generate test input and expected output entities for the active pipe |
| `@sesam /fix <errors + file content>` | Fix validation errors and write corrected files to disk automatically |
| `@sesam /cli <question>` | Get guidance on sesam-py CLI commands |
| `@sesam <anything>` | General Q&A about Sesam, DTL, and sesam-py (with full conversation history) |

| Tool | Reference name | What it does |
|---|---|---|
| **Sesam: Lint Document** | `#sesamLintDocument` | Validates a single pipe/system config and returns structured diagnostics |
| **Sesam: Lint Workspace** | `#sesamLintWorkspace` | Scans all Sesam config files in the workspace and returns a per-file issue summary |

#### How to Use

**1. Open Copilot Chat in Agent Mode**

Open the chat panel (`Ctrl+Alt+I`) and switch the mode selector to **Agent**.
Tool calls are only made in agent mode — "Ask" and "Edit" modes do not invoke tools.

**2. Ask naturally — Copilot selects the tool automatically**

> Are there any errors in my pipe configs?

> What's wrong with pipes/person-to-crm.json?

> Fix all DTL errors in my workspace.

**3. Reference a tool explicitly with `#`**

Type `#sesamLint` in the chat input and select from the autocomplete:

```
#sesamLintWorkspace — run a full workspace audit
#sesamLintDocument  — lint the active file or inline content
```

#### Example Prompts

**Audit the whole workspace**

```
Are there any errors across all my Sesam pipe configs?
```

Copilot calls `#sesamLintWorkspace` and replies with a grouped summary:
```
Found issues in 2 files:

pipes/person-to-crm.json — 1 error
  Line 14: Unknown function "concatt" (did you mean "concat"?)

pipes/order-enrich.json — 2 warnings
  Line 8: Too many arguments for "if" (expected 3, got 4)
  Line 22: Unknown variable prefix "_X."
```

**Fix errors automatically**

```
Fix all DTL errors in my workspace. Use the lint tool to find them, then edit the files.
```

Copilot will call `#sesamLintWorkspace` to get the full issues list, propose edits for each file,
and optionally re-lint after editing to confirm the fixes.

**Generate a valid pipe**

```
Generate a pipe that reads from a REST system called "hr-api" and maps the "employeeId"
field to "_T.id". Make sure it has no DTL errors.
```

Copilot generates the pipe JSON, calls `#sesamLintDocument` on the output, then adjusts
if there are any issues — all in one turn.

**Filter by severity**

```
#sesamLintWorkspace Show only errors, not warnings.
```

**Explain errors**

```
What do the DTL errors in pipes/enrichment.json mean and how do I fix them?
```

Copilot lints the file, then explains each diagnostic in plain language with a suggested fix.

#### Seeing the Tool Calls

In agent mode, each tool invocation appears as a collapsible entry in the chat thread:

```
▶ Used tool: Sesam: Lint Workspace
  Input:  { "maxProblems": 100, "minSeverity": 4 }
  Output: { "status": "has-issues", "fileCount": 2, ... }
```

Click the entry to inspect the exact JSON exchanged.

#### Troubleshooting

**`#sesamLintWorkspace` doesn't autocomplete**
The extension may not have activated yet. Open any `*.conf.json` or `*.conf.pipe` file first,
or run `Developer: Restart Extension Host` from the Command Palette.

**Copilot uses `get_errors` instead of the Sesam tools**
Be more explicit: type `#sesamLintWorkspace` directly in the input, or phrase your request as
*"Use the Sesam lint tool to check my workspace"*.

**Tools don't appear after F5**
Make sure you are asking in the **Extension Development Host** window (the one opened by F5),
not your main VS Code window.

See **[docs/copilot-agent.md](docs/copilot-agent.md)** for the complete usage guide.

---

### Supported File Types

| File | How DTL is detected |
|---|---|
| `pipes/*.json`, `systems/*.json` | JSON injection + LSP activated on pipe/system paths |
| `*.conf.json` | JSON injection + LSP activated on all `.conf.json` files (sesam-py downloaded configs) |

### Workspace Layout

The extension works best with a standard Sesam project layout:

```
my-sesam-project/
  pipes/
    person-to-crm.json
    order-enrich.json
  systems/
    crm.json
```

### Commands

| Command | Shortcut | Description |
|---|---|---|
| `DTL: Preview Pipe` | — | Open the preview panel for the active file |
| `Sesam: Run Pipe` | `Ctrl+Shift+R` | Run the active pipe on the connected node |
| `Sesam: Pipe Status` | — | Open the Node Status panel filtered to the active pipe |
| `Sesam: Node Status` | — | Open the Node Status panel showing all pipes |
| `Sesam: System Status` | — | Open the Node Status panel with the Systems tab selected |
| `Sesam: Upload` | `Ctrl+Shift+U` | Validate and upload all local configs to the node |
| `Sesam: Download` | `Ctrl+Shift+D` | Download all configs from the node (overwrites local files) |
| `Sesam: Upload File` | — | Upload only the active config file to the node |
| `Sesam: Download File` | — | Download only the active pipe/system config from the node |
| `Sesam: Revert Config` | — | Overwrite local file with the node version (inline button on Modified sync items) |
| `Sesam: Refresh Pipe DAG` | — | Rescan workspace and refresh Lineage / Dependents / System Pipes sidebars |
| `DTL: Open Documentation` | — | Open the Sesam DTL docs in a browser |
| `DTL: New Sesam Config File` | — | Create a new pipe or system config file from a template |
| `Sesam: Format Document` | — | Format the active Sesam config file |
| `Sesam: Clear Errors` | — | Clear all entries from the Sesam panel |
| `Sesam: Add Profile` | — | Add a named Sesam profile (node URL + JWT) |
| `Sesam: Delete Profile` | — | Remove a profile (JWT + node URL) entirely |
| `Sesam: Set JWT Token` | — | Store or update the JWT for a named profile |
| `Sesam: Delete JWT Token` | — | Remove only the JWT for a profile, keeping the node URL |
| `Sesam: Switch Profile` | — | Switch the active profile (also available via the status bar) |
| `Sesam: List Profiles` | — | Print all configured profiles to the Sesam output channel |
| `@sesam /generate` | — | (Copilot) Generate a new Sesam pipe config |
| `@sesam /explain` | — | (Copilot) Explain the active DTL transform or pipe config |
| `@sesam /test` | — | (Copilot) Generate test input/expected entities for the active pipe |
| `@sesam /fix` | — | (Copilot) Fix validation errors and apply corrected files to disk |
| `@sesam /cli` | — | (Copilot) Get guidance on sesam-py CLI commands |
| `#sesamLintDocument` | — | (Copilot agent) Lint a single Sesam config file |
| `#sesamLintWorkspace` | — | (Copilot agent) Audit all Sesam configs in the workspace |

---

## DTL Primer

DTL rules are JSON arrays of **transforms** (top-level, side-effects) and **expressions** (composable, return a value).

### Built-in Variables

| Variable | Description |
|---|---|
| `_S` | Source entity (input) |
| `_T` | Target entity (output being built) |
| `_P` | Parent entity (inside `apply`) |
| `_R` | Root entity (top-level source) |
| `_B` | HTTP request parameters |
| `_` | Current value (inside `map`, `filter`, etc.) |

### Example Rule Set

```json
[
  ["add", "_T.full_name", 
    ["concat", 
      ["list", "_S.first_name", " ", "_S.last_name"]
    ]
  ], 
  ["add", "_T.is_active", 
    ["eq", "_S.status", "active"]
  ], 
  ["add", "_T.score", 
    ["if", 
      ["gt", "_S.score", 100], 100, "_S.score"]
  ], 
  ["copy", "*"], 
  ["remove", "_T.internal_notes"], 
  ["filter", 
    ["eq", "_S.type", "person"]
  ]
]
```

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `dtl.validate.enabled` | `true` | Enable/disable all diagnostics |
| `dtl.validate.unknownFunctions` | `true` | Report unknown function names |
| `dtl.validate.argCount` | `true` | Report wrong argument counts |
| `dtl.maxNumberOfProblems` | `100` | Cap on diagnostics per file |
| `dtl.format.reorderKeys` | `true` | Reorder root-level config keys to canonical order on save |
| `dtl.trace.server` | `off` | LSP communication trace (`off`/`messages`/`verbose`) |
| `dtl.graph.scanDepth` | `3` | Directory depth to scan for pipe/system files |
| `sesam.nodeUrl` | `""` | Base URL of your Sesam node — used as a fallback when no profile nodeUrl is configured |
| `sesam.jwt` | `""` | JWT token stored in plain text in settings. Superseded by SecretStorage — use **Sesam: Set JWT Token** instead. |

---

## Requirements

- VS Code **1.90** or later.
- No external tools required — the LSP server and evaluator run entirely inside VS Code.

---

## Known Limitations

- The preview evaluator does not support `hops`/`apply-hops` (requires a live Sesam node).
- Datetime arithmetic functions return `null` in preview mode.
- The formatter uses standard JSON pretty-printing; Sesam-specific comment syntax in `.json` configs is preserved but not formatted.

---

## Development

For information on setting up the development environment, running tests, and contributing, see the [Development Guide](docs/development.md).

---

## Roadmap

The extension is being expanded in 5 phases. See [`agent/impl/README.md`](agent/impl/README.md) for the implementation tracker, [`agent/sesam-extension-plan.prompt.md`](agent/sesam-extension-plan.prompt.md) for the full product plan, or [`agent/plans/release-plan.prompt.md`](agent/plans/release-plan.prompt.md) for the versioned changelog and release roadmap.

| Phase | Focus | Key deliverables |
|---|---|---|
| **1 - MVP** | Zero-install daily command loop | Bundle sesam-py as a TypeScript/Node.js npm package, Command Palette integration, config file IntelliSense, secure credential storage |
| **2** | Testing & diff visibility | VS Code Testing API for `.test.json`, git-style local-vs-node diff view |
| **3** | Node connectivity | Node-connected live preview (unlocks `hops`/`apply-hops`), inline pipe diagnostics |
| **4** | AI & visual polish | `@sesam` Copilot agent, interactive pipe graph, connector dev tools |
| **5** | Management Studio in VS Code | Pipe preview/debug, save individual pipes/systems to node, run pipes from editor |

## License

MIT - see [LICENSE](LICENSE) for details.

---
