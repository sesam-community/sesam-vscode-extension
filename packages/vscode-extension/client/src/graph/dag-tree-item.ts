/**
 * DAG Tree Item
 * Shared VS Code TreeItem class and factory for the Lineage and Dependents
 * tree views.
 */

import * as vscode from "vscode";

import type { DagIndex, DagItemPayload } from "./pipe-dag-builder";

// ---------------------------------------------------------------------------
// Tree item class
// ---------------------------------------------------------------------------

export class DagTreeItem extends vscode.TreeItem {
  constructor(
    public readonly payload: DagItemPayload,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    fileUri?: vscode.Uri,
  ) {
    super(label, collapsible);
    this.iconPath = pickIcon(payload);
    if (fileUri) {
      this.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [fileUri],
      };
      this.tooltip = fileUri.fsPath;
      this.resourceUri = fileUri;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a DagTreeItem from a payload.
 *
 * @param payload   The item data (discriminated union)
 * @param index     DagIndex used to resolve file URIs and determine expandability
 * @param expanded  When true, start the node expanded (use for root items only)
 */
export function makeItem(
  payload: DagItemPayload,
  index?: DagIndex | null,
  expanded = false,
): DagTreeItem {
  const C = vscode.TreeItemCollapsibleState;
  let label: string;
  let collapsible: vscode.TreeItemCollapsibleState;
  let description: string | undefined;
  let fileUri: vscode.Uri | undefined;

  switch (payload.type) {
    case "pipe": {
      label = payload.id;
      // Show expand arrow if depth allows — getChildren always returns ≥1 item
      collapsible = payload.depth > 0 ? (expanded ? C.Expanded : C.Collapsed) : C.None;
      const pipe = index?.byId.get(payload.id);
      if (pipe) {
        fileUri = vscode.Uri.parse(pipe.fileUri);
      }
      break;
    }
    case "hops-group":
      label = "Joins";
      collapsible = C.Collapsed;
      break;
    case "hop-consumers-group":
      label = "Hop consumers";
      collapsible = C.Collapsed;
      break;
    case "hop-ref": {
      label = payload.id;
      collapsible = C.None;
      const pipe = index?.byId.get(payload.id);
      if (pipe) {
        fileUri = vscode.Uri.parse(pipe.fileUri);
      } else {
        description = "not in workspace";
      }
      break;
    }
    case "external":
      label = payload.sourceType || "external";
      collapsible = C.None;
      description = "external source";
      break;
    case "unresolved":
      label = payload.datasetId;
      collapsible = C.None;
      description = "not in workspace";
      break;
    case "cycle":
      label = payload.id;
      collapsible = C.None;
      description = "cycle detected";
      break;
    case "depth-limit":
      label = "…";
      collapsible = C.None;
      description = "max depth reached";
      break;
    case "empty":
      label = payload.message;
      collapsible = C.None;
      break;
  }

  const item = new DagTreeItem(payload, label, collapsible, fileUri);
  item.description = description;
  return item;
}

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

function pickIcon(payload: DagItemPayload): vscode.ThemeIcon {
  switch (payload.type) {
    case "pipe":
      return new vscode.ThemeIcon("git-commit");
    case "hops-group":
    case "hop-consumers-group":
      return new vscode.ThemeIcon("references");
    case "hop-ref":
      return new vscode.ThemeIcon("git-commit");
    case "external":
      return new vscode.ThemeIcon("cloud-download");
    case "unresolved":
      return new vscode.ThemeIcon("warning");
    case "cycle":
      return new vscode.ThemeIcon("issue-opened");
    case "depth-limit":
      return new vscode.ThemeIcon("ellipsis");
    case "empty":
      return new vscode.ThemeIcon("info");
  }
}
