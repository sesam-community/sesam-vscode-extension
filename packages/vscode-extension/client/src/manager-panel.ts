import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageFromWebview =
  | { type: "ready" }
  | { type: "command"; command: "upload" | "download" | "nodeStatus" | "systemStatus" };

// ---------------------------------------------------------------------------
// ManagerPanel
// ---------------------------------------------------------------------------

export class ManagerPanel {
  static currentPanel: ManagerPanel | undefined;
  private static readonly _viewType = "sesamManager";
  private static _transferInProgress = false;
  private static _nodeProvisioning = false;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  // ── Static factory ────────────────────────────────────────────────────────

  static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.Beside;

    if (ManagerPanel.currentPanel) {
      ManagerPanel.currentPanel._panel.reveal(column);
      ManagerPanel.currentPanel._sendState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ManagerPanel._viewType,
      "Node Management",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(extensionUri.fsPath),
          vscode.Uri.file(vscode.env.appRoot),
        ],
      },
    );

    ManagerPanel.currentPanel = new ManagerPanel(panel, extensionUri);
  }

  static updateTransferState(inProgress: boolean): void {
    ManagerPanel._transferInProgress = inProgress;
    ManagerPanel.currentPanel?._sendState();
  }

  static setNodeProvisioning(provisioning: boolean): void {
    ManagerPanel._nodeProvisioning = provisioning;
    ManagerPanel.currentPanel?._sendState();
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.webview.html = this._buildHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: MessageFromWebview) => {
        this._handleMessage(message);
      },
      null,
      this._disposables,
    );
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private _handleMessage(message: MessageFromWebview): void {
    if (message.type === "ready") {
      this._sendState();
      return;
    }

    if (message.type === "command") {
      const commandMap: Record<string, string> = {
        upload: "sesam.upload",
        download: "sesam.download",
        nodeStatus: "sesam.nodeStatus",
        systemStatus: "sesam.systemStatus",
      };

      const vsCommand = commandMap[message.command];

      if (vsCommand) {
        void vscode.commands.executeCommand(vsCommand);
      }
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────

  private _sendState(): void {
    this._panel.webview.postMessage({
      type: "state",
      transferInProgress: ManagerPanel._transferInProgress,
      nodeProvisioning: ManagerPanel._nodeProvisioning,
    });
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  dispose(): void {
    ManagerPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(): string {
    const htmlPath = path.join(this._extensionUri.fsPath, "resources", "manager-panel.html");

    // Resolve the codicon font that ships with VS Code itself so icons match
    // the ones used in the file explorer toolbar.
    const codiconFontPath = path.join(
      vscode.env.appRoot,
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
      "codicon.ttf",
    );
    const codiconFontUri = this._panel.webview.asWebviewUri(vscode.Uri.file(codiconFontPath));
    const webviewUri = this._panel.webview;
    const csp = [
      `default-src 'none'`,
      `font-src ${webviewUri.cspSource}`,
      `style-src 'unsafe-inline'`,
      `script-src 'unsafe-inline'`,
    ].join("; ");

    return fs
      .readFileSync(htmlPath, "utf8")
      .replace("{{codiconFontUri}}", codiconFontUri.toString())
      .replace("{{csp}}", csp);
  }
}
