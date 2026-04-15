/**
 * Config Zipper
 *
 * Creates a ZIP archive of a sesam-py workspace directory, matching the
 * format expected by the Sesam node's `PUT /api/config` endpoint.
 *
 * Included:
 *   pipes/<id>.conf.pipe | *.conf.json | *.conf.system
 *   systems/<id>.conf.system | *.conf.json
 *   node-metadata.conf.json  (optional — skipped when absent)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_SUBDIRS = ["pipes", "systems"] as const;

const CONFIG_EXTENSIONS = [".conf.pipe", ".conf.system", ".conf.json"] as const;

const OPTIONAL_ROOT_FILES = ["node-metadata.conf.json"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isConfigFile = (name: string): boolean => CONFIG_EXTENSIONS.some((ext) => name.endsWith(ext));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an in-memory ZIP archive of the workspace's pipe/system configs.
 *
 * @param workspaceDir  Absolute path to the sesam-py workspace root (contains pipes/, systems/).
 * @returns             A Buffer containing the ZIP file bytes.
 */
export async function zipWorkspaceConfig(workspaceDir: string): Promise<Buffer> {
  const zip = new JSZip();

  // Add pipe & system config files
  for (const subdir of CONFIG_SUBDIRS) {
    const folder = path.join(workspaceDir, subdir);
    let entries: string[];

    try {
      entries = await fs.readdir(folder);
    } catch {
      // Subdirectory is optional — skip if it doesn't exist.
      continue;
    }

    for (const entry of entries.filter(isConfigFile)) {
      const fullPath = path.join(folder, entry);
      const content = await fs.readFile(fullPath);
      zip.file(`${subdir}/${entry}`, content);
    }
  }

  // Add optional root-level metadata files
  for (const fileName of OPTIONAL_ROOT_FILES) {
    const fullPath = path.join(workspaceDir, fileName);

    try {
      const content = await fs.readFile(fullPath);
      zip.file(fileName, content);
    } catch {
      // File is optional — skip if absent.
    }
  }

  const result = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return Buffer.from(result);
}
