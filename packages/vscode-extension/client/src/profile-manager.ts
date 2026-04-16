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

import { deleteToken, getToken, listStoredProfileNames, storeToken } from "./credential-manager";
import { DEFAULT_PORTAL_URL } from "./constants";
import { getSesamChannel } from "./sesam-channel";

export interface ProfileMeta {
  name: string;
  /** Base URL of the Sesam Management Portal (default: https://portal.sesam.io). */
  portalUrl?: string;
  nodeUrl: string;
}

const PROFILES_KEY = "sesam.profiles";
const ACTIVE_PROFILE_KEY = "sesam.activeProfile"; // workspaceState key — never written to settings.json

let _context: vscode.ExtensionContext | undefined;
let _statusBarItem: vscode.StatusBarItem | undefined;

export const initProfileManager = (context: vscode.ExtensionContext): void => {
  _context = context;

  _statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  _statusBarItem.command = "sesam.switchProfile";
  _statusBarItem.tooltip = "Click to switch Sesam profile";
  context.subscriptions.push(_statusBarItem);

  void _refreshStatusBar();
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

/**
 * Returns the active profile name.
 *
 * Storage: `workspaceState` (VS Code's private workspace storage — never written
 * to `.vscode/settings.json` and therefore never committed to version control).
 *
 * Migration: if the old `sesam.activeProfile` workspace setting is present it is
 * read once, written to workspaceState, and then cleared from settings so the
 * user's settings.json stays clean.
 */
export const getActiveProfileName = (): string => {
  // One-time migration from old ConfigurationTarget.Workspace setting
  const legacyValue = vscode.workspace
    .getConfiguration("sesam")
    .inspect<string>("activeProfile")?.workspaceValue;

  if (legacyValue) {
    // Persist to workspaceState synchronously (fire-and-forget the async clear)
    void ctx().workspaceState.update(ACTIVE_PROFILE_KEY, legacyValue);
    void vscode.workspace
      .getConfiguration("sesam")
      .update("activeProfile", undefined, vscode.ConfigurationTarget.Workspace);
  }

  return ctx().workspaceState.get<string>(ACTIVE_PROFILE_KEY) ?? legacyValue ?? "default";
};

export const setActiveProfileName = async (name: string): Promise<void> => {
  await ctx().workspaceState.update(ACTIVE_PROFILE_KEY, name);
};

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

/** Returns the Management Portal base URL for the given profile (defaults to portal.sesam.io). */
export const resolvePortalUrl = (profileName: string): string => {
  const meta = getStoredProfiles().find((p) => p.name === profileName);
  return meta?.portalUrl?.trim() || DEFAULT_PORTAL_URL;
};

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

const _refreshStatusBar = async (): Promise<void> => {
  if (!_statusBarItem) {
    return;
  }

  const active = getActiveProfileName();
  const nodeUrl = resolveNodeUrl(active);
  const secretJwt = await getToken(active);
  const legacyJwt = vscode.workspace.getConfiguration("sesam").get<string>("jwt", "").trim();
  const hasCredentials = !!nodeUrl && !!(secretJwt || legacyJwt);

  let hostname = "";

  try {
    if (nodeUrl) {
      hostname = new URL(nodeUrl).hostname;
    }
  } catch {
    // malformed nodeUrl — fall back to profile name only
  }

  if (hasCredentials) {
    _statusBarItem.backgroundColor = undefined;
    _statusBarItem.color = new vscode.ThemeColor("testing.iconPassed");
    _statusBarItem.text = hostname
      ? `$(check) ${active} · ${hostname}`
      : `$(check) Sesam: [${active}]`;
  } else {
    _statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    _statusBarItem.color = undefined;
    _statusBarItem.text = hostname
      ? `$(warning) ${active} · ${hostname}`
      : `$(warning) Sesam: No credentials`;
  }

  _statusBarItem.show();
};

/** Public re-export so callers outside this module can trigger a status bar refresh. */
export const refreshStatusBar = (): void => {
  void _refreshStatusBar();
};

// ---------------------------------------------------------------------------
// Commands (registered in extension.ts, logic lives here)
// ---------------------------------------------------------------------------

export const runSwitchProfile = async (): Promise<void> => {
  // ── Guard: unsaved files ────────────────────────────────────────────────
  const dirtyFiles = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled);

  if (dirtyFiles.length > 0) {
    const names = dirtyFiles.map((d) => vscode.workspace.asRelativePath(d.uri)).join(", ");
    vscode.window.showWarningMessage(
      `Sesam: Save all files before switching profiles. Unsaved: ${names}`,
    );

    return;
  }

  // ── Guard: uncommitted git changes ─────────────────────────────────────
  const gitExt = vscode.extensions.getExtension("vscode.git");

  if (gitExt) {
    const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
    const api = git.getAPI(1);
    const repo = api.repositories[0];

    if (repo) {
      const { modified, untracked, staged } = repo.state.workingTreeChanges
        ? {
            modified: repo.state.workingTreeChanges.length,
            untracked: 0,
            staged: repo.state.indexChanges?.length ?? 0,
          }
        : {
            modified: 0,
            untracked: 0,
            staged: 0,
          };
      const total = modified + untracked + staged + (repo.state.indexChanges?.length ?? 0);

      if (total > 0) {
        vscode.window.showWarningMessage(
          "Sesam: Commit or stash all changes before switching profiles.",
        );

        return;
      }
    }
  }

  const storedNames = listStoredProfileNames();
  const profileMetas = getStoredProfiles();
  const activeProfile = getActiveProfileName();
  const currentNodeUrl = resolveNodeUrl(activeProfile);

  // Build union of known profiles, active profile first, no phantom "default"
  const allNames = [...new Set([...storedNames, ...profileMetas.map((p) => p.name)])];
  const knownNames = [activeProfile, ...allNames.filter((n) => n !== activeProfile)];

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

  const nextNodeUrl = resolveNodeUrl(picked.label);
  const nodeChanged = nextNodeUrl && currentNodeUrl && nextNodeUrl !== currentNodeUrl;

  // ── Confirmation dialog ─────────────────────────────────────────────────
  const confirmDetail = nodeChanged
    ? `Switching from ${currentNodeUrl} to ${nextNodeUrl}.\n\nLocal configs (pipes/ and systems/) will be deleted and replaced with a fresh download from the new node.`
    : `Local configs (pipes/ and systems/) will be deleted and replaced with a fresh download.`;

  const confirmed = await vscode.window.showWarningMessage(
    `Sesam: Switch profile to '${picked.label}'?`,
    { modal: true, detail: confirmDetail },
    "Switch & Download",
  );

  if (confirmed !== "Switch & Download") {
    return;
  }

  await setActiveProfileName(picked.label);
  void _refreshStatusBar();

  // ── Teardown current node state ─────────────────────────────────────────
  // Import is at the top of the call chain — use dynamic import to avoid a
  // circular dep (NodeStatusPanel imports from profile-manager).
  const { NodeStatusPanel } = await import("./node-status/NodeStatusPanel");
  NodeStatusPanel.currentPanel?.dispose();

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");

  // ── Always clean workspace and download new configs ─────────────────────
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri;

  if (workspaceDir) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Sesam: Switching profile…",
        cancellable: false,
      },
      async () => {
        for (const folder of ["pipes", "systems"]) {
          const folderUri = vscode.Uri.joinPath(workspaceDir, folder);

          try {
            await vscode.workspace.fs.delete(folderUri, { recursive: true, useTrash: false });
          } catch {
            // folder may not exist — ignore
          }
        }
      },
    );
  }

  // Trigger a fresh download from the new node (command resolves its own credentials)
  await vscode.commands.executeCommand("sesam.download");
};

export const runAddProfile = async (): Promise<void> => {
  const profileMetas = getStoredProfiles();
  const storedNames = listStoredProfileNames();
  const activeProfile = getActiveProfileName();

  // Build list of all known profiles (active first), then a "New profile…" option
  const allKnown = [
    activeProfile,
    ...[...new Set([...storedNames, ...profileMetas.map((p) => p.name)])].filter(
      (n) => n !== activeProfile,
    ),
  ];

  const NEW_PROFILE_LABEL = "$(add) New profile…";

  const profileItems: vscode.QuickPickItem[] = [
    ...allKnown.map((name) => ({
      label: name,
      description: name === activeProfile ? "$(check) active" : undefined,
      detail: profileMetas.find((p) => p.name === name)?.nodeUrl,
    })),
    { label: NEW_PROFILE_LABEL, description: "Create a brand-new profile" },
  ];

  const profilePick = await vscode.window.showQuickPick(profileItems, {
    title: "Sesam: Add / Update Profile — Step 1: Select or create",
    placeHolder: "Select an existing profile to update, or create a new one",
    ignoreFocusOut: true,
  });

  if (!profilePick) {
    return;
  }

  let profileName: string;
  let existingMeta: ProfileMeta | undefined;

  if (profilePick.label === NEW_PROFILE_LABEL) {
    const name = await vscode.window.showInputBox({
      title: "Sesam: Add Profile — Profile name",
      prompt: "Profile name (e.g. dev, staging, prod)",
      placeHolder: "dev",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "Profile name cannot be empty"),
    });

    if (name === undefined) {
      return;
    }

    profileName = name.trim();
    existingMeta = undefined;
  } else {
    profileName = profilePick.label;
    existingMeta = profileMetas.find((p) => p.name === profileName);
  }

  const stepOffset = profilePick.label === NEW_PROFILE_LABEL ? 2 : 1;
  const totalSteps = profilePick.label === NEW_PROFILE_LABEL ? 4 : 3;

  const portalUrl = await vscode.window.showInputBox({
    title: `Sesam: Profile '${profileName}' — Step ${stepOffset} of ${totalSteps}: Portal URL`,
    prompt: "Management Studio URL (press Enter to keep / use the default)",
    placeHolder: DEFAULT_PORTAL_URL,
    value: existingMeta?.portalUrl ?? DEFAULT_PORTAL_URL,
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.trim().startsWith("http") ? undefined : "Must be a valid URL starting with http(s)://",
  });

  if (portalUrl === undefined) {
    return;
  }

  const nodeUrl = await vscode.window.showInputBox({
    title: `Sesam: Profile '${profileName}' — Step ${stepOffset + 1} of ${totalSteps}: Node URL`,
    prompt: "Sesam node URL",
    placeHolder: "https://datahub-xxxxxxxx.sesam.cloud",
    value: existingMeta?.nodeUrl ?? "",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "Node URL cannot be empty"),
  });

  if (nodeUrl === undefined) {
    return;
  }

  const jwt = await vscode.window.showInputBox({
    title: `Sesam: Profile '${profileName}' — Step ${totalSteps} of ${totalSteps}: JWT Token`,
    prompt: "Paste your JWT token (obtained from the Sesam portal)",
    placeHolder: "eyJ…",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "JWT cannot be empty"),
  });

  if (jwt === undefined) {
    return;
  }

  const trimmedPortalUrl = portalUrl.trim();
  await upsertProfile({
    name: profileName,
    portalUrl: trimmedPortalUrl === DEFAULT_PORTAL_URL ? undefined : trimmedPortalUrl,
    nodeUrl: nodeUrl.trim(),
  });
  await storeToken(profileName, jwt.trim());
  await setActiveProfileName(profileName);
  void _refreshStatusBar();
  vscode.window.showInformationMessage(`Sesam: profile '${profileName}' saved and set as active.`);
};

export const runDeleteProfile = async (): Promise<void> => {
  const storedNames = listStoredProfileNames();
  const profileMetas = getStoredProfiles();
  const knownNames = [...new Set([...storedNames, ...profileMetas.map((p) => p.name)])];

  if (knownNames.length === 0) {
    vscode.window.showInformationMessage("Sesam: No profiles configured.");
    return;
  }

  const activeProfile = getActiveProfileName();

  const items: vscode.QuickPickItem[] = knownNames.map((name) => ({
    label: name,
    description: name === activeProfile ? "$(check) active" : undefined,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Sesam: Delete Profile — Select profile",
    placeHolder: "Select a profile to delete",
  });

  if (!picked) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete profile '${picked.label}'? This removes the stored JWT and node URL.`,
    { modal: true },
    "Delete",
  );

  if (confirmed !== "Delete") {
    return;
  }

  await deleteToken(picked.label);
  await removeProfile(picked.label);

  // If the deleted profile was active, fall back to "default"
  if (picked.label === activeProfile) {
    await setActiveProfileName("default");
    void _refreshStatusBar();
  }

  vscode.window.showInformationMessage(`Sesam: profile '${picked.label}' deleted.`);
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

      const portalUrl = meta?.portalUrl ?? DEFAULT_PORTAL_URL;
      channel.appendLine(
        `  ${name}${active}: ${nodeUrl}  portal: ${portalUrl}  JWT: ${hasToken ? "stored" : "not stored"}`,
      );
    }
  }

  channel.appendLine("──────────────────────────────────────────────────────");
  channel.show(true);
};
