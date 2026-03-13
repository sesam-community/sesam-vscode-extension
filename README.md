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
- [Getting Started](#getting-started)
- [DTL Primer](#dtl-primer)
- [Extension Settings](#extension-settings)
- [Requirements](#requirements)
- [Known Limitations](#known-limitations)
- [Development](#development)
- [License](#license)

---

Full-featured VS Code extension for **Sesam Data Transformation Language (DTL)** — the declarative JSON-array language used to define pipe transformations in the [Sesam](https://sesam.io) integration platform.

---

## Features

### Syntax Highlighting
- Dedicated `.dtl` language with TextMate grammar.
- Transform keywords (`add`, `copy`, `filter`, `hops`, …) highlighted as control-flow.
- All ~160 built-in functions highlighted by category (string, math, datetime, NI, …).
- Built-in variables `_S`, `_T`, `_P`, `_R`, `_B`, `_` highlighted with property-path continuation.
- Reserved entity fields (`_id`, `_deleted`, `_filtered`, …) distinguished from regular keys.
- **JSON injection**: DTL variables and function names are also highlighted inside regular `.json` pipe config files — no separate file needed.

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
- Format `.dtl` files with **Shift+Alt+F** — pretty-prints the full DTL array with consistent indentation.
- Format `.json` pipe configs — reformats only the `"rules"` block, leaving the rest of the config untouched.

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

### Pipe Preview
A live preview panel that evaluates DTL transforms against a sample input entity — without needing a running Sesam node.

1. Open any `.dtl` file or pipe config `.json`.
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
| `*.dtl` | Dedicated DTL language mode |
| `pipes/*.json`, `systems/*.json` | JSON injection + LSP activated on pipe/system paths |

### Workspace Layout

The extension works best with a standard Sesam project layout:

```
my-sesam-project/
  pipes/
    person-to-crm.json
    order-enrich.json
  systems/
    crm.json
  *.dtl          ← standalone DTL files
```

### Commands

| Command | Description |
|---|---|
| `DTL: Preview Pipe` | Open the preview panel for the active file |
| `DTL: Refresh Graph` | Rescan workspace and refresh the Pipe Graph sidebar |
| `DTL: Open Documentation` | Open the Sesam DTL docs in a browser |

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


## License

MIT — see [LICENSE](LICENSE) for details.

---
