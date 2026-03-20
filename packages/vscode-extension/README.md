# Sesam

## Table of Contents

- [Features](#features)
  - [Syntax Highlighting](#syntax-highlighting)
  - [Auto-Completion](#auto-completion)
  - [Hover Documentation](#hover-documentation)
  - [Diagnostics (Linting)](#diagnostics-linting)
  - [Formatter](#formatter)
  - [Code Snippets](#code-snippets)
  - [Pipe Graph Explorer](#pipe-graph-explorer)
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
- All ~160 built-in functions highlighted by category (string, math, datetime, NI, …).
- Built-in variables `_S`, `_T`, `_P`, `_R`, `_B`, `_` highlighted with property-path continuation.
- Reserved entity fields (`_id`, `_deleted`, `_filtered`, …) distinguished from regular keys.
- **JSON injection**: DTL variables and function names are highlighted inside `.json` pipe config files.

### Auto-Completion
- Function name completions triggered after `["` inside any array context.
- Variable completions (`_S`, `_T`, `_P`, `_R`, `_B`, `_`) triggered after `_`.
- Reserved entity field completions for `_id`, `_deleted`, etc.

### Hover Documentation
- Hover over any function name, variable, or reserved field to see its **signature**, description, parameter list, and a link to the official Sesam docs.

### Diagnostics (Linting)
- **Unknown function** — error when a function name is not in the DTL registry.
- **Too few / too many arguments** — warnings with the expected argument count.
- **Transform used as expression** — warning when a top-level-only transform (e.g. `add`) is nested inside another expression.
- **Unknown variable** — warning for `_X.` prefixes where X is not a known built-in variable.

### Formatter
- Format `.json` pipe configs with **Shift+Alt+F** — reformats only the `"rules"` block, leaving the rest of the config untouched.

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

### Pipe Graph Explorer
A sidebar panel (**DTL Graph**) that scans your workspace for pipe and system config files and shows a navigable tree:

- Each pipe/system listed with its `_id`.
- Click to open the file.
- Hop dataset references shown as children — **✓ resolved** (file found) or **⚠ unresolved** (not found in workspace).
- Named rules listed under each pipe.
- **Refresh** button to rescan after adding files.

### New Sesam Config File
Create a new `*.conf.json` pipe or system config from a template — no copy-pasting boilerplate.

**3 ways to invoke:** Explorer right-click → **DTL: New Sesam Config File** | Command Palette (`Ctrl+Shift+P`) → `DTL: New Sesam Config File` | assign a custom keybinding to `dtl.newConfFile`.

**Wizard steps:**

1. **Pick a template:**

   | Template | Generated file |
   |---|---|
   | Simple pipe | `{ "_id": "…", "type": "pipe" }` |
   | Pipe with DTL transform | Pipe + `transform.rules.default` block with a starter `copy` rule |
   | System | `{ "_id": "…", "type": "system:<type>" }` — then choose the system type |

2. **Choose system type** *(System only)* — pick from all supported types: `elasticsearch`, `kafka`, `ldap`, `microservice`, `mssql`, `mysql`, `oracle`, `postgresql`, `rest`, `smtp`, `solr`, `twilio`, `url`.

3. **Enter `_id`** — used as both the config `_id` and the filename (`<id>.conf.json`). Validated: non-empty, no `/`.

The file is written to the folder you right-clicked (or the active editor's folder, or workspace root) and opened immediately. Run **Format Document** (`Shift+Alt+F`) after creation to apply the Sesam formatter.

---

### Pipe Preview
A live preview panel that evaluates DTL transforms against a sample input entity — without needing a running Sesam node.

1. Open a pipe config `.json` file.
2. Run **DTL: Preview Pipe** from the Command Palette (`Ctrl+Shift+P`).
3. Edit the **Input Entity** (left pane) and press **▶ Evaluate** (or `Ctrl+Enter`).
4. The **Output Entity** (right pane) updates instantly.
5. The **DTL Rules** pane (centre) always reflects the active document.

> **Note:** Functions that require a live Sesam node (e.g. `hops`, `apply-hops`, `lookup-entity`, encryption, UUID) will show a warning and return `null` rather than throwing.

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
| `DTL: Refresh Graph` | Rescan workspace and refresh the Pipe Graph sidebar |
| `DTL: Open Documentation` | Open the Sesam DTL docs in a browser |
| `DTL: New Sesam Config File` | Create a new pipe or system `.conf.json` from a template |

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
| `dtl.validate.argumentCount` | `true` | Report wrong argument counts |
| `dtl.validate.transformAsExpression` | `true` | Warn when a transform is used nested |
| `dtl.maxNumberOfProblems` | `100` | Cap on diagnostics per file |
| `dtl.trace.server` | `off` | LSP communication trace (`off`/`messages`/`verbose`) |
| `dtl.graph.scanDepth` | `5` | Directory depth to scan for pipe/system files |
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
