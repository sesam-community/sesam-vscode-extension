import * as path from "node:path";

import * as vscode from "vscode";

const isSesamUri = (uri: vscode.Uri): boolean => {
  const p = uri.fsPath;

  return p.endsWith(".conf.pipe") || p.endsWith(".conf.system") || p.endsWith(".conf.json");
};

// ---------------------------------------------------------------------------
// Tree nodes
// ---------------------------------------------------------------------------

export class SesamFileItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly diagnostics: readonly vscode.Diagnostic[],
  ) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Expanded);

    const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diagnostics.filter(
      (d) => d.severity === vscode.DiagnosticSeverity.Warning,
    ).length;
    const parts: string[] = [];

    if (errors > 0) {
      parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
    }

    if (warnings > 0) {
      parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
    }

    this.description = parts.join(", ");
    this.resourceUri = uri;
    this.tooltip = uri.fsPath;
    this.iconPath =
      errors > 0
        ? new vscode.ThemeIcon("error", new vscode.ThemeColor("list.errorForeground"))
        : new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
  }
}

export class SesamDiagnosticItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly diagnostic: vscode.Diagnostic,
  ) {
    const line = diagnostic.range.start.line + 1;
    const col = diagnostic.range.start.character + 1;

    super(diagnostic.message, vscode.TreeItemCollapsibleState.None);

    this.description = `Ln ${line}, Col ${col}`;
    this.iconPath = SesamDiagnosticItem.severityIcon(diagnostic.severity);
    this.command = {
      command: "vscode.open",
      title: "Go to error",
      arguments: [uri, { selection: diagnostic.range }],
    };
  }

  private static severityIcon(severity: vscode.DiagnosticSeverity | undefined): vscode.ThemeIcon {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return new vscode.ThemeIcon("error", new vscode.ThemeColor("list.errorForeground"));
      case vscode.DiagnosticSeverity.Warning:
        return new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
      case vscode.DiagnosticSeverity.Information:
        return new vscode.ThemeIcon("info", new vscode.ThemeColor("editorInfo.foreground"));
      default:
        return new vscode.ThemeIcon("lightbulb");
    }
  }
}

type TreeNode = SesamFileItem | SesamDiagnosticItem;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Reads diagnostics from the private `store` (populated by the LSP middleware)
 * and displays them in the Sesam panel view.
 */
export class SesamErrorsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> =
    this._onDidChangeTreeData.event;

  constructor(
    private readonly store: Map<string, vscode.Diagnostic[]>,
    onStoreChanged: vscode.Event<void>,
    context: vscode.ExtensionContext,
  ) {
    context.subscriptions.push(onStoreChanged(() => this._onDidChangeTreeData.fire(undefined)));
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof SesamFileItem) {
      const sorted = [...element.diagnostics].sort((a, b) => (a.severity ?? 3) - (b.severity ?? 3));

      return sorted.map((d) => new SesamDiagnosticItem(element.uri, d));
    }

    const results: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];

    for (const [uriStr, diags] of this.store) {
      if (diags.length === 0) {
        continue;
      }

      const uri = vscode.Uri.parse(uriStr);

      if (isSesamUri(uri)) {
        results.push([uri, diags]);
      }
    }

    return results
      .sort(([a], [b]) => a.fsPath.localeCompare(b.fsPath))
      .map(([uri, diags]) => new SesamFileItem(uri, diags));
  }
}
