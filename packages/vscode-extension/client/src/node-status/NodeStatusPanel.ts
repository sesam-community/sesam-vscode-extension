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
  | { type: "diffPipe"; pipeId: string }
  | { type: "diffSystem"; systemId: string }
  | { type: "showSyncStatus" }
  | { type: "ready" };

// ---------------------------------------------------------------------------
// NodeStatusPanel
// ---------------------------------------------------------------------------

export class NodeStatusPanel {
  static currentPanel: NodeStatusPanel | undefined;
  private static readonly viewType = "sesamNodeStatus";
  /** Set by extension.ts to start the provisioning poller when node requests fail. */
  static onProvisioningNeeded: ((nodeUrl: string, jwt: string) => void) | undefined;
  /** Set by extension.ts to open a diff for a specific pipe against the node. */
  static onDiffPipe: ((pipeId: string) => void) | undefined;
  /** Set by extension.ts to open a diff for a specific system against the node. */
  static onDiffSystem: ((systemId: string) => void) | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  /** When set, the panel focuses on a single pipe (pre-fills search box). */
  private _filterPipeId: string | undefined;
  /** When set, the panel opens on this tab instead of the default 'pipes' tab. */
  private _initialTab: "pipes" | "systems" | undefined;

  // ── Static factory ────────────────────────────────────────────────────────

  static createOrShow(filterPipeId?: string, initialTab?: "pipes" | "systems"): void {
    const column = vscode.ViewColumn.Beside;

    if (NodeStatusPanel.currentPanel) {
      NodeStatusPanel.currentPanel._panel.reveal(column);
      NodeStatusPanel.currentPanel._filterPipeId = filterPipeId;
      NodeStatusPanel.currentPanel._initialTab = initialTab;
      void NodeStatusPanel.currentPanel._loadAndSend();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      NodeStatusPanel.viewType,
      filterPipeId ? `Sesam: ${filterPipeId}` : "Sesam Node Status",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    NodeStatusPanel.currentPanel = new NodeStatusPanel(panel, filterPipeId, initialTab);
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    filterPipeId?: string,
    initialTab?: "pipes" | "systems",
  ) {
    this._panel = panel;
    this._filterPipeId = filterPipeId;
    this._initialTab = initialTab;
    this._panel.webview.html = this._buildHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: MessageFromWebview) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables,
    );
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

    if (message.type === "diffPipe") {
      NodeStatusPanel.onDiffPipe?.(message.pipeId);
      return;
    }

    if (message.type === "diffSystem") {
      NodeStatusPanel.onDiffSystem?.(message.systemId);
      return;
    }

    if (message.type === "showSyncStatus") {
      await vscode.commands.executeCommand("sesam.showStatus");
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

    const done = trackRequest(
      "GET",
      this._filterPipeId ? `pipe-status/${this._filterPipeId}` : "node-status",
    );

    try {
      const runner = new SesamRunner();
      const [statuses, systems] = await Promise.all([
        this._filterPipeId
          ? runner
              .pipeStatus(
                { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
                this._filterPipeId,
              )
              .then((s) => [s])
          : runner.status({ nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest }),
        this._filterPipeId
          ? Promise.resolve([])
          : runner.systemSummaries({
              nodeUrl: creds.nodeUrl,
              jwtToken: creds.jwt,
              logger: logNodeRequest,
            }),
      ]);
      done(true);

      const subId = extractSubscriptionId(creds.jwt) ?? "";
      const portalUrl = resolvePortalUrl(getActiveProfileName());

      this._panel.webview.postMessage({
        type: "data",
        statuses,
        systems,
        nodeUrl: creds.nodeUrl,
        subId,
        portalUrl,
        filterPipeId: this._filterPipeId ?? null,
        initialTab: this._initialTab ?? null,
        refreshedAt: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      done(false);
      const hint = await fetchNodeStatusHint(creds.nodeUrl, creds.jwt);
      const detail = err instanceof Error ? err.message : String(err);
      this._panel.webview.postMessage({
        type: "error",
        message: hint ?? detail,
        provisioning: hint !== null,
      });

      if (hint) {
        NodeStatusPanel.onProvisioningNeeded?.(creds.nodeUrl, creds.jwt);
      }
    }
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  dispose(): void {
    NodeStatusPanel.currentPanel = undefined;
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

    .pipe-diff-link {
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
      opacity: 0;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      vertical-align: middle;
      transition: opacity 0.1s;
    }

    tr:hover .pipe-diff-link { opacity: 0.55; }
    .pipe-diff-link:hover     { opacity: 1 !important; }

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

    /* ── tabs ── */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      flex-shrink: 0;
    }

    .tab-btn {
      background: transparent;
      color: var(--vscode-foreground);
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      padding: 6px 16px;
      font-size: 12px;
      cursor: pointer;
      opacity: 0.65;
    }

    .tab-btn:hover { opacity: 1; background: transparent; }

    .tab-btn.active {
      opacity: 1;
      border-bottom-color: var(--vscode-focusBorder);
      outline: none;
    }

    .tab-panel { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
  </style>
</head>
<body>

<!-- Toolbar -->
<div class="toolbar">
  <h2>Sesam Node Status</h2>
  <span class="node-url" id="nodeUrl"></span>
  <span class="refreshed-at" id="refreshedAt"></span>
  <button id="refreshBtn" class="secondary" onclick="sendRefresh()">↻ Refresh</button>
  <button class="secondary" onclick="syncDiff()" title="Compare local config with node — opens diff editor">⇄ Sync Diff</button>
</div>

<!-- Tabs -->
<div class="tabs">
  <button class="tab-btn active" id="tab-pipes" onclick="switchTab('pipes')">Pipes</button>
  <button class="tab-btn" id="tab-systems" onclick="switchTab('systems')">Systems</button>
</div>

<!-- ══ PIPES TAB ══ -->
<div class="tab-panel" id="panel-pipes">

<!-- Filter bar -->
<div class="filter-bar">
  <input type="search" id="searchBox" placeholder='Filter by pipe ID… (use "exact" for exact match)' oninput="applyFilters()" />
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
    <button id="tryAgainBtn" onclick="sendRefresh()">Try again</button>
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

</div><!-- /panel-pipes -->

<!-- ══ SYSTEMS TAB ══ -->
<div class="tab-panel hidden" id="panel-systems">

<!-- Filter bar -->
<div class="filter-bar">
  <input type="search" id="sysSearchBox" placeholder='Filter by system ID…' oninput="applySysFilters()" />
</div>

<!-- Loading / error / empty overlays -->
<div class="table-wrapper" id="sysTableWrapper">
  <div class="status-overlay" id="sysLoadingOverlay">
    <div class="spinner"></div>
    <span>Loading…</span>
  </div>
  <div class="status-overlay hidden" id="sysErrorOverlay">
    <span style="font-size:24px">⚠️</span>
    <pre class="error-msg" id="sysErrorMsg"></pre>
    <button onclick="sendRefresh()">Try again</button>
  </div>
  <div class="status-overlay hidden" id="sysEmptyOverlay">
    <span style="font-size:24px">🔍</span>
    <span>No systems match the filter.</span>
  </div>
  <table id="sysTable" class="hidden">
    <thead>
      <tr>
        <th onclick="sortSysBy('id')">System ID <span class="sort-arrow" id="sys-sort-id"></span></th>
        <th onclick="sortSysBy('systemType')">Type <span class="sort-arrow" id="sys-sort-systemType"></span></th>
        <th onclick="sortSysBy('pipesIn')" title="Pipes using this system as source">Pipes In <span class="sort-arrow" id="sys-sort-pipesIn"></span></th>
        <th onclick="sortSysBy('pipesOut')" title="Pipes using this system as sink">Pipes Out <span class="sort-arrow" id="sys-sort-pipesOut"></span></th>
        <th>Config Status</th>
      </tr>
    </thead>
    <tbody id="sys-tbody"></tbody>
  </table>
</div>

</div><!-- /panel-systems -->

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
  let currentFilterPipeId = null;

  // systems state
  let allSystems = [];
  let sysSortKey = 'id';
  let sysSortAsc = true;
  let sysConfigStatus = {}; // id -> 'modified'|'node-only'|'local-only'|undefined
  let activeTab = 'pipes';

  // ── Sync Diff ──────────────────────────────────────────────────────────
  function syncDiff() {
    if (currentFilterPipeId) {
      // Single-pipe view: open the diff for this pipe directly
      vscode.postMessage({ type: 'diffPipe', pipeId: currentFilterPipeId });
    } else {
      // All-pipes view: fetch status and reveal the Sync Status sidebar
      vscode.postMessage({ type: 'showSyncStatus' });
    }
  }

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
      document.getElementById('tryAgainBtn').style.display = msg.provisioning ? 'none' : '';
      showOverlay('error');
      document.getElementById('refreshBtn').disabled = false;
      return;
    }

    if (msg.type === 'data') {
      allStatuses = msg.statuses;
      allSystems  = msg.systems || [];
      currentNodeUrl   = msg.nodeUrl;
      currentSubId     = msg.subId   || '';
      currentPortalUrl = msg.portalUrl || ${JSON.stringify(DEFAULT_PORTAL_URL)};
      currentFilterPipeId = msg.filterPipeId || null;
      document.getElementById('nodeUrl').textContent = msg.nodeUrl;
      document.getElementById('refreshedAt').textContent = 'Updated ' + msg.refreshedAt;
      document.getElementById('refreshBtn').disabled = false;
      if (msg.filterPipeId) {
        document.getElementById('searchBox').value = '"' + msg.filterPipeId + '"';
        document.querySelectorAll('.filter-pills button').forEach(b => b.classList.remove('active'));
        document.getElementById('pill-all').classList.add('active');
        stateFilter = 'all';
      }
      renderSummary();
      renderTable();
      renderSysTable();
      if (msg.initialTab) switchTab(msg.initialTab);
    }

    if (msg.type === 'syncStatus') {
      // update config-status badges for systems
      sysConfigStatus = {};
      (msg.items || []).forEach(item => {
        if (item.kind === 'system') sysConfigStatus[item.id] = item.state;
      });
      renderSysTable();
    }
  });

  // Notify extension that the webview is ready
  vscode.postMessage({ type: 'ready' });

  // ── Tab switching ──────────────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('panel-pipes').classList.toggle('hidden', tab !== 'pipes');
    document.getElementById('panel-systems').classList.toggle('hidden', tab !== 'systems');
    document.getElementById('tab-pipes').classList.toggle('active', tab === 'pipes');
    document.getElementById('tab-systems').classList.toggle('active', tab === 'systems');
  }

  // ── Systems rendering ──────────────────────────────────────────────────
  function getSysFiltered() {
    const q = (document.getElementById('sysSearchBox')?.value || '').trim().toLowerCase();
    if (!q) return allSystems;
    return allSystems.filter(s => s.id.toLowerCase().includes(q));
  }

  function getSysSorted(rows) {
    return [...rows].sort((a, b) => {
      const av = a[sysSortKey] ?? '';
      const bv = b[sysSortKey] ?? '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sysSortAsc ? cmp : -cmp;
    });
  }

  function sortSysBy(key) {
    if (sysSortKey === key) { sysSortAsc = !sysSortAsc; }
    else { sysSortKey = key; sysSortAsc = true; }
    renderSysTable();
  }

  function applySysFilters() { renderSysTable(); }

  function renderSysTable() {
    ['id','systemType','pipesIn','pipesOut'].forEach(k => {
      const el = document.getElementById('sys-sort-' + k);
      if (el) el.textContent = k === sysSortKey ? (sysSortAsc ? '▲' : '▼') : '';
    });

    const rows = getSysSorted(getSysFiltered());

    if (allSystems.length === 0) {
      showSysOverlay('loading');
      return;
    }

    if (rows.length === 0) {
      showSysOverlay('empty');
      return;
    }

    showSysOverlay('table');

    const tbody = document.getElementById('sys-tbody');
    const diffSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5ZM5.25 5.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 .75-.75Zm5.5 0a.75.75 0 0 1 .75.75v1.25h1.25a.75.75 0 0 1 0 1.5H11.5v1.25a.75.75 0 0 1-1.5 0V9h-1.25a.75.75 0 0 1 0-1.5H10V6.25a.75.75 0 0 1 .75-.75Z"/></svg>';

    tbody.innerHTML = rows.map(s => {
      const safeId = escHtml(s.id);
      const safeType = escHtml(s.systemType || '—');
      const status = sysConfigStatus[s.id];
      const statusBadge = status
        ? '<span class="badge ' + configStatusBadgeClass(status) + '">' + escHtml(configStatusLabel(status)) + '</span>'
        : '<span style="opacity:.45">—</span>';

      return '<tr>' +
        '<td>' +
          '<span class="pipe-id" data-action="open-sys-local" data-sys-id="' + safeId + '" title="Open local config file">' + safeId + '</span>' +
          '<span class="pipe-diff-link" data-action="diff-system" data-sys-id="' + safeId + '" title="View diff with node config">' +
            diffSvg +
          '</span>' +
        '</td>' +
        '<td style="opacity:.85;font-size:11px">' + safeType + '</td>' +
        '<td class="count-cell">' + (s.pipesIn > 0 ? s.pipesIn : '<span style="opacity:.35">0</span>') + '</td>' +
        '<td class="count-cell">' + (s.pipesOut > 0 ? s.pipesOut : '<span style="opacity:.35">0</span>') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '</tr>';
    }).join('');
  }

  function showSysOverlay(kind) {
    document.getElementById('sysLoadingOverlay').classList.add('hidden');
    document.getElementById('sysErrorOverlay').classList.add('hidden');
    document.getElementById('sysEmptyOverlay').classList.add('hidden');
    document.getElementById('sysTable').classList.add('hidden');

    if (kind === 'loading')      document.getElementById('sysLoadingOverlay').classList.remove('hidden');
    else if (kind === 'error')   document.getElementById('sysErrorOverlay').classList.remove('hidden');
    else if (kind === 'empty')   document.getElementById('sysEmptyOverlay').classList.remove('hidden');
    else                         document.getElementById('sysTable').classList.remove('hidden');
  }

  function configStatusBadgeClass(state) {
    if (state === 'modified')   return 'badge-queued';
    if (state === 'node-only')  return 'badge-running';
    if (state === 'local-only') return 'badge-disabled';
    return '';
  }

  function configStatusLabel(state) {
    if (state === 'modified')   return 'Modified';
    if (state === 'node-only')  return 'Remote Only';
    if (state === 'local-only') return 'Local Only';
    return state;
  }

  // Delegated click listener for systems table
  document.getElementById('sys-tbody').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const sysId = el.dataset.sysId;
    const action = el.dataset.action;
    if (action === 'open-sys-local')  vscode.postMessage({ type: 'openLocalFile', pipeId: sysId });
    if (action === 'diff-system')     vscode.postMessage({ type: 'diffSystem', systemId: sysId });
  });

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
    renderTable();
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
    const raw = document.getElementById('searchBox').value;
    const exactMatch = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
    const query = exactMatch ? raw.slice(1, -1).toLowerCase() : raw.toLowerCase();
    return allStatuses.filter(s => {
      if (query) {
        const id = s.id.toLowerCase();
        if (exactMatch ? id !== query : !id.includes(query)) return false;
      }
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
          '<span class="pipe-diff-link" data-action="diff-pipe" data-pipe-id="' + safeId + '" title="View diff with node config">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">' +
              '<path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5ZM5.25 5.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 .75-.75Zm5.5 0a.75.75 0 0 1 .75.75v1.25h1.25a.75.75 0 0 1 0 1.5H11.5v1.25a.75.75 0 0 1-1.5 0V9h-1.25a.75.75 0 0 1 0-1.5H10V6.25a.75.75 0 0 1 .75-.75Z"/>' +
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
    if (action === 'diff-pipe')   vscode.postMessage({ type: 'diffPipe', pipeId });
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
