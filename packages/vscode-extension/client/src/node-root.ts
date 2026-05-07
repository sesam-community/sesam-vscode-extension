import * as path from "node:path";

import * as vscode from "vscode";

/**
 * Returns the configured node root subdirectory from `sesam.rootFolder`
 * (e.g. `"node"`), or `""` for a flat layout.
 */
export const getNodeRootDir = (): string =>
  vscode.workspace.getConfiguration("sesam").get<string>("rootFolder", "").trim();

/**
 * Resolves a VS Code URI under the sesam node root, relative to `workspaceRoot`.
 *
 * If `sesam.rootFolder` is set (e.g. `"node"`), returns
 * `<workspaceRoot>/node/<...segments>`. Otherwise returns
 * `<workspaceRoot>/<...segments>`.
 */
export const resolveNodeUri = (workspaceRoot: vscode.Uri, ...segments: string[]): vscode.Uri => {
  const rootFolder = getNodeRootDir();
  const base = rootFolder ? vscode.Uri.joinPath(workspaceRoot, rootFolder) : workspaceRoot;

  return segments.length > 0 ? vscode.Uri.joinPath(base, ...segments) : base;
};

/**
 * Resolves a filesystem path under the sesam node root, relative to `workspaceRoot`.
 *
 * If `sesam.rootFolder` is set (e.g. `"node"`), returns
 * `<workspaceRoot>/node/<...segments>`. Otherwise returns
 * `<workspaceRoot>/<...segments>`.
 */
export const resolveNodePath = (workspaceRoot: string, ...segments: string[]): string => {
  const rootFolder = getNodeRootDir();

  return rootFolder
    ? path.join(workspaceRoot, rootFolder, ...segments)
    : path.join(workspaceRoot, ...segments);
};
