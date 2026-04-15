import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { zipWorkspaceConfig } from "../src/config-zipper.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sesam-zip-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const mkDir = (...parts: string[]) => fs.mkdir(path.join(tmpDir, ...parts), { recursive: true });

const write = (relPath: string, content: string) =>
  fs.writeFile(path.join(tmpDir, relPath), content, "utf-8");

const unzip = async (buf: Buffer): Promise<string[]> => {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files);
};

// ---------------------------------------------------------------------------
// zipWorkspaceConfig
// ---------------------------------------------------------------------------

describe("zipWorkspaceConfig", () => {
  it("returns an empty ZIP when no subdirectories exist", async () => {
    const buf = await zipWorkspaceConfig(tmpDir);
    const entries = await unzip(buf);
    expect(entries).toHaveLength(0);
  });

  it("includes pipe config files", async () => {
    await mkDir("pipes");
    await write("pipes/my-pipe.conf.pipe", JSON.stringify({ _id: "my-pipe", type: "pipe" }));

    const entries = await unzip(await zipWorkspaceConfig(tmpDir));
    expect(entries).toContain("pipes/my-pipe.conf.pipe");
  });

  it("includes system config files", async () => {
    await mkDir("systems");
    await write(
      "systems/my-system.conf.system",
      JSON.stringify({ _id: "my-system", type: "system:rest" }),
    );

    const entries = await unzip(await zipWorkspaceConfig(tmpDir));
    expect(entries).toContain("systems/my-system.conf.system");
  });

  it("includes .conf.json files for backwards compatibility", async () => {
    await mkDir("pipes");
    await write("pipes/legacy.conf.json", JSON.stringify({ _id: "legacy", type: "pipe" }));

    const entries = await unzip(await zipWorkspaceConfig(tmpDir));
    expect(entries).toContain("pipes/legacy.conf.json");
  });

  it("ignores non-config files", async () => {
    await mkDir("pipes");
    await write("pipes/notes.txt", "ignore me");
    await write("pipes/valid.conf.pipe", JSON.stringify({ _id: "valid", type: "pipe" }));

    const entries = await unzip(await zipWorkspaceConfig(tmpDir));
    expect(entries).not.toContain("pipes/notes.txt");
    expect(entries).toContain("pipes/valid.conf.pipe");
  });

  it("includes node-metadata.conf.json when present", async () => {
    await write("node-metadata.conf.json", JSON.stringify({ _id: "node-metadata" }));

    const entries = await unzip(await zipWorkspaceConfig(tmpDir));
    expect(entries).toContain("node-metadata.conf.json");
  });

  it("skips node-metadata.conf.json when absent", async () => {
    await mkDir("pipes");
    await write("pipes/a.conf.pipe", JSON.stringify({ _id: "a", type: "pipe" }));

    const entries = await unzip(await zipWorkspaceConfig(tmpDir));
    expect(entries).not.toContain("node-metadata.conf.json");
  });

  it("preserves the original file content inside the ZIP", async () => {
    await mkDir("pipes");
    const original = JSON.stringify({ _id: "check-content", type: "pipe" });
    await write("pipes/check-content.conf.pipe", original);

    const buf = await zipWorkspaceConfig(tmpDir);
    const zip = await JSZip.loadAsync(buf);
    const extracted = await zip.file("pipes/check-content.conf.pipe")!.async("string");
    expect(extracted).toBe(original);
  });

  it("handles both pipes/ and systems/ in a single archive", async () => {
    await mkDir("pipes");
    await mkDir("systems");
    await write("pipes/p.conf.pipe", JSON.stringify({ _id: "p", type: "pipe" }));
    await write("systems/s.conf.system", JSON.stringify({ _id: "s", type: "system:rest" }));

    const entries = await unzip(await zipWorkspaceConfig(tmpDir));
    expect(entries).toContain("pipes/p.conf.pipe");
    expect(entries).toContain("systems/s.conf.system");
  });
});
