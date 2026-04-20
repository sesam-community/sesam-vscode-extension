/**
 * Sync Status (F06)
 *
 * Compares local workspace configs against the live Sesam node to produce a
 * diff-summary — which pipes/systems are modified, node-only, or local-only.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { NodeClient } from "./node-client.js";

import type { NodeCredentials, SyncStatusItem } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CONFIG_EXTS = [".conf.pipe", ".conf.system", ".conf.json", ".json"];

async function readLocalConfigs(
  dir: string,
): Promise<Map<string, { filePath: string; parsed: unknown }>> {
  const result = new Map<string, { filePath: string; parsed: unknown }>();

  let entries: string[];

  try {
    entries = await fs.readdir(dir);
  } catch {
    return result;
  }

  await Promise.all(
    entries
      .filter((e) => CONFIG_EXTS.some((ext) => e.endsWith(ext)))
      .map(async (entry) => {
        const filePath = path.join(dir, entry);

        try {
          const content = await fs.readFile(filePath, "utf-8");
          const parsed = JSON.parse(content) as Record<string, unknown>;
          const id = typeof parsed["_id"] === "string" ? parsed["_id"] : null;

          if (id) {
            result.set(id, { filePath, parsed });
          }
        } catch {
          // Skip unparseable files
        }
      }),
  );

  return result;
}

/**
 * Recursively sort object keys for stable structural comparison.
 * Arrays are kept in their original order.
 */
function sortKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  );
}

/** Compact, key-order-independent JSON string for structural equality comparison. */
const compactJson = (value: unknown): string => JSON.stringify(sortKeys(value));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare local workspace configs against the live node.
 *
 * Items that are identical on both sides are omitted from the result.
 *
 * @param creds         Node URL + JWT credentials.
 * @param workspaceDir  Root of the workspace (must contain `pipes/` and/or `systems/` subdirs).
 * @returns             Array of items that differ between local and node.
 */
export async function getSyncStatus(
  creds: NodeCredentials,
  workspaceDir: string,
): Promise<SyncStatusItem[]> {
  const client = new NodeClient(creds);

  const [nodePipes, nodeSystems, localPipes, localSystems] = await Promise.all([
    client.getPipes(),
    client.getSystems(),
    readLocalConfigs(path.join(workspaceDir, "pipes")),
    readLocalConfigs(path.join(workspaceDir, "systems")),
  ]);

  const items: SyncStatusItem[] = [];

  // ── Pipes ────────────────────────────────────────────────────────────────
  const nodePipeMap = new Map(nodePipes.map((p) => [p._id, p]));

  for (const [id, nodePipe] of nodePipeMap) {
    const nodeConfig =
      (nodePipe.config?.["original"] as Record<string, unknown> | undefined) ?? nodePipe.config;
    const local = localPipes.get(id);

    if (!local) {
      items.push({ id, kind: "pipe", state: "node-only" });
    } else if (compactJson(local.parsed) !== compactJson(nodeConfig)) {
      items.push({ id, kind: "pipe", state: "modified", localPath: local.filePath });
    }
  }

  for (const [id, local] of localPipes) {
    if (!nodePipeMap.has(id)) {
      items.push({ id, kind: "pipe", state: "local-only", localPath: local.filePath });
    }
  }

  // ── Systems ──────────────────────────────────────────────────────────────
  const nodeSystemMap = new Map(nodeSystems.map((s) => [s._id, s]));

  for (const [id, nodeSystem] of nodeSystemMap) {
    const nodeConfig =
      (nodeSystem.config?.["original"] as Record<string, unknown> | undefined) ?? nodeSystem.config;
    const local = localSystems.get(id);

    if (!local) {
      items.push({ id, kind: "system", state: "node-only" });
    } else if (compactJson(local.parsed) !== compactJson(nodeConfig)) {
      items.push({ id, kind: "system", state: "modified", localPath: local.filePath });
    }
  }

  for (const [id, local] of localSystems) {
    if (!nodeSystemMap.has(id)) {
      items.push({ id, kind: "system", state: "local-only", localPath: local.filePath });
    }
  }

  return items;
}

/**
 * Fetch the "original" (user-authored) config for a single pipe or system from the node.
 *
 * @param creds   Node URL + JWT credentials.
 * @param id      The `_id` of the config to fetch.
 * @param kind    Whether `id` refers to a `"pipe"` or `"system"`.
 * @returns       The raw config object as stored on the node.
 */
export async function getNodeConfig(
  creds: NodeCredentials,
  id: string,
  kind: "pipe" | "system",
): Promise<unknown> {
  const client = new NodeClient(creds);

  if (kind === "pipe") {
    const pipe = await client.getPipe(id);
    return (pipe.config?.["original"] as Record<string, unknown> | undefined) ?? pipe.config;
  }

  const system = await client.getSystem(id);
  return (system.config?.["original"] as Record<string, unknown> | undefined) ?? system.config;
}
