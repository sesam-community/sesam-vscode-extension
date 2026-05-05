/**
 * Pipe Preview Panel
 *
 * Two-pane webview: editable input entity (left) / computed output (right).
 * Evaluation is always performed live against the configured Sesam node
 * via POST /api/pipes/{id}/preview.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { resolveCredentials } from "../profile-manager/credential-resolver";
import { fetchDatasetEntities, previewPipe } from "../node-client";
import { fetchNodeStatusHint } from "../portal-client";
import { logNodeRequest } from "../sesam-channel";
import { trackRequest } from "../network-status";

import type { Entity } from "../node-client";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

type MessageFromWebview =
  | { type: "evaluate"; inputJson: string }
  | { type: "openSettings" }
  | { type: "copyOutput"; text: string }
  | { type: "copyInput"; text: string };

const DEBOUNCE_MS = 300;

export class PreviewPanel {
  static currentPanel: PreviewPanel | undefined;
  /** Set by extension.ts to start the provisioning poller when live preview fails. */
  static onProvisioningNeeded: ((nodeUrl: string, jwt: string) => void) | undefined;
  private static readonly viewType = "dtlPreview";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private _document: vscode.TextDocument;
  private _nodeProvisioning = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _lastOutputJson: string | undefined;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    context: vscode.ExtensionContext,
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (PreviewPanel.currentPanel) {
      PreviewPanel.currentPanel._panel.reveal(column ? column + 1 : vscode.ViewColumn.Two);
      PreviewPanel.currentPanel.updateDocument(document);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      "Pipe preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "resources")],
      },
    );

    PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri, document, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    context: vscode.ExtensionContext,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._document = document;
    this._context = context;
    this._panel.webview.html = this._buildHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: MessageFromWebview) => {
        void this._handleMessage(message);
      },
      null,
      this._disposables,
    );

    // Live-preview: re-evaluate on every document edit (debounced)
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== this._document.uri.toString()) {
          return;
        }

        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
          this._panel.webview.postMessage({ type: "autoEvaluate" });
        }, DEBOUNCE_MS);
      }),
    );

    this._sendDocumentState();
  }

  setNodeProvisioning(provisioning: boolean): void {
    this._nodeProvisioning = provisioning;
  }

  updateDocument(document: vscode.TextDocument): void {
    if (
      document.languageId !== "sesam-config" &&
      document.languageId !== "dtl" &&
      document.languageId !== "json"
    ) {
      return;
    }

    const isSwitch = document.uri.toString() !== this._document.uri.toString();
    this._document = document;
    this._sendDocumentState(isSwitch);
  }

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------

  private async _handleMessage(message: MessageFromWebview): Promise<void> {
    if (message.type === "evaluate") {
      await this._runLiveEvaluation(message.inputJson);
      return;
    }

    if (message.type === "openSettings") {
      await vscode.commands.executeCommand("sesam.setToken");
      return;
    }

    if (message.type === "copyOutput") {
      await vscode.env.clipboard.writeText(message.text);

      return;
    }

    if (message.type === "copyInput") {
      await vscode.env.clipboard.writeText(message.text);

      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Live evaluation
  // ---------------------------------------------------------------------------

  private async _runLiveEvaluation(inputJson: string): Promise<void> {
    if (this._nodeProvisioning) {
      this._panel.webview.postMessage({
        type: "liveError",
        kind: "provisioning",
        message:
          "Node is provisioning \u2014 live preview is unavailable. Please wait until the node is ready.",
      });

      return;
    }

    const credentials = await resolveCredentials();

    if (!credentials) {
      this._panel.webview.postMessage({
        type: "liveError",
        kind: "auth",
        message: "No credentials configured. Use 'Sesam: Set JWT Token' to set up a profile.",
      });
      return;
    }

    let inputEntity: Entity;

    try {
      inputEntity = JSON.parse(inputJson) as Entity;
    } catch (e) {
      this._panel.webview.postMessage({
        type: "error",
        message: `Invalid input JSON: ${String(e)}`,
      });

      return;
    }

    let pipeConfig: Record<string, unknown>;
    let pipeId: string | null;

    try {
      pipeConfig = JSON.parse(this._document.getText()) as Record<string, unknown>;
      pipeId = extractPipeId(this._document.getText());
    } catch {
      this._panel.webview.postMessage({
        type: "error",
        message: "Could not parse the active document as JSON.",
      });

      return;
    }

    if (!pipeId) {
      this._panel.webview.postMessage({
        type: "error",
        message: "Could not determine pipe _id from the active document.",
      });

      return;
    }

    this._panel.webview.postMessage({ type: "loading" });

    try {
      const doneTrack = trackRequest("POST", `preview/${pipeId}`);
      let outputEntities: Awaited<ReturnType<typeof previewPipe>>;

      try {
        outputEntities = await previewPipe(
          credentials.nodeUrl,
          credentials.jwt,
          pipeId,
          pipeConfig,
          [inputEntity],
          logNodeRequest,
        );
        doneTrack(true);
      } catch (previewErr) {
        doneTrack(false);
        throw previewErr;
      }

      const errorEntity = outputEntities.find(
        (e) => (e as Record<string, unknown>)["_id"] === "error",
      );

      if (errorEntity) {
        const msg = (errorEntity as Record<string, unknown>)["message"];
        this._panel.webview.postMessage({
          type: "liveError",
          kind: "dtl",
          message: typeof msg === "string" ? msg : "DTL evaluation failed.",
        });

        return;
      }

      const output = outputEntities.length > 0 ? outputEntities : null;
      this._lastOutputJson = output !== null ? JSON.stringify(output, null, 2) : undefined;

      this._panel.webview.postMessage({ type: "liveResult", output });
    } catch (err) {
      const base = toLiveError(err);
      let message = base.message;

      if (base.kind !== "auth") {
        const hint = await fetchNodeStatusHint(credentials.nodeUrl, credentials.jwt);

        if (hint) {
          message += `\n\n${hint}`;
          PreviewPanel.onProvisioningNeeded?.(credentials.nodeUrl, credentials.jwt);
        }
      }

      this._panel.webview.postMessage({ type: "liveError", kind: base.kind, message });
    }
  }

  // ---------------------------------------------------------------------------
  // Document state + entity sourcing
  // ---------------------------------------------------------------------------

  private _sendDocumentState(resetOutput = false): void {
    const text = this._document.getText();
    const fileName = vscode.workspace.asRelativePath(this._document.uri, false);
    const pipeId = extractPipeId(text);

    // Start with embedded entities; async loading updates separately
    const embeddedEntities = extractEmbeddedEntities(text);
    const willLoadAsync = (!embeddedEntities || embeddedEntities.length === 0) && !!pipeId;

    this._panel.webview.postMessage({
      type: "documentState",
      fileName,
      entities: embeddedEntities,
      entitySource: embeddedEntities && embeddedEntities.length > 0 ? "embedded" : null,
      loadingEntities: willLoadAsync,
      resetOutput,
    });

    if (!willLoadAsync) {
      return;
    }

    // Kick off async load; always send a final message so the loader clears
    void this._loadEntitiesAsync(pipeId!).then((result) => {
      this._panel.webview.postMessage({
        type: "documentState",
        fileName,
        entities: result?.entities ?? [],
        entitySource: result?.entitySource ?? null,
        loadingEntities: false,
        resetOutput: false,
      });
    });
  }

  /** Tries testdata first, then node source dataset. Always resolves (never throws). */
  private async _loadEntitiesAsync(
    pipeId: string,
  ): Promise<{ entities: Entity[]; entitySource: string } | null> {
    const testdata = await this._loadTestdataEntities(pipeId);

    if (testdata && testdata.length > 0) {
      return { entities: testdata as Entity[], entitySource: "testdata" };
    }

    const credentials = await resolveCredentials();

    if (!credentials) {
      return null;
    }

    const text = this._document.getText();
    const sourceDataset = extractSourceDataset(text);

    if (!sourceDataset) {
      return null;
    }

    try {
      const entities = await fetchDatasetEntities(
        credentials.nodeUrl,
        credentials.jwt,
        sourceDataset,
        undefined,
        undefined,
        logNodeRequest,
      );

      return entities.length > 0 ? { entities, entitySource: "node" } : null;
    } catch {
      return null;
    }
  }

  private async _loadTestdataEntities(pipeId: string): Promise<Entity[] | null> {
    const pattern = `**/testdata/${pipeId}.json`;
    const matches = await vscode.workspace.findFiles(pattern, null, 1);

    if (matches.length === 0) {
      return null;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(matches[0]);
      const parsed: unknown = JSON.parse(Buffer.from(raw).toString("utf8"));

      if (Array.isArray(parsed)) {
        return parsed as Entity[];
      }

      // Single entity — wrap in array
      return [parsed as Entity];
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose(): void {
    PreviewPanel.currentPanel = undefined;
    clearTimeout(this._debounceTimer);
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(): string {
    const htmlPath = path.join(this._extensionUri.fsPath, "resources", "preview.html");
    return fs.readFileSync(htmlPath, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractEmbeddedEntities(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const source = (parsed as Record<string, unknown>)["source"] as
      | Record<string, unknown>
      | undefined;

    if (!source || source["type"] !== "embedded") {
      return null;
    }

    const entities = source["entities"];

    if (Array.isArray(entities) && entities.length > 0) {
      return entities as unknown[];
    }
  } catch {
    // Not valid JSON
  }

  return null;
}

function extractPipeId(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const id = (parsed as Record<string, unknown>)["_id"];

    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

function extractSourceDataset(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const source = (parsed as Record<string, unknown>)["source"] as
      | Record<string, unknown>
      | undefined;

    if (!source) {
      return null;
    }

    const dataset = source["dataset"];

    return typeof dataset === "string" ? dataset : null;
  } catch {
    return null;
  }
}

function toLiveError(err: unknown): { kind: string; message: string } {
  if (
    err instanceof Error &&
    "kind" in err &&
    typeof (err as Record<string, unknown>)["kind"] === "string"
  ) {
    return {
      kind: (err as Record<string, unknown>)["kind"] as string,
      message: err.message,
    };
  }

  return {
    kind: "network",
    message: err instanceof Error ? err.message : String(err),
  };
}
