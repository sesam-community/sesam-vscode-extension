/**
 * Credential Resolver
 *
 * Single integration point for resolving the active Sesam node URL and JWT.
 * Currently reads from VS Code settings (`sesam.nodeUrl`, `sesam.jwt`).
 *
 * When F03 (SecretStorage) is implemented, extend this function to check
 * SecretStorage first and fall back to settings — no other file needs to
 * change.
 */

import * as vscode from "vscode";

export interface SesamCredentials {
  nodeUrl: string;
  jwt: string;
}

/**
 * Resolve the active Sesam node URL and JWT from VS Code settings.
 * Returns `null` if either value is absent or empty.
 */
export const resolveCredentials = (): SesamCredentials | null => {
  const config = vscode.workspace.getConfiguration("sesam");
  const nodeUrl = config.get<string>("nodeUrl", "").trim();
  const jwt = config.get<string>("jwt", "").trim();

  if (!nodeUrl || !jwt) {
    return null;
  }

  return { nodeUrl, jwt };
};
