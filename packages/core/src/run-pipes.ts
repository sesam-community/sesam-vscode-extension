/**
 * Run Pipes
 *
 * Implements `sesam run` — trigger one or all pipes on the connected node.
 */

import { NodeClient } from "./node-client.js";

import type { NodeCredentials, RunAllOptions, RunResult } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the pump for a single pipe by its `_id`.
 *
 * @param creds   Node URL + JWT credentials.
 * @param pipeId  The `_id` of the pipe to run.
 */
export async function runPipe(creds: NodeCredentials, pipeId: string): Promise<RunResult> {
  const client = new NodeClient(creds);
  await client.startPump(pipeId);
  return { success: true, pipeId };
}

/**
 * Trigger a run of all pipes on the node (`POST /api/pipes/run-all-pipes`).
 *
 * @param creds  Node URL + JWT credentials.
 * @param opts   Optional tuning parameters (extra zero runs, max runs, timeout).
 */
export async function runAllPipes(
  creds: NodeCredentials,
  opts?: RunAllOptions,
): Promise<RunResult> {
  const client = new NodeClient(creds);
  await client.runAllPipes(opts);
  return { success: true };
}
