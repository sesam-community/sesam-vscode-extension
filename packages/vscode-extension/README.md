# Sesam

## Table of Contents

- [Features](#features)
  - [Syntax Highlighting](#syntax-highlighting)
  - [Auto-Completion](#auto-completion)
  - [Hover Documentation](#hover-documentation)
  - [Diagnostics (Linting)](#diagnostics-linting)
  - [Formatter](#formatter)
  - [Code Snippets](#code-snippets)
  - [Go to Rule Definition](#go-to-rule-definition)
  - [Cross-file Navigation](#cross-file-navigation)
  - [Pipe Lineage](#pipe-lineage)
  - [Pipe Dependents](#pipe-dependents)
  - [System Pipes](#system-pipes)
  - [Pipe Preview](#pipe-preview)
  - [New Sesam Config File](#new-sesam-config-file)
- [Getting Started](#getting-started)
- [DTL Primer](#dtl-primer)
- [Extension Settings](#extension-settings)
- [Requirements](#requirements)
- [Known Limitations](#known-limitations)
- [Development](#development)
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

- Function name completions triggered after `["` inside any array context.
- Variable completions (`_S`, `_T`, `_P`, `_R`, `_B`, `_`) triggered after `_`.
- Reserved entity field completions for `_id`, `_deleted`, etc.
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

| Diagnostic | Severity |
|---|---|
| Unknown function name | Error |
| Too few / too many arguments | Warning |
| Transform used as an expression | Warning |
| Unknown variable prefix (`_X.`) | Warning |

---

### Formatter

Format any Sesam config file with **Shift+Alt+F** (or **Format Document**). The formatter:

- Preserves insertion key order — keys are never re-sorted.
- Renders DTL rule arrays compactly (one rule per line) so diff output stays readable.
- Pretty-prints top-level config objects with standard indentation.
- Works on `.conf.json` files and triggers automatically on save.

---

### Code Snippets

30+ snippets covering all common patterns. Type the prefix and press Tab:

| Prefix | Inserts |
|---|---|
| `add` | `["add", "_T.field", value]` |
| `add-if` | Add with condition |
| `copy` | `["copy", "*"]` |
| `remove` | Remove a property |
| `rename` | Rename a property |
| `filter` | Filter transform |
| `discard` | Discard entity |
| `if` | If expression |
| `case` | Case expression |
| `hops` | Full hops object with datasets/where |
| `apply-hops` | Apply-hops transform |
| `map` | Map over a list |
| `concat` | Concat strings |
| `make-ni` | Make a namespaced identifier |
| `dtl-pipe` | Full pipe config template |
| `dtl-rules` | Transform rules block |
| … | And many more |

---

### Go to Rule Definition

Navigate between `apply`/`apply-hops` call sites and their rule definitions without leaving the editor.

| Action | How to invoke |
|---|---|
| **Go to Definition** | `F12` or `Ctrl+Click` on the rule name in `["apply", "<rule>", …]` |
| **Peek Definition** | `Alt+F12` on the rule name |
| **Find All References** | Right-click a rule definition key → **Find All References** |
| **Peek References** | `Shift+Alt+F12` on the rule definition key |

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

### Pipe Preview

A live preview panel that evaluates DTL transforms against a sample input entity — without needing a running Sesam node.

1. Open a pipe config file.
2. Run **DTL: Preview Pipe** from the Command Palette (`Ctrl+Shift+P`).
3. Edit the **Input Entity** and press **▶ Evaluate** (or `Ctrl+Enter`).
4. The **Output Entity** updates instantly.

> Functions that require a live Sesam node (e.g. `hops`, `apply-hops`, `lookup-entity`, encryption, UUID) return `null` with a warning rather than throwing.

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

## Getting Started

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

| Command | Description |
|---|---|
| `DTL: Preview Pipe` | Open the preview panel for the active file |
| `Sesam: Refresh Pipe DAG` | Rescan workspace and refresh Lineage / Dependents / System Pipes sidebars |
| `DTL: Open Documentation` | Open the Sesam DTL docs in a browser |
| `DTL: New Sesam Config File` | Create a new pipe or system config file from a template |
| `Sesam: Format Document` | Format the active Sesam config file |

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
  ["add", "_T.full_name", ["concat", ["list", "_S.first_name", " ", "_S.last_name"]]],
  ["add", "_T.is_active", ["eq", "_S.status", "active"]],
  ["add", "_T.score",     ["if", ["gt", "_S.score", 100], 100, "_S.score"]],
  ["copy", "*"],
  ["remove", "_T.internal_notes"],
  ["filter", ["eq", "_S.type", "person"]]
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
| `dtl.trace.server` | `off` | LSP communication trace (`off`/`messages`/`verbose`) |
| `dtl.graph.scanDepth` | `3` | Directory depth to scan for pipe/system files |
| `sesam.nodeUrl` | `""` | Base URL of your Sesam node (e.g. `https://abc123.sesam.cloud`) — enables node-backed validation on `.conf.json` save |
| `sesam.jwt` | `""` | JWT token for the Sesam node API. Set in **user** settings only — do not commit to `.vscode/settings.json` |

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

For information on setting up the development environment, running tests, and contributing, see the [Development Guide](docs/DEVELOPMENT.md).

---

## Installation

This extension is for **internal use only** and is not published to the Visual Studio Marketplace.

Download the latest `.vsix` from the GitHub Releases page of the `sesam-ts` monorepo, then install:

```bash
code --install-extension sesam-x.y.z.vsix
```

Or use the convenience script in the monorepo:

```bash
bash scripts/install-extension.sh
```

See [`agent/impl/impl-distribution.prompt.md`](agent/impl/impl-distribution.prompt.md) for the full distribution plan.

---

## Roadmap

The extension is being expanded in 5 phases. See [`agent/impl/README.md`](agent/impl/README.md) for the implementation tracker, or [`agent/sesam-extension-plan.prompt.md`](agent/sesam-extension-plan.prompt.md) for the full product plan.

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
