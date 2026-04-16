/**
 * Pipe Preview Panel
 *
 * Two-pane webview: editable input entity (left) / computed output (right).
 * Supports two evaluation modes:
 *   - Offline: local dtl-evaluator.ts (default, no credentials needed)
 *   - Live:    POST /api/pipes/{id}/preview on the configured Sesam node
 *
 * Mode is persisted per workspace in workspaceState under "sesam.previewMode".
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { evaluate } from "../../../src/shared/dtl-evaluator";
import { resolveCredentials } from "../credential-resolver";
import { fetchDatasetEntities, previewPipe } from "../node-client";
import { fetchNodeStatusHint } from "../portal-client";
import { logNodeRequest } from "../sesam-channel";
import { trackRequest } from "../network-status";

import type { EvalEntity } from "../../../src/shared/dtl-evaluator";
import type { Entity } from "../node-client";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

type MessageFromWebview =
  | { type: "evaluate"; inputJson: string }
  | { type: "toggleMode" }
  | { type: "openSettings" }
  | { type: "copyOutput"; text: string }
  | { type: "copyInput"; text: string };

type PreviewMode = "offline" | "live";

const MODE_KEY = "sesam.previewMode";
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
  private _mode: PreviewMode;
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
    this._mode = context.workspaceState.get<PreviewMode>(MODE_KEY) ?? "offline";

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
    void this._sendModeState();
  }

  setNodeProvisioning(provisioning: boolean): void {
    this._nodeProvisioning = provisioning;
    void this._sendModeState();
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
      if (this._mode === "live") {
        await this._runLiveEvaluation(message.inputJson);
      } else {
        this._runOfflineEvaluation(message.inputJson);
      }

      return;
    }

    if (message.type === "toggleMode") {
      this._mode = this._mode === "offline" ? "live" : "offline";
      await this._context.workspaceState.update(MODE_KEY, this._mode);
      await this._sendModeState();

      // When switching to live, try to populate entities from the node if none loaded locally
      if (this._mode === "live") {
        const text = this._document.getText();
        const pipeId = extractPipeId(text);
        const hasEmbedded = (extractEmbeddedEntities(text) ?? []).length > 0;

        if (!hasEmbedded && pipeId) {
          const testdata = await this._loadTestdataEntities(pipeId);

          if (!testdata || testdata.length === 0) {
            const fileName = vscode.workspace.asRelativePath(this._document.uri, false);
            await this._fetchAndSendNodeEntities(fileName);
          }
        }
      }

      return;
    }

    if (message.type === "openSettings") {
      await vscode.commands.executeCommand("sesam.setToken");
      await this._sendModeState();

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
  // Offline evaluation
  // ---------------------------------------------------------------------------

  private _runOfflineEvaluation(inputJson: string): void {
    let inputEntity: EvalEntity;

    try {
      inputEntity = JSON.parse(inputJson) as EvalEntity;
    } catch (e) {
      this._panel.webview.postMessage({
        type: "error",
        message: `Invalid input JSON: ${String(e)}`,
      });

      return;
    }

    const text = this._document.getText();
    const rules = extractRules(text);

    if (!rules || !Array.isArray(rules)) {
      this._panel.webview.postMessage({
        type: "error",
        message: "Could not extract DTL rules from the active document.",
      });

      return;
    }

    const result = evaluate(rules, inputEntity);
    this._panel.webview.postMessage({ type: "result", result });
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
      await this._sendModeState();

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
  // Mode state
  // ---------------------------------------------------------------------------

  private async _sendModeState(): Promise<void> {
    const hasCredentials = (await resolveCredentials()) !== null;
    this._panel.webview.postMessage({
      type: "modeChanged",
      mode: this._mode,
      hasCredentials,
      nodeProvisioning: this._nodeProvisioning,
    });
  }

  // ---------------------------------------------------------------------------
  // Document state + entity sourcing
  // ---------------------------------------------------------------------------

  private _sendDocumentState(resetOutput = false): void {
    const text = this._document.getText();
    const fileName = vscode.workspace.asRelativePath(this._document.uri, false);
    const pipeId = extractPipeId(text);

    // Start with embedded entities; testdata loading is async and updates separately
    const embeddedEntities = extractEmbeddedEntities(text);

    this._panel.webview.postMessage({
      type: "documentState",
      fileName,
      entities: embeddedEntities,
      entitySource: embeddedEntities && embeddedEntities.length > 0 ? "embedded" : null,
      resetOutput,
    });

    // Kick off async testdata load (and node fetch fallback) if no embedded entities
    if ((!embeddedEntities || embeddedEntities.length === 0) && pipeId) {
      void this._loadTestdataEntities(pipeId).then(async (testdataEntities) => {
        if (testdataEntities && testdataEntities.length > 0) {
          this._panel.webview.postMessage({
            type: "documentState",
            fileName,
            entities: testdataEntities,
            entitySource: "testdata",
            resetOutput: false,
          });

          return;
        }

        // Live mode fallback: fetch real entities from the source dataset on the node
        if (this._mode === "live") {
          await this._fetchAndSendNodeEntities(fileName);
        }
      });
    }
  }

  private async _fetchAndSendNodeEntities(fileName: string): Promise<void> {
    const credentials = await resolveCredentials();

    if (!credentials) {
      return;
    }

    const text = this._document.getText();
    const sourceDataset = extractSourceDataset(text);

    if (!sourceDataset) {
      return;
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

      if (entities.length > 0) {
        this._panel.webview.postMessage({
          type: "documentState",
          fileName,
          entities,
          entitySource: "node",
          resetOutput: false,
        });
      }
    } catch {
      // Silently ignore — user will still see the manual input textarea
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

function extractRules(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    const transform = obj["transform"] as Record<string, unknown> | unknown[] | undefined;

    if (!transform) {
      return null;
    }

    if (Array.isArray(transform)) {
      return transform;
    }

    const rules = (transform as Record<string, unknown>)["rules"] as
      | Record<string, unknown>
      | undefined;

    if (!rules) {
      return null;
    }

    if (Array.isArray(rules["default"])) {
      return rules["default"] as unknown[];
    }

    const firstKey = Object.keys(rules)[0];

    if (firstKey && Array.isArray(rules[firstKey])) {
      return rules[firstKey] as unknown[];
    }
  } catch {
    // Not valid JSON
  }

  return null;
}

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
