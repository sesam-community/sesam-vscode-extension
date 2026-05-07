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
| F00 | Bundle sesam-py (TS rewrite + npm bundle) | Phase 1 | `implemented` | [impl-f00-bundle-sesam-py.prompt.md](impl-f00-bundle-sesam-py.prompt.md) |
| F01 | sesam-py Command Integration | Phase 1 | `implemented` | [impl-f01-sesam-commands.prompt.md](impl-f01-sesam-commands.prompt.md) |
| F02 | Config File Intelligence | Phase 5 | `planned` | [impl-f02-config-file-intelligence.prompt.md](impl-f02-config-file-intelligence.prompt.md) |
| F03 | Secure Credential Management | Phase 1 | `implemented` | [impl-f03-credential-management.prompt.md](impl-f03-credential-management.prompt.md) |
| F12 | Sesam Config File Extensions & Formatter | Phase 1 | `implemented` | [impl-f12-conf-json-formatter.prompt.md](impl-f12-conf-json-formatter.prompt.md) |
| F13 | Go to Rule Definition + Find All References + Rename Rule | — | `implemented` | [go-to-rule-definition.prompt.md](../plans/go-to-rule-definition.prompt.md) |
| F14 | Cross-file Dataset Navigation | — | `implemented` | [cross-file-navigation.prompt.md](../plans/cross-file-navigation.prompt.md) |
| F15 | Interactive Pipe Graph (canvas / webview) | Phase 4 | `planned` | [interactive-pipe-graph.prompt.md](../plans/interactive-pipe-graph.prompt.md) |
| F16 | Pipe DAG Tree Views (Lineage + Dependents) | — | `implemented` | [pipe-dag-tree.prompt.md](../plans/pipe-dag-tree.prompt.md) |
| F17 | System Pipes View | — | `implemented` | [system-pipes-view.prompt.md](../plans/system-pipes-view.prompt.md) |
| F18 | Dataset Alias Support (highlight + hover + rename) | — | `implemented` | [dataset-alias-support.prompt.md](../plans/dataset-alias-support.prompt.md) |
| F19 | DTL Syntax Linting | Phase 1 | `implemented` | [impl-f19-syntax-linting.prompt.md](impl-f19-syntax-linting.prompt.md) |
| F20 | Extension Language Model Tools API | Phase 1 | `implemented` | [impl-f20-lm-tools-api.prompt.md](impl-f20-lm-tools-api.prompt.md) |
| F21 | Config Property Completions | Phase 1 | `implemented` | [impl-f21-config-prop-completions.prompt.md](impl-f21-config-prop-completions.prompt.md) |
| F22 | Sesam Panel (Errors / Warnings View) | Phase 1 | `implemented` | — |
| F23 | Centralized Network Status Bar | Phase 1 | `implemented` | [impl-f23-network-status.prompt.md](impl-f23-network-status.prompt.md) |
| F24 | Live Updates via Socket.IO | Phase 1 | `implemented` | [impl-f24-live-updates.prompt.md](impl-f24-live-updates.prompt.md) |
| F25 | Credential Safety (status bar hostname + destructive-command guard) | Phase 1 | `implemented` | [credential-safety.prompt.md](../plans/credential-safety.prompt.md) |
| F26 | Safe Profile Switching (unsaved-file + git guard + node teardown) | Phase 1 | `implemented` | [impl-f26-switch-profile.prompt.md](impl-f26-switch-profile.prompt.md) |
| F27 | Autocomplete & Hover Improvements (hops, permissions, reference values) | Phase 1 | `implemented` | [impl-f27-autocomplete-improvements.prompt.md](impl-f27-autocomplete-improvements.prompt.md) |
| F28 | Workspace-Scoped Profiles (one profile per folder, no bleed between workspaces) | Phase 1 | `implemented` | [impl-f28-workspace-scoped-profiles.prompt.md](impl-f28-workspace-scoped-profiles.prompt.md) |
| F05 | Test Management (Testing API) | Phase 2 | `phase 3 implemented` | [impl-f05-test-management.prompt.md](impl-f05-test-management.prompt.md) |
| F06 | Status / Diff View | Phase 2 | `implemented` | [impl-f06-status-diff-view.prompt.md](impl-f06-status-diff-view.prompt.md) |
| F04 | Node-Connected Live Preview | Phase 3 | `implemented` | [impl-f04-node-preview.prompt.md](impl-f04-node-preview.prompt.md) |
| F10 | Inline Output & Diagnostics from Node | Phase 3 | `planned` | [impl-f10-inline-diagnostics.prompt.md](impl-f10-inline-diagnostics.prompt.md) |
| F09 | Copilot Agent Participant (@sesam) | Phase 4 | `implemented` | [impl-f09-copilot-agent.prompt.md](impl-f09-copilot-agent.prompt.md) |
| F07 | Interactive Pipe Graph (canvas) | Phase 4 | `planned` (tracked as F15) | [impl-f07-pipe-graph.prompt.md](impl-f07-pipe-graph.prompt.md) |
| F08 | Connector Development Tools | Phase 4 | `planned` | [impl-f08-connector-tools.prompt.md](impl-f08-connector-tools.prompt.md) |
| F11 | Management Studio Functionalities | Phase 5 | `planned` | [impl-f11-management-studio.prompt.md](impl-f11-management-studio.prompt.md) |
| E2E | End-to-End Tests via Playwright | Cross-cutting | `planned` | [e2e-playwright.prompt.md](../plans/e2e-playwright.prompt.md) |
| F29 | Large Workspace Optimization (1k+ pipes) | Cross-cutting | `phase 3 O6 implemented` | [large-workspace-optimization.prompt.md](../plans/large-workspace-optimization.prompt.md) |

---

## Infrastructure Decisions

| Decision | Summary | Detail |
|---|---|---|
| Monorepo structure | `@sesam/core`, `@sesam/cli`, and vscode-extension in a single pnpm monorepo (`sesam-ts`) | [impl-f00-monorepo-structure.prompt.md](impl-f00-monorepo-structure.prompt.md) |
| Extension distribution | VSIX published to GitHub Releases (private repo) — no Microsoft Marketplace | [impl-distribution.prompt.md](impl-distribution.prompt.md) |
| Release plan | Versioned changelog and roadmap following Keep a Changelog 1.1.0 + SemVer | [release-plan.prompt.md](../plans/release-plan.prompt.md) |

### Phase 1: MVP - The Daily Command Loop
> Goal: zero-install experience; eliminate terminal context-switch.

| Feature | Status |
|---|---|
| F00: Bundle sesam-py | `implemented` |
| F01: sesam-py Command Integration | `implemented` |
| F03: Secure Credential Management | `implemented` |
| F12: conf.json Support & Full-File Sesam Formatter | `implemented` |
| F13: Go to Rule Definition | `implemented` |
| F14: Cross-file Dataset Navigation | `implemented` |
| F16: Pipe DAG Tree Views | `implemented` |
| F17: System Pipes View | `implemented` |
| F18: Dataset Alias Support | `implemented` |
| F19: DTL Syntax Linting | `implemented` |
| F20: Extension Language Model Tools API | `implemented` |
| F21: Config Property Completions (all phases) | `implemented` |
| F22: Sesam Panel (Errors / Warnings View) | `implemented` |
| F23: Centralized Network Status Bar | `implemented` |
| F24: Live Updates via Socket.IO | `implemented` |
| F25: Credential Safety | `implemented` |
| F26: Safe Profile Switching | `implemented` |

### Phase 2: Testing & Diff Loop

| Feature | Status |
|---|---|
| F05: Test Management | `planned` |
| F06: Status / Diff View | `planned` |

### Phase 3: Node Connectivity

| Feature | Status |
|---|---|
| F04: Node-Connected Live Preview | `implemented` |
| F10: Inline Output & Diagnostics | `planned` |

### Phase 4: AI & Visual Polish

| Feature | Status |
|---|---|
| F09: Copilot Agent Participant | `implemented` |
| F07/F15: Interactive Pipe Graph (canvas) | `planned` |
| F08: Connector Development Tools | `planned` |

### Phase 5: Management Studio Functionalities (Long-term)

| Feature | Status |
|---|---|
| F11: Management Studio Functionalities | `planned` |
