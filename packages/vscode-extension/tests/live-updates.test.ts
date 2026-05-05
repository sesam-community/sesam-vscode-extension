import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { createLiveConnection, toWebSocketUrl } from "../client/src/node-status/live-updates";

import type { LiveConnection, LiveEventType } from "../client/src/node-status/live-updates";
import type { PipeStatus } from "@sesam/core";

// ---------------------------------------------------------------------------
// Mock socket.io-client
// ---------------------------------------------------------------------------

type Handler = (...args: unknown[]) => void;

interface MockSocket {
  connected: boolean;
  on: (event: string, handler: Handler) => MockSocket;
  emit: (event: string, ...args: unknown[]) => MockSocket;
  close: () => void;
  io: { on: (event: string, handler: Handler) => void };
  /** Fire all handlers registered for `event`. */
  _fire: (event: string, ...args: unknown[]) => void;
  /** Call the callback argument of the last `emit(event, ..., callback)` call. */
  _resolveEmit: (event: string, response: unknown) => void;
  /** Return all events emitted so far. */
  _emitted: () => Array<{ event: string; args: unknown[] }>;
}

let _latestSocket: MockSocket;
let _lastIoCall: { url: string; opts: Record<string, unknown> } | undefined;

const createMockSocket = (): MockSocket => {
  const handlers: Record<string, Handler[]> = {};
  const emits: Array<{ event: string; args: unknown[] }> = [];

  const socket: MockSocket = {
    connected: false,

    on(event, handler) {
      (handlers[event] ??= []).push(handler);
      return socket;
    },

    emit(event, ...args) {
      emits.push({ event, args });
      return socket;
    },

    close() {
      socket.connected = false;
    },

    io: {
      on(_event, _handler) {
        // manager lifecycle events — not needed for core behaviour tests
      },
    },

    _fire(event, ...args) {
      handlers[event]?.forEach((h) => h(...args));
    },

    _resolveEmit(event, response) {
      const entry = [...emits].reverse().find((e) => e.event === event);
      const cb = entry?.args.find((a) => typeof a === "function") as Handler | undefined;
      cb?.(response);
    },

    _emitted() {
      return [...emits];
    },
  };

  return socket;
};

vi.mock("socket.io-client", () => ({
  io: (url: string, opts: Record<string, unknown>) => {
    _lastIoCall = { url, opts };
    _latestSocket = createMockSocket();
    return _latestSocket;
  },
}));

// Silence _probeHttp — it uses fetch() which is irrelevant to these tests.
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, text: async () => "mocked" }));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FAKE_PIPES = {
  "pipe-a": {
    _id: "pipe-a",
    runtime: {
      state: "running",
      success_count: 10,
      failure_count: 0,
      queued: 0,
      last_run: "2024-01-01T00:00:00Z",
    },
  },
  "pipe-b": {
    _id: "pipe-b",
    runtime: { state: "stopped", success_count: 3, failure_count: 2, queued: 1 },
  },
};

const EXPECTED_STATUSES: PipeStatus[] = [
  {
    id: "pipe-a",
    state: "running",
    successCount: 10,
    failureCount: 0,
    queued: 0,
    lastRun: "2024-01-01T00:00:00Z",
    nextRun: undefined,
  },
  {
    id: "pipe-b",
    state: "stopped",
    successCount: 3,
    failureCount: 2,
    queued: 1,
    lastRun: undefined,
    nextRun: undefined,
  },
];

// ---------------------------------------------------------------------------
// toWebSocketUrl
// ---------------------------------------------------------------------------

describe("toWebSocketUrl", () => {
  it("converts https to wss and strips /api", () => {
    expect(toWebSocketUrl("https://datahub-abc.sesam.cloud/api")).toBe(
      "wss://datahub-abc.sesam.cloud",
    );
  });

  it("converts http to ws and strips /api", () => {
    expect(toWebSocketUrl("http://localhost:9042/api")).toBe("ws://localhost:9042");
  });

  it("strips trailing slash on /api/", () => {
    expect(toWebSocketUrl("https://datahub-abc.sesam.cloud/api/")).toBe(
      "wss://datahub-abc.sesam.cloud",
    );
  });

  it("preserves port numbers", () => {
    expect(toWebSocketUrl("http://node.local:5000/api")).toBe("ws://node.local:5000");
  });
});

// ---------------------------------------------------------------------------
// createLiveConnection
// ---------------------------------------------------------------------------

describe("createLiveConnection", () => {
  let updates: Array<{ statuses: PipeStatus[]; eventType: LiveEventType; errorMessage?: string }>;
  let liveUpdates: LiveConnection;

  beforeEach(() => {
    updates = [];
    liveUpdates = createLiveConnection((statuses, eventType, errorMessage) => {
      updates.push({ statuses, eventType, errorMessage });
    });
  });

  afterEach(() => {
    liveUpdates.disconnect();
    vi.useRealTimers();
  });

  // ── connect options ──────────────────────────────────────────────────────

  it("opens the socket with polling+websocket transports and correct path", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "my-jwt");

    expect(_lastIoCall?.url).toBe("wss://node.sesam.cloud");
    expect(_lastIoCall?.opts).toMatchObject({ path: "/ws/", transports: ["polling", "websocket"] });
  });

  it("passes the JWT in the auth token", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "test-jwt-value");

    expect(_lastIoCall?.opts).toMatchObject({ auth: { token: "bearer test-jwt-value" } });
  });

  // ── snapshot ─────────────────────────────────────────────────────────────

  it("delivers a snapshot when get_pipes callback resolves after connect", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const socket = _latestSocket;

    socket.connected = true;
    socket._fire("connect");
    socket._resolveEmit("get_pipes", { data: FAKE_PIPES });

    expect(updates).toHaveLength(1);
    expect(updates[0].eventType).toBe("snapshot");
    expect(updates[0].statuses).toEqual(EXPECTED_STATUSES);
  });

  it("emits subscribe_pipes after connect", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const socket = _latestSocket;

    socket.connected = true;
    socket._fire("connect");

    const emitted = socket._emitted().map((e) => e.event);
    expect(emitted).toContain("subscribe_pipes");
  });

  it("maps runtime fields to PipeStatus correctly", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const socket = _latestSocket;

    socket.connected = true;
    socket._fire("connect");
    socket._resolveEmit("get_pipes", {
      data: {
        p: {
          _id: "p",
          runtime: {
            state: "failed",
            success_count: 1,
            failure_count: 9,
            queued: 3,
            last_run: "2025-01-01",
            next_run: "2025-01-02",
          },
        },
      },
    });

    const { statuses } = updates[0];
    expect(statuses[0]).toEqual({
      id: "p",
      state: "failed",
      successCount: 1,
      failureCount: 9,
      queued: 3,
      lastRun: "2025-01-01",
      nextRun: "2025-01-02",
    });
  });

  it("uses 'unknown' state when runtime is absent", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const socket = _latestSocket;

    socket.connected = true;
    socket._fire("connect");
    socket._resolveEmit("get_pipes", { data: { x: { _id: "x" } } });

    expect(updates[0].statuses[0].state).toBe("unknown");
  });

  // ── incremental events ───────────────────────────────────────────────────

  it("pipes_updated fires the 'updated' callback", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");

    _latestSocket._fire("pipes_updated", { data: FAKE_PIPES });

    expect(updates[0].eventType).toBe("updated");
    expect(updates[0].statuses).toEqual(EXPECTED_STATUSES);
  });

  it("pipes_added fires the 'added' callback", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");

    _latestSocket._fire("pipes_added", { data: { "pipe-a": FAKE_PIPES["pipe-a"] } });

    expect(updates[0].eventType).toBe("added");
    expect(updates[0].statuses[0].id).toBe("pipe-a");
  });

  it("pipes_deleted fires the 'deleted' callback", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");

    _latestSocket._fire("pipes_deleted", { data: { "pipe-b": FAKE_PIPES["pipe-b"] } });

    expect(updates[0].eventType).toBe("deleted");
    expect(updates[0].statuses[0].id).toBe("pipe-b");
  });

  // ── error ────────────────────────────────────────────────────────────────

  it("connect_error fires 'error' callback with the error message", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");

    _latestSocket._fire("connect_error", Object.assign(new Error("token expired"), { data: null }));

    expect(updates[0].eventType).toBe("error");
    expect(updates[0].errorMessage).toBe("token expired");
    expect(updates[0].statuses).toEqual([]);
  });

  // ── disconnect ───────────────────────────────────────────────────────────

  it("socket disconnect event fires 'disconnect' callback", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");

    _latestSocket._fire("disconnect", "transport close");

    expect(updates[0].eventType).toBe("disconnect");
    expect(updates[0].statuses).toEqual([]);
  });

  // ── disconnect() method ──────────────────────────────────────────────────

  it("disconnect() closes the socket", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const socket = _latestSocket;
    socket.connected = true;

    expect(liveUpdates.isConnected).toBe(true);

    liveUpdates.disconnect();

    expect(socket.connected).toBe(false);
    expect(liveUpdates.isConnected).toBe(false);
  });

  it("calling connect() again while connected closes the previous socket", () => {
    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const first = _latestSocket;
    first.connected = true;

    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const second = _latestSocket;

    expect(first.connected).toBe(false);
    expect(first).not.toBe(second);
  });

  // ── guard timer ──────────────────────────────────────────────────────────

  it("guard timer fires 'error: timeout' when socket never connects", () => {
    vi.useFakeTimers();

    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    // socket stays disconnected

    vi.advanceTimersByTime(12_001);

    expect(updates).toHaveLength(1);
    expect(updates[0].eventType).toBe("error");
    expect(updates[0].errorMessage).toBe("timeout");
  });

  it("guard timer does not fire when socket connects in time", () => {
    vi.useFakeTimers();

    liveUpdates.connect("https://node.sesam.cloud/api", "jwt");
    const socket = _latestSocket;

    socket.connected = true;
    socket._fire("connect");

    vi.advanceTimersByTime(12_001);

    // Only the snapshot callback (from get_pipes if resolved), no guard error
    const errors = updates.filter((u) => u.eventType === "error");
    expect(errors).toHaveLength(0);
  });
});
