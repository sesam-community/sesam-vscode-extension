/**
 * NodeClient unit tests.
 *
 * Uses vi.stubGlobal to replace the global `fetch` with a controlled stub.
 * No live Sesam node is required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NodeApiError, NodeAuthError, NodeNetworkError } from "../src/errors.js";
import { NodeClient } from "../src/node-client.js";

// ---------------------------------------------------------------------------
// Test credentials
// ---------------------------------------------------------------------------

const CREDS = {
  nodeUrl: "https://datahub-test.sesam.cloud",
  jwtToken: "test-jwt",
};

const API_BASE = "https://datahub-test.sesam.cloud/api";

// ---------------------------------------------------------------------------
// Fetch stub helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake Response that `fetch` would return.
 */
function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

/**
 * Stub globalThis.fetch with a function that returns the given response for
 * the first call (and optionally subsequent calls via an array).
 */
function stubFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  const stub = vi.fn(() => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return Promise.resolve(resp);
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("NodeClient — error handling", () => {
  it("throws NodeNetworkError when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const client = new NodeClient(CREDS);
    await expect(client.getPipes()).rejects.toBeInstanceOf(NodeNetworkError);
  });

  it("throws NodeAuthError on HTTP 401", async () => {
    stubFetch(makeResponse(401, "Unauthorized"));

    const client = new NodeClient(CREDS);
    const err = await client.getPipes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NodeAuthError);
    expect((err as NodeAuthError).statusCode).toBe(401);
  });

  it("throws NodeAuthError on HTTP 403", async () => {
    stubFetch(makeResponse(403, "Forbidden"));

    const client = new NodeClient(CREDS);
    await expect(client.getPipes()).rejects.toBeInstanceOf(NodeAuthError);
  });

  it("throws NodeApiError on HTTP 500", async () => {
    stubFetch(makeResponse(500, "Internal server error"));

    const client = new NodeClient(CREDS);
    const err = await client.getPipes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NodeApiError);
    expect((err as NodeApiError).statusCode).toBe(500);
  });

  it("includes response body text in NodeApiError message", async () => {
    stubFetch(makeResponse(422, "Pipe validation failed"));

    const client = new NodeClient(CREDS);
    const err = await client.getPipes().catch((e: unknown) => e);
    expect((err as NodeApiError).message).toContain("Pipe validation failed");
  });
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

describe("NodeClient — request shape", () => {
  it("sends Authorization header with Bearer token", async () => {
    const stub = stubFetch(makeResponse(200, []));

    await new NodeClient(CREDS).getPipes();

    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/pipes`);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-jwt");
  });

  it("strips trailing slash from nodeUrl", async () => {
    const stub = stubFetch(makeResponse(200, []));
    await new NodeClient({ ...CREDS, nodeUrl: "https://datahub-test.sesam.cloud/" }).getPipes();

    const [url] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/pipes`);
  });
});

// ---------------------------------------------------------------------------
// getPipes / getSystems
// ---------------------------------------------------------------------------

describe("NodeClient.getPipes()", () => {
  it("returns parsed pipe array", async () => {
    const pipes = [
      { _id: "pipe-a", runtime: { state: "ok" } },
      { _id: "pipe-b", runtime: { state: "Deploying" } },
    ];
    stubFetch(makeResponse(200, pipes));

    const result = await new NodeClient(CREDS).getPipes();
    expect(result).toHaveLength(2);
    expect(result[0]._id).toBe("pipe-a");
  });
});

describe("NodeClient.getSystems()", () => {
  it("returns parsed system array", async () => {
    const systems = [{ _id: "my-system" }];
    stubFetch(makeResponse(200, systems));

    const result = await new NodeClient(CREDS).getSystems();
    expect(result[0]._id).toBe("my-system");
  });
});

// ---------------------------------------------------------------------------
// getPipeEntities
// ---------------------------------------------------------------------------

describe("NodeClient.getPipeEntities()", () => {
  it("fetches entities from the correct URL", async () => {
    const entities = [{ _id: "e1" }, { _id: "e2" }];
    const stub = stubFetch(makeResponse(200, entities));

    const result = await new NodeClient(CREDS).getPipeEntities("output-pipe");

    const [url] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/pipes/output-pipe/entities`);
    expect(result).toHaveLength(2);
  });

  it("appends stage query param when provided", async () => {
    const stub = stubFetch(makeResponse(200, []));
    await new NodeClient(CREDS).getPipeEntities("my-pipe", "source");

    const [url] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("stage=source");
  });

  it("URL-encodes pipe IDs containing special characters", async () => {
    const stub = stubFetch(makeResponse(200, []));
    await new NodeClient(CREDS).getPipeEntities("pipe/with/slashes");

    const [url] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("pipe%2Fwith%2Fslashes");
  });
});

// ---------------------------------------------------------------------------
// putConfig
// ---------------------------------------------------------------------------

describe("NodeClient.putConfig()", () => {
  it("sends PUT with application/zip content type", async () => {
    const stub = stubFetch(makeResponse(204, ""));
    await new NodeClient(CREDS).putConfig(Buffer.from("fake-zip"));

    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/config`);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/zip");
  });

  it("appends ?force=true when force=true", async () => {
    const stub = stubFetch(makeResponse(204, ""));
    await new NodeClient(CREDS).putConfig(Buffer.from("fake-zip"), true);

    const [url] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("force=true");
  });
});

// ---------------------------------------------------------------------------
// putEnvVars
// ---------------------------------------------------------------------------

describe("NodeClient.putEnvVars()", () => {
  it("sends PUT to /env with JSON body", async () => {
    const stub = stubFetch(makeResponse(204, ""));
    await new NodeClient(CREDS).putEnvVars({ MY_VAR: "hello" });

    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/env`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ MY_VAR: "hello" }));
  });
});

// ---------------------------------------------------------------------------
// runAllPipes
// ---------------------------------------------------------------------------

describe("NodeClient.runAllPipes()", () => {
  it("POSTs to /pipes/run-all-pipes", async () => {
    const stub = stubFetch(makeResponse(200, ""));
    await new NodeClient(CREDS).runAllPipes();

    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("pipes/run-all-pipes");
    expect(init.method).toBe("POST");
  });

  it("includes extra_zero_runs query param when provided", async () => {
    const stub = stubFetch(makeResponse(200, ""));
    await new NodeClient(CREDS).runAllPipes({ extraZeroRuns: 2 });

    const [url] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("extra_zero_runs=2");
  });
});

// ---------------------------------------------------------------------------
// startPump
// ---------------------------------------------------------------------------

describe("NodeClient.startPump()", () => {
  it("sends PUT to the correct pump URL", async () => {
    const stub = stubFetch(makeResponse(200, ""));
    await new NodeClient(CREDS).startPump("my-pipe");

    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("pipes/my-pipe/pump");
    expect(url).toContain("operation=start");
    expect(init.method).toBe("PUT");
  });
});

// ---------------------------------------------------------------------------
// waitForDeploy
// ---------------------------------------------------------------------------

describe("NodeClient.waitForDeploy()", () => {
  it("resolves immediately when no pipe is Deploying", async () => {
    stubFetch(makeResponse(200, [{ _id: "p", runtime: { state: "ok" } }]));

    await expect(new NodeClient(CREDS).waitForDeploy()).resolves.toBeUndefined();
  });

  it("polls until deployment finishes", async () => {
    // First call: Deploying; second call: ok
    const stub = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(200, [{ _id: "p", runtime: { state: "Deploying" } }]))
      .mockResolvedValueOnce(makeResponse(200, [{ _id: "p", runtime: { state: "ok" } }]));

    vi.stubGlobal("fetch", stub);

    // Speed up polling by using a short timeout; real sleep is replaced below.
    vi.useFakeTimers();
    const deployPromise = new NodeClient(CREDS).waitForDeploy(10_000);

    // Advance clock past the 2000 ms sleep
    await vi.advanceTimersByTimeAsync(3_000);
    await deployPromise;

    expect(stub).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws NodeApiError when timeout is exceeded", async () => {
    // Always return Deploying
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeResponse(200, [{ _id: "p", runtime: { state: "Deploying" } }])),
    );

    vi.useFakeTimers();
    const deployPromise = new NodeClient(CREDS).waitForDeploy(3_000);

    // Attach the rejection assertion BEFORE advancing the clock so the
    // rejection is never "unhandled" from Node's perspective.
    const assertion = expect(deployPromise).rejects.toBeInstanceOf(NodeApiError);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// previewPipe
// ---------------------------------------------------------------------------

describe("NodeClient.previewPipe()", () => {
  it("POSTs entities and returns the response array", async () => {
    const input = [{ _id: "in1" }];
    const output = [{ _id: "out1", name: "Alice" }];
    const stub = stubFetch(makeResponse(200, output));

    const result = await new NodeClient(CREDS).previewPipe("transform-pipe", input);

    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("pipes/transform-pipe/preview");
    expect(init.method).toBe("POST");
    expect(result).toEqual(output);
  });
});
