/**
 * Profile Manager (F03 Phase B)
 *
 * Manages named Sesam environment profiles — each profile is a (name, nodeUrl) pair.
 * The JWT for each profile is stored separately in SecretStorage via credential-manager.
 *
 * Profile metadata (name + nodeUrl) is persisted in `workspaceState` so different
 * workspace folders can point at different Sesam nodes.
 *
 * A status bar item shows the active profile and lets the user switch profiles via QuickPick.
 *
 * Call `initProfileManager(context)` once in `activate()`.
 */

import * as vscode from "vscode";

import { deleteToken, listStoredProfileNames, storeToken } from "./credential-manager";
import { getSesamChannel } from "./sesam-channel";

export interface ProfileMeta {
  name: string;
  nodeUrl: string;
}

const PROFILES_KEY = "sesam.profiles";
const ACTIVE_PROFILE_SETTING = "sesam.activeProfile";

let _context: vscode.ExtensionContext | undefined;
let _statusBarItem: vscode.StatusBarItem | undefined;

export const initProfileManager = (context: vscode.ExtensionContext): void => {
  _context = context;

  _statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  _statusBarItem.command = "sesam.switchProfile";
  _statusBarItem.tooltip = "Click to switch Sesam profile";
  context.subscriptions.push(_statusBarItem);

  _refreshStatusBar();

  // Refresh status bar when the active profile setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(ACTIVE_PROFILE_SETTING)) {
        _refreshStatusBar();
      }
    }),
  );
};

const ctx = (): vscode.ExtensionContext => {
  if (!_context) {
    throw new Error("Profile manager not initialised — call initProfileManager() first.");
  }

  return _context;
};

// ---------------------------------------------------------------------------
// Active profile
// ---------------------------------------------------------------------------

export const getActiveProfileName = (): string =>
  vscode.workspace.getConfiguration("sesam").get<string>("activeProfile", "default");

export const setActiveProfileName = (name: string): Promise<void> =>
  vscode.workspace
    .getConfiguration("sesam")
    .update(ACTIVE_PROFILE_SETTING, name, vscode.ConfigurationTarget.Workspace);

// ---------------------------------------------------------------------------
// Profile metadata (nodeUrl per profile)
// ---------------------------------------------------------------------------

export const getStoredProfiles = (): ProfileMeta[] =>
  ctx().workspaceState.get<ProfileMeta[]>(PROFILES_KEY) ?? [];

export const upsertProfile = async (meta: ProfileMeta): Promise<void> => {
  const profiles = getStoredProfiles().filter((p) => p.name !== meta.name);
  await ctx().workspaceState.update(PROFILES_KEY, [...profiles, meta]);
};

export const removeProfile = async (name: string): Promise<void> => {
  const profiles = getStoredProfiles().filter((p) => p.name !== name);
  await ctx().workspaceState.update(PROFILES_KEY, profiles);
};

// ---------------------------------------------------------------------------
// Node URL resolution for a profile
// ---------------------------------------------------------------------------

/** Returns the nodeUrl for the given profile, falling back to the `sesam.nodeUrl` setting. */
export const resolveNodeUrl = (profileName: string): string => {
  const profiles = getStoredProfiles();
  const meta = profiles.find((p) => p.name === profileName);

  if (meta?.nodeUrl) {
    return meta.nodeUrl;
  }

  return vscode.workspace.getConfiguration("sesam").get<string>("nodeUrl", "").trim();
};

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

const _refreshStatusBar = (): void => {
  if (!_statusBarItem) {
    return;
  }

  const active = getActiveProfileName();
  _statusBarItem.text = `$(key) Sesam: [${active}]`;
  _statusBarItem.show();
};

// ---------------------------------------------------------------------------
// Commands (registered in extension.ts, logic lives here)
// ---------------------------------------------------------------------------

export const runSwitchProfile = async (): Promise<void> => {
  const storedNames = listStoredProfileNames();
  const profileMetas = getStoredProfiles();

  // Build union of profiles known from credentials and from metadata
  const knownNames = [...new Set([...storedNames, ...profileMetas.map((p) => p.name), "default"])];
  const activeProfile = getActiveProfileName();

  const items: vscode.QuickPickItem[] = [
    ...knownNames.map((name) => ({
      label: name,
      description: name === activeProfile ? "$(check) active" : undefined,
    })),
    { label: "$(add) Add profile…", description: "" },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "Switch Sesam Profile",
    placeHolder: `Active: ${activeProfile}`,
  });

  if (!picked) {
    return;
  }

  if (picked.label === "$(add) Add profile…") {
    await runAddProfile();

    return;
  }

  await setActiveProfileName(picked.label);
  _refreshStatusBar();
  vscode.window.showInformationMessage(`Sesam: active profile set to '${picked.label}'.`);
};

export const runAddProfile = async (): Promise<void> => {
  const name = await vscode.window.showInputBox({
    title: "Add Sesam Profile — Step 1 of 3",
    prompt: "Profile name (e.g. dev, staging, prod)",
    placeHolder: "default",
    value: "default",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "Profile name cannot be empty"),
  });

  if (name === undefined) {
    return;
  }

  const nodeUrl = await vscode.window.showInputBox({
    title: "Add Sesam Profile — Step 2 of 3",
    prompt: "Sesam node URL",
    placeHolder: "https://datahub-xxxxxxxx.sesam.cloud",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "Node URL cannot be empty"),
  });

  if (nodeUrl === undefined) {
    return;
  }

  const jwt = await vscode.window.showInputBox({
    title: "Add Sesam Profile — Step 3 of 3",
    prompt: "Paste your JWT token (obtained from the Sesam portal)",
    placeHolder: "eyJ…",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "JWT cannot be empty"),
  });

  if (jwt === undefined) {
    return;
  }

  await upsertProfile({ name: name.trim(), nodeUrl: nodeUrl.trim() });
  await storeToken(name.trim(), jwt.trim());
  _refreshStatusBar();
  vscode.window.showInformationMessage(`Sesam: profile '${name.trim()}' saved.`);
};

export const runListProfiles = (): void => {
  const channel = getSesamChannel();
  const storedNames = listStoredProfileNames();
  const profileMetas = getStoredProfiles();
  const activeProfile = getActiveProfileName();

  channel.appendLine("─── Sesam Profiles ───────────────────────────────────");

  const knownNames = [...new Set([...storedNames, ...profileMetas.map((p) => p.name)])];

  if (knownNames.length === 0) {
    channel.appendLine("  (no profiles configured)");
  } else {
    for (const name of knownNames) {
      const meta = profileMetas.find((p) => p.name === name);
      const nodeUrl = meta?.nodeUrl ?? "(node URL from sesam.nodeUrl setting)";
      const hasToken = storedNames.includes(name);
      const active = name === activeProfile ? " [active]" : "";

      channel.appendLine(
        `  ${name}${active}: ${nodeUrl}  JWT: ${hasToken ? "stored" : "not stored"}`,
      );
    }
  }

  channel.appendLine("──────────────────────────────────────────────────────");
  channel.show(true);
};
