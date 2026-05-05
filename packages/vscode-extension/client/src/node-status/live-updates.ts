/**
 * live-updates.ts
 *
 * Manages a Socket.IO connection to the Sesam node and translates raw
 * pipe-status events into PipeStatus[] callbacks. No VS Code API — pure TS.
 *
 * Connection options mirror Management Studio's websocketFactory exactly.
 */

import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

import type { PipeStatus } from "@sesam/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LiveEventType = "snapshot" | "updated" | "added" | "deleted" | "error" | "disconnect";
export type LiveUpdateCallback = (
  statuses: PipeStatus[],
  eventType: LiveEventType,
  errorMessage?: string,
) => void;

export interface LiveConnection {
  connect: (nodeUrl: string, jwt: string) => void;
  disconnect: () => void;
  readonly isConnected: boolean;
}

interface PipeResponse {
  _id: string;
  runtime?: {
    state?: string;
    success_count?: number;
    failure_count?: number;
    queued?: number;
    last_run?: string;
    next_run?: string;
  };
}

interface EngineSocket {
  readyState?: string;
  transport?: { name?: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// How long (ms) to wait for the engine.io handshake before giving up.
const CONNECT_TIMEOUT_MS = 10_000;

// Extra headroom so our guard fires AFTER socket.io's own timeout.
const GUARD_TIMEOUT_MS = CONNECT_TIMEOUT_MS + 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pipesDataToStatuses = (data: Record<string, PipeResponse>): PipeStatus[] =>
  Object.values(data).map((p) => ({
    id: p._id,
    state: p.runtime?.state ?? "unknown",
    successCount: p.runtime?.success_count ?? 0,
    failureCount: p.runtime?.failure_count ?? 0,
    queued: p.runtime?.queued ?? 0,
    lastRun: p.runtime?.last_run,
    nextRun: p.runtime?.next_run,
  }));

/** Converts REST API base URL → WebSocket URL (mirrors MS getWebSocketUrlFromApiUrl). */
export const toWebSocketUrl = (nodeUrl: string): string =>
  nodeUrl
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:")
    .replace(/\/api\/?$/, "");

/**
 * Probe the socket.io polling endpoint over HTTPS and log the raw HTTP
 * status + body. Gives visibility into what the server returns before the
 * WebSocket upgrade, which is otherwise invisible when the connection hangs.
 *
 * URL pattern: https://\<host\>/ws/\?EIO\=4\&transport\=polling
 */
const probeHttp = async (wsUrl: string, jwt: string, log: (msg: string) => void): Promise<void> => {
  const httpUrl = wsUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/?$/, "/ws/?EIO=4&transport=polling");

  log(`probe GET ${httpUrl}`);

  try {
    const res = await fetch(httpUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(8_000),
    });

    let body = "";

    try {
      body = await res.text();
    } catch {
      body = "(could not read body)";
    }

    log(`probe response: HTTP ${res.status}  body=${body.slice(0, 300)}`);
  } catch (err) {
    log(`probe error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a live-updates connection handle.
 *
 * Returns { connect, disconnect, isConnected } — call connect() to open
 * the socket and disconnect() to tear it down. The handle is stateful via
 * closure (current socket + guard timer) but exposes a pure functional API.
 */
export const createLiveConnection = (
  onUpdate: LiveUpdateCallback,
  log: (msg: string) => void = () => {},
): LiveConnection => {
  let socket: Socket | null = null;
  let guardTimer: ReturnType<typeof setTimeout> | undefined;

  const clearGuardTimer = (): void => {
    if (guardTimer !== undefined) {
      clearTimeout(guardTimer);
      guardTimer = undefined;
    }
  };

  const disconnect = (): void => {
    clearGuardTimer();
    socket?.close();
    socket = null;
  };

  const connect = (nodeUrl: string, jwt: string): void => {
    disconnect(); // close any existing socket + clear guard timer

    const wsUrl = toWebSocketUrl(nodeUrl);
    const jwtHint = jwt.length > 16 ? `${jwt.slice(0, 8)}…${jwt.slice(-4)}` : "(short)";
    log(`io() → url="${wsUrl}" path="/ws/" jwt=${jwtHint}`);

    // Probe the polling endpoint for diagnostics (fire-and-forget).
    void probeHttp(wsUrl, jwt, log);

    // transports: ["polling", "websocket"] — start with HTTP long-polling
    // (which the server accepts unconditionally) then let socket.io upgrade
    // to WebSocket automatically. Using transports: ["websocket"] alone
    // sends a bare WebSocket upgrade without a prior session; the Sesam server
    // silently drops that request (the Node.js extension host sends no Origin
    // header), causing a silent 10-second hang instead of an error.
    socket = io(wsUrl, {
      path: "/ws/",
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
      transports: ["polling", "websocket"],
      auth: { token: `bearer ${jwt}` },
      forceNew: true,
    });

    // Manager lifecycle logs.
    socket.io.on("open", () => log("manager: open"));
    socket.io.on("error", (err: Error) => log(`manager: error  ${err?.message ?? err}`));
    socket.io.on("close", (reason: string) => log(`manager: close  reason="${reason}"`));
    socket.io.on("ping", () => log("manager: ping"));
    socket.io.on("reconnect_attempt", (n: number) => log(`manager: reconnect_attempt #${n}`));
    socket.io.on("reconnect_error", (err: Error) => log(`manager: reconnect_error  ${err?.message}`));
    socket.io.on("reconnect_failed", () => log("manager: reconnect_failed"));

    // Transport-level connect log.
    socket.on("connect", () => {
      const eng = (socket?.io as { engine?: EngineSocket } | undefined)?.engine;
      log(`socket: connect  transport=${eng?.transport?.name ?? "?"}`);
    });

    // Belt-and-suspenders guard: if socket.io's own timeout doesn't fire
    // (can happen when the TCP connection is accepted but the HTTP upgrade
    // stalls silently), we force-fail after a fixed deadline.
    guardTimer = setTimeout(() => {
      guardTimer = undefined;

      if (!socket?.connected) {
        const eng = (socket?.io as { engine?: EngineSocket } | undefined)?.engine;
        log(
          `guard timer fired — engine.readyState="${eng?.readyState ?? "?"}" socket.connected=${socket?.connected ?? false}`,
        );
        disconnect();
        onUpdate([], "error", "timeout");
      }
    }, GUARD_TIMEOUT_MS);

    socket.on("connect", () => {
      clearGuardTimer();

      // 1. Request the initial snapshot.
      socket?.emit("get_pipes", (data: { data?: Record<string, PipeResponse> }) => {
        const statuses = pipesDataToStatuses(data.data ?? {});
        log(`get_pipes callback: ${statuses.length} pipes`);
        onUpdate(statuses, "snapshot");
      });

      // 2. Subscribe to incremental push events.
      socket?.emit("subscribe_pipes");
    });

    (["pipes_added", "pipes_updated", "pipes_deleted"] as const).forEach((event) => {
      socket?.on(event, (data: { data?: Record<string, PipeResponse> }) => {
        const statuses = pipesDataToStatuses(data.data ?? {});
        const type: LiveEventType =
          event === "pipes_added" ? "added" : event === "pipes_deleted" ? "deleted" : "updated";
        onUpdate(statuses, type);
      });
    });

    socket.on("connect_error", (err: Error & { data?: unknown; cause?: unknown }) => {
      clearGuardTimer();
      const cause = err.cause instanceof Error ? err.cause.message : String(err.cause ?? "");
      const data = err.data !== undefined ? JSON.stringify(err.data) : "";
      log(
        `connect_error: message="${err.message}"${cause ? `  cause="${cause}"` : ""}${data ? `  data=${data}` : ""}`,
      );
      onUpdate([], "error", err.message);
    });

    socket.on("disconnect", (reason: string) => {
      clearGuardTimer();
      log(`socket: disconnect  reason="${reason}"`);
      onUpdate([], "disconnect");
    });
  };

  return {
    connect,
    disconnect,
    get isConnected() {
      return socket?.connected ?? false;
    },
  };
};
