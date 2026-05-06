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

import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { getToken, listStoredProfileNames, deleteToken, storeToken } from "./credential-manager";
import { DEFAULT_PORTAL_URL } from "../constants";
import { getSesamChannel } from "../sesam-channel";
import {
  getActiveProfileName,
  getStoredProfiles,
  isProfileConnected,
  clearProfileConnected,
  removeProfile,
  setActiveProfileName,
  setNodeConnected,
  upsertProfile,
} from "./profile-manager";

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
  /** Full token value — sent to webview for pre-filling the edit form. */
  token: string;
  isActive: boolean;
  /** True when this profile is the active one AND the workspace lock is set (node confirmed connected). */
  isConnected: boolean;
  /** Profile has metadata in workspaceState. */
  hasMetadata: boolean;
  production: boolean;
}

type MessageFromWebview =
  | { type: "ready" }
  | { type: "connect"; profileName: string }
  | { type: "toggleProduction"; profileName: string }
  | { type: "deleteProfile"; profileName: string }
  | {
      type: "saveProfile";
      name: string;
      oldName: string;
      portalUrl: string;
      nodeUrl: string;
      jwt: string;
      production: boolean;
    };

// ---------------------------------------------------------------------------
// ProfilesPanel
// ---------------------------------------------------------------------------

export class ProfilesPanel {
  static currentPanel: ProfilesPanel | undefined;
  private static readonly _viewType = "sesamProfiles";

  /** Wired in extension.ts — pings the node and locks the workspace to the profile. */
  static onConnect: ((profileName: string) => Promise<void>) | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  // ── Static factory ────────────────────────────────────────────────────────

  static createOrShow(extensionUri: vscode.Uri): void {
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

    ProfilesPanel.currentPanel = new ProfilesPanel(panel, extensionUri);
  }

  static refreshIfOpen(): void {
    if (ProfilesPanel.currentPanel) {
      void ProfilesPanel.currentPanel._loadAndSend();
    }
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
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
    if (message.type === "ready") {
      await this._loadAndSend();
      return;
    }

    if (message.type === "saveProfile") {
      const trimmedPortal = message.portalUrl.trim();
      const isRename = message.oldName && message.oldName !== message.name;

      await upsertProfile({
        name: message.name,
        portalUrl:
          trimmedPortal === DEFAULT_PORTAL_URL || trimmedPortal === "" ? undefined : trimmedPortal,
        nodeUrl: message.nodeUrl.trim(),
        production: message.production,
      });

      if (message.jwt.trim()) {
        await storeToken(message.name, message.jwt.trim());
      }

      if (isRename) {
        await deleteToken(message.oldName);
        await removeProfile(message.oldName);
      }

      await vscode.commands.executeCommand("sesam.refreshStatusBar");
      await this._loadAndSend();
      return;
    }

    if (message.type === "connect") {
      getSesamChannel().appendLine(
        `[PROFILES] connect received for '${message.profileName}', onConnect=${!!ProfilesPanel.onConnect}`,
      );

      if (ProfilesPanel.onConnect) {
        await ProfilesPanel.onConnect(message.profileName);
      }

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
      const answer = await vscode.window.showWarningMessage(
        `Delete profile '${message.profileName}'? This removes its stored JWT and node URL.`,
        { modal: true },
        "Delete",
      );

      if (answer !== "Delete") {
        return;
      }

      const activeProfile = getActiveProfileName();

      await deleteToken(message.profileName);
      await removeProfile(message.profileName);

      const remainingNames = [
        ...new Set([...listStoredProfileNames(), ...getStoredProfiles().map((p) => p.name)]),
      ];

      if (message.profileName === activeProfile) {
        await setActiveProfileName("");
        setNodeConnected(false);
        await clearProfileConnected();
      } else if (remainingNames.length === 0) {
        await clearProfileConnected();
      }

      await vscode.commands.executeCommand("sesam.refreshStatusBar");
      await vscode.commands.executeCommand("sesam.refreshProfilesPanel");
      await this._loadAndSend();
      return;
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  private async _loadAndSend(): Promise<void> {
    this._panel.webview.postMessage({ type: "loading" });

    const activeProfile = getActiveProfileName();
    const profileMetas = getStoredProfiles();
    const storedNames = listStoredProfileNames();

    // Union of all known profile names (active first).
    // Do NOT force-include activeProfile when it has no backing data — that would
    // create a phantom "default" row after the last profile is deleted.
    const backingNames = [...new Set([...storedNames, ...profileMetas.map((p) => p.name)])];
    const allNames = backingNames.includes(activeProfile)
      ? [activeProfile, ...backingNames.filter((n) => n !== activeProfile)]
      : backingNames;

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
          token: token ?? "",
          isActive: name === activeProfile,
          isConnected: name === activeProfile && isProfileConnected(),
          hasMetadata: !!meta,
          production: meta?.production ?? false,
        };
      }),
    );

    this._panel.webview.postMessage({
      type: "data",
      rows,
      activeProfile,
      isLocked: isProfileConnected(),
    });
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
    const htmlPath = path.join(this._extensionUri.fsPath, "resources", "profiles-panel.html");

    return fs.readFileSync(htmlPath, "utf8");
  }
}
