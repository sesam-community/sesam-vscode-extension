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
  /** Minimum severity to include: 1=Error only, 2=W+E, 3=Info+, 4=all (hints too) */
  minSeverity?: LintSeverity;
}

export interface LintWorkspaceResponse {
  results: Array<LintContentResponse & { uri: string }>;
  error?: string;
}
