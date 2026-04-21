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

export class SesamLiveUpdates {
  private _socket: Socket | null = null;
  private readonly _onUpdate: LiveUpdateCallback;

  constructor(onUpdate: LiveUpdateCallback) {
    this._onUpdate = onUpdate;
  }

  connect(nodeUrl: string, jwt: string): void {
    this.disconnect();

    const wsUrl = toWebSocketUrl(nodeUrl);

    this._socket = io(wsUrl, {
      path: "/ws/",
      reconnection: true,
      reconnectionAttempts: 1,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ["websocket"],
      upgrade: false,
      auth: { token: `bearer ${jwt}` },
    });

    this._socket.on("connect", () => {
      // 1. Request the initial snapshot
      this._socket?.emit("get_pipes", (data: { data?: Record<string, PipeResponse> }) => {
        const statuses = pipesDataToStatuses(data.data ?? {});
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

    this._socket.on("connect_error", (err: Error) => {
      this._onUpdate([], "error", err.message);
    });

    this._socket.on("disconnect", () => {
      this._onUpdate([], "disconnect");
    });
  }

  get isConnected(): boolean {
    return this._socket?.connected ?? false;
  }

  disconnect(): void {
    this._socket?.close();
    this._socket = null;
  }
}
