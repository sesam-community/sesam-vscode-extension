/**
 * Workspace Index
 * Maintains an in-memory map of all pipe and system _id values to their file
 * URIs and character offsets. Used by the LSP server for cross-file Go to
 * Definition, DocumentLinks, and Find All References.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { WorkspaceFolder } from "vscode-languageserver/node";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexEntry {
  uri: string;
  /** Byte offset of the first character of the _id value (after the opening quote). */
  idOffset: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _pipeIndex = new Map<string, IndexEntry>();
const _systemIndex = new Map<string, IndexEntry>();
const _fileTexts = new Map<string, string>();
/** Maps file URI → the _id it defines (for cleanup on update/remove). */
const _fileIds = new Map<string, string>();

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "build"]);

const isSesamFile = (filePath: string): boolean => {
  const base = path.basename(filePath);
  return (
    base.endsWith(".conf.pipe") ||
    base.endsWith(".conf.system") ||
    base.endsWith(".conf.json") ||
    path.extname(filePath) === ".json"
  );
};

const indexFileText = (uri: string, text: string): void => {
  // Remove previous entries for this file URI
  const oldId = _fileIds.get(uri);
  if (oldId !== undefined) {
    _pipeIndex.delete(oldId);
    _systemIndex.delete(oldId);
    _fileIds.delete(uri);
  }
  _fileTexts.set(uri, text);

  let parsed: Record<string, unknown>;
  try {
    const val = JSON.parse(text);
    if (typeof val !== "object" || val === null || Array.isArray(val)) {
      return;
    }
    parsed = val as Record<string, unknown>;
  } catch {
    return;
  }

  const id = typeof parsed["_id"] === "string" ? parsed["_id"] : null;
  if (!id) {
    return;
  }

  // Find the _id value offset (first char after the opening quote of the value)
  const keyMatch = /"_id"\s*:/.exec(text);
  if (!keyMatch) {
    return;
  }
  const afterKey = text.slice(keyMatch.index + keyMatch[0].length);
  const colonMatch = /^\s*"/.exec(afterKey);
  if (!colonMatch) {
    return;
  }
  const idOffset = keyMatch.index + keyMatch[0].length + colonMatch[0].length;

  const type = typeof parsed["type"] === "string" ? parsed["type"] : "pipe";

  _fileIds.set(uri, id);
  const entry: IndexEntry = { uri, idOffset };
  if (type === "system") {
    _systemIndex.set(id, entry);
  } else {
    _pipeIndex.set(id, entry);
  }
};

const scanDirectory = (dirPath: string): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      scanDirectory(path.join(dirPath, entry.name));
    } else if (entry.isFile()) {
      const filePath = path.join(dirPath, entry.name);
      if (!isSesamFile(filePath)) {
        continue;
      }
      let text: string;
      try {
        text = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const uri = pathToFileURL(filePath).toString();
      indexFileText(uri, text);
    }
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const workspaceIndex = {
  get pipeIndex(): ReadonlyMap<string, IndexEntry> {
    return _pipeIndex;
  },

  get systemIndex(): ReadonlyMap<string, IndexEntry> {
    return _systemIndex;
  },

  get fileTexts(): ReadonlyMap<string, string> {
    return _fileTexts;
  },

  scanWorkspace(folders: WorkspaceFolder[]): void {
    _pipeIndex.clear();
    _systemIndex.clear();
    _fileTexts.clear();
    _fileIds.clear();

    for (const folder of folders) {
      try {
        const folderPath = fileURLToPath(folder.uri);
        scanDirectory(folderPath);
      } catch {
        // Invalid URI or inaccessible folder — skip
      }
    }
  },

  updateFile(uri: string, text: string): void {
    indexFileText(uri, text);
  },

  removeFile(uri: string): void {
    const id = _fileIds.get(uri);
    if (id !== undefined) {
      _pipeIndex.delete(id);
      _systemIndex.delete(id);
      _fileIds.delete(uri);
    }
    _fileTexts.delete(uri);
  },
};
