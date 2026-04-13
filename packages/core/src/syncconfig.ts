/**
 * .syncconfig reader
 *
 * Parses the sesam-py `.syncconfig` file — a simple `KEY=VALUE` text file
 * (no quoting, no sections) containing at minimum:
 *   NODE=https://datahub-xxxx.sesam.cloud
 *   JWT=eyJ...
 *
 * Resolution walks up from `startDir` toward the filesystem root, stopping
 * at the first `.syncconfig` file found (same behaviour as sesam-py).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncConfig {
  nodeUrl: string;
  jwtToken: string;
  /** Raw key=value pairs from the file, for forward-compatibility. */
  raw: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseKeyValueFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIdx = trimmed.indexOf("=");

    if (eqIdx === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find and parse a `.syncconfig` file by walking up from `startDir`.
 * Returns `null` if no file is found or it has no usable credentials.
 *
 * @param startDir  Directory to begin searching from (default: `process.cwd()`).
 */
export async function readSyncConfig(startDir?: string): Promise<SyncConfig | null> {
  let dir = path.resolve(startDir ?? process.cwd());

  while (true) {
    const candidate = path.join(dir, ".syncconfig");

    try {
      const text = await fs.readFile(candidate, "utf-8");
      const raw = parseKeyValueFile(text);
      const nodeUrl = raw["NODE"]?.trim() ?? "";
      const jwtToken = raw["JWT"]?.trim() ?? "";

      if (!nodeUrl && !jwtToken) {
        return null;
      }

      return { nodeUrl, jwtToken, raw };
    } catch {
      // File not found at this level — move up.
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      break; // reached filesystem root
    }

    dir = parent;
  }

  return null;
}
