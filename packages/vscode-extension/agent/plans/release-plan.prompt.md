# Changelog

All notable changes to the **DTL Language Support** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Distribution**: VSIX artifacts are attached to [GitHub Releases](https://github.com/datanav/sesam-ts/releases)
> in the private `sesam-ts` monorepo. Install via `code --install-extension sesam-x.y.z.vsix`.

---

## [Unreleased]

### Added

- **F02**: Config File Intelligence — schema-aware validation and completions for all top-level
  config properties across pipe, system, and global configs
- **F24**: Live Updates via Socket.IO — `NodeStatusPanel` connects to the Sesam node over
  Socket.IO (`socket.io-client`) for real-time `pipes_updated` / `pipes_added` / `pipes_deleted`
  push events; replaces 30 s polling; falls back to poll on connection failure; live/polling/offline
  badge in the Node Status WebView
- **F25**: Credential Safety — node hostname shown in the status bar (Option A); `.sesamprofile`
  lockfile read on workspace open to validate the active profile targets the expected node URL
  (Option C); destructive commands (upload, wipe, sync) blocked with a confirmation modal when
  a mismatch is detected (Option B)

---

## [0.4.0] — Planned: Phase 4 — AI & Visual Polish

This release is about understanding your pipes at a glance and accelerating connector work.
The interactive pipe graph lets you explore the full data-flow canvas without leaving the editor,
while the connector dev tools close the feedback loop when building custom microservice sources.

### Added

- **F07/F15**: Interactive Pipe Graph — canvas-based webview showing the full pipe DAG with
  clickable nodes, zoom/pan, and inline entity preview
- **F08**: Connector Development Tools — scaffolding, schema helpers, and live feedback for
  building Sesam microservice connectors

---

## [0.3.0] — Planned: Phase 3 Completion — Node Diagnostics

With the node already connected since v0.1.0, this release surfaces what the node actually sees.
Entity output and runtime errors appear as inline editor decorations so you never have to
cross-reference the Management Studio logs manually again.

### Added

- **F10**: Inline Output & Diagnostics from Node — live entity output and node-reported errors
  rendered as inline decorations and VS Code diagnostics while connected to a Sesam node

---

## [0.2.0] — Planned: Phase 2 — Testing & Diff Loop

This release closes the edit–verify loop. You can run your Sesam pipe tests from the VS Code
Test Explorer and immediately see which assertions fail, then diff your local configs against
what is live on the node before deciding what to push.

### Added

- **F05**: Test Management — first-class test runner integration via the VS Code Testing API;
  run, debug, and view results for Sesam pipe tests without leaving the editor
- **F06**: Status / Diff View — side-by-side diff between local configs and what is deployed
  on the connected Sesam node, with one-click upload/revert per config

---

## [0.1.0] — 2026-04-22

The foundation release. The goal was simple: open VS Code, open a pipe, and never touch a
terminal again. All sesam-py operations are available from the Command Palette, credentials
are kept secure in the OS keyring, and the editor understands DTL deeply enough to catch
mistakes as you type. As a bonus, node-connected live preview, the `@sesam` Copilot agent,
and the full pipe graph sidebar shipped ahead of schedule alongside the core MVP.

### Added

- **F00**: Bundled `@sesam/core` TypeScript rewrite of `sesam-py` as an npm package inside the
  monorepo — no Python runtime required at install time
- **F01**: sesam-py Command Integration — run `upload`, `download`, `sync`, `test`, and other
  sesam commands directly from the Command Palette and editor toolbar
- **F03**: Secure Credential Management — store and retrieve Sesam node credentials using the
  VS Code `SecretStorage` API; subscription switcher in the status bar
- **F04**: Node-Connected Live Preview — real-time entity preview panel driven by the connected
  Sesam node, updating as the pipe editor changes
- **F09**: Copilot Agent Participant (`@sesam`) — custom Language Model Tools API participant
  that understands Sesam configs, DTL, and pipe topology
- **F12**: Sesam Config File Extensions & Formatter — language ID `sesam-config` assigned to
  `*.conf.pipe`, `*.conf.system`, and `*.conf.json`; auto-format on save preserves key order
  and produces compact DTL arrays
- **F13**: Go to Rule Definition + Find All References + Rename Rule — full LSP navigation for
  DTL rule names within and across config files
- **F14**: Cross-file Dataset Navigation — go-to-definition and find-references for dataset
  names produced and consumed across pipes
- **F16**: Pipe DAG Tree Views (Lineage & Dependents) — sidebar tree panels showing upstream
  lineage and downstream dependents for any pipe
- **F17**: System Pipes View — sidebar tree grouping all pipes by their source system
- **F18**: Dataset Alias Support — highlight, hover documentation, and rename refactoring for
  dataset aliases defined in global config
- **F19**: DTL Syntax Linting — real-time diagnostics for invalid DTL expressions, unknown
  functions, and structural errors in pipe configs
- **F20**: Extension Language Model Tools API — exposes Sesam graph data to Copilot via the
  VS Code LM Tools API
- **F21**: Config Property Completions — IntelliSense completions for source types, system
  types, DTL built-in variables, and DTL functions; trigger characters `"`, `[`, `_`, `.`, `:`
- **F22**: Sesam Panel (Errors / Warnings View) — dedicated Problems panel view aggregating
  all Sesam-specific diagnostics across the workspace
- **F23**: Centralized Network Status Bar — status bar item showing live connection state to
  the configured Sesam node
- **F24**: Live Updates via Socket.IO — real-time push events from the Sesam node via
  Socket.IO; replaces 30 s polling; live/polling/offline badge in the Node Status WebView
- **F25**: Credential Safety — node hostname displayed in the status bar; `.sesamprofile`
  lockfile validated on workspace open to confirm the active profile targets the correct node;
  destructive commands show a confirmation modal on profile/node mismatch

---

## Release Roadmap Summary

| Version | Phase | Key theme | Planned features |
|---|---|---|---|
| 0.1.0 | Phase 1 + 3 + 4 | Initial release | F00–F04, F09, F12–F25 |
| 0.2.0 | Phase 2 | Testing & Diff | F05, F06 |
| 0.3.0 | Phase 3 | Node Diagnostics | F10 |
| 0.4.0 | Phase 4 | Visual & AI Polish | F07/F15, F08 |
| 1.0.0 | Phase 5 | Management Studio | F02 (completed) + F11 |

> **Phase 5 (v1.0.0)**: Management Studio Functionalities (F11) — full in-editor replacement
> for the Sesam Management Studio web UI, including subscription management, secret management,
> and execution monitoring.

[unreleased]: https://github.com/datanav/sesam-ts/compare/v0.1.0...HEAD
[0.4.0]: https://github.com/datanav/sesam-ts/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/datanav/sesam-ts/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/datanav/sesam-ts/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/datanav/sesam-ts/releases/tag/v0.1.0
