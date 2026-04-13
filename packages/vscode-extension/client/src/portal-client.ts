/**
 * Sesam Portal Client
 *
 * Queries the Sesam management portal for subscription / node status.
 * Used to surface actionable hints when node API calls fail (e.g. the node
 * is hibernated or still provisioning).
 *
 * API: GET https://portal.sesam.io/api/subscriptions/{sub-id}
 *
 * All functions are best-effort: any network / parse failure returns null
 * silently so callers never need to handle errors from this module.
 */

import * as https from "node:https";

import { getSesamChannel } from "./sesam-channel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvisioningStatus =
  | "pending"
  | "completed"
  | "provisioning"
  | "failed"
  | "destroyed"
  | "hibernated";

export interface SubscriptionConnection {
  name: string;
  id: string;
  type: "sesam-node";
  url: string;
}

export interface SubscriptionStatus {
  provisioning_status?: ProvisioningStatus;
  was_hibernated_due_to_idleness?: true;
  /** Array of connections; empty when none are configured. */
  connections?: SubscriptionConnection[];
}

// ---------------------------------------------------------------------------
// Sub-ID extraction (matches sesam-py behaviour)
// ---------------------------------------------------------------------------

/**
 * Extract the subscription ID from the JWT token by decoding its payload.
 *
 * sesam-py does the same: splits on ".", base64-decodes the middle segment,
 * parses JSON, and takes the first key of `jwt_data["principals"]`.
 *
 * Returns null if the JWT is malformed or has no `principals` field (e.g.
 * locally-issued tokens without subscription context).
 */
export const extractSubscriptionId = (jwt: string): string | null => {
  try {
    const parts = jwt.split(".");

    if (parts.length < 2) {
      return null;
    }

    // Standard base64url → base64 padding
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    const data = JSON.parse(decoded) as Record<string, unknown>;
    const principals = data["principals"];

    if (typeof principals !== "object" || principals === null || Array.isArray(principals)) {
      return null;
    }

    const subIds = Object.keys(principals as Record<string, unknown>);

    return subIds[0] ?? null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Portal fetch
// ---------------------------------------------------------------------------

const fetchSubscriptionStatus = (jwt: string, subId: string): Promise<SubscriptionStatus | null> =>
  new Promise((resolve) => {
    const startMs = Date.now();
    const url = `https://portal.sesam.io/api/subscriptions/${encodeURIComponent(subId)}`;

    const req = https.request(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const durationMs = Date.now() - startMs;
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          const ch = getSesamChannel();
          const ts = new Date();
          const hh = ts.getHours().toString().padStart(2, "0");
          const mm = ts.getMinutes().toString().padStart(2, "0");
          const ss = ts.getSeconds().toString().padStart(2, "0");
          const tsStr = `${hh}:${mm}:${ss}`;

          ch.appendLine(`[${tsStr}] GET ${url}  ${status}  ${durationMs} ms`);
          ch.appendLine(`[${tsStr}] Portal response: ${body}`);

          try {
            resolve(JSON.parse(body) as SubscriptionStatus);
          } catch {
            resolve(null);
          }
        });

        res.on("error", () => resolve(null));
      },
    );

    req.on("error", () => resolve(null));
    req.setTimeout(10_000, () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });

// ---------------------------------------------------------------------------
// Hint builder
// ---------------------------------------------------------------------------

const buildStatusHint = (status: SubscriptionStatus): string | null => {
  // was_hibernated_due_to_idleness takes priority over provisioning_status:
  // the node is auto-waking, so the message is informational not an error.
  if (status.was_hibernated_due_to_idleness === true) {
    return "Node is waking from hibernation — this may take a few minutes. Try again shortly.";
  }

  const ps = status.provisioning_status;

  if (!ps || ps === "completed") {
    // Completed but no default connection URL configured
    const conns = status.connections;

    if (Array.isArray(conns) && conns.length === 0) {
      return "No default connection defined for this subscription. Configure one in the Sesam portal.";
    }

    return null;
  }

  if (ps === "hibernated") {
    return "Node is hibernated. Wake it up in the Sesam portal before retrying.";
  }

  if (ps === "pending" || ps === "provisioning") {
    return "Node is being provisioned — this may take a few minutes. Try again shortly.";
  }

  if (ps === "failed") {
    return "Node provisioning has failed. Check network settings in the Sesam portal.";
  }

  if (ps === "destroyed") {
    return "Node has been destroyed. Check the Sesam portal.";
  }

  return `Node status: ${ps}.`;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper: extract sub-id from JWT → fetch status → build hint string.
 *
 * Returns null when:
 * - The JWT has no `principals` field (non-sesam.cloud tokens)
 * - The portal fetch fails for any reason
 * - The node status is normal (provisioning_status === "completed" or absent)
 */
export const fetchNodeStatusHint = async (nodeUrl: string, jwt: string): Promise<string | null> => {
  const subId = extractSubscriptionId(jwt);

  if (!subId) {
    return null;
  }

  const status = await fetchSubscriptionStatus(jwt, subId);

  return status ? buildStatusHint(status) : null;
};
