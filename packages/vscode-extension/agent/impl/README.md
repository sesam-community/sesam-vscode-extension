# Implementation Plan: Sesam VS Code Extension

> High-level tracking document. Each feature links to its detailed sub-plan in this folder.
> See [`agent/sesam-extension-plan.prompt.md`](../sesam-extension-plan.prompt.md) for the product-level plan.

## Status Legend

| Badge | Meaning |
|---|---|
| `planned` | Scoped, not started |
| `under review` | Design/approach being discussed |
| `in progress` | Actively being implemented |
| `phase N implemented` | First N phases done, more phases remain |
| `implemented` | All phases complete |

---

## Feature Tracking Table

| # | Feature | Rollout Phase | Status | Sub-plan |
|---|---|---|---|---|
| F00 | Bundle sesam-py (TS rewrite + npm bundle) | Phase 1 | `planned` | [impl-f00-bundle-sesam-py.prompt.md](impl-f00-bundle-sesam-py.prompt.md) |
| F01 | sesam-py Command Integration | Phase 1 | `planned` | [impl-f01-sesam-commands.prompt.md](impl-f01-sesam-commands.prompt.md) |
| F02 | Config File Intelligence | Phase 1 | `planned` | [impl-f02-config-file-intelligence.prompt.md](impl-f02-config-file-intelligence.prompt.md) |
| F03 | Secure Credential Management | Phase 1 | `planned` | [impl-f03-credential-management.prompt.md](impl-f03-credential-management.prompt.md) |
| F12 | Sesam Config File Extensions & Formatter | Phase 1 | `implemented` | [impl-f12-conf-json-formatter.prompt.md](impl-f12-conf-json-formatter.prompt.md) |
| F13 | Go to Rule Definition | — | `implemented` | [go-to-rule-definition.prompt.md](../plans/go-to-rule-definition.prompt.md) |
| F14 | Cross-file Dataset Navigation | — | `implemented` | [cross-file-navigation.prompt.md](../plans/cross-file-navigation.prompt.md) |
| F15 | Interactive Pipe Graph (canvas / webview) | Phase 4 | `planned` | [interactive-pipe-graph.prompt.md](../plans/interactive-pipe-graph.prompt.md) |
| F16 | Pipe DAG Tree Views (Lineage + Dependents) | — | `implemented` | [pipe-dag-tree.prompt.md](../plans/pipe-dag-tree.prompt.md) |
| F17 | System Pipes View | — | `implemented` | [system-pipes-view.prompt.md](../plans/system-pipes-view.prompt.md) |
| F18 | Dataset Alias Support (highlight + hover + rename) | — | `done` | [dataset-alias-support.prompt.md](../plans/dataset-alias-support.prompt.md) |
| F05 | Test Management (Testing API) | Phase 2 | `planned` | [impl-f05-test-management.prompt.md](impl-f05-test-management.prompt.md) |
| F06 | Status / Diff View | Phase 2 | `planned` | [impl-f06-status-diff-view.prompt.md](impl-f06-status-diff-view.prompt.md) |
| F04 | Node-Connected Live Preview | Phase 3 | `planned` | [impl-f04-node-preview.prompt.md](impl-f04-node-preview.prompt.md) |
| F10 | Inline Output & Diagnostics from Node | Phase 3 | `planned` | [impl-f10-inline-diagnostics.prompt.md](impl-f10-inline-diagnostics.prompt.md) |
| F09 | Copilot Agent Participant (@sesam) | Phase 4 | `planned` | [impl-f09-copilot-agent.prompt.md](impl-f09-copilot-agent.prompt.md) |
| F07 | Interactive Pipe Graph (canvas) | Phase 4 | `planned` (tracked as F15) | [impl-f07-pipe-graph.prompt.md](impl-f07-pipe-graph.prompt.md) |
| F08 | Connector Development Tools | Phase 4 | `planned` | [impl-f08-connector-tools.prompt.md](impl-f08-connector-tools.prompt.md) |
| F11 | Management Studio Functionalities | Phase 5 | `planned` | [impl-f11-management-studio.prompt.md](impl-f11-management-studio.prompt.md) |

---

## Infrastructure Decisions

| Decision | Summary | Detail |
|---|---|---|
| Monorepo structure | `@sesam/core`, `@sesam/cli`, and vscode-extension in a single pnpm monorepo (`sesam-ts`) | [impl-f00-monorepo-structure.prompt.md](impl-f00-monorepo-structure.prompt.md) |
| Extension distribution | VSIX published to GitHub Releases (private repo) — no Microsoft Marketplace | [impl-distribution.prompt.md](impl-distribution.prompt.md) |

### Phase 1: MVP - The Daily Command Loop
> Goal: zero-install experience; eliminate terminal context-switch.

| Feature | Status |
|---|---|
| F00: Bundle sesam-py | `planned` |
| F01: sesam-py Command Integration | `planned` |
| F02: Config File Intelligence | `planned` |
| F03: Secure Credential Management | `planned` |
| F12: conf.json Support & Full-File Sesam Formatter | `implemented` |
| F13: Go to Rule Definition | `implemented` |
| F14: Cross-file Dataset Navigation | `implemented` |
| F16: Pipe DAG Tree Views | `implemented` |
| F17: System Pipes View | `implemented` |

### Phase 2: Testing & Diff Loop

| Feature | Status |
|---|---|
| F05: Test Management | `planned` |
| F06: Status / Diff View | `planned` |

### Phase 3: Node Connectivity

| Feature | Status |
|---|---|
| F04: Node-Connected Live Preview | `planned` |
| F10: Inline Output & Diagnostics | `planned` |

### Phase 4: AI & Visual Polish

| Feature | Status |
|---|---|
| F09: Copilot Agent Participant | `planned` |
| F07/F15: Interactive Pipe Graph (canvas) | `planned` |
| F08: Connector Development Tools | `planned` |

### Phase 5: Management Studio Functionalities (Long-term)

| Feature | Status |
|---|---|
| F11: Management Studio Functionalities | `planned` |
