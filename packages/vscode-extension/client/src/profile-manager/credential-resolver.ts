/**
 * Credential Resolver
 *
 * Single integration point for resolving the active Sesam node URL and JWT.
 * Resolution order (first non-empty wins):
 *   1. SecretStorage JWT for the active profile (F03)
 *   2. Legacy `sesam.jwt` VS Code setting (backward compat)
 *
 * Node URL resolution order:
 *   1. Profile metadata nodeUrl stored in workspaceState (F03)
 *   2. `sesam.nodeUrl` VS Code setting (backward compat)
 */

import * as vscode from "vscode";

import { getToken } from "./credential-manager";
import { getActiveProfileName, resolveNodeUrl } from "./profile-manager";

export interface SesamCredentials {
  nodeUrl: string;
  jwt: string;
}

/**
 * Resolve the active Sesam node URL and JWT.
 * Returns `null` if either value is absent or empty.
 */
export const resolveCredentials = async (): Promise<SesamCredentials | null> => {
  const activeProfile = getActiveProfileName();
  const nodeUrl = resolveNodeUrl(activeProfile);

  if (!nodeUrl) {
    return null;
  }

  // 1. SecretStorage (F03)
  const secretJwt = await getToken(activeProfile);

  if (secretJwt) {
    return { nodeUrl, jwt: secretJwt };
  }

  // 2. Legacy settings fallback
  const settingsJwt = vscode.workspace.getConfiguration("sesam").get<string>("jwt", "").trim();

  if (settingsJwt) {
    return { nodeUrl, jwt: settingsJwt };
  }

  return null;
};
