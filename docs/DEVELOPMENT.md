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
- [Yarn](https://classic.yarnpkg.com/) v1.x (`npm install -g yarn`)
- [VS Code](https://code.visualstudio.com/) v1.90+
- [@vscode/vsce](https://github.com/microsoft/vscode-vsce) (included as a dev dependency)

---

## Setup

```bash
git clone https://github.com/bouvet/dtl-extension.git
cd dtl-extension
yarn install
```

---

## Project Structure

```
client/src/         # VS Code extension host (UI, commands, webviews)
server/src/         # Language Server Protocol (LSP) implementation
src/shared/         # Utilities shared by both client and server
syntaxes/           # TextMate grammar for syntax highlighting
snippets/           # Code snippet definitions
docs/               # Developer documentation
```

---

## Development Workflow

### 1. Build (one-off)

```bash
yarn build        # production build
yarn build:dev    # development build (unminified, with source maps)
```

Outputs go to `dist/client/extension.js` and `dist/server/server.js`.

### 2. Watch mode

```bash
yarn watch
```

Starts Vite in watch mode for both the client and server bundles. Rebuilds automatically on every file save.

### 3. Type-check only (no emit)

```bash
yarn compile
```

Runs `tsc --noEmit` over both the client and server `tsconfig.json` files. Useful for catching type errors without a full build.

---

## Testing Locally in VS Code

1. Open the repo root in VS Code.
2. Run a build (or start watch mode):
   ```bash
   yarn build:dev
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
yarn package
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
- [ ] Run `yarn compile` to confirm no type errors
- [ ] Run a clean `yarn build` and smoke-test with F5

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
