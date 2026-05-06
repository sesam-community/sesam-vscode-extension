/**
 * Credential Manager (F03 Phase A / F28)
 *
 * SecretStorage wrapper for per-profile Sesam JWT tokens.
 * Tokens are stored under the key `sesam.jwt.<workspaceId>.<profile>` and never written to disk.
 * The workspace ID is derived from `context.storageUri` so tokens are fully isolated per folder.
 *
 * Profile names are tracked in `workspaceState` (per-folder) so they cannot bleed between folders.
 *
 * Call `initCredentialManager(context)` once in `activate()` before using any other export.
 */

import * as vscode from "vscode";

const JWT_KEY_PREFIX = "sesam.jwt.";
const PROFILE_NAMES_KEY = "sesam.profileNames";
/** Legacy key used before F28 — still read during migration. */
const LEGACY_PROFILE_NAMES_GLOBAL_KEY = "sesam.profileNames";

let _context: vscode.ExtensionContext | undefined;
/** Short stable identifier derived from `context.storageUri`, unique per workspace folder. */
let _workspaceId = "global";

export const initCredentialManager = (context: vscode.ExtensionContext): void => {
  _context = context;

  // Derive a stable per-workspace ID from storageUri (a VS Code-managed path unique per folder).
  const storagePath = context.storageUri?.fsPath ?? "global";
  _workspaceId = Buffer.from(storagePath).toString("base64").replace(/[+/=]/g, "").slice(0, 16);

  // F28 Phase E migration: copy any names from globalState into workspaceState
  // for profiles that have matching metadata stored locally.
  void _migrateGlobalRegistry();
};

const ctx = (): vscode.ExtensionContext => {
  if (!_context) {
    throw new Error("Credential manager not initialised — call initCredentialManager() first.");
  }

  return _context;
};

// ---------------------------------------------------------------------------
// F28 Phase E — one-time migration from globalState registry
// ---------------------------------------------------------------------------

const _migrateGlobalRegistry = async (): Promise<void> => {
  const c = ctx();
  const globalNames = c.globalState.get<string[]>(LEGACY_PROFILE_NAMES_GLOBAL_KEY) ?? [];

  if (globalNames.length === 0) {
    return;
  }

  const localMetas = c.workspaceState.get<{ name: string }[]>("sesam.profiles") ?? [];
  const localMetaNames = new Set(localMetas.map((p) => p.name));
  const namesToMigrate = globalNames.filter((n) => localMetaNames.has(n));

  for (const name of namesToMigrate) {
    await registerProfileName(name);

    // Lazily migrate token: if new namespaced key missing but old key present, copy it.
    const newKey = `${JWT_KEY_PREFIX}${_workspaceId}.${name}`;
    const existing = await c.secrets.get(newKey);

    if (!existing) {
      const oldToken = await c.secrets.get(`${JWT_KEY_PREFIX}${name}`);

      if (oldToken) {
        await c.secrets.store(newKey, oldToken);
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Profile name registry (workspaceState — per-folder, not shared globally)
// ---------------------------------------------------------------------------

export const listStoredProfileNames = (): string[] =>
  ctx().workspaceState.get<string[]>(PROFILE_NAMES_KEY) ?? [];

const registerProfileName = async (profile: string): Promise<void> => {
  const names = listStoredProfileNames();

  if (!names.includes(profile)) {
    await ctx().workspaceState.update(PROFILE_NAMES_KEY, [...names, profile]);
  }
};

const unregisterProfileName = async (profile: string): Promise<void> => {
  const names = listStoredProfileNames().filter((n) => n !== profile);
  await ctx().workspaceState.update(PROFILE_NAMES_KEY, names);
};

// ---------------------------------------------------------------------------
// SecretStorage operations (keys namespaced by workspace ID)
// ---------------------------------------------------------------------------

const _jwtKey = (profile: string): string => `${JWT_KEY_PREFIX}${_workspaceId}.${profile}`;

export const storeToken = async (profile: string, token: string): Promise<void> => {
  await ctx().secrets.store(_jwtKey(profile), token);
  await registerProfileName(profile);
};

export const getToken = async (profile: string): Promise<string | undefined> => {
  const token = await ctx().secrets.get(_jwtKey(profile));

  if (token !== undefined) {
    return token;
  }

  // Lazy migration: fall back to legacy unnamespaced key
  const legacy = await ctx().secrets.get(`${JWT_KEY_PREFIX}${profile}`);

  if (legacy !== undefined) {
    // Migrate silently
    await ctx().secrets.store(_jwtKey(profile), legacy);
    await ctx().secrets.delete(`${JWT_KEY_PREFIX}${profile}`);
    return legacy;
  }

  return undefined;
};

export const deleteToken = async (profile: string): Promise<void> => {
  await ctx().secrets.delete(_jwtKey(profile));
  // Also clean up any legacy unnamespaced key that might still exist
  await ctx().secrets.delete(`${JWT_KEY_PREFIX}${profile}`);
  await unregisterProfileName(profile);
};
