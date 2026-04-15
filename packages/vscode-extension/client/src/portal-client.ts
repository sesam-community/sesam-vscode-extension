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

import * as vscode from "vscode";

import { getSesamChannel } from "./sesam-channel";
import { trackRequest } from "./network-status";

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

/**
 * Tracks sub-IDs for which we have already sent the wake-up analytics event.
 * Cleared when the poller detects the node is ready (via `clearWakeUpSent`).
 */
const _wakeUpSent = new Set<string>();

/** Called by the provisioning poller when the node becomes ready. */
export const clearWakeUpSent = (subId: string): void => {
  _wakeUpSent.delete(subId);
};

/**
 * Trigger node provisioning/wake-up by posting a page_view analytics event.
 * Sesam-py does the same via `register_user_interaction()` — even if the node
 * is hibernated or not yet provisioned, this POST causes the portal to start
 * spinning it up.
 *
 * Returns a Promise that resolves when the request completes (success or
 * failure). Callers should await this before starting the provisioning poller
 * so that the wake-up signal reaches the portal first.
 */
const triggerNodeWakeUp = (jwt: string, subId: string): Promise<void> =>
  new Promise((resolve) => {
    const analyticsUrl = "https://portal.sesam.io/api/analytics";
    const body = JSON.stringify({ subscription_id: subId, action: "page_view" });
    const startMs = Date.now();
    const done = trackRequest("POST", "portal/analytics");

    const req = https.request(
      analyticsUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body, "utf8")),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          done((res.statusCode ?? 0) < 400, res.statusCode);
          const ch = getSesamChannel();
          const ts = new Date();
          const tsStr = [
            ts.getHours().toString().padStart(2, "0"),
            ts.getMinutes().toString().padStart(2, "0"),
            ts.getSeconds().toString().padStart(2, "0"),
          ].join(":");
          ch.appendLine(
            `[${tsStr}] POST ${analyticsUrl}  ${res.statusCode ?? 0}  ${Date.now() - startMs} ms  — wake-up sent`,
          );
          resolve();
        });
        res.on("error", () => {
          done(false);
          resolve();
        });
      },
    );

    req.on("error", () => {
      done(false);
      resolve();
    });
    req.setTimeout(10_000, () => {
      req.destroy();
      done(false);
      resolve();
    });
    req.write(body, "utf8");
    req.end();
  });

const fetchSubscriptionStatus = (jwt: string, subId: string): Promise<SubscriptionStatus | null> =>
  new Promise((resolve) => {
    const startMs = Date.now();
    const url = `https://portal.sesam.io/api/subscriptions/${encodeURIComponent(subId)}`;
    const done = trackRequest("GET", "portal/subscriptions");

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
          done(status < 400, status === 0 ? undefined : status);
          const ch = getSesamChannel();
          const ts = new Date();
          const hh = ts.getHours().toString().padStart(2, "0");
          const mm = ts.getMinutes().toString().padStart(2, "0");
          const ss = ts.getSeconds().toString().padStart(2, "0");
          const tsStr = `${hh}:${mm}:${ss}`;

          ch.appendLine(`[${tsStr}] GET ${url}  ${status}  ${durationMs} ms`);

          const verbose = vscode.workspace
            .getConfiguration("sesam.portal")
            .get<boolean>("verboseLogging", false);

          if (verbose) {
            ch.appendLine(`[${tsStr}] Portal response: ${body}`);
          }

          try {
            resolve(JSON.parse(body) as SubscriptionStatus);
          } catch {
            resolve(null);
          }
        });

        res.on("error", () => {
          done(false);
          resolve(null);
        });
      },
    );

    req.on("error", () => {
      done(false);
      resolve(null);
    });
    req.setTimeout(10_000, () => {
      req.destroy();
      done(false);
      resolve(null);
    });

    req.end();
  });

// ---------------------------------------------------------------------------
// Node ping
// ---------------------------------------------------------------------------

/**
 * Ping the Sesam node API. Returns true if the node responded with any HTTP
 * status code (meaning it is reachable), false on timeout or connection error.
 *
 * A 4xx response still means the node is up — the TCP handshake succeeded.
 */
const pingNode = (nodeUrl: string, jwt: string): Promise<boolean> =>
  new Promise((resolve) => {
    const base = nodeUrl.replace(/\/+$/, "");
    const pingUrl = `${base}/api/config`;

    const req = https.request(
      pingUrl,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      },
      (res) => {
        res.resume();
        resolve(true);
      },
    );

    req.on("error", () => resolve(false));
    req.setTimeout(5_000, () => {
      req.destroy();
      resolve(false);
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
 * Poll in two phases until the Sesam node is fully reachable:
 *
 * **Phase 1 — portal**: Poll the portal every 30 s while `provisioning_status`
 * is `provisioning`, `pending`, `hibernated`, or `was_hibernated_due_to_idleness`.
 * No node URL requests are made in this phase.
 *
 * **Phase 2 — node**: When the portal returns `completed` (and not
 * `was_hibernated_due_to_idleness`), switch to pinging the node URL every 10 s.
 * Shows "Provisioning completed successfully! Please allow a few minutes for
 * the subscription to connect." until the ping succeeds.
 *
 * `onReady()` is only called when the node is confirmed reachable — so the
 * caller's `sesam.nodeProvisioning` guard stays active through both phases.
 *
 * Returns a `stop()` function — call it to cancel polling (e.g. on dispose).
 */
export const startProvisioningPoller = (
  jwt: string,
  subId: string,
  nodeUrl: string,
  onStatusChange: (hint: string) => void,
  onReady: () => void,
): { stop: () => void } => {
  const PORTAL_POLL_MS = 30_000;
  const NODE_POLL_MS = 10_000;
  let stopped = false;
  let phase: "portal" | "node" = "portal";
  let handle: ReturnType<typeof setInterval>;

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    if (phase === "portal") {
      const status = await fetchSubscriptionStatus(jwt, subId);

      if (stopped || !status) {
        return;
      }

      const provisioningDone =
        status.provisioning_status === "completed" &&
        status.was_hibernated_due_to_idleness !== true;

      if (provisioningDone) {
        // Portal says provisioning is done — switch to pinging the node directly.
        // Keep sesam.nodeProvisioning = true until the node is actually reachable.
        clearInterval(handle);
        phase = "node";
        onStatusChange(
          "Provisioning completed successfully! Please allow a few minutes for the subscription to connect.",
        );
        handle = setInterval(() => {
          void tick();
        }, NODE_POLL_MS);
      } else {
        const hint = buildStatusHint(status);

        if (hint) {
          onStatusChange(hint);
        }
      }
    } else {
      // phase === "node": ping the node URL until it responds
      const reachable = await pingNode(nodeUrl, jwt);

      if (stopped) {
        return;
      }

      if (reachable) {
        stopped = true;
        clearInterval(handle);
        onReady();
      }
    }
  };

  handle = setInterval(() => {
    void tick();
  }, PORTAL_POLL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
};

/**
 * Convenience wrapper: extract sub-id from JWT → fetch status → build hint string.
 *
 * Returns null when:
 * - The JWT has no `principals` field (non-sesam.cloud tokens)
 * - The portal fetch fails for any reason
 * - The node status is normal (provisioning_status === "completed" or absent)
 *
 * Also triggers `POST /api/analytics` (page_view) for hibernated/provisioning
 * nodes so the portal starts waking the node immediately.
 */
export const fetchNodeStatusHint = async (nodeUrl: string, jwt: string): Promise<string | null> => {
  const subId = extractSubscriptionId(jwt);

  if (!subId) {
    return null;
  }

  const status = await fetchSubscriptionStatus(jwt, subId);

  if (!status) {
    return null;
  }

  const needsWakeUp =
    status.was_hibernated_due_to_idleness === true ||
    status.provisioning_status === "hibernated" ||
    status.provisioning_status === "pending" ||
    status.provisioning_status === "provisioning";

  if (needsWakeUp && !_wakeUpSent.has(subId)) {
    _wakeUpSent.add(subId);
    await triggerNodeWakeUp(jwt, subId);
  }

  return buildStatusHint(status);
};
