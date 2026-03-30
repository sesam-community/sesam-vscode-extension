/**
 * Pipe Preview Panel
 * Opens a VS Code WebviewPanel with three panes:
 *   Left:   Editable input entity (JSON)
 *   Middle: DTL transform rules (read-only, synced from document)
 *   Right:  Computed output entity
 */

import * as vscode from "vscode";
import { evaluate, EvalEntity } from "../../../src/shared/dtl-evaluator";

type MessageFromWebview = { type: "evaluate"; inputJson: string };

export class PreviewPanel {
  static currentPanel: PreviewPanel | undefined;
  private static readonly viewType = "dtlPreview";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _document: vscode.TextDocument;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument): void {
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

    PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri, document);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._document = document;

    this._panel.webview.html = this._buildHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: MessageFromWebview) => {
        if (message.type === "evaluate") {
          this._runEvaluation(message.inputJson);
        }
      },
      null,
      this._disposables,
    );

    this._sendDocumentState();
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

  private _runEvaluation(inputJson: string): void {
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

  private _sendDocumentState(resetOutput = false): void {
    const text = this._document.getText();
    const fileName = vscode.workspace.asRelativePath(this._document.uri, false);
    const entities = extractEmbeddedEntities(text);

    this._panel.webview.postMessage({ type: "documentState", fileName, entities, resetOutput });
  }

  dispose(): void {
    PreviewPanel.currentPanel = undefined;
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
      padding: 8px 12px;
      background: var(--vscode-titleBar-activeBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    header h1 { font-size: 14px; font-weight: 600; }
    header .file-name {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .run-btn {
      margin-left: auto;
      padding: 4px 12px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      font-size: 13px;
    }
    .run-btn:hover { background: var(--vscode-button-hoverBackground); }
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

    .panes {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
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
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
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
    }
    .output-box { user-select: text; }
    .status-bar {
      padding: 4px 12px;
      font-size: 11px;
      color: var(--vscode-statusBar-foreground);
      background: var(--vscode-statusBar-background);
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      min-height: 22px;
    }
    .status-bar.ok     { background: var(--vscode-statusBarItem-remoteBackground, #007c00); color: #fff; }
    .status-bar.error  { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: #f48771; }
    .status-bar.discard{ background: #6b4c00; color: #ffc66d; }
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
    <button class="run-btn" id="run-btn" onclick="runEval()">▶ Evaluate</button>
  </header>

  <div class="panes">
    <!-- Input Entity -->
    <div class="pane">
      <div class="pane-header">Input Entity (_S)</div>
      <div id="entity-nav" class="entity-nav">
        <span>Embedded:</span>
        <button id="prev-btn" onclick="prevEntity()">&#9664;</button>
        <span id="entity-counter">1 / 1</span>
        <button id="next-btn" onclick="nextEntity()">&#9654;</button>
      </div>
      <textarea id="input-entity" spellcheck="false" placeholder='{\n  "_id": "example-1",\n  "name": "Alice"\n}'>{
  "_id": "example-1",
  "name": "Alice",
  "status": "active"
}</textarea>
    </div>

    <!-- Output Entity -->
    <div class="pane">
      <div class="pane-header">Output Entity (_T)</div>
      <div class="output-box" id="output-box" style="color: var(--vscode-descriptionForeground);">
        Press ▶ Evaluate to see output.
      </div>
    </div>
  </div>

  <div id="warnings-box" style="display:none"></div>
  <div class="status-bar" id="status-bar">Ready.</div>

  <script>
    const vscode = acquireVsCodeApi();

    let embeddedEntities = [];
    let entityIndex = 0;

    function prevEntity() {
      if (entityIndex > 0) {
        entityIndex--;
        showEntity();
      }
    }

    function nextEntity() {
      if (entityIndex < embeddedEntities.length - 1) {
        entityIndex++;
        showEntity();
      }
    }

    function showEntity() {
      document.getElementById('input-entity').value = JSON.stringify(embeddedEntities[entityIndex], null, 2);
      document.getElementById('entity-counter').textContent = (entityIndex + 1) + ' / ' + embeddedEntities.length;
      document.getElementById('prev-btn').disabled = entityIndex === 0;
      document.getElementById('next-btn').disabled = entityIndex === embeddedEntities.length - 1;
    }

    function runEval() {
      const inputJson = document.getElementById('input-entity').value;
      vscode.postMessage({ type: 'evaluate', inputJson });
    }

    // Ctrl+Enter shortcut
    document.getElementById('input-entity').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runEval();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'documentState') {
        document.getElementById('file-name').textContent = msg.fileName;
        embeddedEntities = msg.entities ?? [];
        entityIndex = 0;
        const nav = document.getElementById('entity-nav');
        nav.style.display = embeddedEntities.length > 1 ? 'flex' : 'none';
        if (embeddedEntities.length > 0) { showEntity(); }
        if (msg.resetOutput) {
          const outputBox = document.getElementById('output-box');
          outputBox.style.color = 'var(--vscode-descriptionForeground)';
          outputBox.textContent = 'Press \u25ba Evaluate to see output.';
          document.getElementById('status-bar').className = 'status-bar';
          document.getElementById('status-bar').textContent = 'Ready.';
          document.getElementById('warnings-box').style.display = 'none';
          document.getElementById('warnings-box').innerHTML = '';
        }
        return;
      }

      if (msg.type === 'result') {
        const r = msg.result;
        const outputBox = document.getElementById('output-box');
        const statusBar = document.getElementById('status-bar');
        const warningsBox = document.getElementById('warnings-box');

        statusBar.className = 'status-bar ' + r.status;

        if (r.status === 'discarded') {
          outputBox.textContent = '(entity discarded by filter/discard)';
          statusBar.textContent = '✓ Entity discarded.';
        } else if (r.status === 'error') {
          outputBox.textContent = '(evaluation error)';
          statusBar.textContent = '✗ Error during evaluation.';
        } else {
          outputBox.textContent = JSON.stringify(r.output, null, 2);
          statusBar.textContent = '✓ OK — ' + Object.keys(r.output).length + ' properties.';
        }

        if (r.warnings && r.warnings.length > 0) {
          warningsBox.style.display = 'block';
          warningsBox.innerHTML = r.warnings
            .map((w) => '<div class="warning">' + escHtml(w) + '</div>')
            .join('');
        } else {
          warningsBox.style.display = 'none';
          warningsBox.innerHTML = '';
        }
      }

      if (msg.type === 'error') {
        const statusBar = document.getElementById('status-bar');
        statusBar.className = 'status-bar error';
        statusBar.textContent = msg.message;
      }
    });

    function escHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
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
    const parsed = JSON.parse(text);

    // Bare array — treat as rules list directly
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;

    // Full pipe config
    const transform = obj["transform"] as Record<string, unknown> | undefined;
    if (!transform) {
      return null;
    }

    // Shorthand direct array
    if (Array.isArray(transform)) {
      return transform;
    }

    const rules = transform["rules"] as Record<string, unknown> | undefined;
    if (!rules) {
      return null;
    }

    // Return the "default" rule, or the first rule found
    if (Array.isArray((rules as Record<string, unknown>)["default"])) {
      return (rules as Record<string, unknown[]>)["default"];
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
    const parsed = JSON.parse(text);

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
