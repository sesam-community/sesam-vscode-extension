/**
 * Pipe Lineage Provider
 * TreeDataProvider for the "Pipe Lineage" view: shows the upstream ancestry of
 * the currently open pipe — "where does this data come from?"
 *
 * Tree structure:
 *   ▼ my-pipe                   ← active pipe (root, auto-expanded)
 *     ▼ upstream-collect        ← source dataset (resolves to a pipe)
 *       ▼ upstream-collect-2    ← recursive
 *         ○ (external source)   ← leaf: http_endpoint / sql / etc.
 *       ► Joins                 ← hop datasets (leaf group)
 *     ► other-merge-input       ← second source (merge source)
 *     ► Joins                   ← hop datasets of my-pipe
 */

import * as vscode from "vscode";

import { DATASET_SOURCE_TYPES } from "./pipe-dag-builder";
import { DagTreeItem, makeItem } from "./dag-tree-item";

import type { DagIndex, DagItemPayload } from "./pipe-dag-builder";

const MAX_DEPTH = 8;

export class PipeLineageProvider implements vscode.TreeDataProvider<DagTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentPipeId: string | undefined;

  constructor(private readonly dagRef: { current: DagIndex | null }) {}

  /** Called by the active-editor listener when the user switches files. */
  setCurrentPipe(id: string | undefined): void {
    if (this.currentPipeId === id) {
      return;
    }
    this.currentPipeId = id;
    this._onDidChangeTreeData.fire();
  }

  /** Called when the DagIndex has been rebuilt (file change / refresh command). */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DagTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DagTreeItem): DagTreeItem[] {
    const index = this.dagRef.current;

    // ── Root ────────────────────────────────────────────────────────────────
    if (!element) {
      if (!this.currentPipeId) {
        return [makeItem({ type: "empty", message: "Open a pipe config to see its lineage." })];
      }
      if (!index) {
        return [makeItem({ type: "empty", message: "Scanning workspace…" })];
      }
      // Root pipe — starts expanded so the first level is immediately visible
      return [
        makeItem(
          { type: "pipe", id: this.currentPipeId, depth: MAX_DEPTH, visited: new Set() },
          index,
          /* expanded */ true,
        ),
      ];
    }

    // ── Pipe node ────────────────────────────────────────────────────────────
    const p = element.payload;

    if (p.type === "pipe") {
      return this.pipeChildren(p, index);
    }

    // ── Hops group ───────────────────────────────────────────────────────────
    if (p.type === "hops-group") {
      if (!index) {
        return [];
      }
      const pipe = index.byId.get(p.parentId);
      if (!pipe) {
        return [];
      }
      return pipe.hopDatasets.map((ds) => makeItem({ type: "hop-ref", id: ds }, index));
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Children of a pipe node (lineage = upstream sources)
  // ---------------------------------------------------------------------------

  private pipeChildren(
    p: Extract<DagItemPayload, { type: "pipe" }>,
    index: DagIndex | null,
  ): DagTreeItem[] {
    if (!index) {
      return [makeItem({ type: "empty", message: "Scanning workspace…" })];
    }

    if (p.depth === 0) {
      return [makeItem({ type: "depth-limit", id: p.id })];
    }

    const pipe = index.byId.get(p.id);
    if (!pipe) {
      return [makeItem({ type: "unresolved", datasetId: p.id })];
    }

    const newVisited = new Set([...p.visited, p.id]);
    const items: DagTreeItem[] = [];

    // ── Source dataset items ─────────────────────────────────────────────────
    if (pipe.sourceDatasets.length > 0) {
      for (const ds of pipe.sourceDatasets) {
        if (p.visited.has(ds)) {
          items.push(makeItem({ type: "cycle", id: ds }));
        } else if (index.byId.has(ds)) {
          items.push(
            makeItem({ type: "pipe", id: ds, depth: p.depth - 1, visited: newVisited }, index),
          );
        } else {
          items.push(makeItem({ type: "unresolved", datasetId: ds }));
        }
      }
    } else if (!DATASET_SOURCE_TYPES.has(pipe.sourceType)) {
      // External source (http_endpoint, sql, rest, etc.) — show single leaf
      items.push(makeItem({ type: "external", sourceType: pipe.sourceType || "unknown" }));
    }

    // ── Hops group ───────────────────────────────────────────────────────────
    if (pipe.hopDatasets.length > 0) {
      items.push(makeItem({ type: "hops-group", parentId: p.id }));
    }

    if (items.length === 0) {
      items.push(makeItem({ type: "empty", message: "No upstream sources." }));
    }

    return items;
  }
}
