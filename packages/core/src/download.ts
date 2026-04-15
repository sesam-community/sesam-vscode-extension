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

import type {
  DownloadOptions,
  DownloadSingleOptions,
  NodeCredentials,
  SingleDownloadResult,
  DownloadResult,
} from "./types.js";

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
  const { outDir, formatter } = opts;
  const serialize = (config: unknown): string =>
    formatter ? formatter(config) : JSON.stringify(config, null, 2);

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
      const filePath = path.join(outDir, "pipes", `${p._id}.conf.json`);
      await fs.writeFile(filePath, serialize(userConfig), "utf-8");
    }),
    ...systemsWithConfig.map(async (s) => {
      const userConfig =
        (s.config?.["original"] as Record<string, unknown> | undefined) ?? s.config;
      const filePath = path.join(outDir, "systems", `${s._id}.conf.json`);
      await fs.writeFile(filePath, serialize(userConfig), "utf-8");
    }),
  ]);

  return {
    pipesWritten: pipesWithConfig.length,
    systemsWritten: systemsWithConfig.length,
  };
}

// ---------------------------------------------------------------------------
// Single-config download
// ---------------------------------------------------------------------------

/**
 * Download a single pipe or system config from the node and write it to disk.
 *
 * The file is written to `opts.outDir/pipes/<id>.conf.json` (for pipes) or
 * `opts.outDir/systems/<id>.conf.json` (for systems).
 *
 * @param creds       Node URL + JWT credentials.
 * @param configId    The `_id` of the pipe or system to download.
 * @param configType  Whether `configId` refers to a `"pipe"` or `"system"`.
 * @param opts        Download options — must include `outDir`.
 */
export async function downloadSingleConfig(
  creds: NodeCredentials,
  configId: string,
  configType: "pipe" | "system",
  opts: DownloadSingleOptions,
): Promise<SingleDownloadResult> {
  const client = new NodeClient(creds);
  const serialize = (config: unknown): string =>
    opts.formatter ? opts.formatter(config) : JSON.stringify(config, null, 2);

  if (configType === "pipe") {
    const pipe = await client.getPipe(configId);
    const userConfig =
      (pipe.config?.["original"] as Record<string, unknown> | undefined) ?? pipe.config;
    const dir = path.join(opts.outDir, "pipes");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${configId}.conf.json`);
    await fs.writeFile(filePath, serialize(userConfig), "utf-8");
    return { configId, configType: "pipe", filePath };
  }

  const system = await client.getSystem(configId);
  const userConfig =
    (system.config?.["original"] as Record<string, unknown> | undefined) ?? system.config;
  const dir = path.join(opts.outDir, "systems");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${configId}.conf.json`);
  await fs.writeFile(filePath, serialize(userConfig), "utf-8");
  return { configId, configType: "system", filePath };
}
