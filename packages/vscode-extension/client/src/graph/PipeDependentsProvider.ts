/**
 * Pipe Dependents Provider
 * TreeDataProvider for the "Pipe Dependents" view: shows the downstream
 * consumers of the currently open pipe — "who uses my output?"
 *
 * Tree structure:
 *   ▼ my-pipe                         ← active pipe (root, auto-expanded)
 *     ▼ consumer-a                    ← pipe that sources from my-pipe
 *       ▼ consumer-a-derived          ← recursive downstream
 *         ○ (no further consumers)    ← empty leaf
 *     ► another-consumer              ← second consumer
 *     ► Hop consumers                 ← pipes that join my-pipe via hops (leaf group)
 */

import * as vscode from "vscode";

import { DagTreeItem, makeItem } from "./dag-tree-item";

import type { DagIndex, DagItemPayload } from "./pipe-dag-builder";

const MAX_DEPTH = 8;

export class PipeDependentsProvider implements vscode.TreeDataProvider<DagTreeItem> {
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
        return [makeItem({ type: "empty", message: "Open a pipe config to see its dependents." })];
      }
      if (!index) {
        return [makeItem({ type: "empty", message: "Scanning workspace…" })];
      }
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

    // ── Hop consumers group ──────────────────────────────────────────────────
    if (p.type === "hop-consumers-group") {
      if (!index) {
        return [];
      }
      const hopCons = index.hopConsumers.get(p.parentId) ?? [];
      return hopCons.map((id) => makeItem({ type: "hop-ref", id }, index));
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Children of a pipe node (dependents = downstream consumers)
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

    const consumers = index.sourceDependents.get(p.id) ?? [];
    const hopCons = index.hopConsumers.get(p.id) ?? [];
    const newVisited = new Set([...p.visited, p.id]);
    const items: DagTreeItem[] = [];

    // ── Direct consumers (source-based) ──────────────────────────────────────
    for (const consumerId of consumers) {
      if (p.visited.has(consumerId)) {
        items.push(makeItem({ type: "cycle", id: consumerId }));
      } else {
        items.push(
          makeItem(
            { type: "pipe", id: consumerId, depth: p.depth - 1, visited: newVisited },
            index,
          ),
        );
      }
    }

    // ── Hop consumers group ───────────────────────────────────────────────────
    if (hopCons.length > 0) {
      items.push(makeItem({ type: "hop-consumers-group", parentId: p.id }));
    }

    if (items.length === 0) {
      items.push(makeItem({ type: "empty", message: "No downstream consumers." }));
    }

    return items;
  }
}
