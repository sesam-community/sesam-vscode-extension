# Development Guide

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing Locally in VS Code](#testing-locally-in-vs-code)
- [Packaging](#packaging)
  - [Install the .vsix manually](#install-the-vsix-manually)
- [Publishing to the VS Code Marketplace](#publishing-to-the-vs-code-marketplace)
  - [One-time setup](#one-time-setup)
  - [Publish](#publish)
  - [Pre-publish checklist](#pre-publish-checklist)
- [Installing from the Marketplace](#installing-from-the-marketplace)

---

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+ (`npm install -g pnpm`)
- [VS Code](https://code.visualstudio.com/) v1.90+
- [@vscode/vsce](https://github.com/microsoft/vscode-vsce) (included as a dev dependency)

---

## Setup

```bash
git clone https://github.com/bouvet/dtl-extension.git
cd dtl-extension
pnpm install
```

---

## Project Structure

```
.
├── package.json                        # Extension manifest: activation events, contributes, scripts, dependencies
├── tsconfig.json                       # Root TypeScript config (references client & server sub-projects)
├── vite.config.client.ts               # Vite build config for the client bundle (outputs dist/client/extension.js)
├── vite.config.server.ts               # Vite build config for the server bundle (outputs dist/server/server.js)
├── vitest.config.ts                    # Vitest config for the test suite
├── language-configuration.json         # VS Code language config: bracket pairs, comment tokens, auto-closing rules for .dtl files
│
├── client/
│   ├── tsconfig.json                   # TypeScript config for the extension host (targets VS Code API, no emit — Vite handles bundling)
│   └── src/
│       ├── extension.ts                # Extension entry point: activates the LSP client, registers sidebar tree views and preview command
│       ├── graph/
│       │   ├── pipe-dag-builder.ts     # Pure functions: workspace scan, FullPipeInfo/DagIndex data types, buildDagIndex, buildSystemIndex
│       │   ├── dag-tree-item.ts        # Shared DagTreeItem class and makeItem factory used by Lineage and Dependents views
│       │   ├── PipeLineageProvider.ts  # TreeDataProvider: upstream ancestry of the active pipe (Pipe Lineage sidebar)
│       │   ├── PipeDependentsProvider.ts # TreeDataProvider: downstream consumers of the active pipe (Pipe Dependents sidebar)
│       │   └── SystemPipesProvider.ts  # TreeDataProvider: dual-mode source/sink pipes ↔ systems view (System Pipes sidebar)
│       └── preview/
│           └── PreviewPanel.ts         # WebviewPanel that renders a three-pane DTL live preview (editable input entity → transform rules → computed output entity), calling dtl-evaluator directly inside the extension host
│
├── server/
│   ├── tsconfig.json                   # TypeScript config for the language server (targets Node 20, no emit — Vite handles bundling)
│   └── src/
│       ├── server.ts                   # LSP server entry point: wires up completions, hover documentation, diagnostics, formatting, and cross-file navigation handlers
│       ├── dtl-parser.ts               # Lightweight positional parser: tokenises document text and produces a list of DtlCall nodes (function name + argument count + source ranges) without relying on JSON.parse, so source positions are preserved
│       ├── dtl-validator.ts            # Diagnostic producer: consumes DtlCall nodes from the parser and emits LSP Diagnostic objects for unknown functions, wrong argument counts, transforms used as expressions, and unknown variable prefixes
│       └── utils/
│           ├── workspace-index.ts      # Workspace-wide index of all pipe/system configs — file URIs, _id values, dataset outputs; rebuilt on file change
│           ├── definition.utils.ts     # Go to Definition for rule names (intra-file) and dataset IDs (cross-file)
│           ├── document-links.utils.ts # Document link provider: turns dataset IDs into clickable Ctrl+Click links
│           ├── reference-detection.utils.ts # Detects dataset ID references in source.dataset and hops.datasets
│           └── cross-references.utils.ts    # Find All References: locates all pipes that reference a given dataset ID
│
├── src/
│   └── shared/
│       ├── dtl-registry.ts             # Single source of truth for all ~160 DTL built-in functions, variables, and reserved entity fields; imported by both the server (hover/completions/validation) and the client (preview evaluator)
│       └── dtl-evaluator.ts            # Client-side mini-interpreter: evaluates a supported subset of DTL transform rules against an input entity and returns the resulting output entity (used by PreviewPanel; hops and encryption are flagged as unsupported)
│
├── syntaxes/
│   ├── dtl.tmLanguage.json             # TextMate grammar for standalone .dtl files: highlights transform keywords, all built-in function names by category, variables (_S, _T, …), and reserved entity fields
│   └── dtl-injection.tmLanguage.json   # TextMate injection grammar: applies the same DTL highlighting inside regular .json pipe config files without requiring a separate file type
│
├── snippets/
│   └── dtl.code-snippets.json          # VS Code snippet definitions for common DTL patterns (pipe skeleton, add/copy/filter transforms, hops template, etc.)
│
├── tests/
│   ├── evaluator.test.ts               # Unit tests for dtl-evaluator
│   ├── formatter.test.ts               # Unit tests for config-formatter
│   ├── parser.test.ts                  # Unit tests for dtl-parser
│   ├── registry.test.ts                # Unit tests for dtl-registry
│   ├── validator.test.ts               # Unit tests for dtl-validator
│   ├── server.utils.test.ts            # Unit tests for server utility helpers
│   ├── definition.utils.test.ts        # Unit tests for definition / Go to Definition utils
│   ├── document-links.test.ts          # Unit tests for document link provider
│   ├── reference-detection.test.ts     # Unit tests for dataset reference detection
│   ├── cross-references.test.ts        # Unit tests for Find All References utils
│   └── pipe-dag-builder.test.ts        # Unit tests for DAG builder (lineage, dependents, system index)
│
└── docs/
    └── development.md                  # This file — developer setup, workflow, testing, packaging, and publishing guide
```

---

## Development Workflow

### 1. Build (one-off)

```bash
pnpm build        # production build
pnpm build:dev    # development build (unminified, with source maps)
```

Outputs go to `dist/client/extension.js` and `dist/server/server.js`.

### 2. Watch mode

```bash
pnpm run watch
```

Starts Vite in watch mode for both the client and server bundles. Rebuilds automatically on every file save.

### 3. Type-check only (no emit)

```bash
pnpm run compile
```

Runs `tsc --noEmit` over both the client and server `tsconfig.json` files. Useful for catching type errors without a full build.

---

## Testing Locally in VS Code

1. Open the repo root in VS Code.
2. Run a build (or start watch mode):
   ```bash
   pnpm build:dev
   ```
3. Press **F5** (or go to **Run > Start Debugging**).  
   This launches the **Extension Development Host** — a second VS Code window with the extension loaded from the local `dist/` folder.
4. In the Extension Development Host window:
   - Open any `.dtl` file or a Sesam pipe `.json` config to activate the extension.
   - Test syntax highlighting, completions, hover, diagnostics, formatting, the Pipe Graph sidebar, and the **DTL: Preview Pipe Output** command.
5. After changing source files, if you're in watch mode the bundles rebuild automatically. Press **Ctrl+Shift+F5** (Restart Debugging) in the host window to reload.

> **Tip:** The `.vscode/launch.json` in this repo already contains the correct launch configuration. If it's missing, create one:
> ```json
> {
>   "version": "0.2.0",
>   "configurations": [
>     {
>       "name": "Launch Extension",
>       "type": "extensionHost",
>       "request": "launch",
>       "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
>     }
>   ]
> }
> ```

---

## Packaging

To create an installable `.vsix` file locally:

```bash
pnpm run package
```

This runs `vsce package`, which first triggers the `vscode:prepublish` script (`yarn build`) and then produces a `.vsix` archive in the project root (e.g. `dtl-language-support-0.1.0.vsix`).

### Install the `.vsix` manually

```bash
code --install-extension dtl-language-support-0.1.0.vsix
```

Or via the VS Code UI: **Extensions > ⋯ > Install from VSIX…**

---

## Publishing to the VS Code Marketplace

### One-time setup

1. Create a [Visual Studio Marketplace publisher account](https://marketplace.visualstudio.com/manage).
2. Generate a **Personal Access Token (PAT)** in Azure DevOps:
   - Organization: `All accessible organizations`
   - Scope: **Marketplace > Manage**
3. Log in with `vsce`:
   ```bash
   npx vsce login bouvet
   # Paste your PAT when prompted
   ```

### Publish

```bash
npx vsce publish
```

This builds the extension (via `vscode:prepublish`) and uploads it directly to the marketplace under the `bouvet` publisher.

To publish a specific version bump:

```bash
npx vsce publish minor   # bumps minor version (e.g. 0.1.0 → 0.2.0)
npx vsce publish patch   # bumps patch version (e.g. 0.1.0 → 0.1.1)
npx vsce publish major   # bumps major version (e.g. 0.1.0 → 1.0.0)
```

### Pre-publish checklist

- [ ] Update `version` in `package.json`
- [ ] Update `CHANGELOG.md` (if present)
- [ ] Confirm `README.md` renders correctly (it becomes the marketplace page)
- [ ] Run `pnpm run compile` to confirm no type errors
- [ ] Run a clean `pnpm build` and smoke-test with F5

---

## Installing from the Marketplace

Once published, users can install the extension from inside VS Code:

1. Open the **Extensions** panel (`Ctrl+Shift+X`)
2. Search for **"DTL Language Support"** (publisher: `bouvet`)
3. Click **Install**

Or via the command line:

```bash
code --install-extension bouvet.dtl-language-support
```
