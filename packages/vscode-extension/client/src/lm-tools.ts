import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import type {
  LintContentRequest,
  LintContentResponse,
  LintDiagnostic,
  LintWorkspaceRequest,
  LintWorkspaceResponse,
} from "../../types/lint.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityLabel = (s: number): string => {
  if (s === 1) {
    return "error";
  }
  if (s === 2) {
    return "warning";
  }
  if (s === 3) {
    return "info";
  }
  return "hint";
};

const formatDiagnostics = (diags: LintDiagnostic[], file: string) => ({
  file,
  status: diags.length === 0 ? ("ok" as const) : ("has-issues" as const),
  errorCount: diags.filter((d) => d.severity === 1).length,
  warningCount: diags.filter((d) => d.severity === 2).length,
  diagnostics: diags.map((d) => ({
    severity: severityLabel(d.severity),
    line: d.range.start.line + 1,
    character: d.range.start.character + 1,
    message: d.message,
    code: d.code,
  })),
});

const resolveUri = (input: string): string => {
  if (input.startsWith("file://")) {
    return input;
  }

  if (input.startsWith("/")) {
    return vscode.Uri.file(input).toString();
  }

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
  async invoke(options) {
    const { uri, content, filename } = options.input;

    const request: LintContentRequest = {
      uri: uri ? resolveUri(uri) : undefined,
      content,
    };

    const response = await client.sendRequest<LintContentResponse>("sesam/lintContent", request);

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
  if (s === "error") {
    return 1;
  }
  if (s === "warning") {
    return 2;
  }
  return 4;
};

const makeLintWorkspaceTool = (
  client: LanguageClient,
): vscode.LanguageModelTool<LintWorkspaceInput> => ({
  async invoke(options) {
    const request: LintWorkspaceRequest = {
      maxProblems: options.input.maxProblems ?? 100,
      minSeverity: severityToNumber(options.input.severity),
    };

    const response = await client.sendRequest<LintWorkspaceResponse>(
      "sesam/lintWorkspace",
      request,
    );

    if (response.error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify({ status: "error", error: response.error }),
        ),
      ]);
    }

    const summary = {
      status: response.results.length === 0 ? ("ok" as const) : ("has-issues" as const),
      fileCount: response.results.length,
      totalErrors: response.results.reduce(
        (n, r) => n + r.diagnostics.filter((d) => d.severity === 1).length,
        0,
      ),
      totalWarnings: response.results.reduce(
        (n, r) => n + r.diagnostics.filter((d) => d.severity === 2).length,
        0,
      ),
      files: response.results.map((r) => formatDiagnostics(r.diagnostics, r.fileLabel)),
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(summary)),
    ]);
  },
});

// ---------------------------------------------------------------------------
// Registration (called from extension.ts after client.start())
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
