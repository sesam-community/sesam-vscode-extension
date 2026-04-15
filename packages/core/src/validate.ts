/**
 * Validate
 *
 * Implements `sesam validate` — checks all local pipe and system config files for:
 *   1. Valid JSON syntax.
 *   2. Presence and type of required Sesam fields (_id, type).
 *
 * This is an offline operation — no node connection required.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ValidationError, ValidationResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_SUBDIRS = ["pipes", "systems"] as const;

const CONFIG_EXTENSIONS = [".conf.pipe", ".conf.system", ".conf.json"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isConfigFile = (name: string): boolean => CONFIG_EXTENSIONS.some((ext) => name.endsWith(ext));

async function validateSingleFile(filePath: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  let raw: string;

  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    errors.push({ file: filePath, message: "Could not read file." });
    return errors;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    errors.push({ file: filePath, message: `JSON parse error: ${String(err)}` });
    return errors;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push({
      file: filePath,
      message: "Config must be a JSON object, not an array or scalar.",
    });
    return errors;
  }

  const config = parsed as Record<string, unknown>;

  if (typeof config["_id"] !== "string" || !config["_id"].trim()) {
    errors.push({ file: filePath, message: 'Missing or empty required field: "_id".' });
  }

  if (typeof config["type"] !== "string" || !config["type"].trim()) {
    errors.push({ file: filePath, message: 'Missing or empty required field: "type".' });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate all pipe and system config files in a sesam-py workspace directory.
 *
 * @param workspaceDir  Absolute path to the workspace root (contains pipes/, systems/).
 * @returns             Validation result with `valid` flag and list of errors.
 */
export async function validateWorkspace(workspaceDir: string): Promise<ValidationResult> {
  const allErrors: ValidationError[] = [];

  for (const subdir of CONFIG_SUBDIRS) {
    const folder = path.join(workspaceDir, subdir);
    let entries: string[];

    try {
      entries = await fs.readdir(folder);
    } catch {
      continue; // subdirectory is optional
    }

    const configFiles = entries.filter(isConfigFile);
    const results = await Promise.all(
      configFiles.map((entry) => validateSingleFile(path.join(folder, entry))),
    );

    results.forEach((errs) => allErrors.push(...errs));
  }

  return { valid: allErrors.length === 0, errors: allErrors };
}
