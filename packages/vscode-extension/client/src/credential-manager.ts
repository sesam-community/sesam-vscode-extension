/**
 * Credential Manager (F03 Phase A)
 *
 * SecretStorage wrapper for per-profile Sesam JWT tokens.
 * Tokens are stored under the key `sesam.jwt.<profile>` and never written to disk.
 *
 * Profile names are tracked in `globalState` so they can be enumerated for
 * the delete-token QuickPick without scanning SecretStorage (which has no list API).
 *
 * Call `initCredentialManager(context)` once in `activate()` before using any other export.
 */

import * as vscode from "vscode";

const JWT_KEY_PREFIX = "sesam.jwt.";
const PROFILE_NAMES_KEY = "sesam.profileNames";

let _context: vscode.ExtensionContext | undefined;

export const initCredentialManager = (context: vscode.ExtensionContext): void => {
  _context = context;
};

const ctx = (): vscode.ExtensionContext => {
  if (!_context) {
    throw new Error("Credential manager not initialised — call initCredentialManager() first.");
  }

  return _context;
};

// ---------------------------------------------------------------------------
// Profile name registry (stored in globalState so it survives workspace changes)
// ---------------------------------------------------------------------------

export const listStoredProfileNames = (): string[] =>
  ctx().globalState.get<string[]>(PROFILE_NAMES_KEY) ?? [];

const registerProfileName = async (profile: string): Promise<void> => {
  const names = listStoredProfileNames();

  if (!names.includes(profile)) {
    await ctx().globalState.update(PROFILE_NAMES_KEY, [...names, profile]);
  }
};

const unregisterProfileName = async (profile: string): Promise<void> => {
  const names = listStoredProfileNames().filter((n) => n !== profile);
  await ctx().globalState.update(PROFILE_NAMES_KEY, names);
};

// ---------------------------------------------------------------------------
// SecretStorage operations
// ---------------------------------------------------------------------------

export const storeToken = async (profile: string, token: string): Promise<void> => {
  await ctx().secrets.store(`${JWT_KEY_PREFIX}${profile}`, token);
  await registerProfileName(profile);
};

export const getToken = (profile: string): Promise<string | undefined> =>
  ctx().secrets.get(`${JWT_KEY_PREFIX}${profile}`);

export const deleteToken = async (profile: string): Promise<void> => {
  await ctx().secrets.delete(`${JWT_KEY_PREFIX}${profile}`);
  await unregisterProfileName(profile);
};
