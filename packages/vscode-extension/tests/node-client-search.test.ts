/**
 * Integration tests for searchDatasetById and searchDatasetByText.
 *
 * Uses a real local HTTP server so no mocking of Node built-ins is required.
 */

import * as http from "node:http";
import { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchDatasetById, searchDatasetByText } from "../client/src/node-client";

import type { Entity } from "../client/src/node-client";

// ---------------------------------------------------------------------------
// Local test server helpers
// ---------------------------------------------------------------------------

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Start a real HTTP server that responds using the provided handler queue.
 * Each handler in the queue is consumed once, in order.
 * Returns { port, addHandler, close }.
 */
function createTestServer() {
  const handlers: RequestHandler[] = [];

  const server = http.createServer((req, res) => {
    const handler = handlers.shift();

    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(500);
      res.end(JSON.stringify({ message: "Unexpected request" }));
    }
  });

  return {
    start(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          resolve((server.address() as AddressInfo).port);
        });
      });
    },

    /** Queue a response: next incoming request returns this status + body. */
    respond(statusCode: number, body: unknown): void {
      handlers.push((_req, res) => {
        const text = typeof body === "string" ? body : JSON.stringify(body);
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(text);
      });
    },

    /** Queue a handler that also captures the incoming request for assertions. */
    respondAndCapture(
      statusCode: number,
      body: unknown,
      capture: (req: http.IncomingMessage) => void,
    ): void {
      handlers.push((req, res) => {
        capture(req);
        const text = typeof body === "string" ? body : JSON.stringify(body);
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(text);
      });
    },

    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// searchDatasetById
// ---------------------------------------------------------------------------

describe("searchDatasetById", () => {
  const JWT = "test-jwt";
  const DS = "my-dataset";

  let server: ReturnType<typeof createTestServer>;
  let nodeUrl: string;

  beforeEach(async () => {
    server = createTestServer();
    const port = await server.start();
    nodeUrl = `http://localhost:${port}`;
  });

  afterEach(() => server.close());

  it("returns parsed entity array on 200", async () => {
    const entities: Entity[] = [{ _id: "e1", name: "Alice" }];
    server.respond(200, entities);

    const result = await searchDatasetById(nodeUrl, JWT, DS, "e1");

    expect(result).toEqual(entities);
  });

  it("builds the correct request path including the entity id", async () => {
    let capturedUrl = "";
    server.respondAndCapture(200, [], (req) => {
      capturedUrl = req.url ?? "";
    });

    await searchDatasetById(nodeUrl, JWT, DS, "my entity id");

    expect(capturedUrl).toContain("/api/datasets/my-dataset/search");
    expect(capturedUrl).toContain("id=my+entity+id");
  });

  it("sends the Authorization header", async () => {
    let capturedAuth = "";
    server.respondAndCapture(200, [], (req) => {
      capturedAuth = req.headers["authorization"] ?? "";
    });

    await searchDatasetById(nodeUrl, JWT, DS, "e1");

    expect(capturedAuth).toBe(`Bearer ${JWT}`);
  });

  it("throws NodeApiError on 404", async () => {
    server.respond(404, { message: "not found" });

    await expect(searchDatasetById(nodeUrl, JWT, DS, "missing")).rejects.toMatchObject({
      kind: "api",
      statusCode: 404,
    });
  });

  it("throws NodeAuthError on 401", async () => {
    server.respond(401, { message: "Unauthorized" });

    await expect(searchDatasetById(nodeUrl, JWT, DS, "x")).rejects.toMatchObject({
      kind: "auth",
    });
  });
});

// ---------------------------------------------------------------------------
// searchDatasetByText
// ---------------------------------------------------------------------------

describe("searchDatasetByText", () => {
  const JWT = "test-jwt";
  const DS = "my-dataset";

  let server: ReturnType<typeof createTestServer>;
  let nodeUrl: string;

  beforeEach(async () => {
    server = createTestServer();
    const port = await server.start();
    nodeUrl = `http://localhost:${port}`;
  });

  afterEach(() => server.close());

  it("returns all matching entities on a single-page result", async () => {
    const page: Entity[] = [
      { _id: "e1", _ts: 1, name: "Alice" },
      { _id: "e2", _ts: 2, name: "Bob" },
    ];
    server.respond(200, page);
    server.respond(200, []);

    const result = await searchDatasetByText(nodeUrl, JWT, DS, "alice");

    expect(result).toEqual([page[0]]);
  });

  it("returns empty array when no entity matches", async () => {
    const page: Entity[] = [
      { _id: "e1", _ts: 1, name: "Alice" },
      { _id: "e2", _ts: 2, name: "Bob" },
    ];
    server.respond(200, page);
    server.respond(200, []); // empty page signals end of dataset

    const result = await searchDatasetByText(nodeUrl, JWT, DS, "charlie");

    expect(result).toEqual([]);
  });

  it("paginates and finds a match on page 2", async () => {
    const page1: Entity[] = Array.from({ length: 200 }, (_, i) => ({
      _id: `e${i}`,
      _ts: i,
      name: `Entity ${i}`,
    }));
    const page2: Entity[] = [{ _id: "target", _ts: 200, name: "needle" }];

    server.respond(200, page1);
    server.respond(200, page2);

    const result = await searchDatasetByText(nodeUrl, JWT, DS, "needle");

    expect(result).toEqual([page2[0]]);
  });

  it("stops scanning once maxEntities is reached", async () => {
    let requestCount = 0;
    const page: Entity[] = Array.from({ length: 200 }, (_, i) => ({
      _id: `e${i}`,
      _ts: i,
      data: "no match here",
    }));

    // Provide two pages — only the first should be fetched with cap=100
    server.respondAndCapture(200, page, () => {
      requestCount++;
    });
    server.respondAndCapture(200, page, () => {
      requestCount++;
    });

    const result = await searchDatasetByText(nodeUrl, JWT, DS, "needle", 100);

    expect(result).toEqual([]);
    expect(requestCount).toBe(1);
  });

  it("returns empty array when the dataset is empty", async () => {
    server.respond(200, []);

    const result = await searchDatasetByText(nodeUrl, JWT, DS, "anything");

    expect(result).toEqual([]);
  });

  it("propagates NodeApiError on server error", async () => {
    server.respond(500, { message: "Internal Server Error" });

    await expect(searchDatasetByText(nodeUrl, JWT, DS, "x")).rejects.toMatchObject({
      kind: "api",
    });
  });
});
