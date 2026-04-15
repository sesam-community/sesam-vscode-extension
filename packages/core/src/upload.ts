/**
 * Upload
 *
 * Implements the `sesam upload` operation:
 *   0. Validate local configs (same as `sesam validate`) — abort on errors.
 *   1. PUT environment variables (from test-env.json and/or caller-supplied map).
 *   2. ZIP workspace configs and PUT the archive to the node.
 *   3. Wait for all pipes to finish deploying.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { NodeClient } from "./node-client.js";
import { zipWorkspaceConfig } from "./config-zipper.js";
import { validateWorkspace } from "./validate.js";
import { NodeApiError, ValidationFailedError } from "./errors.js";

import type { NodeCredentials, SingleUploadResult, UploadOptions, UploadResult } from "./types.js";

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

  // 0. Validate local configs before touching the node (matches sesam-py behaviour)
  if (!opts?.skipValidate) {
    const validation = await validateWorkspace(workspaceDir);

    if (!validation.valid) {
      throw new ValidationFailedError(validation.errors);
    }
  }

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

// ---------------------------------------------------------------------------
// Single-config upload
// ---------------------------------------------------------------------------

/**
 * Upload a single pipe or system config file to the node.
 *
 * Reads the file at `filePath`, determines its type from the `type` field,
 * and PUTs it via the per-entity config endpoint.  Does **not** affect other
 * pipes or systems on the node.
 *
 * @param creds     Node URL + JWT credentials.
 * @param filePath  Absolute path to the `.conf.json` / `.conf.pipe` / `.conf.system` file.
 * @param opts      Optional flags (skip offline validation).
 */
export async function uploadSingleConfig(
  creds: NodeCredentials,
  filePath: string,
  opts?: { skipValidate?: boolean },
): Promise<SingleUploadResult> {
  const raw = await fs.readFile(filePath, "utf-8");
  const config = JSON.parse(raw) as Record<string, unknown>;
  const configId = typeof config["_id"] === "string" ? config["_id"] : null;

  if (!configId) {
    throw new NodeApiError(0, `Config file has no "_id" field: ${filePath}`);
  }

  const typeStr = typeof config["type"] === "string" ? config["type"] : "";
  const configType: "pipe" | "system" =
    typeStr.startsWith("system:") || typeStr === "system" ? "system" : "pipe";

  if (!opts?.skipValidate) {
    // Derive workspace root: the file lives in <root>/pipes/ or <root>/systems/
    const workspaceDir = path.dirname(path.dirname(filePath));
    const validation = await validateWorkspace(workspaceDir);
    const relevant = validation.errors.filter((e) => e.file === filePath);

    if (relevant.length > 0) {
      throw new ValidationFailedError(relevant);
    }
  }

  const client = new NodeClient(creds);

  if (configType === "pipe") {
    await client.putPipeConfig(configId, config);
  } else {
    await client.putSystemConfig(configId, config);
  }

  return { success: true, configId, configType };
}
