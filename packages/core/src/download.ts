/**
 * Download
 *
 * Implements the `sesam download` operation:
 *   1. Fetch all pipe configs from the node.
 *   2. Fetch all system configs from the node.
 *   3. Write each config as a JSON file into pipes/ and systems/ subdirectories.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { NodeClient } from "./node-client.js";

import type { NodeCredentials, DownloadOptions, DownloadResult } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download all pipe and system configs from the node into `opts.outDir`.
 *
 * Subdirectory layout:
 *   outDir/
 *     pipes/<pipe-id>.conf.pipe
 *     systems/<system-id>.conf.system
 *
 * @param creds  Node URL + JWT credentials.
 * @param opts   Download options — must include `outDir`.
 */
export async function downloadConfig(
  creds: NodeCredentials,
  opts: DownloadOptions,
): Promise<DownloadResult> {
  const client = new NodeClient(creds);
  const { outDir } = opts;

  // Ensure output subdirectories exist
  await Promise.all([
    fs.mkdir(path.join(outDir, "pipes"), { recursive: true }),
    fs.mkdir(path.join(outDir, "systems"), { recursive: true }),
  ]);

  const [pipes, systems] = await Promise.all([client.getPipes(), client.getSystems()]);

  const pipesWithConfig = pipes.filter((p) => p.config !== undefined);
  const systemsWithConfig = systems.filter((s) => s.config !== undefined);

  await Promise.all([
    ...pipesWithConfig.map(async (p) => {
      // The node wraps the user config in an envelope: { original, effective, audit, deployed, … }
      // sesam-py writes only config["original"] — the stored user config without computed fields.
      const userConfig =
        (p.config?.["original"] as Record<string, unknown> | undefined) ?? p.config;
      const filePath = path.join(outDir, "pipes", `${p._id}.conf.pipe`);
      await fs.writeFile(filePath, JSON.stringify(userConfig, null, 2), "utf-8");
    }),
    ...systemsWithConfig.map(async (s) => {
      const userConfig =
        (s.config?.["original"] as Record<string, unknown> | undefined) ?? s.config;
      const filePath = path.join(outDir, "systems", `${s._id}.conf.system`);
      await fs.writeFile(filePath, JSON.stringify(userConfig, null, 2), "utf-8");
    }),
  ]);

  return {
    pipesWritten: pipesWithConfig.length,
    systemsWritten: systemsWithConfig.length,
  };
}
