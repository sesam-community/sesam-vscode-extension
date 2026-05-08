import * as http from "node:http";
import { EventEmitter } from "node:events";

import { vi, describe, it, expect, beforeEach } from "vitest";

import { searchDatasetById, searchDatasetByText } from "../client/src/node-client";

import type { Entity } from "../client/src/node-client";

// ---------------------------------------------------------------------------
// vi.mock is hoisted by Vitest — override http.request with a vi.fn()
// ---------------------------------------------------------------------------

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof http>();

  return {
    ...actual,
    request: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// HTTP mock helpers
// ---------------------------------------------------------------------------

/** Minimal stand-in for http.IncomingMessage */
class MockResponse extends EventEmitter {
  statusCode: number;

  constructor(statusCode: number, body: string) {
    super();
    this.statusCode = statusCode;
    process.nextTick(() => {
      this.emit("data", Buffer.from(body, "utf8"));
      this.emit("end");
    });
  }
}

/** Minimal stand-in for http.ClientRequest */
class MockRequest extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn();
  setTimeout = vi.fn();
}

/**
 * Configure the mocked `http.request` to respond with `statusCode` + `body`
 * on the next call.
 */
function stubHttpRequest(statusCode: number, body: string): void {
  vi.mocked(http.request).mockImplementationOnce((_opts, cb) => {
    const req = new MockRequest();
    const res = new MockResponse(statusCode, body);
    process.nextTick(() =>
      (cb as (r: http.IncomingMessage) => void)(res as unknown as http.IncomingMessage),
    );
    return req as unknown as http.ClientRequest;
  });
}

// ---------------------------------------------------------------------------
// searchDatasetById
// ---------------------------------------------------------------------------

describe("searchDatasetById", () => {
  const NODE_URL = "http://localhost:9042";
  const JWT = "test-jwt";
  const DS = "my-dataset";

  beforeEach(() => {
    vi.mocked(http.request).mockReset();
  });

  it("returns parsed entity array on 200", async () => {
    const entities: Entity[] = [{ _id: "e1", name: "Alice" }];
    stubHttpRequest(200, JSON.stringify(entities));

    const result = await searchDatasetById(NODE_URL, JWT, DS, "e1");

    expect(result).toEqual(entities);
  });

  it("builds the correct request URL including the entity id", async () => {
    stubHttpRequest(200, "[]");

    await searchDatasetById(NODE_URL, JWT, DS, "my entity id");

    const opts = vi.mocked(http.request).mock.calls[0][0] as http.RequestOptions;
    expect(opts.path).toContain("/api/datasets/my-dataset/search");
    expect(opts.path).toContain("id=my+entity+id");
  });

  it("throws NodeApiError on 404", async () => {
    stubHttpRequest(404, JSON.stringify({ message: "not found" }));

    await expect(searchDatasetById(NODE_URL, JWT, DS, "missing")).rejects.toMatchObject({
      kind: "api",
      statusCode: 404,
    });
  });

  it("throws NodeAuthError on 401", async () => {
    stubHttpRequest(401, JSON.stringify({ message: "Unauthorized" }));

    await expect(searchDatasetById(NODE_URL, JWT, DS, "x")).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("sends Authorization header with the JWT", async () => {
    stubHttpRequest(200, "[]");

    await searchDatasetById(NODE_URL, JWT, DS, "e1");

    const opts = vi.mocked(http.request).mock.calls[0][0] as http.RequestOptions;
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${JWT}`);
  });
});

// ---------------------------------------------------------------------------
// searchDatasetByText
// ---------------------------------------------------------------------------

describe("searchDatasetByText", () => {
  const NODE_URL = "http://localhost:9042";
  const JWT = "test-jwt";
  const DS = "my-dataset";

  beforeEach(() => {
    vi.mocked(http.request).mockReset();
  });

  it("returns the first matching entity on a single-page result", async () => {
    const page: Entity[] = [
      { _id: "e1", _ts: 1, name: "Alice" },
      { _id: "e2", _ts: 2, name: "Bob" },
    ];
    stubHttpRequest(200, JSON.stringify(page));
    // second page empty — signals end of dataset (needed only if no match found)
    stubHttpRequest(200, "[]");

    const result = await searchDatasetByText(NODE_URL, JWT, DS, "alice");

    expect(result).toEqual(page[0]);
  });

  it("returns null when no entity matches", async () => {
    const page: Entity[] = [
      { _id: "e1", _ts: 1, name: "Alice" },
      { _id: "e2", _ts: 2, name: "Bob" },
    ];
    stubHttpRequest(200, JSON.stringify(page));
    stubHttpRequest(200, "[]");

    const result = await searchDatasetByText(NODE_URL, JWT, DS, "charlie");

    expect(result).toBeNull();
  });

  it("paginates and finds a match on page 2", async () => {
    // Page 1 — 200 entities that don't contain the query
    const page1: Entity[] = Array.from({ length: 200 }, (_, i) => ({
      _id: `e${i}`,
      _ts: i,
      name: `Entity ${i}`,
    }));

    const page2: Entity[] = [{ _id: "target", _ts: 200, name: "needle" }];

    stubHttpRequest(200, JSON.stringify(page1));
    stubHttpRequest(200, JSON.stringify(page2));

    const result = await searchDatasetByText(NODE_URL, JWT, DS, "needle");

    expect(result).toEqual(page2[0]);
  });

  it("stops scanning once maxEntities is reached", async () => {
    // One page of 200 that doesn't match — cap of 100 stops before a second page
    const page: Entity[] = Array.from({ length: 200 }, (_, i) => ({
      _id: `e${i}`,
      _ts: i,
      data: "no match here",
    }));

    stubHttpRequest(200, JSON.stringify(page));
    // Provide extra stubs in case the function erroneously fetches more pages
    stubHttpRequest(200, JSON.stringify(page));

    const result = await searchDatasetByText(NODE_URL, JWT, DS, "needle", 100);

    expect(result).toBeNull();
    expect(vi.mocked(http.request).mock.calls.length).toBe(1);
  });

  it("returns null when the dataset is empty", async () => {
    stubHttpRequest(200, "[]");

    const result = await searchDatasetByText(NODE_URL, JWT, DS, "anything");

    expect(result).toBeNull();
  });

  it("propagates NodeApiError from the HTTP layer", async () => {
    stubHttpRequest(500, JSON.stringify({ message: "Internal Server Error" }));

    await expect(searchDatasetByText(NODE_URL, JWT, DS, "x")).rejects.toMatchObject({
      kind: "api",
    });
  });
});
