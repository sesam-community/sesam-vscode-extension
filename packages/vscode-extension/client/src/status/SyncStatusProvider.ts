/**
 * Sync Status Provider (F06)
 *
 * TreeDataProvider for the "Sesam Sync Status" explorer view.
 * Groups configs into Modified / Node Only / Local Only buckets.
 *
 * Also exports SesamNodeConfigProvider — a TextDocumentContentProvider
 * that serves node-side config content for the VS Code diff editor.
 */

import * as vscode from "vscode";

import type { SyncState, SyncStatusItem } from "@sesam/core";

// ---------------------------------------------------------------------------
// Node config content provider (for diff view)
// ---------------------------------------------------------------------------

export const SESAM_NODE_SCHEME = "sesam-node";

/**
 * Serves cached node-side config content under the `sesam-node://` URI scheme.
 * Register once via `vscode.workspace.registerTextDocumentContentProvider`.
 */
export class SesamNodeConfigProvider implements vscode.TextDocumentContentProvider {
  private readonly _cache = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._cache.get(uri.path) ?? "";
  }

  /**
   * Store formatted config text and return a URI for use in `vscode.diff`.
   * Subsequent calls with the same `id` + `kind` overwrite the cached content.
   */
  store(id: string, kind: "pipe" | "system", content: string): vscode.Uri {
    const key = `/${kind}/${id}.conf.json`;
    this._cache.set(key, content);
    return vscode.Uri.from({ scheme: SESAM_NODE_SCHEME, path: key });
  }
}

// ---------------------------------------------------------------------------
// Tree item classes
// ---------------------------------------------------------------------------

/** A plain informational row (loading / empty / error state). */
class MessageItem extends vscode.TreeItem {
  constructor(message: string, icon?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);

    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

/** Top-level group row ("Modified (N)", "Node Only (N)", "Local Only (N)"). */
class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupState: SyncState,
    count: number,
  ) {
    const labels: Record<SyncState, string> = {
      modified: "Modified",
      "node-only": "Remote Only",
      "local-only": "Local Only",
    };
    const icons: Record<SyncState, string> = {
      modified: "diff-modified",
      "node-only": "cloud-download",
      "local-only": "file-add",
    };

    super(`${labels[groupState]} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(icons[groupState]);
    this.contextValue = "syncGroup";
  }
}

const itemIcons: Record<SyncState, string> = {
  modified: "diff-modified",
  "node-only": "cloud-download",
  "local-only": "file-add",
};

/** Leaf row representing a single pipe or system config. */
export class ConfigStatusItem extends vscode.TreeItem {
  constructor(public readonly syncItem: SyncStatusItem) {
    super(syncItem.id, vscode.TreeItemCollapsibleState.None);
    this.description = syncItem.kind;
    this.contextValue = `syncItem.${syncItem.state}`;
    this.iconPath = new vscode.ThemeIcon(itemIcons[syncItem.state]);

    if (syncItem.localPath) {
      this.resourceUri = vscode.Uri.file(syncItem.localPath);
      this.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [vscode.Uri.file(syncItem.localPath)],
      };
    }
  }
}

type SyncTreeItem = MessageItem | GroupItem | ConfigStatusItem;

// ---------------------------------------------------------------------------
// SyncStatusProvider
// ---------------------------------------------------------------------------

export class SyncStatusProvider implements vscode.TreeDataProvider<SyncTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _items: SyncStatusItem[] = [];
  private _state: "idle" | "loading" | "error" | "loaded" = "idle";
  private _errorMessage = "";

  setItems(items: SyncStatusItem[]): void {
    this._items = items;
    this._state = "loaded";
    this._onDidChangeTreeData.fire();
  }

  getItems(): readonly SyncStatusItem[] {
    return this._items;
  }

  isLoaded(): boolean {
    return this._state === "loaded";
  }

  setLoading(): void {
    this._state = "loading";
    this._onDidChangeTreeData.fire();
  }

  setError(message: string): void {
    this._state = "error";
    this._errorMessage = message;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SyncTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SyncTreeItem): SyncTreeItem[] {
    if (this._state === "loading") {
      return [new MessageItem("Loading status…", "loading~spin")];
    }

    if (this._state === "error") {
      return [new MessageItem(this._errorMessage, "error")];
    }

    if (this._state === "idle") {
      return [new MessageItem("Click ↻ to fetch sync status from the node.", "info")];
    }

    if (!element) {
      if (this._items.length === 0) {
        return [new MessageItem("All configs are in sync with the node.", "check")];
      }

      const groups: SyncState[] = ["modified", "node-only", "local-only"];

      return groups
        .filter((s) => this._items.some((i) => i.state === s))
        .map((s) => new GroupItem(s, this._items.filter((i) => i.state === s).length));
    }

    if (element instanceof GroupItem) {
      return this._items
        .filter((i) => i.state === element.groupState)
        .map((i) => new ConfigStatusItem(i));
    }

    return [];
  }
}
