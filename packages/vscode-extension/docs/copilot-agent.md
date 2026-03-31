# Using GitHub Copilot Agent with the Sesam Extension

## Table of Contents

- [Requirements](#requirements)
- [Available Tools](#available-tools)
- [How to Use](#how-to-use)
  - [1. Open Copilot Chat in Agent Mode](#1-open-copilot-chat-in-agent-mode)
  - [2. Ask naturally — Copilot selects the tool automatically](#2-ask-naturally--copilot-selects-the-tool-automatically)
  - [3. Reference a tool explicitly with `#`](#3-reference-a-tool-explicitly-with-)
- [Example Prompts](#example-prompts)
  - [Audit the whole workspace](#audit-the-whole-workspace)
  - [Validate a single file](#validate-a-single-file)
  - [Fix errors automatically](#fix-errors-automatically)
  - [Generate a valid pipe](#generate-a-valid-pipe)
  - [Filter by severity](#filter-by-severity)
  - [Explain errors](#explain-errors)
- [Seeing the Tool Calls](#seeing-the-tool-calls)
- [@sesam Chat Participant](#sesam-chat-participant)
  - [How to Use @sesam](#how-to-use-sesam)
  - [Slash Commands](#slash-commands)
  - [Example Prompts](#example-prompts-1)
- [Troubleshooting](#troubleshooting)

---

## Requirements

- GitHub Copilot extension installed and signed in
- VS Code 1.90 or later
- The Sesam extension active in your workspace

---

## Available Tools

| Tool | Reference name | What it does |
|---|---|---|
| **Sesam: Lint Document** | `#sesamLintDocument` | Validates a single pipe/system config and returns structured diagnostics |
| **Sesam: Lint Workspace** | `#sesamLintWorkspace` | Scans all Sesam config files in the workspace and returns a per-file issue summary |

---

## How to Use

### 1. Open Copilot Chat in Agent Mode

Open the chat panel (`Ctrl+Alt+I`) and switch the mode selector to **Agent**.
Tool calls are only made in agent mode — "Ask" and "Edit" modes do not invoke tools.

### 2. Ask naturally — Copilot selects the tool automatically

> Are there any errors in my pipe configs?

> What's wrong with pipes/person-to-crm.json?

> Fix all DTL errors in my workspace.

### 3. Reference a tool explicitly with `#`

Type `#sesamLint` in the chat input and select from the autocomplete:

```
#sesamLintWorkspace — run a full workspace audit
#sesamLintDocument  — lint the active file or inline content
```

---

## Example Prompts

### Audit the whole workspace

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

---

### Validate a single file

```
Is pipes/order-enrich.json valid?
```

or paste inline content:

```
Does this config have any issues?
{"_id": "my-pipe", "type": "pipe", "source": {"type": "dataset"}}
```

---

### Fix errors automatically

```
Fix all DTL errors in my workspace. Use the lint tool to find them, then edit the files.
```

Copilot will:
1. Call `#sesamLintWorkspace` to get the full issues list
2. Propose edits for each file
3. Optionally re-lint after editing to confirm the fixes

---

### Generate a valid pipe

```
Generate a pipe that reads from a REST system called "hr-api" and maps the "employeeId"
field to "_T.id". Make sure it has no DTL errors.
```

Copilot generates the pipe JSON, calls `#sesamLintDocument` on the output, then adjusts
if there are any issues — all in one turn.

---

### Filter by severity

```
#sesamLintWorkspace Show only errors, not warnings.
```

---

### Explain errors

```
What do the DTL errors in pipes/enrichment.json mean and how do I fix them?
```

Copilot lints the file, then explains each diagnostic in plain language with a suggested fix.

---

## Seeing the Tool Calls

In agent mode, each tool invocation appears as a collapsible entry in the chat thread:

```
▶ Used tool: Sesam: Lint Workspace
  Input:  { "maxProblems": 100, "minSeverity": 4 }
  Output: { "status": "has-issues", "fileCount": 2, ... }
```

Click the entry to inspect the exact JSON exchanged.

You can also watch the raw IPC traffic in **Output → DTL Language Server (Trace)**.

---

## @sesam Chat Participant

> **Copilot only** — Chat participants use the VS Code Chat Participant API, which is provided
> exclusively by the GitHub Copilot extension. Other AI extensions (Continue, Cline, Codex, etc.)
> cannot invoke `@sesam`.

A **chat participant** is a named assistant persona your extension registers in Copilot Chat.
Users address it explicitly with `@sesam`, and the extension handles the full conversational turn:
it builds a context-aware system prompt (embedding the DTL function reference, the active file
content, or any attached files), calls the language model, streams the response as markdown, and
can perform follow-up actions like auto-linting the generated output.

This is different from the `#sesamLintDocument` / `#sesamLintWorkspace` tools: those are
invoked **automatically** by Copilot's agent when it decides they're relevant, whereas `@sesam`
is **always user-initiated** and supports richer, multi-step interaction.

The extension also registers an **`@sesam` chat participant** — a Sesam-aware assistant that can
generate pipes, explain transforms, write test data, and answer CLI questions directly in Copilot Chat.

### How to Use @sesam

1. Open Copilot Chat (`Ctrl+Alt+I`) and switch the mode selector to **Agent**.
2. Type `@sesam` — *Sesam Assistant* appears in the autocomplete.
3. Use a slash command or ask naturally.

### Slash Commands

| Command | What it does |
|---|---|
| `/generate` | Generate a new Sesam pipe config |
| `/explain` | Explain the active pipe config or a file dragged into chat |
| `/test` | Generate `testdata/<pipe-id>-input.json` + `testdata/<pipe-id>-expected.json` |
| `/cli` | Get sesam-py CLI command syntax and examples |

### Example Prompts

**Generate a pipe (with auto-lint and save)**

```
@sesam /generate a pipe that reads from a REST system "hr-api" and maps employeeId to _T.id
```

`@sesam` generates the JSON, calls the lint tool on the output, and reports any issues inline.
A **`Save as hr-api.conf.json`** button appears below the response — click it to open a Save Dialog
pre-filled with `pipes/<pipe-id>.conf.json` inside your workspace. Confirm to write the file and
open it in the editor.

---

**Explain the active file**

Open a pipe config in the editor, then:

```
@sesam /explain
```

`@sesam` reads the active file and explains each transform rule in plain language.

---

**Generate test data**

Open the pipe config you want to test in the editor, then:

```
@sesam /test
```

`@sesam` reads the active pipe config and generates `input.json` and `expected.json` content for it:

```
testdata/
  <pipe-id>/
    input.json    ← sample source entities fed into the transform
    expected.json ← what the transform must output for the test to pass
```

Save the files to `testdata/<pipe-id>/`, then run `sesam test` from the CLI to verify.

---

**Attach a file as context**

Drag a `.conf.json` file into the chat input, then send one message per intent:

```
@sesam /explain
```

or

```
@sesam /test
```

---

**Natural language (intent is auto-detected)**

Each of these is a separate chat message:

```
@sesam what does the "hops" function do?
```

```
@sesam create a pipe that merges two datasets
```

```
@sesam how do I run a single pipe with sesam-py?
```

---

## Troubleshooting

**`#sesamLintWorkspace` doesn't autocomplete**
The extension may not have activated yet. Open any `*.conf.json` or `*.conf.pipe` file first,
or run `Developer: Restart Extension Host` from the Command Palette.

**Copilot uses `get_errors` instead of the Sesam tools**
Be more explicit: type `#sesamLintWorkspace` directly in the input, or phrase your request as
*"Use the Sesam lint tool to check my workspace"*.

**`@sesam` doesn't appear in autocomplete**
Run `Developer: Restart Extension Host` from the Command Palette, then re-open the chat.

**Tools don't appear after F5**
Make sure you are asking in the **Extension Development Host** window (the one opened by F5),
not your main VS Code window.
