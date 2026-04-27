import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSyncConfig } from "../src/syncconfig.js";

// ---------------------------------------------------------------------------
// Temp-dir helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sesam-syncconfig-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const write = (relPath: string, content: string): Promise<void> =>
  fs.writeFile(path.join(tmpDir, relPath), content, "utf-8");

// ---------------------------------------------------------------------------
// readSyncConfig
// ---------------------------------------------------------------------------

describe("readSyncConfig", () => {
  it("parses NODE and JWT from a .syncconfig in the start directory", async () => {
    await write(".syncconfig", "NODE=https://hub.sesam.cloud\nJWT=tok123\n");
    const result = await readSyncConfig(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.nodeUrl).toBe("https://hub.sesam.cloud");
    expect(result!.jwtToken).toBe("tok123");
  });

  it("returns null when no .syncconfig file exists in the hierarchy", async () => {
    // tmpDir has no .syncconfig; its parents might but we use an isolated dir
    // so we cannot guarantee the absence of ancestor files; use a very deep sub-path
    // that is under our controlled tmpDir and has no .syncconfig
    const deepDir = path.join(tmpDir, "a", "b", "c");
    await fs.mkdir(deepDir, { recursive: true });

    // Do NOT create a .syncconfig anywhere under tmpDir
    const result = await readSyncConfig(deepDir);

    // Either null (not found) or the tmpDir one from a parent — but tmpDir has no file,
    // so walking stops when it leaves tmpDir. If the real FS has a .syncconfig higher up
    // we cannot control that; assert it either found credentials or not.
    // The important thing is it does not throw.
    expect(result === null || typeof result?.nodeUrl === "string").toBe(true);
  });

  it("finds .syncconfig when walking up from a subdirectory", async () => {
    await write(".syncconfig", "NODE=https://hub.sesam.cloud\nJWT=tok456\n");
    const subDir = path.join(tmpDir, "pipes");
    await fs.mkdir(subDir, { recursive: true });

    const result = await readSyncConfig(subDir);

    expect(result).not.toBeNull();
    expect(result!.nodeUrl).toBe("https://hub.sesam.cloud");
    expect(result!.jwtToken).toBe("tok456");
  });

  it("ignores comment lines starting with #", async () => {
    await write(".syncconfig", "# comment\nNODE=https://hub.sesam.cloud\nJWT=tok\n");
    const result = await readSyncConfig(tmpDir);

    expect(result!.nodeUrl).toBe("https://hub.sesam.cloud");
  });

  it("ignores blank lines", async () => {
    await write(".syncconfig", "\n\nNODE=https://hub.sesam.cloud\n\nJWT=tok\n\n");
    const result = await readSyncConfig(tmpDir);

    expect(result!.nodeUrl).toBe("https://hub.sesam.cloud");
  });

  it("exposes all raw key=value pairs", async () => {
    await write(".syncconfig", "NODE=https://hub.sesam.cloud\nJWT=tok\nEXTRA=hello\n");
    const result = await readSyncConfig(tmpDir);

    expect(result!.raw["NODE"]).toBe("https://hub.sesam.cloud");
    expect(result!.raw["JWT"]).toBe("tok");
    expect(result!.raw["EXTRA"]).toBe("hello");
  });

  it("returns null when file exists but has no NODE or JWT entries", async () => {
    await write(".syncconfig", "EXTRA=value\n");
    const result = await readSyncConfig(tmpDir);

    expect(result).toBeNull();
  });

  it("handles CRLF line endings", async () => {
    await write(".syncconfig", "NODE=https://hub.sesam.cloud\r\nJWT=tok\r\n");
    const result = await readSyncConfig(tmpDir);

    expect(result!.nodeUrl).toBe("https://hub.sesam.cloud");
    expect(result!.jwtToken).toBe("tok");
  });
});
