/**
 * Pipe Graph Provider
 * Implements a VS Code TreeDataProvider that scans the workspace for Sesam pipe
 * and system config files and shows their DTL hop relationships in the sidebar.
 */

import * as path from "path";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

export type NodeKind = "pipe" | "system" | "dataset-ref" | "rule";

export class PipeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly kind: NodeKind,
    public readonly fileUri?: vscode.Uri,
    public readonly collapsible: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState
      .None,
  ) {
    super(label, collapsible);
    this.contextValue = kind;
    this.iconPath = this.pickIcon(kind);

    if (fileUri && (kind === "pipe" || kind === "system")) {
      this.tooltip = fileUri.fsPath;
      this.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [fileUri],
      };
      this.resourceUri = fileUri;
    }
  }

  private pickIcon(kind: NodeKind): vscode.ThemeIcon {
    switch (kind) {
      case "pipe":
        return new vscode.ThemeIcon("git-merge");
      case "system":
        return new vscode.ThemeIcon("server");
      case "dataset-ref":
        return new vscode.ThemeIcon("database");
      case "rule":
        return new vscode.ThemeIcon("symbol-method");
      default:
        return new vscode.ThemeIcon("file");
    }
  }
}

// ---------------------------------------------------------------------------
// Parsed pipe info
// ---------------------------------------------------------------------------

interface PipeInfo {
  id: string;
  fileUri: vscode.Uri;
  kind: "pipe" | "system";
  /** Dataset names referenced inside hops */
  hopDatasets: string[];
  /** Named rules defined in transform.rules */
  ruleNames: string[];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class PipeGraphProvider implements vscode.TreeDataProvider<PipeTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PipeTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pipes: PipeInfo[] = [];
  private datasetIndex: Map<string, vscode.Uri> = new Map();
  private initialized = false;

  refresh(): void {
    this.initialized = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PipeTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PipeTreeItem): Promise<PipeTreeItem[]> {
    if (!this.initialized) {
      await this.scanWorkspace();
      this.initialized = true;
    }

    if (!element) {
      // Root: list all pipes and systems
      return this.pipes.map(
        (p) =>
          new PipeTreeItem(
            p.id,
            p.kind,
            p.fileUri,
            p.hopDatasets.length > 0 || p.ruleNames.length > 0
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.None,
          ),
      );
    }

    // Children of a pipe: hop targets + defined rules
    const pipe = this.pipes.find((p) => p.id === element.label);
    if (!pipe) return [];

    const children: PipeTreeItem[] = [];

    // Dataset references from hops
    for (const ds of pipe.hopDatasets) {
      const resolvedUri = this.datasetIndex.get(ds);
      const item = new PipeTreeItem(
        ds,
        "dataset-ref",
        resolvedUri,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = resolvedUri ? "✓ resolved" : "⚠ unresolved";
      item.tooltip = resolvedUri
        ? `Dataset found: ${resolvedUri.fsPath}`
        : `No file found defining dataset "${ds}"`;
      if (resolvedUri) {
        item.command = {
          command: "vscode.open",
          title: "Open dataset",
          arguments: [resolvedUri],
        };
      }
      children.push(item);
    }

    // Named rules
    for (const rule of pipe.ruleNames) {
      const item = new PipeTreeItem(rule, "rule");
      item.tooltip = `DTL rule: ${rule}`;
      children.push(item);
    }

    return children;
  }

  // ── Workspace Scanning ──────────────────────────────────────────────────

  private async scanWorkspace(): Promise<void> {
    this.pipes = [];
    this.datasetIndex = new Map();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const config = vscode.workspace.getConfiguration("dtl");
    const scanDepth: number = config.get("graph.scanDepth", 3);

    // Find all JSON files
    const globDepth = Array.from({ length: scanDepth }, (_, i) => "*").join("/");
    const files = await vscode.workspace.findFiles(`**/*.json`, `**/node_modules/**`);

    // Also find .dtl files
    const dtlFiles = await vscode.workspace.findFiles("**/*.dtl", "**/node_modules/**");

    const allFiles = [...files, ...dtlFiles];

    for (const fileUri of allFiles) {
      try {
        const contents = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(contents).toString("utf-8");
        const parsed = JSON.parse(text);
        const info = extractPipeInfo(parsed, fileUri);
        if (info) {
          this.pipes.push(info);
          // Index this pipe's _id for resolution by other pipes' hops
          this.datasetIndex.set(info.id, fileUri);
        }
      } catch {
        // Not valid JSON or not a pipe config — skip
      }
    }

    // Sort pipes alphabetically
    this.pipes.sort((a, b) => a.id.localeCompare(b.id));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPipeInfo(parsed: unknown, fileUri: vscode.Uri): PipeInfo | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const id = typeof obj["_id"] === "string" ? obj["_id"] : null;
  if (!id) return null;

  const type = typeof obj["type"] === "string" ? obj["type"] : "pipe";
  const kind: "pipe" | "system" = type === "system" ? "system" : "pipe";

  const hopDatasets: Set<string> = new Set();
  const ruleNames: string[] = [];

  // Extract named rules from transform.rules
  const transform = obj["transform"] as Record<string, unknown> | undefined;
  if (transform && typeof transform === "object") {
    const rules = transform["rules"];
    if (rules && typeof rules === "object") {
      ruleNames.push(...Object.keys(rules as Record<string, unknown>));
      // Walk rules looking for hops
      for (const ruleName of Object.keys(rules as Record<string, unknown>)) {
        const ruleArr = (rules as Record<string, unknown>)[ruleName];
        if (Array.isArray(ruleArr)) {
          collectHopDatasets(ruleArr, hopDatasets);
        }
      }
    }
  }

  return {
    id,
    fileUri,
    kind,
    hopDatasets: [...hopDatasets],
    ruleNames,
  };
}

/** Recursively walk a DTL rules array and collect dataset names mentioned in hops. */
function collectHopDatasets(arr: unknown[], out: Set<string>): void {
  for (const item of arr) {
    if (!Array.isArray(item)) continue;

    const head = item[0];
    if (head === "hops" || head === "apply-hops") {
      // hops spec is the second element (index 1 for hops, index 2 for apply-hops)
      const specIdx = head === "hops" ? 1 : 2;
      const spec = item[specIdx];
      if (spec && typeof spec === "object" && !Array.isArray(spec)) {
        const datasets = (spec as Record<string, unknown>)["datasets"];
        if (Array.isArray(datasets)) {
          for (const ds of datasets) {
            if (typeof ds === "string") {
              // Dataset entry can be "datasetName ALIAS" — extract the name part
              const parts = ds.trim().split(/\s+/);
              if (parts.length > 0) out.add(parts[0]);
            }
          }
        }
      }
    }

    // Recurse into nested arrays
    for (const child of item) {
      if (Array.isArray(child)) {
        collectHopDatasets(child as unknown[], out);
      }
    }
  }
}
