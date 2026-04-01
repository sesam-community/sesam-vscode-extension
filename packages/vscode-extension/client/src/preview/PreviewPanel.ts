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

import * as vscode from "vscode";

import { evaluate } from "../../../src/shared/dtl-evaluator";
import { resolveCredentials } from "../credential-resolver";
import { fetchDatasetEntities, previewPipe } from "../node-client";
import { logNodeRequest } from "../sesam-channel";

import type { EvalEntity } from "../../../src/shared/dtl-evaluator";
import type { Entity } from "../node-client";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

type MessageFromWebview =
  | { type: "evaluate"; inputJson: string }
  | { type: "toggleMode" }
  | { type: "toggleAutoRefresh"; enabled: boolean }
  | { type: "openSettings" }
  | { type: "copyOutput"; text: string }
  | { type: "copyInput"; text: string };

type PreviewMode = "offline" | "live";

const MODE_KEY = "sesam.previewMode";
const AUTO_REFRESH_KEY = "sesam.previewAutoRefresh";
const DEBOUNCE_MS = 300;

export class PreviewPanel {
  static currentPanel: PreviewPanel | undefined;
  private static readonly viewType = "dtlPreview";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private _document: vscode.TextDocument;
  private _mode: PreviewMode;
  private _autoRefresh: boolean;
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
    this._autoRefresh = context.workspaceState.get<boolean>(AUTO_REFRESH_KEY) ?? false;

    this._panel.webview.html = this._buildHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: MessageFromWebview) => {
        void this._handleMessage(message);
      },
      null,
      this._disposables,
    );

    // Auto-refresh subscription
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument((saved) => {
        if (!this._autoRefresh) {
          return;
        }

        if (saved.uri.toString() !== this._document.uri.toString()) {
          return;
        }

        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
          this._sendDocumentState();
        }, DEBOUNCE_MS);
      }),
    );

    this._sendDocumentState();
    this._sendModeState();
    this._panel.webview.postMessage({ type: "autoRefreshState", enabled: this._autoRefresh });
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
      this._sendModeState();

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
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "sesam.nodeUrl sesam.jwt",
      );

      return;
    }

    if (message.type === "toggleAutoRefresh") {
      this._autoRefresh = message.enabled;
      await this._context.workspaceState.update(AUTO_REFRESH_KEY, this._autoRefresh);

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
    const credentials = resolveCredentials();

    if (!credentials) {
      this._sendModeState();

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

    try {
      pipeConfig = JSON.parse(this._document.getText()) as Record<string, unknown>;
    } catch {
      this._panel.webview.postMessage({
        type: "error",
        message: "Could not parse the active document as JSON.",
      });

      return;
    }

    this._panel.webview.postMessage({ type: "loading" });

    try {
      const outputEntities = await previewPipe(
        credentials.nodeUrl,
        credentials.jwt,
        pipeConfig,
        [inputEntity],
        logNodeRequest,
      );

      const output = outputEntities[0] ?? null;
      this._lastOutputJson = output !== null ? JSON.stringify(output, null, 2) : undefined;

      this._panel.webview.postMessage({ type: "liveResult", output });
    } catch (err) {
      const liveError = toLiveError(err);
      this._panel.webview.postMessage({ type: "liveError", ...liveError });
    }
  }

  // ---------------------------------------------------------------------------
  // Mode state
  // ---------------------------------------------------------------------------

  private _sendModeState(): void {
    const hasCredentials = resolveCredentials() !== null;
    this._panel.webview.postMessage({ type: "modeChanged", mode: this._mode, hasCredentials });
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
    const credentials = resolveCredentials();

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
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pipe preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--vscode-titleBar-activeBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    header h1 { font-size: 14px; font-weight: 600; }
    .file-name {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .header-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .btn {
      padding: 3px 10px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      font-size: 12px;
      white-space: nowrap;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #3a3d41); }
    .btn-live {
      background: #1e4d78;
      color: #9cdcfe;
      border-color: #264f73;
    }
    .btn-live:hover { background: #1a4268; }
    .auto-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
    }
    .no-creds-banner {
      display: none;
      padding: 5px 12px;
      font-size: 12px;
      background: #3a2e00;
      color: #ffc66d;
      border-bottom: 1px solid #5c4700;
      flex-shrink: 0;
    }
    .no-creds-banner a {
      color: #9cdcfe;
      cursor: pointer;
      text-decoration: underline;
    }
    .entity-nav {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .entity-nav button {
      padding: 1px 6px;
      cursor: pointer;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 2px;
      font-size: 11px;
    }
    .entity-nav button:disabled { opacity: 0.4; cursor: default; }
    .entity-source-label {
      font-size: 10px;
      opacity: 0.7;
      margin-left: 2px;
    }
    .panes {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      overflow: hidden;
    }
    .pane {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--vscode-panel-border);
      overflow: hidden;
    }
    .pane:last-child { border-right: none; }
    .pane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .copy-btn {
      font-size: 11px;
      padding: 1px 6px;
      cursor: pointer;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 2px;
      opacity: 0.6;
    }
    .copy-btn:hover { opacity: 1; background: var(--vscode-button-secondaryBackground); }
    textarea, .output-box {
      flex: 1;
      padding: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      border: none;
      outline: none;
      resize: none;
      overflow: auto;
      white-space: pre;
      position: relative;
    }
    .output-box { user-select: text; }
    .output-wrapper { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
    .spinner-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.35);
      align-items: center;
      justify-content: center;
      font-size: 12px;
      color: #ccc;
    }
    .spinner-overlay.visible { display: flex; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner-icon {
      width: 18px; height: 18px;
      border: 2px solid #555;
      border-top-color: #9cdcfe;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-right: 8px;
    }
    .error-banner {
      display: none;
      padding: 6px 12px;
      font-size: 12px;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: #f48771;
      border-top: 1px solid #8b3333;
      flex-shrink: 0;
    }
    .error-banner a {
      color: #9cdcfe;
      cursor: pointer;
      text-decoration: underline;
      margin-left: 8px;
    }
    .status-bar {
      padding: 4px 12px;
      font-size: 11px;
      color: var(--vscode-statusBar-foreground);
      background: var(--vscode-statusBar-background);
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      min-height: 22px;
    }
    .status-bar.ok      { background: var(--vscode-statusBarItem-remoteBackground, #007c00); color: #fff; }
    .status-bar.error   { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: #f48771; }
    .status-bar.discard { background: #6b4c00; color: #ffc66d; }
    .status-bar.loading { background: #1e3a5f; color: #9cdcfe; }
    .warning {
      padding: 4px 10px;
      font-size: 11px;
      color: #ffc66d;
      background: #3a2e00;
      border-top: 1px solid #5c4700;
    }
  </style>
</head>
<body>
  <header>
    <h1>Pipe preview</h1>
    <span class="file-name" id="file-name"></span>
    <div class="header-actions">
      <label class="auto-label" title="Re-evaluate automatically when the pipe file is saved">
        <input type="checkbox" id="auto-refresh-cb" onchange="toggleAutoRefresh(this.checked)" />
        Auto
      </label>
      <button class="btn btn-secondary" id="mode-btn" onclick="toggleMode()">🔌 Offline</button>
      <button class="btn btn-primary" id="run-btn" onclick="runEval()">▶ Evaluate</button>
    </div>
  </header>

  <div class="no-creds-banner" id="no-creds-banner">
    ⚠ Set <code>sesam.nodeUrl</code> and <code>sesam.jwt</code> in Settings to enable Live mode.
    <a onclick="openSettings()">Open Settings</a>
  </div>

  <div class="panes">
    <!-- Input Entity -->
    <div class="pane">
      <div class="pane-header">
        <span>Input Entity (_S)</span>
        <button class="copy-btn" onclick="copyInput()">⧉ Copy</button>
      </div>
      <div id="entity-nav" class="entity-nav">
        <button id="prev-btn" onclick="prevEntity()">&#9664;</button>
        <span id="entity-counter">1 / 1</span>
        <button id="next-btn" onclick="nextEntity()">&#9654;</button>
        <span id="entity-source" class="entity-source-label"></span>
      </div>
      <textarea id="input-entity" spellcheck="false" placeholder='{\n  "_id": "example-1",\n  "name": "Alice"\n}'>{
  "_id": "example-1",
  "name": "Alice",
  "status": "active"
}</textarea>
    </div>

    <!-- Output Entity -->
    <div class="pane">
      <div class="pane-header">
        <span>Output Entity (_T)</span>
        <button class="copy-btn" id="copy-output-btn" onclick="copyOutput()">⧉ Copy</button>
      </div>
      <div class="output-wrapper">
        <div class="output-box" id="output-box" style="color: var(--vscode-descriptionForeground);">
          Press ▶ Evaluate to see output.
        </div>
        <div class="spinner-overlay" id="spinner">
          <div class="spinner-icon"></div>
          <span>Evaluating on node…</span>
        </div>
      </div>
    </div>
  </div>

  <div id="warnings-box" style="display:none"></div>
  <div class="error-banner" id="error-banner"></div>
  <div class="status-bar" id="status-bar">Ready.</div>

  <script>
    const vscode = acquireVsCodeApi();

    let embeddedEntities = [];
    let entityIndex = 0;
    let currentMode = 'offline';
    let lastOutputText = null;

    // ── Entity navigation ────────────────────────────────────────────────────

    function prevEntity() {
      if (entityIndex > 0) { entityIndex--; showEntity(); }
    }

    function nextEntity() {
      if (entityIndex < embeddedEntities.length - 1) { entityIndex++; showEntity(); }
    }

    function showEntity() {
      document.getElementById('input-entity').value = JSON.stringify(embeddedEntities[entityIndex], null, 2);
      document.getElementById('entity-counter').textContent = (entityIndex + 1) + ' / ' + embeddedEntities.length;
      document.getElementById('prev-btn').disabled = entityIndex === 0;
      document.getElementById('next-btn').disabled = entityIndex === embeddedEntities.length - 1;
    }

    // ── Evaluation ───────────────────────────────────────────────────────────

    function runEval() {
      const inputJson = document.getElementById('input-entity').value;
      vscode.postMessage({ type: 'evaluate', inputJson });
    }

    document.getElementById('input-entity').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runEval();
      }
    });

    // ── Mode toggle ──────────────────────────────────────────────────────────

    function toggleMode() {
      vscode.postMessage({ type: 'toggleMode' });
    }

    function openSettings() {
      vscode.postMessage({ type: 'openSettings' });
    }

    function applyMode(mode, hasCredentials) {
      currentMode = mode;
      const btn = document.getElementById('mode-btn');
      const banner = document.getElementById('no-creds-banner');

      if (mode === 'live') {
        btn.textContent = '🌐 Live';
        btn.className = 'btn btn-live';
        banner.style.display = (hasCredentials ? 'none' : 'block');
      } else {
        btn.textContent = '🔌 Offline';
        btn.className = 'btn btn-secondary';
        banner.style.display = 'none';
      }
    }

    // ── Auto-refresh ─────────────────────────────────────────────────────────

    function toggleAutoRefresh(checked) {
      vscode.postMessage({ type: 'toggleAutoRefresh', enabled: checked });
    }

    // ── Copy ─────────────────────────────────────────────────────────────────

    function copyOutput() {
      if (lastOutputText !== null) {
        vscode.postMessage({ type: 'copyOutput', text: lastOutputText });
      }
    }

    function copyInput() {
      const text = document.getElementById('input-entity').value;
      vscode.postMessage({ type: 'copyInput', text });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function setErrorBanner(html) {
      const banner = document.getElementById('error-banner');
      banner.innerHTML = html;
      banner.style.display = html ? 'block' : 'none';
    }

    function setSpinner(visible) {
      const overlay = document.getElementById('spinner');
      if (visible) {
        overlay.classList.add('visible');
      } else {
        overlay.classList.remove('visible');
      }
    }

    function escHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Message handler ───────────────────────────────────────────────────────

    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'documentState') {
        document.getElementById('file-name').textContent = msg.fileName;
        embeddedEntities = msg.entities ?? [];
        entityIndex = 0;
        const nav = document.getElementById('entity-nav');
        const sourceLabel = document.getElementById('entity-source');
        nav.style.display = embeddedEntities.length > 0 ? 'flex' : 'none';
        sourceLabel.textContent = msg.entitySource ? '(' + msg.entitySource + ')' : '';
        if (embeddedEntities.length > 0) { showEntity(); }
        if (msg.resetOutput) {
          const outputBox = document.getElementById('output-box');
          outputBox.style.color = 'var(--vscode-descriptionForeground)';
          outputBox.textContent = 'Press \u25ba Evaluate to see output.';
          document.getElementById('status-bar').className = 'status-bar';
          document.getElementById('status-bar').textContent = 'Ready.';
          document.getElementById('warnings-box').style.display = 'none';
          document.getElementById('warnings-box').innerHTML = '';
          setErrorBanner('');
          lastOutputText = null;
        }
        return;
      }

      if (msg.type === 'modeChanged') {
        applyMode(msg.mode, msg.hasCredentials);
        return;
      }

      if (msg.type === 'autoRefreshState') {
        document.getElementById('auto-refresh-cb').checked = msg.enabled;
        return;
      }

      if (msg.type === 'loading') {
        setSpinner(true);
        setErrorBanner('');
        document.getElementById('status-bar').className = 'status-bar loading';
        document.getElementById('status-bar').textContent = '⟳ Evaluating on node…';
        document.getElementById('warnings-box').style.display = 'none';
        document.getElementById('warnings-box').innerHTML = '';
        return;
      }

      if (msg.type === 'liveResult') {
        setSpinner(false);
        setErrorBanner('');
        const outputBox = document.getElementById('output-box');
        const statusBar = document.getElementById('status-bar');
        outputBox.style.color = '';

        if (msg.output === null) {
          outputBox.textContent = '(entity discarded by filter/discard)';
          statusBar.className = 'status-bar discard';
          statusBar.textContent = '✓ Entity discarded.';
          lastOutputText = null;
        } else {
          const text = JSON.stringify(msg.output, null, 2);
          outputBox.textContent = text;
          lastOutputText = text;
          statusBar.className = 'status-bar ok';
          statusBar.textContent = '✓ Live — ' + Object.keys(msg.output).length + ' properties.';
        }
        return;
      }

      if (msg.type === 'liveError') {
        setSpinner(false);
        const statusBar = document.getElementById('status-bar');
        statusBar.className = 'status-bar error';
        statusBar.textContent = '✗ Node error.';

        let html = escHtml(msg.message ?? 'Unknown error.');
        if (msg.kind === 'auth') {
          html += ' <a onclick="openSettings()">Open Settings</a>';
        }
        setErrorBanner(html);
        return;
      }

      if (msg.type === 'result') {
        setSpinner(false);
        setErrorBanner('');
        const r = msg.result;
        const outputBox = document.getElementById('output-box');
        const statusBar = document.getElementById('status-bar');
        const warningsBox = document.getElementById('warnings-box');
        outputBox.style.color = '';

        statusBar.className = 'status-bar ' + r.status;

        if (r.status === 'discarded') {
          outputBox.textContent = '(entity discarded by filter/discard)';
          statusBar.textContent = '✓ Entity discarded.';
          lastOutputText = null;
        } else if (r.status === 'error') {
          outputBox.textContent = '(evaluation error)';
          statusBar.textContent = '✗ Error during evaluation.';
          lastOutputText = null;
        } else {
          const text = JSON.stringify(r.output, null, 2);
          outputBox.textContent = text;
          lastOutputText = text;
          statusBar.textContent = '✓ Offline — ' + Object.keys(r.output).length + ' properties.';
        }

        if (r.warnings && r.warnings.length > 0) {
          warningsBox.style.display = 'block';
          warningsBox.innerHTML = r.warnings.map((w) => '<div class="warning">' + escHtml(w) + '</div>').join('');
        } else {
          warningsBox.style.display = 'none';
          warningsBox.innerHTML = '';
        }
        return;
      }

      if (msg.type === 'error') {
        setSpinner(false);
        const statusBar = document.getElementById('status-bar');
        statusBar.className = 'status-bar error';
        statusBar.textContent = msg.message;
      }
    });
  </script>
</body>
</html>`;
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
