/**
 * SesamLiveUpdates
 *
 * Manages a Socket.IO connection to the Sesam node and translates raw
 * pipe-status events into PipeStatus[] callbacks. No VS Code API — pure TS.
 *
 * Connection options mirror Management Studio's websocketFactory exactly.
 */

import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

interface EngineSocket {
  readyState?: string;
  transport?: { name?: string };
}

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

// ---------------------------------------------------------------------------
// SesamLiveUpdates
// ---------------------------------------------------------------------------

// How long (ms) to wait for the engine.io handshake before giving up.
// socket.io-client's internal timeout fires onError() directly, but with the
// Node.js `ws` library the TCP connection can hang silently (no error, no
// close) while the timer is still running.  With `reconnection: false` a
// single attempt costs at most CONNECT_TIMEOUT_MS before we report failure.
const CONNECT_TIMEOUT_MS = 10_000;

// Extra headroom so our guard fires AFTER socket.io's own timeout.
const GUARD_TIMEOUT_MS = CONNECT_TIMEOUT_MS + 2_000;

export class SesamLiveUpdates {
  private _socket: Socket | null = null;
  private _guardTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _onUpdate: LiveUpdateCallback;
  private readonly _log: (msg: string) => void;

  constructor(onUpdate: LiveUpdateCallback, log: (msg: string) => void = () => {}) {
    this._onUpdate = onUpdate;
    this._log = log;
  }

  connect(nodeUrl: string, jwt: string): void {
    this.disconnect(); // clears _socket and _guardTimer

    const wsUrl = toWebSocketUrl(nodeUrl);
    const jwtHint = jwt.length > 16 ? `${jwt.slice(0, 8)}…${jwt.slice(-4)}` : "(short)";
    this._log(`io() → url="${wsUrl}" path="/ws/" jwt=${jwtHint}`);

    // Probe the socket.io polling endpoint over HTTPS before opening the WebSocket.
    // This lets us see the raw HTTP status + body the server sends back,
    // which is hidden once we switch to a WebSocket transport.
    void this._probeHttp(wsUrl, jwt);

    // forceNew: true — bypass the socket.io-client Manager cache so each
    // connect() call gets a fresh Manager with no leftover state.
    // reconnection: false — a single attempt; if it fails we surface the
    // error immediately instead of silently retrying for another 20+ seconds.
    //
    // transports: ["polling", "websocket"] — start with HTTP long-polling
    // (which the server accepts unconditionally) then let socket.io upgrade
    // to WebSocket automatically. Using transports: ["websocket"] alone
    // sends a bare WebSocket upgrade without a prior session; the Sesam server
    // silently drops that request (the Node.js extension host sends no Origin
    // header), causing a silent 10-second hang instead of an error.
    this._socket = io(wsUrl, {
      path: "/ws/",
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
      transports: ["polling", "websocket"],
      auth: { token: `bearer ${jwt}` },
      forceNew: true,
    });

    // Hook into the underlying engine.io socket for granular lifecycle logs.
    // engine is not set synchronously, but "engine" fires on the Manager when
    // the engine socket is created (before any handshake).
    this._socket.io.on("open", () => this._log("manager: open"));
    this._socket.io.on("error", (err: Error) =>
      this._log(`manager: error  ${err?.message ?? err}`),
    );
    this._socket.io.on("close", (reason: string) =>
      this._log(`manager: close  reason="${reason}"`),
    );
    this._socket.io.on("ping", () => this._log("manager: ping"));
    this._socket.io.on("reconnect_attempt", (n: number) =>
      this._log(`manager: reconnect_attempt #${n}`),
    );
    this._socket.io.on("reconnect_error", (err: Error) =>
      this._log(`manager: reconnect_error  ${err?.message}`),
    );
    this._socket.io.on("reconnect_failed", () => this._log("manager: reconnect_failed"));

    // engine.io transport-level events (available on socket.io.engine once assigned)
    this._socket.on("connect", () => {
      const eng = (this._socket?.io as { engine?: EngineSocket } | undefined)?.engine;
      this._log(`socket: connect  transport=${eng?.transport?.name ?? "?"}`);
    });

    // Belt-and-suspenders guard: if socket.io's own timeout doesn't fire
    // (can happen when the TCP connection is accepted but the HTTP upgrade
    // stalls silently in the Node.js `ws` library), we force-fail after a
    // fixed deadline so the UI never stays stuck.
    this._guardTimer = setTimeout(() => {
      this._guardTimer = undefined;

      if (!this.isConnected) {
        const eng = (this._socket?.io as { engine?: EngineSocket } | undefined)?.engine;
        this._log(
          `guard timer fired — engine.readyState="${eng?.readyState ?? "?"}" socket.connected=${this._socket?.connected ?? false}`,
        );
        this.disconnect();
        this._onUpdate([], "error", "timeout");
      }
    }, GUARD_TIMEOUT_MS);

    this._socket.on("connect", () => {
      this._clearGuardTimer();

      // 1. Request the initial snapshot
      this._socket?.emit("get_pipes", (data: { data?: Record<string, PipeResponse> }) => {
        const statuses = pipesDataToStatuses(data.data ?? {});
        this._log(`get_pipes callback: ${statuses.length} pipes`);
        this._onUpdate(statuses, "snapshot");
      });

      // 2. Subscribe to incremental push events
      this._socket?.emit("subscribe_pipes");
    });

    (["pipes_added", "pipes_updated", "pipes_deleted"] as const).forEach((event) => {
      this._socket?.on(event, (data: { data?: Record<string, PipeResponse> }) => {
        const statuses = pipesDataToStatuses(data.data ?? {});
        const type: LiveEventType =
          event === "pipes_added" ? "added" : event === "pipes_deleted" ? "deleted" : "updated";
        this._onUpdate(statuses, type);
      });
    });

    this._socket.on("connect_error", (err: Error & { data?: unknown; cause?: unknown }) => {
      this._clearGuardTimer();
      const cause = err.cause instanceof Error ? err.cause.message : String(err.cause ?? "");
      const data = err.data !== undefined ? JSON.stringify(err.data) : "";
      this._log(
        `connect_error: message="${err.message}"${cause ? `  cause="${cause}"` : ""}${data ? `  data=${data}` : ""}`,
      );
      this._onUpdate([], "error", err.message);
    });

    this._socket.on("disconnect", (reason: string) => {
      this._clearGuardTimer();
      this._log(`socket: disconnect  reason="${reason}"`);
      this._onUpdate([], "disconnect");
    });
  }

  get isConnected(): boolean {
    return this._socket?.connected ?? false;
  }

  disconnect(): void {
    this._clearGuardTimer();
    this._socket?.close();
    this._socket = null;
  }

  private _clearGuardTimer(): void {
    if (this._guardTimer !== undefined) {
      clearTimeout(this._guardTimer);
      this._guardTimer = undefined;
    }
  }

  /**
   * Probe the socket.io polling endpoint over HTTPS and log the raw HTTP
   * status + body. This gives us visibility into what the server actually
   * returns before the WebSocket upgrade, which is otherwise invisible when
   * the connection silently hangs.
   *
   * URL pattern: https://<host>/ws/?EIO=4&transport=polling
   */
  private async _probeHttp(wsUrl: string, jwt: string): Promise<void> {
    const httpUrl = wsUrl
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/?$/, "/ws/?EIO=4&transport=polling");

    this._log(`probe GET ${httpUrl}`);

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

      this._log(`probe response: HTTP ${res.status}  body=${body.slice(0, 300)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._log(`probe error: ${msg}`);
    }
  }
}
