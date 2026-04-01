# F20: Extension Language Model Tools API

> **Status**: `implemented`
> **Rollout Phase**: Phase 1 - MVP (prerequisite for F09)
> **Depends on**: F19 (DTL Syntax Linting — `implemented`)
> **Enables**: [F09 — Copilot Agent Participant `@sesam`](impl-f09-copilot-agent.prompt.md)
> **Tracking**: [README.md](README.md)

---

## Summary

Expose the extension's DTL/Sesam validation logic as **VS Code Language Model Tools**
(`vscode.lm.registerTool`) so any AI agent or model can programmatically lint and query Sesam
config files.

The `vscode.lm.registerTool` API is **model-agnostic by design** — once tools are registered,
they become available to _any_ LM caller that VS Code brokers, not just GitHub Copilot:

| Caller | How it invokes the tools |
|---|---|
| **GitHub Copilot** (chat / inline) | `#sesam_lint_document` prompt reference or automatic tool selection |
| **`@sesam` chat participant** (F09) | Explicit `vscode.lm.invokeTool()` call or passed in `tools` array |
| **VS Code agent mode** (any model) | Model self-selects tools from the registered set |
| **Continue.dev / Cline / Roo** or other VS Code–hosted LM extensions | Same `vscode.lm.invokeTool()` bridge |
| **External MCP-style orchestrators** | Via VS Code's LM tool proxy when the server is connected |

The tools communicate with the existing LSP server (F19) via custom protocol requests. The server
remains the single source of truth for all validation logic; no validator code is duplicated.

---

## API Surface (Tools registered)

### Tool 1: `sesam_lint_document`

Lint a single Sesam config file and return structured diagnostics.

**Use cases for agents:**
- "Are there any errors in this pipe before I upload it?"
- "Fix the DTL error on line 12."
- Check a generated config before writing it to disk

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string",
      "description": "VS Code URI (file:///…) or workspace-relative path to the Sesam config file."
    },
    "content": {
      "type": "string",
      "description": "Raw JSON content to validate inline. Takes precedence over 'uri' if both are provided. Use this when validating unsaved / generated content."
    },
    "filename": {
      "type": "string",
      "description": "Optional filename hint when using 'content' (e.g. 'my-pipe.conf.json'). Used for display only."
    }
  },
  "oneOf": [
    { "required": ["uri"] },
    { "required": ["content"] }
  ]
}
```

**Output (JSON string):**
```ts
interface LintToolResult {
  status: "ok" | "has-issues" | "error";
  errorCount: number;
  warningCount: number;
  /** Human-readable file label (resolved URI or filename hint) */
  file: string;
  diagnostics: Array<{
    severity: "error" | "warning" | "info" | "hint";
    /** 1-based line number */
    line: number;
    /** 1-based character offset */
    character: number;
    message: string;
    /** Machine-readable code, e.g. "invalid-json", "undefined-rule" */
    code: string | undefined;
  }>;
  error?: string; // only when status === "error"
}
```

---

### Tool 2: `sesam_lint_workspace`

Lint **all** Sesam config files in the workspace and return a rolled-up summary.

**Use cases for agents:**
- "Are there any errors in the whole config set?"
- "List all pipes that have DTL errors."
- Pre-upload validation before a `sesam upload`

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "maxProblems": {
      "type": "number",
      "description": "Cap on total diagnostics returned. Default: 100."
    },
    "severity": {
      "type": "string",
      "enum": ["error", "warning", "all"],
      "description": "Filter by minimum severity. Default: 'all'."
    }
  }
}
```

**Output (JSON string):**
```ts
interface LintWorkspaceResult {
  status: "ok" | "has-issues";
  totalErrors: number;
  totalWarnings: number;
  fileCount: number;
  filesWithIssues: Array<{
    uri: string;
    /** Workspace-relative path for readability */
    relativePath: string;
    errorCount: number;
    warningCount: number;
    diagnostics: LintToolResult["diagnostics"];
  }>;
}
```

---

## Architecture

### Why a custom LSP request (not a shared module)?

The three server-side validators (`dtl-validator.ts`, `dtl-structure-validator.ts`,
`dtl-path-validator.ts`) already depend on `vscode-languageserver/node` types. Moving them to
`src/shared/` would require a type-layer refactor. Instead:

1. **The server exposes a custom protocol request** `sesam/lintContent` that accepts text or a URI,
   runs the full validation pipeline, and returns plain serializable diagnostics.
2. **The LM tool in the client** sends this request via `LanguageClient.sendRequest()` and
   formats the result for the language model.

This keeps the validation logic in one place (the LSP server), adds no code duplication, and
automatically picks up any future improvements to the validators.

```
  Any LM caller
  (Copilot / @sesam / Continue / agent mode / …)
         │
         │  vscode.lm.invokeTool('sesam_lint_document', …)
         ▼
┌─────────────────────────────────────┐        ┌──────────────────────────────────┐
│  Extension client (lm-tools.ts)     │        │  LSP Server (server.ts)          │
│                                     │        │                                  │
│  vscode.lm.registerTool(            │  IPC   │  onRequest('sesam/lintContent')  │
│    'sesam_lint_document', {         │───────>│    parseDtlText(text)            │
│      invoke(options) {              │        │    + validateCalls(...)          │
│        client.sendRequest(          │<───────│    + validateStructure(...)      │
│          'sesam/lintContent', ...)  │        │    + validatePathStrings(...)    │
│      }                              │        │    → LintDiagnostic[]            │
│  })                                 │        │                                  │
└─────────────────────────────────────┘        └──────────────────────────────────┘
         │
         │  JSON string result
         ▼
  Caller's LLM context
```

---

## Implementation Phases

### Phase A — Serializable diagnostic types + custom LSP request

**Files touched:**

| File | Change |
|---|---|
| `types/lint.types.ts` (new) | `LintDiagnostic`, `LintContentRequest`, `LintContentResponse` |
| `server/src/server.ts` | Register `sesam/lintContent` request handler |

#### `types/lint.types.ts`

```ts
/** Severity mirrors LSP DiagnosticSeverity (1=Error, 2=Warning, 3=Info, 4=Hint). */
export type LintSeverity = 1 | 2 | 3 | 4;

export interface LintPosition {
  line: number;
  character: number;
}

export interface LintDiagnostic {
  range: { start: LintPosition; end: LintPosition };
  severity: LintSeverity;
  message: string;
  code?: string;
  source?: string;
}

export interface LintContentRequest {
  /** VS Code file URI. Used when content is not provided inline. */
  uri?: string;
  /** Raw document text to validate. Takes precedence over uri. */
  content?: string;
}

export interface LintContentResponse {
  diagnostics: LintDiagnostic[];
  /** Resolved display label (uri basename or "inline content"). */
  fileLabel: string;
  error?: string;
}

export interface LintWorkspaceRequest {
  maxProblems?: number;
  /** Minimum severity to include: 1=Error only, 2=W+E, 3=all */
  minSeverity?: LintSeverity;
}

export interface LintWorkspaceResponse {
  results: Array<LintContentResponse & { uri: string }>;
  error?: string;
}
```

#### `server/src/server.ts` — new request handlers

Add after the existing `documents.onDidOpen` wiring, before the `onCompletion` handler:

```ts
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  LintContentRequest,
  LintContentResponse,
  LintWorkspaceRequest,
  LintWorkspaceResponse,
  LintDiagnostic,
  LintSeverity,
} from "../../types/lint.types";

// Helper: run the full validation pipeline and return plain LintDiagnostic[].
async function lintText(text: string, uri: string): Promise<LintDiagnostic[]> {
  const settings = await getDocumentSettings(uri);
  const parseResult = parseDtlText(text, "json");
  const diagnostics: Diagnostic[] = [];

  const validatorOptions: ValidatorOptions = {
    maxProblems: settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems,
    validateUnknownFunctions: settings.validate?.unknownFunctions ?? true,
    validateArgCount:          settings.validate?.argCount ?? true,
    validateJsonSyntax:       settings.validate?.jsonSyntax ?? true,
    validateDtlStructure:     settings.validate?.dtlStructure ?? true,
    validateTransformInExpression: settings.validate?.transformInExpression ?? true,
    validatePathExpressions:  settings.validate?.pathExpressions ?? false,
    ruleNames: parseResult.ruleNames,
  };

  if (parseResult.parseError !== null && validatorOptions.validateJsonSyntax) {
    const offset = parseResult.parseError.offset;
    const pos = offset >= 0 ? offsetToPosition(text, offset) : { line: 0, character: 0 };
    diagnostics.push({
      range: Range.create(pos.line, pos.character, pos.line, Math.max(pos.character + 1, pos.character)),
      severity: DiagnosticSeverity.Error,
      message: `Invalid JSON: ${parseResult.parseError.message}`,
      source: "dtl",
      code: "invalid-json",
    });
  } else {
    diagnostics.push(...validateStructure(parseResult.calls, parseResult.structuralErrors, validatorOptions));
    diagnostics.push(...validateCalls(parseResult.calls, validatorOptions));
    diagnostics.push(...validatePathStrings(parseResult.calls, validatorOptions));
  }

  return diagnostics.map((d) => ({
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end:   { line: d.range.end.line,   character: d.range.end.character },
    },
    severity: (d.severity ?? DiagnosticSeverity.Information) as LintSeverity,
    message: d.message,
    code: typeof d.code === "string" ? d.code : d.code !== undefined ? String(d.code) : undefined,
    source: d.source,
  }));
}

// ── sesam/lintContent ──────────────────────────────────────────────────────
connection.onRequest(
  "sesam/lintContent",
  async (params: LintContentRequest): Promise<LintContentResponse> => {
    try {
      let text: string;
      let fileLabel: string;

      if (params.content !== undefined) {
        text = params.content;
        fileLabel = "inline content";
      } else if (params.uri) {
        const openDoc = documents.get(params.uri);
        if (openDoc) {
          text = openDoc.getText();
        } else {
          text = fs.readFileSync(fileURLToPath(params.uri), "utf-8");
        }
        fileLabel = params.uri.split("/").pop() ?? params.uri;
      } else {
        return { diagnostics: [], fileLabel: "unknown", error: "Either 'uri' or 'content' must be provided." };
      }

      const diagnostics = await lintText(text, params.uri ?? "untitled:lint");
      return { diagnostics, fileLabel };
    } catch (e) {
      return { diagnostics: [], fileLabel: "unknown", error: String(e) };
    }
  },
);

// ── sesam/lintWorkspace ────────────────────────────────────────────────────
connection.onRequest(
  "sesam/lintWorkspace",
  async (params: LintWorkspaceRequest): Promise<LintWorkspaceResponse> => {
    try {
      const maxProblems = params.maxProblems ?? 100;
      const minSeverity: LintSeverity = params.minSeverity ?? 4; // 4 = include all
      const results: LintWorkspaceResponse["results"] = [];
      let totalCollected = 0;

      for (const [uri, _] of workspaceIndex.allFileUris()) {
        if (totalCollected >= maxProblems) break;
        try {
          const fsPath = fileURLToPath(uri);
          const text = fs.readFileSync(fsPath, "utf-8");
          const allDiags = await lintText(text, uri);
          const filtered = allDiags.filter((d) => d.severity <= minSeverity);
          if (filtered.length > 0) {
            results.push({
              uri,
              fileLabel: uri.split("/").pop() ?? uri,
              diagnostics: filtered.slice(0, maxProblems - totalCollected),
            });
            totalCollected += filtered.length;
          }
        } catch {
          // Skip unreadable files silently
        }
      }

      return { results };
    } catch (e) {
      return { results: [], error: String(e) };
    }
  },
);
```

> **Note on `workspaceIndex.allFileUris()`**: the `sesam/lintWorkspace` handler requires
> `workspaceIndex` to expose an iterator over all tracked file URIs. If this method does not exist
> yet on the workspace index, it must be added as part of this feature (see Phase B below).

---

### Phase B — Client-side Language Model Tool registration

**Files touched:**

| File | Change |
|---|---|
| `client/src/lm-tools.ts` (new) | Tool registration for `sesam_lint_document` and `sesam_lint_workspace` |
| `client/src/extension.ts` | Call `registerSesamLmTools(context, client)` after `client.start()` |
| `package.json` | Add `"languageModelTools"` contribution and activation event |

#### `client/src/lm-tools.ts`

```ts
import * as path from "node:path";

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import type {
  LintContentRequest,
  LintContentResponse,
  LintWorkspaceRequest,
  LintWorkspaceResponse,
  LintDiagnostic,
} from "../../types/lint.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityLabel = (s: number): string => {
  if (s === 1) return "error";
  if (s === 2) return "warning";
  if (s === 3) return "info";
  return "hint";
};

const formatDiagnostics = (diags: LintDiagnostic[], file: string) => ({
  file,
  status: diags.length === 0 ? "ok" : "has-issues",
  errorCount:   diags.filter((d) => d.severity === 1).length,
  warningCount: diags.filter((d) => d.severity === 2).length,
  diagnostics: diags.map((d) => ({
    severity:  severityLabel(d.severity),
    line:      d.range.start.line + 1,      // 1-based
    character: d.range.start.character + 1, // 1-based
    message:   d.message,
    code:      d.code,
  })),
});

const resolveUri = (input: string): string => {
  if (input.startsWith("file://")) {
    return input;
  }

  // Absolute POSIX path
  if (input.startsWith("/")) {
    return vscode.Uri.file(input).toString();
  }

  // Workspace-relative path
  const wsFolder = vscode.workspace.workspaceFolders?.[0];

  if (wsFolder) {
    return vscode.Uri.joinPath(wsFolder.uri, input).toString();
  }

  return input;
};

// ---------------------------------------------------------------------------
// Tool: sesam_lint_document
// ---------------------------------------------------------------------------

interface LintDocumentInput {
  uri?: string;
  content?: string;
  filename?: string;
}

const makeLintDocumentTool = (
  client: LanguageClient,
): vscode.LanguageModelTool<LintDocumentInput> => ({
  async invoke(options, _token) {
    const { uri, content, filename } = options.input;

    const request: LintContentRequest = {
      uri: uri ? resolveUri(uri) : undefined,
      content,
    };

    const response: LintContentResponse = await client.sendRequest("sesam/lintContent", request);

    const fileLabel = filename ?? response.fileLabel;
    const resultJson = response.error
      ? JSON.stringify({ status: "error", file: fileLabel, error: response.error })
      : JSON.stringify(formatDiagnostics(response.diagnostics, fileLabel));

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultJson)]);
  },
});

// ---------------------------------------------------------------------------
// Tool: sesam_lint_workspace
// ---------------------------------------------------------------------------

interface LintWorkspaceInput {
  maxProblems?: number;
  severity?: "error" | "warning" | "all";
}

const severityToNumber = (s: "error" | "warning" | "all" | undefined): 1 | 2 | 4 => {
  if (s === "error") return 1;
  if (s === "warning") return 2;
  return 4;
};

const makeLintWorkspaceTool = (
  client: LanguageClient,
): vscode.LanguageModelTool<LintWorkspaceInput> => ({
  async invoke(options, _token) {
    const request: LintWorkspaceRequest = {
      maxProblems: options.input.maxProblems ?? 100,
      minSeverity: severityToNumber(options.input.severity),
    };

    const response: LintWorkspaceResponse = await client.sendRequest(
      "sesam/lintWorkspace",
      request,
    );

    if (response.error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({ status: "error", error: response.error })),
      ]);
    }

    const summary = {
      status:        response.results.length === 0 ? "ok" : "has-issues",
      fileCount:     response.results.length,
      totalErrors:   response.results.reduce((n, r) => n + r.diagnostics.filter((d) => d.severity === 1).length, 0),
      totalWarnings: response.results.reduce((n, r) => n + r.diagnostics.filter((d) => d.severity === 2).length, 0),
      files: response.results.map((r) =>
        formatDiagnostics(r.diagnostics, r.fileLabel),
      ),
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(summary)),
    ]);
  },
});

// ---------------------------------------------------------------------------
// Registration entry point (called from extension.ts after client.start())
// ---------------------------------------------------------------------------

export const registerSesamLmTools = (
  context: vscode.ExtensionContext,
  client: LanguageClient,
): void => {
  context.subscriptions.push(
    vscode.lm.registerTool("sesam_lint_document", makeLintDocumentTool(client)),
    vscode.lm.registerTool("sesam_lint_workspace", makeLintWorkspaceTool(client)),
  );
};
```

#### `client/src/extension.ts` change

After `await client.start();` add:

```ts
import { registerSesamLmTools } from "./lm-tools";

// inside activate():
await client.start();
registerSesamLmTools(context, client);
```

#### `package.json` changes

In `"contributes"`:
```jsonc
"languageModelTools": [
  {
    "name": "sesam_lint_document",
    "displayName": "Sesam: Lint Document",
    "modelDescription": "Validates a Sesam DTL config file and returns structured diagnostics (errors and warnings). Accepts either a file path/URI or inline JSON content. Use this tool before suggesting fixes, writing configs to disk, or uploading to a Sesam node.",
    "canBeReferencedInPrompt": true,
    "icon": "$(check)",
    "inputSchema": {
      "type": "object",
      "properties": {
        "uri": {
          "type": "string",
          "description": "File URI (file:///…) or workspace-relative path to the Sesam config file."
        },
        "content": {
          "type": "string",
          "description": "Raw JSON content to validate inline. Use when file is unsaved or generated."
        },
        "filename": {
          "type": "string",
          "description": "Optional human-readable filename for inline content (display only)."
        }
      }
    }
  },
  {
    "name": "sesam_lint_workspace",
    "displayName": "Sesam: Lint Workspace",
    "modelDescription": "Scans all Sesam config files in the workspace and returns a summary of all validation issues grouped by file. Use to audit the full config set before an upload.",
    "canBeReferencedInPrompt": true,
    "icon": "$(list-errors)",
    "inputSchema": {
      "type": "object",
      "properties": {
        "maxProblems": {
          "type": "number",
          "description": "Maximum total diagnostics to return. Default: 100."
        },
        "severity": {
          "type": "string",
          "enum": ["error", "warning", "all"],
          "description": "Minimum severity to include. Default: 'all'."
        }
      }
    }
  }
]
```

In `"activationEvents"` add:
```json
"onLanguageModelTool:sesam_lint_document",
"onLanguageModelTool:sesam_lint_workspace"
```

---

### Phase C — `workspaceIndex` iterator for `sesam/lintWorkspace`

The `sesam/lintWorkspace` handler needs to iterate over all tracked file URIs.

Inspect `server/src/utils/workspace-index.ts`. If `allFileUris()` (or equivalent) does not exist,
add it — it should return an `IterableIterator<string>` over the keys of the internal file map.

```ts
// In the WorkspaceIndex class / object:
allFileUris(): IterableIterator<string> {
  return this.fileMap.keys(); // or whatever the internal map is called
}
```

---

### Phase D — Integration guide for all callers

The tools are model-agnostic. Any caller that VS Code routes LM requests through can use them.

---

#### D1 — GitHub Copilot (built-in)

Once registered, tools with `"canBeReferencedInPrompt": true` are automatically available in
Copilot chat. Users can reference them explicitly:

```
#sesam_lint_document lint the current file and tell me what is wrong
```

Copilot will also pick them up automatically in **agent mode** when it determines they are relevant
(no special code needed — Copilot reads the `modelDescription` field from `package.json`).

---

#### D2 — `@sesam` chat participant (F09)

Once F09's `sesamChatParticipant.ts` is implemented, it can use the tools in two ways:

**Method A — Implicit (pass tools array, let model decide):**

```ts
const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
  const tools = vscode.lm.tools.filter((t) =>
    ["sesam_lint_document", "sesam_lint_workspace"].includes(t.name),
  );
  const response = await model.sendRequest(messages, { tools }, token);
  // Stream response handling with tool call round-trips...
};
```

**Method B — Explicit invocation (intent is clearly about validation):**

```ts
const result = await vscode.lm.invokeTool(
  "sesam_lint_document",
  { input: { uri: currentFileUri }, toolInvocationToken: request.toolInvocationToken },
  token,
);
// Deserialise JSON result and weave into the chat response
```

---

#### D3 — VS Code agent mode (any LLM backend)

VS Code 1.99+ surfaces all registered `languageModelTools` to any model running in agent mode
(GPT-4o, Claude, Gemini, Llama, etc. via Continue.dev, Cline, Roo, or similar). No additional
code is required in this extension — registration is sufficient.

The `modelDescription` string in `package.json` is the only text the model sees when deciding
whether to call the tool. Keep it accurate and action-oriented.

---

#### D4 — MCP tool proxy (future)

VS Code's Language Model Tools bridge is designed to eventually map to MCP tool calls. When that
bridge stabilises, registered tools will become callable from any MCP-compatible orchestrator
without changes to this extension.

---

#### D5 — Prompt engineering notes for `modelDescription`

The `modelDescription` fields in `package.json` are the primary signal for automatic tool
selection. Guidelines:

- State **when** to use the tool (e.g. *"before suggesting fixes"*, *"before uploading"*).
- State **what it returns** (e.g. *"structured diagnostics"*, *"line and character position"*).
- Avoid vague phrases like *"useful for validation"* — models need action triggers.
- Do **not** mention Copilot or a specific model — descriptions must be model-neutral.

---

## Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `types/lint.types.ts` | **Create** | Platform-agnostic serializable diagnostics types |
| `server/src/server.ts` | **Modify** | Add `lintText()` helper; register `sesam/lintContent` and `sesam/lintWorkspace` request handlers |
| `server/src/utils/workspace-index.ts` | **Modify** | Add `allFileUris()` method if missing |
| `client/src/lm-tools.ts` | **Create** | Full LM tool implementation for both tools |
| `client/src/extension.ts` | **Modify** | Import and call `registerSesamLmTools` after LSP client start |
| `package.json` | **Modify** | Add `languageModelTools` contribution + activation events |

---

## Settings Respected

The `sesam/lintContent` handler calls `getDocumentSettings()` using the provided URI, so all
existing `dtl.validate.*` settings (`enabled`, `unknownFunctions`, `argCount`, `jsonSyntax`,
`dtlStructure`, `transformInExpression`, `pathExpressions`) apply to tool-invoked validation
exactly as they do to the live editor diagnostics.

---

## VS Code Version Requirements

| Feature used | Minimum VS Code | Notes |
|---|---|---|
| `vscode.lm.registerTool()` | 1.90 (May 2024) | Core registration |
| `vscode.LanguageModelToolResult` | 1.90 | Return type for tool `invoke` |
| `vscode.lm.invokeTool()` (for F09) | 1.91 | Explicit programmatic invocation |
| `canBeReferencedInPrompt` in `package.json` | 1.92 | Enables `#tool_name` prompt references |
| Agent mode tool routing (any model) | 1.99 | VS Code exposes tools to non-Copilot models |

Target engine version in `package.json` should be `"^1.99.0"` or higher to enable full
cross-model tool routing. The extension degrades gracefully on older versions — tools still
work for Copilot calls, but may not be routed to non-Copilot callers.

---

## Testing

### Unit tests

Add to `tests/`:

| Test file | What it covers |
|---|---|
| `lm-tools.test.ts` (new) | `formatDiagnostics()`, `resolveUri()`, `severityToNumber()` — pure helpers, no VS Code APIs needed |

### Integration tests (manual)

| Scenario | Steps | Expected |
|---|---|---|
| Copilot inline reference | Open a `.conf.pipe` with a DTL error; in Copilot Chat type `#sesam_lint_document tell me what's wrong` | Tool is invoked, response lists the error with 1-based line number |
| Copilot agent mode | Enable agent mode; ask *"check my sesam pipe for errors"* | Copilot auto-selects `sesam_lint_document` without prompt reference |
| Continue.dev / Cline | Enable agent mode with a non-Copilot backend; ask the same validation question | Same tool is invoked — confirms model-agnostic routing |
| `@sesam` participant (post-F09) | In chat type `@sesam lint the current file` | Participant forwards to tool, returns structured result |
| Inline content | Invoke via `vscode.lm.invokeTool` with `content` field (no file on disk) | Validates the string directly, no file read attempted |
| Workspace scan | Ask *"are there any sesam errors in the whole project?"* | `sesam_lint_workspace` is invoked, returns per-file summary |

---

## Future Tools (not in this feature)

These are placeholders for follow-on features enabled by this architecture:

| Tool name | Description | Enabled by |
|---|---|---|
| `sesam_describe_pipe` | Return pipe metadata (source type, transform summary, sink) | F02 |
| `sesam_get_dataset_lineage` | Return upstream/downstream pipe graph for a dataset | F16 (implemented) |
| `sesam_run_command` | Execute a sesam-py command and stream output | F01 |
| `sesam_get_pipe_entities` | Fetch live entities from a pipe in the connected node | F04 |
