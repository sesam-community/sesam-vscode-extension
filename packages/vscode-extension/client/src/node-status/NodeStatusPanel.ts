/**
 * NodeStatusPanel
 *
 * WebView panel that displays the runtime status of all pipes on the
 * connected Sesam node as a rich HTML table with:
 *   - Color-coded state badges
 *   - Success / failure / queued counts
 *   - Last-run time
 *   - Filter-by-state buttons and a search box
 *   - Auto-refresh every 30 s (configurable)
 *   - Manual refresh button
 *   - Click a pipe row → run sesam.runPipe for that pipe
 */

import * as path from "node:path";

import * as vscode from "vscode";

import { resolveCredentials } from "../credential-resolver";
import { fetchNodeStatusHint } from "../portal-client";
import { extractSubscriptionId } from "../portal-client";
import { logNodeRequest } from "../sesam-channel";
import { SesamRunner } from "../sesam-runner";
import { trackRequest } from "../network-status";
import { getActiveProfileName, resolvePortalUrl } from "../profile-manager";
import { DEFAULT_PORTAL_URL } from "../constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageFromWebview =
  | { type: "refresh" }
  | { type: "openLocalFile"; pipeId: string }
  | { type: "openInManagementStudio"; pipeId: string; portalUrl: string; subId: string }
  | { type: "ready" };

// ---------------------------------------------------------------------------
// NodeStatusPanel
// ---------------------------------------------------------------------------

export class NodeStatusPanel {
  static currentPanel: NodeStatusPanel | undefined;
  private static readonly viewType = "sesamNodeStatus";

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;

  // ── Static factory ────────────────────────────────────────────────────────

  static createOrShow(): void {
    const column = vscode.ViewColumn.Beside;

    if (NodeStatusPanel.currentPanel) {
      NodeStatusPanel.currentPanel._panel.reveal(column);
      void NodeStatusPanel.currentPanel._loadAndSend();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      NodeStatusPanel.viewType,
      "Sesam Node Status",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    NodeStatusPanel.currentPanel = new NodeStatusPanel(panel);
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.webview.html = this._buildHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: MessageFromWebview) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables,
    );

    // Auto-refresh every 30 s
    this._refreshTimer = setInterval(() => {
      void this._loadAndSend();
    }, 30_000);
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private async _handleMessage(message: MessageFromWebview): Promise<void> {
    if (message.type === "ready" || message.type === "refresh") {
      await this._loadAndSend();
      return;
    }

    if (message.type === "openLocalFile") {
      // Scan all pipe/system config files and find one whose basename matches the id.
      // Using a broad pattern + basename filter is more robust than per-extension globs
      // because the workspace may use .conf.json, .conf.pipe, .json, etc.
      const all = await vscode.workspace.findFiles("**/{pipes,systems}/**", "**/node_modules/**");

      const CONFIG_EXTS = [".conf.json", ".conf.pipe", ".conf.system", ".json"];
      const match = all.find((uri) => {
        const base = path.basename(uri.fsPath);
        return CONFIG_EXTS.some((ext) => base === `${message.pipeId}${ext}`);
      });

      if (!match) {
        vscode.window.showWarningMessage(
          `Sesam: No local file found for '${message.pipeId}'. Have you downloaded configs?`,
        );
        return;
      }

      await vscode.commands.executeCommand("vscode.open", match, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false,
      });
      return;
    }

    if (message.type === "openInManagementStudio") {
      if (!message.subId) {
        vscode.window.showWarningMessage(
          "Sesam: Cannot determine subscription ID from the JWT — cannot open Management Studio link.",
        );
        return;
      }

      const base = message.portalUrl.replace(/\/+$/, "");
      const url = `${base}/subscription/${encodeURIComponent(message.subId)}/pipes/pipe/${encodeURIComponent(message.pipeId)}/edit`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
  }

  // ── Data fetch ────────────────────────────────────────────────────────────

  private async _loadAndSend(): Promise<void> {
    this._panel.webview.postMessage({ type: "loading" });

    const creds = await resolveCredentials();

    if (!creds) {
      this._panel.webview.postMessage({
        type: "error",
        message: "No credentials configured. Use 'Sesam: Store JWT Token' to set up a profile.",
      });
      return;
    }

    const done = trackRequest("GET", "node-status");

    try {
      const runner = new SesamRunner();
      const statuses = await runner.status({
        nodeUrl: creds.nodeUrl,
        jwtToken: creds.jwt,
        logger: logNodeRequest,
      });
      done(true);

      const subId = extractSubscriptionId(creds.jwt) ?? "";
      const portalUrl = resolvePortalUrl(getActiveProfileName());

      this._panel.webview.postMessage({
        type: "data",
        statuses,
        nodeUrl: creds.nodeUrl,
        subId,
        portalUrl,
        refreshedAt: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      done(false);
      const hint = await fetchNodeStatusHint(creds.nodeUrl, creds.jwt);
      const detail = err instanceof Error ? err.message : String(err);
      this._panel.webview.postMessage({
        type: "error",
        message: hint ? `${detail}\n\n${hint}` : detail,
      });
    }
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  dispose(): void {
    NodeStatusPanel.currentPanel = undefined;
    clearInterval(this._refreshTimer);
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sesam Node Status</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ── toolbar ── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .toolbar h2 {
      font-size: 13px;
      font-weight: 600;
      margin-right: auto;
    }

    .toolbar .node-url {
      font-size: 11px;
      opacity: 0.65;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar .refreshed-at {
      font-size: 11px;
      opacity: 0.55;
      white-space: nowrap;
    }

    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }

    button:hover { background: var(--vscode-button-hoverBackground); }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    button.active {
      outline: 1px solid var(--vscode-focusBorder);
    }

    /* ── search / filter bar ── */
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    input[type="search"] {
      flex: 1;
      min-width: 140px;
      max-width: 300px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 12px;
      outline: none;
    }

    input[type="search"]:focus {
      border-color: var(--vscode-focusBorder);
    }

    .filter-pills {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .filter-pills button {
      font-size: 11px;
      padding: 2px 8px;
    }

    /* ── summary row ── */
    .summary {
      display: flex;
      gap: 16px;
      padding: 6px 12px;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      font-size: 12px;
    }

    .summary-item { display: flex; align-items: center; gap: 5px; }

    /* ── table ── */
    .table-wrapper {
      flex: 1;
      overflow-y: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      z-index: 1;
    }

    th {
      text-align: left;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.7;
      border-bottom: 1px solid var(--vscode-panel-border);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }

    th:hover { opacity: 1; }

    th .sort-arrow {
      margin-left: 4px;
      opacity: 0.5;
    }

    td {
      padding: 5px 10px;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
      vertical-align: middle;
    }

    tr:hover td { background: var(--vscode-list-hoverBackground); }

    .pipe-id {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      cursor: pointer;
      color: var(--vscode-textLink-foreground);
    }

    .pipe-id:hover { text-decoration: underline; }

    .pipe-studio-link {
      display: inline-flex;
      align-items: center;
      margin-left: 6px;
      opacity: 0;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      vertical-align: middle;
      transition: opacity 0.1s;
    }

    .pipe-studio-link svg { display: block; }

    tr:hover .pipe-studio-link { opacity: 0.55; }
    .pipe-studio-link:hover   { opacity: 1 !important; }

    /* ── state badge ── */
    .badge {
      display: inline-block;
      border-radius: 3px;
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-ok, .badge-idle, .badge-completed {
      background: rgba(73,185,90,0.18);
      color: #4db86a;
    }

    .badge-running {
      background: rgba(82,156,255,0.15);
      color: #5c9fff;
      animation: pulse 1.5s infinite ease-in-out;
    }

    .badge-failed, .badge-error {
      background: rgba(229,83,75,0.18);
      color: #e95b55;
    }

    .badge-disabled, .badge-stopped {
      background: rgba(128,128,128,0.15);
      color: #8a8a8a;
    }

    .badge-queued, .badge-waiting {
      background: rgba(220,170,60,0.18);
      color: #d4a92a;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.6; }
    }

    /* ── counts ── */
    .count-cell { white-space: nowrap; }

    .ok-count  { color: #4db86a; }
    .err-count { color: #e95b55; }
    .q-count   { color: #d4a92a; }

    /* ── loading / error / empty states ── */
    .status-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      height: 100%;
      text-align: center;
      padding: 32px;
      opacity: 0.7;
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--vscode-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .error-msg {
      white-space: pre-wrap;
      font-size: 12px;
      max-width: 480px;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>

<!-- Toolbar -->
<div class="toolbar">
  <h2>Sesam Node Status</h2>
  <span class="node-url" id="nodeUrl"></span>
  <span class="refreshed-at" id="refreshedAt"></span>
  <button id="refreshBtn" class="secondary" onclick="sendRefresh()">↻ Refresh</button>
</div>

<!-- Filter bar -->
<div class="filter-bar">
  <input type="search" id="searchBox" placeholder="Filter by pipe ID…" oninput="applyFilters()" />
  <div class="filter-pills">
    <button id="pill-all"      class="secondary active" onclick="setStatePill('all')">All</button>
    <button id="pill-running"  class="secondary"        onclick="setStatePill('running')">Running</button>
    <button id="pill-failed"   class="secondary"        onclick="setStatePill('failed')">Failed</button>
    <button id="pill-ok"       class="secondary"        onclick="setStatePill('ok')">OK</button>
    <button id="pill-disabled" class="secondary"        onclick="setStatePill('disabled')">Disabled</button>
  </div>
</div>

<!-- Summary -->
<div class="summary" id="summary"></div>

<!-- Loading / error overlays -->
<div class="table-wrapper" id="tableWrapper">
  <div class="status-overlay" id="loadingOverlay">
    <div class="spinner"></div>
    <span>Loading…</span>
  </div>
  <div class="status-overlay hidden" id="errorOverlay">
    <span style="font-size:24px">⚠️</span>
    <pre class="error-msg" id="errorMsg"></pre>
    <button onclick="sendRefresh()">Try again</button>
  </div>
  <div class="status-overlay hidden" id="emptyOverlay">
    <span style="font-size:24px">🎉</span>
    <span>No pipes match the current filter.</span>
  </div>
  <table id="pipeTable" class="hidden">
    <thead>
      <tr>
        <th onclick="sortBy('id')">Pipe ID <span class="sort-arrow" id="sort-id"></span></th>
        <th onclick="sortBy('state')">State <span class="sort-arrow" id="sort-state"></span></th>
        <th onclick="sortBy('successCount')" title="Success count">✓ <span class="sort-arrow" id="sort-successCount"></span></th>
        <th onclick="sortBy('failureCount')" title="Failure count">✗ <span class="sort-arrow" id="sort-failureCount"></span></th>
        <th onclick="sortBy('queued')" title="Queued">⏳ <span class="sort-arrow" id="sort-queued"></span></th>
        <th onclick="sortBy('lastRun')">Last run <span class="sort-arrow" id="sort-lastRun"></span></th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
</div>

<script>
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────────────
  let allStatuses = [];
  let sortKey    = 'id';
  let sortAsc    = true;
  let stateFilter = 'all';
  let currentNodeUrl = '';
  let currentSubId   = '';
  let currentPortalUrl = ${JSON.stringify(DEFAULT_PORTAL_URL)};

  // ── VS Code messaging ──────────────────────────────────────────────────
  function sendRefresh() {
    document.getElementById('refreshBtn').disabled = true;
    vscode.postMessage({ type: 'refresh' });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;

    if (msg.type === 'loading') {
      showOverlay('loading');
      document.getElementById('refreshBtn').disabled = true;
      return;
    }

    if (msg.type === 'error') {
      document.getElementById('errorMsg').textContent = msg.message;
      showOverlay('error');
      document.getElementById('refreshBtn').disabled = false;
      return;
    }

    if (msg.type === 'data') {
      allStatuses = msg.statuses;
      currentNodeUrl   = msg.nodeUrl;
      currentSubId     = msg.subId   || '';
      currentPortalUrl = msg.portalUrl || ${JSON.stringify(DEFAULT_PORTAL_URL)};
      document.getElementById('nodeUrl').textContent = msg.nodeUrl;
      document.getElementById('refreshedAt').textContent = 'Updated ' + msg.refreshedAt;
      document.getElementById('refreshBtn').disabled = false;
      renderSummary();
      renderTable();
    }
  });

  // Notify extension that the webview is ready
  vscode.postMessage({ type: 'ready' });

  // ── Overlay helpers ────────────────────────────────────────────────────
  function showOverlay(kind) {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('errorOverlay').classList.add('hidden');
    document.getElementById('emptyOverlay').classList.add('hidden');
    document.getElementById('pipeTable').classList.add('hidden');

    if (kind === 'loading')  document.getElementById('loadingOverlay').classList.remove('hidden');
    else if (kind === 'error') document.getElementById('errorOverlay').classList.remove('hidden');
    else if (kind === 'empty') document.getElementById('emptyOverlay').classList.remove('hidden');
    else                    document.getElementById('pipeTable').classList.remove('hidden');
  }

  // ── Summary bar ────────────────────────────────────────────────────────
  function renderSummary() {
    const total    = allStatuses.length;
    const running  = allStatuses.filter(s => s.state === 'running').length;
    const failures = allStatuses.filter(s => s.failureCount > 0).length;
    const disabled = allStatuses.filter(s => s.state === 'disabled' || s.state === 'stopped').length;

    document.getElementById('summary').innerHTML =
      '<span class="summary-item"><b>' + total + '</b>&nbsp;pipes</span>' +
      '<span class="summary-item" style="color:#5c9fff">' + running + '&nbsp;running</span>' +
      '<span class="summary-item" style="color:#e95b55">' + failures + '&nbsp;with failures</span>' +
      '<span class="summary-item" style="color:#8a8a8a">' + disabled + '&nbsp;disabled</span>';
  }

  // ── Filter / sort ──────────────────────────────────────────────────────
  function setStatePill(state) {
    stateFilter = state;
    document.querySelectorAll('.filter-pills button').forEach(b => b.classList.remove('active'));
    document.getElementById('pill-' + state).classList.add('active');
    sendRefresh();
  }

  function applyFilters() { renderTable(); }

  function sortBy(key) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
    renderTable();
  }

  function getFiltered() {
    const query = document.getElementById('searchBox').value.toLowerCase();
    return allStatuses.filter(s => {
      if (query && !s.id.toLowerCase().includes(query)) return false;
      if (stateFilter === 'all') return true;
      if (stateFilter === 'failed') return s.failureCount > 0;
      if (stateFilter === 'running') return s.state === 'running';
      if (stateFilter === 'ok') return (s.state === 'ok' || s.state === 'idle' || s.state === 'completed') && s.failureCount === 0;
      if (stateFilter === 'disabled') return s.state === 'disabled' || s.state === 'stopped';
      return true;
    });
  }

  function getSorted(rows) {
    return [...rows].sort((a, b) => {
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ?  1 : -1;
      return 0;
    });
  }

  // ── Table render ───────────────────────────────────────────────────────
  function renderTable() {
    // Update sort arrows
    ['id','state','successCount','failureCount','queued','lastRun'].forEach(k => {
      const el = document.getElementById('sort-' + k);
      if (el) el.textContent = k === sortKey ? (sortAsc ? '▲' : '▼') : '';
    });

    const rows = getSorted(getFiltered());

    if (rows.length === 0) {
      showOverlay('empty');
      return;
    }

    showOverlay('table');

    const tbody = document.getElementById('tbody');
    tbody.innerHTML = rows.map(s => {
      const badge = badgeClass(s);
      const lastRun = s.lastRun ? fmtDate(s.lastRun) : '<span style="opacity:.45">—</span>';
      const queuedVal = s.queued > 0 ? '<span class="q-count">' + s.queued + '</span>' : '<span style="opacity:.35">0</span>';

      const safeId = escHtml(s.id);
      return '<tr>' +
        '<td>' +
          '<span class="pipe-id" data-action="open-local" data-pipe-id="' + safeId + '" title="Open local config file">' + safeId + '</span>' +
          '<span class="pipe-studio-link" data-action="open-studio" data-pipe-id="' + safeId + '" title="Open in Management Studio">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">' +
              '<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 1.363 4.177c.255.426.542.832.857 1.215.245-.296.551-.705.857-1.215A9.64 9.64 0 0 0 10.22 8.75Zm4.44-1.5a9.64 9.64 0 0 0-1.363-4.177c-.306-.51-.612-.919-.857-1.215a9.927 9.927 0 0 0-.857 1.215A9.64 9.64 0 0 0 5.78 7.25Zm-5.944 1.5H1.543a6.507 6.507 0 0 0 4.666 5.5A11.13 11.13 0 0 1 4.276 9.75Zm-2.733-1.5h2.733A11.13 11.13 0 0 1 6.209 2.75 6.507 6.507 0 0 0 1.543 8.25Zm10.214 1.5a11.13 11.13 0 0 1-1.933 5.5 6.506 6.506 0 0 0 4.666-5.5Zm1.733-1.5a6.506 6.506 0 0 0-4.666-5.5 11.13 11.13 0 0 1 1.933 5.5Z"/>' +
            '</svg>' +
          '</span>' +
        '</td>' +
        '<td><span class="badge ' + badge + '">' + escHtml(s.state) + '</span></td>' +
        '<td class="count-cell"><span class="ok-count">' + s.successCount + '</span></td>' +
        '<td class="count-cell"><span class="' + (s.failureCount > 0 ? 'err-count' : '') + '">' + s.failureCount + '</span></td>' +
        '<td class="count-cell">' + queuedVal + '</td>' +
        '<td style="opacity:.8;white-space:nowrap">' + lastRun + '</td>' +
        '</tr>';
    }).join('');
  }

  // Single delegated listener — avoids all inline-onclick quoting issues
  document.getElementById('tbody').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const pipeId = el.dataset.pipeId;
    const action = el.dataset.action;
    if (action === 'open-local')  vscode.postMessage({ type: 'openLocalFile', pipeId });
    if (action === 'open-studio') vscode.postMessage({ type: 'openInManagementStudio', pipeId, portalUrl: currentPortalUrl, subId: currentSubId });
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  function badgeClass(s) {
    const state = (s.state || '').toLowerCase();
    if (s.failureCount > 0) return 'badge-failed';
    if (state === 'running')  return 'badge-running';
    if (state === 'ok' || state === 'idle' || state === 'completed') return 'badge-ok';
    if (state === 'disabled' || state === 'stopped') return 'badge-disabled';
    if (state === 'queued' || state === 'waiting')   return 'badge-queued';
    return '';
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    } catch { return iso; }
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
</script>
</body>
</html>`;
  }
}
