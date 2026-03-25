/**
 * System Pipes Provider
 * TreeDataProvider for the "System Pipes" sidebar view.
 *
 * When a SYSTEM config is the active editor, shows:
 *   ▼ my-system                  ← root
 *     ▼ Source pipes (N)         ← pipes with source.system = this id
 *       ● rest-collect-foo
 *     ▼ Sink pipes (N)           ← pipes with sink.system = this id
 *       ● foo-to-rest
 *
 * When a PIPE config is the active editor, shows:
 *   ▼ my-pipe                    ← root
 *     ▼ Source systems           ← system referenced in source.system
 *       ● my-system
 *     ▼ Sink systems             ← system referenced in sink.system
 *       ● smtp-server
 */

import * as vscode from "vscode";

import type { DagIndex, SystemEntry } from "./pipe-dag-builder";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

type Payload =
  | { type: "system-root"; id: string }
  | { type: "pipe-root"; id: string }
  | { type: "source-pipes-group"; systemId: string }
  | { type: "sink-pipes-group"; systemId: string }
  | { type: "transform-pipes-group"; systemId: string }
  | { type: "source-systems-group"; pipeId: string }
  | { type: "sink-systems-group"; pipeId: string }
  | { type: "transform-systems-group"; pipeId: string }
  | { type: "pipe-leaf"; id: string }
  | { type: "system-leaf"; id: string }
  | { type: "empty"; message: string };

// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------

class SystemPipesItem extends vscode.TreeItem {
  constructor(
    public readonly payload: Payload,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    fileUri?: vscode.Uri,
    description?: string,
  ) {
    super(label, collapsible);
    this.iconPath = pickIcon(payload);
    this.description = description;
    if (fileUri) {
      this.command = { command: "vscode.open", title: "Open", arguments: [fileUri] };
      this.tooltip = fileUri.fsPath;
      this.resourceUri = fileUri;
    }
  }
}

function pickIcon(p: Payload): vscode.ThemeIcon {
  switch (p.type) {
    case "system-root":
    case "system-leaf":
      return new vscode.ThemeIcon("server");
    case "pipe-root":
    case "pipe-leaf":
      return new vscode.ThemeIcon("git-commit");
    case "source-pipes-group":
    case "source-systems-group":
      return new vscode.ThemeIcon("cloud-download");
    case "sink-pipes-group":
    case "sink-systems-group":
      return new vscode.ThemeIcon("cloud-upload");
    case "transform-pipes-group":
    case "transform-systems-group":
      return new vscode.ThemeIcon("symbol-event");
    case "empty":
      return new vscode.ThemeIcon("info");
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Kind of the currently active config file. */
type ActiveKind = "system" | "pipe" | null;

export class SystemPipesProvider implements vscode.TreeDataProvider<SystemPipesItem> {
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  private currentId: string | undefined;
  private currentKind: ActiveKind = null;

  constructor(
    private readonly dagRef: { current: DagIndex | null },
    private readonly systemRef: { current: Map<string, SystemEntry> | null },
  ) {}

  /** Called by the active-editor listener. `kind` is "system", "pipe", or null. */
  setCurrentConfig(id: string | undefined, kind: ActiveKind): void {
    if (this.currentId === id && this.currentKind === kind) {
      return;
    }
    this.currentId = id;
    this.currentKind = kind;
    this._onChange.fire();
  }

  refresh(): void {
    this._onChange.fire();
  }

  getTreeItem(element: SystemPipesItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SystemPipesItem): SystemPipesItem[] {
    const index = this.dagRef.current;
    const systems = this.systemRef.current;
    const C = vscode.TreeItemCollapsibleState;

    // ── Root ──────────────────────────────────────────────────────────────
    if (!element) {
      if (!this.currentId || !this.currentKind) {
        return [
          new SystemPipesItem(
            { type: "empty", message: "Open a system or pipe config to see system connections." },
            "Open a system or pipe config to see system connections.",
            C.None,
          ),
        ];
      }
      if (!index) {
        return [
          new SystemPipesItem(
            { type: "empty", message: "Scanning workspace…" },
            "Scanning workspace…",
            C.None,
          ),
        ];
      }

      if (this.currentKind === "system") {
        const entry = systems?.get(this.currentId);
        return [
          new SystemPipesItem(
            { type: "system-root", id: this.currentId },
            this.currentId,
            C.Expanded,
            entry ? vscode.Uri.parse(entry.fileUri) : undefined,
            entry?.systemType,
          ),
        ];
      }

      // pipe
      const pipe = index.byId.get(this.currentId);
      return [
        new SystemPipesItem(
          { type: "pipe-root", id: this.currentId },
          this.currentId,
          C.Expanded,
          pipe ? vscode.Uri.parse(pipe.fileUri) : undefined,
        ),
      ];
    }

    // ── System root → two groups ─────────────────────────────────────────
    const p = element.payload;

    if (p.type === "system-root") {
      return [
        groupItem("source-pipes-group", p.id, index),
        groupItem("sink-pipes-group", p.id, index),
        groupItem("transform-pipes-group", p.id, index),
      ];
    }

    // ── Pipe root → three groups ─────────────────────────────────────────
    if (p.type === "pipe-root") {
      return [
        groupItem("source-systems-group", p.id, index),
        groupItem("sink-systems-group", p.id, index),
        groupItem("transform-systems-group", p.id, index),
      ];
    }

    // ── Source pipes group ───────────────────────────────────────────────
    if (p.type === "source-pipes-group") {
      return pipeLeaves(index?.sourceSystemPipes.get(p.systemId) ?? [], index);
    }

    // ── Sink pipes group ──────────────────────────────────────────────────
    if (p.type === "sink-pipes-group") {
      return pipeLeaves(index?.sinkSystemPipes.get(p.systemId) ?? [], index);
    }

    // ── Transform pipes group ─────────────────────────────────────────────
    if (p.type === "transform-pipes-group") {
      return pipeLeaves(index?.transformSystemPipes.get(p.systemId) ?? [], index);
    }

    // ── Source systems group ──────────────────────────────────────────────
    if (p.type === "source-systems-group") {
      const pipe = index?.byId.get(p.pipeId);
      if (!pipe?.sourceSystem) {
        return [noneItem()];
      }
      return [systemLeaf(pipe.sourceSystem, systems)];
    }

    // ── Sink systems group ────────────────────────────────────────────────
    if (p.type === "sink-systems-group") {
      const pipe = index?.byId.get(p.pipeId);
      if (!pipe?.sinkSystem) {
        return [noneItem()];
      }
      return [systemLeaf(pipe.sinkSystem, systems)];
    }

    // ── Transform systems group ───────────────────────────────────────────
    if (p.type === "transform-systems-group") {
      const pipe = index?.byId.get(p.pipeId);
      if (!pipe?.transformSystems.length) {
        return [noneItem()];
      }
      return pipe.transformSystems.map((sys) => systemLeaf(sys, systems));
    }

    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupItem(
  type:
    | "source-pipes-group"
    | "sink-pipes-group"
    | "transform-pipes-group"
    | "source-systems-group"
    | "sink-systems-group"
    | "transform-systems-group",
  id: string,
  index: DagIndex | null,
): SystemPipesItem {
  const C = vscode.TreeItemCollapsibleState;

  let label: string;
  let count: number;
  let payload: Payload;

  if (type === "source-pipes-group") {
    count = index?.sourceSystemPipes.get(id)?.length ?? 0;
    label = "Source pipes";
    payload = { type, systemId: id };
  } else if (type === "sink-pipes-group") {
    count = index?.sinkSystemPipes.get(id)?.length ?? 0;
    label = "Sink pipes";
    payload = { type, systemId: id };
  } else if (type === "transform-pipes-group") {
    count = index?.transformSystemPipes.get(id)?.length ?? 0;
    label = "Transform pipes";
    payload = { type, systemId: id };
  } else if (type === "source-systems-group") {
    const pipe = index?.byId.get(id);
    count = pipe?.sourceSystem ? 1 : 0;
    label = "Source systems";
    payload = { type, pipeId: id };
  } else if (type === "sink-systems-group") {
    const pipe = index?.byId.get(id);
    count = pipe?.sinkSystem ? 1 : 0;
    label = "Sink systems";
    payload = { type, pipeId: id };
  } else {
    // transform-systems-group
    const pipe = index?.byId.get(id);
    count = pipe?.transformSystems.length ?? 0;
    label = "Transform systems";
    payload = { type, pipeId: id };
  }

  const item = new SystemPipesItem(payload, label, count > 0 ? C.Collapsed : C.None);
  item.description = `(${count})`;
  return item;
}

function pipeLeaves(ids: string[], index: DagIndex | null): SystemPipesItem[] {
  if (ids.length === 0) {
    return [noneItem()];
  }
  return ids.map((id) => {
    const pipe = index?.byId.get(id);
    return new SystemPipesItem(
      { type: "pipe-leaf", id },
      id,
      vscode.TreeItemCollapsibleState.None,
      pipe ? vscode.Uri.parse(pipe.fileUri) : undefined,
      pipe ? undefined : "not in workspace",
    );
  });
}

function systemLeaf(
  id: string,
  systems: Map<string, SystemEntry> | null | undefined,
): SystemPipesItem {
  const entry = systems?.get(id);
  return new SystemPipesItem(
    { type: "system-leaf", id },
    id,
    vscode.TreeItemCollapsibleState.None,
    entry ? vscode.Uri.parse(entry.fileUri) : undefined,
    entry ? entry.systemType : "not in workspace",
  );
}

function noneItem(): SystemPipesItem {
  return new SystemPipesItem(
    { type: "empty", message: "None" },
    "None",
    vscode.TreeItemCollapsibleState.None,
  );
}
