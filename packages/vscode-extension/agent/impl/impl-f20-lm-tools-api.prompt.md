# F20: Extension Language Model Tools API

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP (prerequisite for F09)
> **Depends on**: F19 (DTL Syntax Linting — `implemented`)
> **Enables**: [F09 — Copilot Agent Participant `@sesam`](impl-f09-copilot-agent.prompt.md)
> **Tracking**: [README.md](README.md)

---

## Summary

Expose the extension's DTL/Sesam validation logic as **VS Code Language Model Tools**
(`vscode.lm.registerTool`) so any AI agent — GitHub Copilot, the planned `@sesam` participant
(F09), or any LLM tool-calling context — can programmatically lint and query Sesam config files.

The tools are registered in the extension client and communicate with the existing LSP server
(F19) via custom protocol requests. The server remains the single source of truth for all
validation logic; no validator code is duplicated.

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
┌─────────────────────────────────────┐        ┌──────────────────────────────────┐
│  Extension client (extension.ts)    │        │  LSP Server (server.ts)          │
│                                     │        │                                  │
│  vscode.lm.registerTool(            │  IPC   │  onRequest('sesam/lintContent')  │
│    'sesam_lint_document', {         │───────>│    parseDtlText(text)            │
│      invoke(options) {              │        │    + validateCalls(...)          │
│        client.sendRequest(          │<───────│    + validateStructure(...)      │
│          'sesam/lintContent', ...)  │        │    + validatePathStrings(...)    │
│      }                              │        │    → LintDiagnostic[]            │
│  })                                 │        │                                  │
└─────────────────────────────────────┘        └──────────────────────────────────┘
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

### Phase D — Integration guide for `@sesam` (F09)

Once F09's `sesamChatParticipant.ts` is implemented, it can invoke the tools in two ways:

#### Method 1: Implicit (model self-selects the tool)

Register the tools as part of the `@sesam` participant's tool set:

```ts
import * as vscode from "vscode";

const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  const tools = vscode.lm.tools.filter((t) =>
    ["sesam_lint_document", "sesam_lint_workspace"].includes(t.name),
  );
  // Pass tools to the model; it decides when to call them
  const response = await model.sendRequest(messages, { tools }, token);
  // Stream response handling...
};
```

#### Method 2: Explicit invocation (force-call the lint tool)

When the intent is clearly about validation (keyword detection: `lint`, `error`, `valid`, `check`):

```ts
const result = await vscode.lm.invokeTool(
  "sesam_lint_document",
  {
    input: { uri: currentFileUri },
    toolInvocationToken: request.toolInvocationToken,
  },
  token,
);
// Parse result JSON and integrate into the chat response
```

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

| Feature used | Minimum VS Code |
|---|---|
| `vscode.lm.registerTool()` | 1.90 (May 2024) |
| `vscode.LanguageModelToolResult` | 1.90 |
| `vscode.lm.invokeTool()` (for F09) | 1.91 |
| `canBeReferencedInPrompt` in `package.json` | 1.92 |

Target engine version in `package.json` should be `"^1.92.0"` or higher.

---

## Testing

Add to `tests/`:

| Test file | What it covers |
|---|---|
| `lm-tools.test.ts` (new) | Unit-test `formatDiagnostics()`, `resolveUri()`, `severityToNumber()` — pure helpers, no VS Code APIs needed |

Integration testing:
- Open a `.conf.pipe` file with a known DTL error
- Open Copilot Chat, type: `@sesam lint the current file`
- Confirm the tool is invoked and the response lists the error with correct line number

---

## Future Tools (not in this feature)

These are placeholders for follow-on features enabled by this architecture:

| Tool name | Description | Enabled by |
|---|---|---|
| `sesam_describe_pipe` | Return pipe metadata (source type, transform summary, sink) | F02 |
| `sesam_get_dataset_lineage` | Return upstream/downstream pipe graph for a dataset | F16 (implemented) |
| `sesam_run_command` | Execute a sesam-py command and stream output | F01 |
| `sesam_get_pipe_entities` | Fetch live entities from a pipe in the connected node | F04 |
