/**
 * Tests for download.ts, upload.ts, run-pipes.ts, status.ts and sync-status.ts.
 *
 * NodeClient is mocked so no live Sesam node is required.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// NodeClient mock — must be declared before importing the modules under test
// ---------------------------------------------------------------------------

vi.mock("../src/node-client.js", () => {
  const NodeClient = vi.fn();
  NodeClient.prototype.getPipes = vi.fn();
  NodeClient.prototype.getSystems = vi.fn();
  NodeClient.prototype.getPipe = vi.fn();
  NodeClient.prototype.getSystem = vi.fn();
  NodeClient.prototype.startPump = vi.fn();
  NodeClient.prototype.runAllPipes = vi.fn();
  NodeClient.prototype.putConfig = vi.fn();
  NodeClient.prototype.waitForDeploy = vi.fn();
  NodeClient.prototype.putEnvVars = vi.fn();
  NodeClient.prototype.putPipeConfig = vi.fn();
  NodeClient.prototype.putSystemConfig = vi.fn();
  return { NodeClient };
});

// validateWorkspace: always passes (unless we override in a test)
vi.mock("../src/validate.js", () => ({
  validateWorkspace: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

// zipWorkspaceConfig: returns a tiny stub buffer
vi.mock("../src/config-zipper.js", () => ({
  zipWorkspaceConfig: vi.fn().mockResolvedValue(Buffer.from("zip")),
}));

import { NodeClient } from "../src/node-client.js";
import { downloadConfig, downloadSingleConfig } from "../src/download.js";
import { uploadConfig, uploadSingleConfig } from "../src/upload.js";
import { runPipe, runAllPipes } from "../src/run-pipes.js";
import { getStatus, getPipeStatus } from "../src/status.js";
import { getNodeConfig, getSyncStatus } from "../src/sync-status.js";
import { validateWorkspace } from "../src/validate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CREDS = { nodeUrl: "https://hub.sesam.cloud", jwtToken: "tok" };

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sesam-node-ops-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Typed reference to the mock constructor instance
const client = (): InstanceType<typeof NodeClient> =>
  (NodeClient as ReturnType<typeof vi.fn>).mock.instances[0];

// ---------------------------------------------------------------------------
// downloadConfig
// ---------------------------------------------------------------------------

describe("downloadConfig", () => {
  it("writes pipe config files to outDir/pipes/", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "my-pipe", config: { original: { _id: "my-pipe", type: "pipe" } } },
    ]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await downloadConfig(CREDS, { outDir: tmpDir });

    expect(result.pipesWritten).toBe(1);
    expect(result.systemsWritten).toBe(0);

    const content = await fs.readFile(path.join(tmpDir, "pipes", "my-pipe.conf.json"), "utf-8");
    expect(JSON.parse(content)).toEqual({ _id: "my-pipe", type: "pipe" });
  });

  it("writes system config files to outDir/systems/", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "my-sys", config: { original: { _id: "my-sys", type: "system:rest" } } },
    ]);

    const result = await downloadConfig(CREDS, { outDir: tmpDir });

    expect(result.pipesWritten).toBe(0);
    expect(result.systemsWritten).toBe(1);

    const content = await fs.readFile(path.join(tmpDir, "systems", "my-sys.conf.json"), "utf-8");
    expect(JSON.parse(content)["_id"]).toBe("my-sys");
  });

  it("uses the formatter when provided", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "p", config: { original: { _id: "p" } } },
    ]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const formatter = vi.fn().mockReturnValue("FORMATTED");
    await downloadConfig(CREDS, { outDir: tmpDir, formatter });

    expect(formatter).toHaveBeenCalledOnce();
    const content = await fs.readFile(path.join(tmpDir, "pipes", "p.conf.json"), "utf-8");
    expect(content).toBe("FORMATTED");
  });

  it("falls back to the envelope root when 'original' is absent", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "p", config: { _id: "p", type: "pipe" } },
    ]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await downloadConfig(CREDS, { outDir: tmpDir });
    const content = await fs.readFile(path.join(tmpDir, "pipes", "p.conf.json"), "utf-8");
    expect(JSON.parse(content)["_id"]).toBe("p");
  });

  it("skips pipes that have no config", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "no-config" },
    ]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await downloadConfig(CREDS, { outDir: tmpDir });
    expect(result.pipesWritten).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// downloadSingleConfig
// ---------------------------------------------------------------------------

describe("downloadSingleConfig", () => {
  it("downloads a single pipe by id", async () => {
    (NodeClient.prototype.getPipe as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "p1",
      config: { original: { _id: "p1", type: "pipe" } },
    });

    const result = await downloadSingleConfig(CREDS, "p1", "pipe", { outDir: tmpDir });

    expect(result.configId).toBe("p1");
    expect(result.configType).toBe("pipe");
    expect(result.filePath).toContain("p1.conf.json");
    const content = await fs.readFile(result.filePath, "utf-8");
    expect(JSON.parse(content)["_id"]).toBe("p1");
  });

  it("downloads a single system by id", async () => {
    (NodeClient.prototype.getSystem as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "s1",
      config: { original: { _id: "s1", type: "system:rest" } },
    });

    const result = await downloadSingleConfig(CREDS, "s1", "system", { outDir: tmpDir });

    expect(result.configType).toBe("system");
    expect(result.filePath).toContain("s1.conf.json");
  });
});

// ---------------------------------------------------------------------------
// uploadConfig
// ---------------------------------------------------------------------------

describe("uploadConfig", () => {
  it("zips and uploads configs, returns pipe and system counts", async () => {
    // Create stub config files so countConfigFiles returns positive numbers
    await fs.mkdir(path.join(tmpDir, "pipes"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "systems"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "pipes", "p.conf.pipe"),
      JSON.stringify({ _id: "p" }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmpDir, "systems", "s.conf.system"),
      JSON.stringify({ _id: "s" }),
      "utf-8",
    );

    (NodeClient.prototype.putConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (NodeClient.prototype.waitForDeploy as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await uploadConfig(CREDS, tmpDir, { skipValidate: true });

    expect(result.success).toBe(true);
    expect(result.pipesUploaded).toBe(1);
    expect(result.systemsUploaded).toBe(1);
    expect(client().putConfig).toHaveBeenCalledOnce();
    expect(client().waitForDeploy).toHaveBeenCalledOnce();
  });

  it("runs validation by default and throws ValidationFailedError when it fails", async () => {
    const { validateWorkspace: mockValidate } = await import("../src/validate.js");
    (mockValidate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      errors: [{ file: "pipes/p.conf.pipe", message: "missing _id" }],
    });

    await expect(uploadConfig(CREDS, tmpDir)).rejects.toThrow("Validation failed");
  });

  it("PUTs caller-supplied env vars before uploading", async () => {
    (NodeClient.prototype.putConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (NodeClient.prototype.waitForDeploy as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (NodeClient.prototype.putEnvVars as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await uploadConfig(CREDS, tmpDir, { skipValidate: true, envVars: { MY_VAR: "val" } });

    expect(client().putEnvVars).toHaveBeenCalledWith({ MY_VAR: "val" });
  });
});

// ---------------------------------------------------------------------------
// uploadSingleConfig
// ---------------------------------------------------------------------------

describe("uploadSingleConfig", () => {
  it("PUTs a pipe config via putPipeConfig", async () => {
    const configPath = path.join(tmpDir, "p.conf.pipe");
    await fs.writeFile(configPath, JSON.stringify({ _id: "p", type: "pipe" }), "utf-8");

    (NodeClient.prototype.putPipeConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await uploadSingleConfig(CREDS, configPath, { skipValidate: true });

    expect(result.success).toBe(true);
    expect(result.configId).toBe("p");
    expect(result.configType).toBe("pipe");
    expect(client().putPipeConfig).toHaveBeenCalledWith("p", expect.objectContaining({ _id: "p" }));
  });

  it("PUTs a system config via putSystemConfig", async () => {
    const configPath = path.join(tmpDir, "s.conf.system");
    await fs.writeFile(configPath, JSON.stringify({ _id: "s", type: "system:rest" }), "utf-8");

    (NodeClient.prototype.putSystemConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await uploadSingleConfig(CREDS, configPath, { skipValidate: true });

    expect(result.configType).toBe("system");
    expect(client().putSystemConfig).toHaveBeenCalledWith(
      "s",
      expect.objectContaining({ _id: "s" }),
    );
  });

  it("throws NodeApiError when config has no _id", async () => {
    const configPath = path.join(tmpDir, "broken.conf.pipe");
    await fs.writeFile(configPath, JSON.stringify({ type: "pipe" }), "utf-8");

    await expect(uploadSingleConfig(CREDS, configPath, { skipValidate: true })).rejects.toThrow(
      '"_id"',
    );
  });
});

// ---------------------------------------------------------------------------
// runPipe
// ---------------------------------------------------------------------------

describe("runPipe", () => {
  it("calls startPump with the given pipeId and returns success", async () => {
    (NodeClient.prototype.startPump as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await runPipe(CREDS, "my-pipe");

    expect(result.success).toBe(true);
    expect(result.pipeId).toBe("my-pipe");
    expect(client().startPump).toHaveBeenCalledWith("my-pipe");
  });

  it("propagates errors thrown by startPump", async () => {
    (NodeClient.prototype.startPump as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );

    await expect(runPipe(CREDS, "bad-pipe")).rejects.toThrow("network error");
  });
});

// ---------------------------------------------------------------------------
// runAllPipes
// ---------------------------------------------------------------------------

describe("runAllPipes", () => {
  it("calls client.runAllPipes and returns success", async () => {
    (NodeClient.prototype.runAllPipes as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await runAllPipes(CREDS);

    expect(result.success).toBe(true);
    expect(client().runAllPipes).toHaveBeenCalledOnce();
  });

  it("passes opts through to client.runAllPipes", async () => {
    (NodeClient.prototype.runAllPipes as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await runAllPipes(CREDS, { maxRuns: 3 });

    expect(client().runAllPipes).toHaveBeenCalledWith({ maxRuns: 3 });
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe("getStatus", () => {
  it("maps pipe runtime info to PipeStatus objects", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        _id: "p1",
        runtime: {
          state: "running",
          success_count: 10,
          failure_count: 1,
          queued: 0,
          last_run: "2024-01-01T00:00:00Z",
          next_run: "2024-01-02T00:00:00Z",
        },
      },
    ]);

    const statuses = await getStatus(CREDS);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual({
      id: "p1",
      state: "running",
      successCount: 10,
      failureCount: 1,
      queued: 0,
      lastRun: "2024-01-01T00:00:00Z",
      nextRun: "2024-01-02T00:00:00Z",
    });
  });

  it("defaults missing runtime fields to zero / 'unknown'", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([{ _id: "p2" }]);

    const statuses = await getStatus(CREDS);

    expect(statuses[0]).toMatchObject({
      id: "p2",
      state: "unknown",
      successCount: 0,
      failureCount: 0,
      queued: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// getPipeStatus
// ---------------------------------------------------------------------------

describe("getPipeStatus", () => {
  it("returns status for a single pipe", async () => {
    (NodeClient.prototype.getPipe as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "p1",
      runtime: { state: "idle", success_count: 5, failure_count: 0, queued: 2 },
    });

    const status = await getPipeStatus(CREDS, "p1");

    expect(status.id).toBe("p1");
    expect(status.state).toBe("idle");
    expect(status.successCount).toBe(5);
    expect(status.queued).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getSyncStatus
// ---------------------------------------------------------------------------

describe("getSyncStatus", () => {
  it("reports node-only pipe when local file is absent", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "remote-pipe", config: { _id: "remote-pipe" } },
    ]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const items = await getSyncStatus(CREDS, tmpDir);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "remote-pipe", kind: "pipe", state: "node-only" });
  });

  it("reports local-only pipe when not present on node", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await fs.mkdir(path.join(tmpDir, "pipes"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "pipes", "local-pipe.conf.pipe"),
      JSON.stringify({ _id: "local-pipe" }),
      "utf-8",
    );

    const items = await getSyncStatus(CREDS, tmpDir);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "local-pipe", kind: "pipe", state: "local-only" });
  });

  it("reports modified pipe when content differs", async () => {
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "shared", config: { _id: "shared", x: 1 } },
    ]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await fs.mkdir(path.join(tmpDir, "pipes"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "pipes", "shared.conf.pipe"),
      JSON.stringify({ _id: "shared", x: 2 }),
      "utf-8",
    );

    const items = await getSyncStatus(CREDS, tmpDir);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "shared", state: "modified" });
  });

  it("omits pipe when local and node content are identical", async () => {
    const config = { _id: "same", x: 1 };
    (NodeClient.prototype.getPipes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "same", config },
    ]);
    (NodeClient.prototype.getSystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await fs.mkdir(path.join(tmpDir, "pipes"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "pipes", "same.conf.pipe"),
      JSON.stringify(config),
      "utf-8",
    );

    const items = await getSyncStatus(CREDS, tmpDir);
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getNodeConfig
// ---------------------------------------------------------------------------

describe("getNodeConfig", () => {
  it("returns 'original' envelope field for a pipe when present", async () => {
    (NodeClient.prototype.getPipe as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "p",
      config: { original: { _id: "p", type: "pipe" }, effective: {} },
    });

    const cfg = await getNodeConfig(CREDS, "p", "pipe");

    expect(cfg).toEqual({ _id: "p", type: "pipe" });
  });

  it("falls back to the raw config when 'original' is absent (pipe)", async () => {
    (NodeClient.prototype.getPipe as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "p",
      config: { _id: "p" },
    });

    const cfg = await getNodeConfig(CREDS, "p", "pipe");
    expect((cfg as Record<string, unknown>)["_id"]).toBe("p");
  });

  it("returns config for a system", async () => {
    (NodeClient.prototype.getSystem as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "s",
      config: { original: { _id: "s", type: "system:rest" } },
    });

    const cfg = await getNodeConfig(CREDS, "s", "system");
    expect((cfg as Record<string, unknown>)["type"]).toBe("system:rest");
  });
});
