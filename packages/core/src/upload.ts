/**
 * Upload
 *
 * Implements the `sesam upload` operation:
 *   1. PUT environment variables (from test-env.json and/or caller-supplied map).
 *   2. ZIP workspace configs and PUT the archive to the node.
 *   3. Wait for all pipes to finish deploying.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { NodeClient } from "./node-client.js";
import { zipWorkspaceConfig } from "./config-zipper.js";

import type { NodeCredentials, UploadOptions, UploadResult } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isConfigFile = (name: string): boolean =>
  name.endsWith(".conf.pipe") || name.endsWith(".conf.system") || name.endsWith(".conf.json");

async function countConfigFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter(isConfigFile).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload local configs from `workspaceDir` to the connected Sesam node.
 *
 * @param creds         Node URL + JWT credentials.
 * @param workspaceDir  Absolute path to the sesam-py workspace root.
 * @param opts          Optional upload flags and extra environment variables.
 */
export async function uploadConfig(
  creds: NodeCredentials,
  workspaceDir: string,
  opts?: UploadOptions,
): Promise<UploadResult> {
  const client = new NodeClient(creds);

  // 1. PUT caller-supplied env vars (if any)
  if (opts?.envVars && Object.keys(opts.envVars).length > 0) {
    await client.putEnvVars(opts.envVars);
  }

  // 2. PUT env vars from test-env.json (optional file at workspace root)
  const testEnvPath = path.join(workspaceDir, "test-env.json");

  try {
    const raw = await fs.readFile(testEnvPath, "utf-8");
    const envVars = JSON.parse(raw) as Record<string, string>;

    if (Object.keys(envVars).length > 0) {
      await client.putEnvVars(envVars);
    }
  } catch {
    // test-env.json is optional
  }

  // 3. Count configs for the result summary (before zipping)
  const [pipesUploaded, systemsUploaded] = await Promise.all([
    countConfigFiles(path.join(workspaceDir, "pipes")),
    countConfigFiles(path.join(workspaceDir, "systems")),
  ]);

  // 4. ZIP and PUT
  const zipBuffer = await zipWorkspaceConfig(workspaceDir);
  await client.putConfig(zipBuffer, opts?.force ?? false);

  // 5. Wait for deploy
  await client.waitForDeploy();

  return { success: true, pipesUploaded, systemsUploaded };
}
