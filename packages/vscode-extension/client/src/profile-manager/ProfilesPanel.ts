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

import profilesPanelHtml from "./profiles-panel.html?raw";

import { getToken, listStoredProfileNames, deleteToken } from "../credential-manager";
import { DEFAULT_PORTAL_URL } from "../constants";
import {
  getActiveProfileName,
  getStoredProfiles,
  removeProfile,
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
  | { type: "deleteProfile"; profileName: string }
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

    if (message.type === "deleteProfile") {
      await deleteToken(message.profileName);
      await removeProfile(message.profileName);
      await vscode.commands.executeCommand("sesam.refreshStatusBar");
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
    return profilesPanelHtml;
  }
}
