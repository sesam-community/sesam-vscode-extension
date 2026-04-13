/**
 * Status
 *
 * Implements `sesam status` — fetch the runtime execution state of all pipes.
 */

import { NodeClient } from "./node-client.js";

import type { NodeCredentials, PipeStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the runtime status of every pipe on the node.
 *
 * @param creds  Node URL + JWT credentials.
 * @returns      An array of pipe status objects, one per pipe.
 */
export async function getStatus(creds: NodeCredentials): Promise<PipeStatus[]> {
  const client = new NodeClient(creds);
  const pipes = await client.getPipes();

  return pipes.map((p) => ({
    id: p._id,
    state: p.runtime?.state ?? "unknown",
    successCount: p.runtime?.success_count ?? 0,
    failureCount: p.runtime?.failure_count ?? 0,
    queued: p.runtime?.queued ?? 0,
    lastRun: p.runtime?.last_run,
    nextRun: p.runtime?.next_run,
  }));
}
