/**
 * ProfilesPanel
 *
 * WebView panel that displays all configured Sesam profiles and their stored
 * state: nodeUrl, portalUrl, active indicator, and JWT presence (masked).
 *
 * Data sources:
 *   - Profile metadata  → workspaceState  (getStoredProfiles)
 *   - JWT registry      → globalState     (listStoredProfileNames)
 *   - Actual tokens     → SecretStorage   (getToken)
 *
 * This panel helps diagnose the common mismatch where a profile appears in
 * globalState (JWT registry) but has no metadata in workspaceState (nodeUrl
 * missing), which causes "No credentials configured" errors.
 */

import * as vscode from "vscode";

import { getToken, listStoredProfileNames } from "../credential-manager";
import { DEFAULT_PORTAL_URL } from "../constants";
import {
  getActiveProfileName,
  getStoredProfiles,
  runAddProfile,
  setActiveProfileName,
  upsertProfile,
} from "../profile-manager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileRow {
  name: string;
  nodeUrl: string;
  portalUrl: string;
  hasToken: boolean;
  /** First 8 chars of the actual token — shown as partial hint. */
  tokenHint: string;
  isActive: boolean;
  /** Profile has metadata in workspaceState. */
  hasMetadata: boolean;
  production: boolean;
}

type MessageFromWebview =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "setToken"; profileName: string }
  | { type: "editProfile"; profileName: string }
  | { type: "makeActive"; profileName: string }
  | { type: "toggleProduction"; profileName: string }
  | { type: "addProfile" };

// ---------------------------------------------------------------------------
// ProfilesPanel
// ---------------------------------------------------------------------------

export class ProfilesPanel {
  static currentPanel: ProfilesPanel | undefined;
  private static readonly _viewType = "sesamProfiles";

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  // ── Static factory ────────────────────────────────────────────────────────

  static createOrShow(): void {
    const column = vscode.ViewColumn.Beside;

    if (ProfilesPanel.currentPanel) {
      ProfilesPanel.currentPanel._panel.reveal(column);
      void ProfilesPanel.currentPanel._loadAndSend();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ProfilesPanel._viewType,
      "Sesam Profiles",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    ProfilesPanel.currentPanel = new ProfilesPanel(panel);
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
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private async _handleMessage(message: MessageFromWebview): Promise<void> {
    if (message.type === "ready" || message.type === "refresh") {
      await this._loadAndSend();
      return;
    }

    if (message.type === "setToken") {
      // Switch to that profile first so sesam.setToken targets the right one
      await setActiveProfileName(message.profileName);
      await vscode.commands.executeCommand("sesam.setToken");
      await this._loadAndSend();
      return;
    }

    if (message.type === "editProfile") {
      // runAddProfile QuickPick will pre-select the existing profile
      await runAddProfile();
      await this._loadAndSend();
      return;
    }

    if (message.type === "makeActive") {
      await setActiveProfileName(message.profileName);
      // Refresh status bar
      await vscode.commands.executeCommand("sesam.switchProfile");
      await this._loadAndSend();
      return;
    }

    if (message.type === "toggleProduction") {
      const metas = getStoredProfiles();
      const meta = metas.find((p) => p.name === message.profileName);

      if (meta) {
        await upsertProfile({ ...meta, production: !meta.production });
        await vscode.commands.executeCommand("sesam.refreshStatusBar");
      }

      await this._loadAndSend();
      return;
    }

    if (message.type === "addProfile") {
      await runAddProfile();
      await this._loadAndSend();
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  private async _loadAndSend(): Promise<void> {
    this._panel.webview.postMessage({ type: "loading" });

    const activeProfile = getActiveProfileName();
    const profileMetas = getStoredProfiles();
    const storedNames = listStoredProfileNames();

    // Union of all known profile names (active first)
    const allNames = [
      ...new Set([activeProfile, ...storedNames, ...profileMetas.map((p) => p.name)]),
    ];

    const rows: ProfileRow[] = await Promise.all(
      allNames.map(async (name) => {
        const meta = profileMetas.find((p) => p.name === name);
        const token = await getToken(name);
        const hasToken = !!token;
        const tokenHint = token ? token.slice(0, 8) : "";

        return {
          name,
          nodeUrl: meta?.nodeUrl ?? "",
          portalUrl: meta?.portalUrl ?? DEFAULT_PORTAL_URL,
          hasToken,
          tokenHint,
          isActive: name === activeProfile,
          hasMetadata: !!meta,
          production: meta?.production ?? false,
        };
      }),
    );

    this._panel.webview.postMessage({ type: "data", rows, activeProfile });
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  dispose(): void {
    ProfilesPanel.currentPanel = undefined;
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
  <title>Sesam Profiles</title>
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
    }

    .toolbar h2 {
      font-size: 13px;
      font-weight: 600;
      margin-right: auto;
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

    /* ── content ── */
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 12px;
    }

    /* ── profile cards ── */
    .profiles-grid {
      display: grid;
      gap: 10px;
    }

    .profile-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px 14px;
      background: var(--vscode-editor-background);
      position: relative;
    }

    .profile-card.active {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-activeSelectionBackground, var(--vscode-editor-background));
    }

    .profile-card.missing-metadata {
      border-color: var(--vscode-inputValidation-warningBorder, #cca700);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .profile-name {
      font-size: 13px;
      font-weight: 600;
    }

    .badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge-active {
      background: var(--vscode-testing-iconPassed, #4caf50);
      color: #fff;
    }

    .badge-warning {
      background: #e6a817;
      color: #1a1a1a;
    }

    .badge-prod {
      background: #d9534f;
      color: #fff;
    }

    .card-fields {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 3px 12px;
      font-size: 12px;
      margin-bottom: 10px;
    }

    .field-label {
      opacity: 0.6;
      white-space: nowrap;
    }

    .field-value {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .field-value.missing {
      opacity: 0.45;
      font-style: italic;
      font-family: var(--vscode-font-family);
    }

    .token-field {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .token-dots {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      letter-spacing: 2px;
    }

    .token-hint {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      opacity: 0.55;
    }

    .token-none {
      opacity: 0.45;
      font-style: italic;
    }

    .card-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .card-actions button {
      font-size: 11px;
      padding: 2px 8px;
    }

    /* ── loading / empty states ── */
    .state-msg {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      opacity: 0.5;
      font-size: 13px;
    }

    /* ── legend ── */
    .legend {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .legend p { margin-bottom: 3px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <h2>Sesam Profiles</h2>
    <button class="secondary" id="btn-refresh">↺ Refresh</button>
    <button id="btn-add">+ Add Profile</button>
  </div>

  <div class="content" id="content">
    <div class="state-msg" id="loading-msg">Loading…</div>
    <div class="profiles-grid" id="profiles-grid" style="display:none;"></div>
    <div class="legend" id="legend" style="display:none;">
      <p>⚠ = Profile has a JWT stored but no node URL in this workspace. Run <em>Add Profile</em> to set the node URL.</p>
      <p>Token is shown masked (first 8 chars visible). Tokens are stored in VS Code SecretStorage and never written to disk.</p>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('btn-add').addEventListener('click', () => {
      vscode.postMessage({ type: 'addProfile' });
    });

    function renderRows(rows) {
      const grid = document.getElementById('profiles-grid');
      grid.innerHTML = '';

      if (!rows || rows.length === 0) {
        document.getElementById('loading-msg').textContent = 'No profiles configured. Click "+ Add Profile" to get started.';
        document.getElementById('loading-msg').style.display = 'flex';
        document.getElementById('profiles-grid').style.display = 'none';
        document.getElementById('legend').style.display = 'none';
        return;
      }

      document.getElementById('loading-msg').style.display = 'none';
      grid.style.display = 'grid';
      document.getElementById('legend').style.display = '';

      for (const row of rows) {
        const card = document.createElement('div');
        card.className = 'profile-card' +
          (row.isActive ? ' active' : '') +
          (!row.hasMetadata && row.hasToken ? ' missing-metadata' : '');

        const activeBadge = row.isActive
          ? '<span class="badge badge-active">active</span>'
          : '';

        const prodBadge = row.production
          ? '<span class="badge badge-prod">🔒 PROD</span>'
          : '';

        const warnBadge = (!row.hasMetadata && row.hasToken)
          ? '<span class="badge badge-warning">⚠ no node URL</span>'
          : '';

        const nodeUrlHtml = row.nodeUrl
          ? '<span class="field-value">' + escHtml(row.nodeUrl) + '</span>'
          : '<span class="field-value missing">(not set in this workspace)</span>';

        const portalUrlHtml = row.portalUrl
          ? '<span class="field-value">' + escHtml(row.portalUrl) + '</span>'
          : '<span class="field-value missing">(default)</span>';

        let tokenHtml;
        if (row.hasToken) {
          tokenHtml = '<span class="token-field">'
            + '<span class="token-dots">••••••••</span>'
            + '<span class="token-hint">' + escHtml(row.tokenHint) + '…</span>'
            + '</span>';
        } else {
          tokenHtml = '<span class="field-value token-none">not set</span>';
        }

        const makeActiveBtn = !row.isActive
          ? '<button class="secondary" data-action="makeActive" data-profile="' + escAttr(row.name) + '">Make active</button>'
          : '';

        card.innerHTML =
          '<div class="card-header">'
          + '<span class="profile-name">' + escHtml(row.name) + '</span>'
          + activeBadge
          + prodBadge
          + warnBadge
          + '</div>'
          + '<div class="card-fields">'
          + '<span class="field-label">Node URL</span>' + nodeUrlHtml
          + '<span class="field-label">Portal URL</span>' + portalUrlHtml
          + '<span class="field-label">JWT Token</span>' + tokenHtml
          + '</div>'
          + '<div class="card-actions">'
          + '<button class="secondary" data-action="editProfile" data-profile="' + escAttr(row.name) + '">Edit Profile</button>'
          + '<button class="secondary" data-action="setToken" data-profile="' + escAttr(row.name) + '">'
          + (row.hasToken ? 'Update JWT' : 'Set JWT')
          + '</button>'
          + '<button class="secondary" data-action="toggleProduction" data-profile="' + escAttr(row.name) + '">'
          + (row.production ? 'Unmark Production' : 'Mark as Production')
          + '</button>'
          + makeActiveBtn
          + '</div>';

        grid.appendChild(card);
      }

      // Wire up card action buttons
      grid.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-action');
          const profile = btn.getAttribute('data-profile');
          vscode.postMessage({ type: action, profileName: profile });
        });
      });
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escAttr(str) {
      return String(str).replace(/"/g, '&quot;');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'loading') {
        document.getElementById('loading-msg').textContent = 'Loading…';
        document.getElementById('loading-msg').style.display = 'flex';
        document.getElementById('profiles-grid').style.display = 'none';
        document.getElementById('legend').style.display = 'none';
        return;
      }

      if (msg.type === 'data') {
        renderRows(msg.rows);
      }
    });

    // Signal ready so the extension can push the first data load
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
