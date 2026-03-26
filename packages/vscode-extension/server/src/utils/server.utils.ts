import {
  DiagnosticSeverity,
  CompletionItem,
  CompletionItemKind,
  MarkupKind,
  DocumentSymbol,
  SymbolKind,
  Range,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  getAllFunctions,
  DTL_VARIABLES,
  ENTITY_RESERVED_FIELDS,
} from "../../../src/shared/dtl-registry";
import { parseDtlText } from "../dtl-parser";
import { SYSTEM_TYPES, PIPE_SOURCE_TYPES } from "../constants";

import type { DtlFunction } from "../../../src/shared/dtl-registry";
import type { DtlRange } from "../dtl-parser";

// ---------------------------------------------------------------------------
// Node-backed validation helpers (retained for future use)
// ---------------------------------------------------------------------------
export const levelToSeverity = (level: string): DiagnosticSeverity => {
  switch (level) {
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    default: // "error" or "critical"
      return DiagnosticSeverity.Error;
  }
};

export const escapeRegex = (s: string): string => {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const elementsToRange = (document: TextDocument, text: string, elements: string): Range => {
  const match = /\['([^']+)'\]/.exec(elements);
  if (match) {
    const key = match[1];
    const keyPattern = new RegExp(`"${escapeRegex(key)}"\\s*:`);
    const m = keyPattern.exec(text);
    if (m) {
      const start = document.positionAt(m.index);
      const end = document.positionAt(m.index + m[0].length);
      return Range.create(start, end);
    }
  }
  return Range.create(Position.create(0, 0), Position.create(0, Number.MAX_VALUE));
};

// ---------------------------------------------------------------------------
// Completion context predicates
// ---------------------------------------------------------------------------
export const isSourceTypeContext = (prefix: string): boolean => {
  return /"source"\s*:\s*\{[^{}]*"type"\s*:\s*"[^"]*$/.test(prefix);
};

export const isSystemTypeContext = (prefix: string): boolean => {
  if (!/"type"\s*:\s*"[^"]*$/.test(prefix)) {
    return false;
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (const c of prefix) {
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\" && inStr) {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      }
    }
  }
  return depth === 1;
};

export const isVariableContext = (prefix: string): boolean => {
  return /"\s*_[STPRB]?\.?[^"]*$/.test(prefix);
};

export const isFunctionNameContext = (prefix: string): boolean => {
  return /\[\s*"[^"]*$/.test(prefix) || /\[\s*$/.test(prefix);
};

// A cursor is at a property key position when the most recent non-whitespace
// character (outside strings) before the opening " is { or ,
export const isPropKeyContext = (prefix: string): boolean => {
  return /[{,]\s*"[^"]*$/.test(prefix);
};

// ---------------------------------------------------------------------------
// Config file type
// ---------------------------------------------------------------------------
export type ConfigFileType = "pipe" | "system" | "node-metadata" | "unknown";

export const getConfigFileType = (uri: string): ConfigFileType => {
  if (uri.endsWith(".conf.pipe")) {
    return "pipe";
  }

  if (uri.endsWith(".conf.system")) {
    return "system";
  }

  if (uri.endsWith("node-metadata.conf.json")) {
    return "node-metadata";
  }

  return "unknown";
};

// ---------------------------------------------------------------------------
// Property schema data
// ---------------------------------------------------------------------------
interface PropInfo {
  label: string;
  detail: string;
  sortText: string;
}

const PIPE_ROOT_PROPS: readonly PropInfo[] = [
  { label: "_id", detail: "string — unique pipe identifier (required)", sortText: "0_01" },
  { label: "type", detail: 'string — must be "pipe" (required)', sortText: "0_02" },
  { label: "source", detail: "object — data source (required)", sortText: "0_03" },
  { label: "transform", detail: "object | array — DTL transform (optional)", sortText: "1_01" },
  { label: "sink", detail: "object — data sink (optional)", sortText: "1_02" },
  { label: "pump", detail: "object — scheduling config (optional)", sortText: "1_03" },
  { label: "metadata", detail: "object — arbitrary metadata (optional)", sortText: "1_04" },
  {
    label: "description",
    detail: "string — human-readable description (optional)",
    sortText: "1_05",
  },
  { label: "comment", detail: "string — internal note (optional)", sortText: "1_06" },
  { label: "namespaces", detail: "boolean — enable namespacing (optional)", sortText: "1_07" },
  { label: "add_namespaces", detail: "boolean (optional)", sortText: "1_08" },
  { label: "remove_namespaces", detail: "boolean (optional)", sortText: "1_09" },
  { label: "batch_size", detail: "integer (optional)", sortText: "1_10" },
  { label: "checkpoint_interval", detail: "integer (optional)", sortText: "1_11" },
  { label: "compaction", detail: "object (optional)", sortText: "1_12" },
  { label: "expose_entity_id", detail: "boolean (optional)", sortText: "1_13" },
  { label: "merge_existing_namespaces", detail: "boolean (optional)", sortText: "1_14" },
  { label: "infer_pipe_entity_types", detail: "boolean (optional)", sortText: "1_15" },
];

const SYSTEM_ROOT_PROPS: readonly PropInfo[] = [
  { label: "_id", detail: "string — unique system identifier (required)", sortText: "0_01" },
  { label: "type", detail: 'string — must be "system:*" (required)', sortText: "0_02" },
  { label: "metadata", detail: "object — arbitrary metadata (optional)", sortText: "1_01" },
  {
    label: "description",
    detail: "string — human-readable description (optional)",
    sortText: "1_02",
  },
  { label: "comment", detail: "string — internal note (optional)", sortText: "1_03" },
];

const NODE_METADATA_ROOT_PROPS: readonly PropInfo[] = [
  { label: "_id", detail: 'string — typically "node" (required)', sortText: "0_01" },
  { label: "type", detail: 'string — must be "metadata:node" (required)', sortText: "0_02" },
  {
    label: "pipe_defaults",
    detail: "object — default settings for all pipes (optional)",
    sortText: "0_03",
  },
  {
    label: "system_defaults",
    detail: "object — default settings for all systems (optional)",
    sortText: "0_04",
  },
  {
    label: "global_defaults",
    detail: "object — defaults for both pipes and systems (optional)",
    sortText: "1_01",
  },
  {
    label: "feature_flags",
    detail: "object — enable/disable experimental features (optional)",
    sortText: "1_02",
  },
  { label: "namespaces", detail: "object — namespace configuration (optional)", sortText: "1_03" },
  { label: "metadata", detail: "object — node-level metadata tags (optional)", sortText: "1_04" },
  { label: "description", detail: "string (optional)", sortText: "1_05" },
  { label: "comment", detail: "string (optional)", sortText: "1_06" },
];

// Combined superset for unknown .conf.json files
const UNKNOWN_ROOT_PROPS: readonly PropInfo[] = [
  ...PIPE_ROOT_PROPS,
  ...SYSTEM_ROOT_PROPS.filter((p) => !PIPE_ROOT_PROPS.some((q) => q.label === p.label)),
];

const SOURCE_PROPS: readonly PropInfo[] = [
  { label: "type", detail: "string — source type (required)", sortText: "0_01" },
  { label: "dataset", detail: "string — dataset name (dataset source)", sortText: "1_01" },
  { label: "system", detail: "string — system id (sql/rest/json/ldap/kafka)", sortText: "1_02" },
  { label: "table", detail: "string — table name (sql source)", sortText: "1_03" },
  { label: "query", detail: "string — SQL query (sql source)", sortText: "1_04" },
  { label: "url", detail: "string — URL (json/http_endpoint source)", sortText: "1_05" },
  { label: "operation", detail: "string — operation (rest/kafka source)", sortText: "1_06" },
  { label: "headers", detail: "object — HTTP headers (optional)", sortText: "1_07" },
  { label: "params", detail: "object — query parameters (optional)", sortText: "1_08" },
  { label: "entities", detail: "array — inline entities (embedded source)", sortText: "1_09" },
  { label: "datasets", detail: "array — datasets list (union_datasets/merge)", sortText: "1_10" },
  {
    label: "since_property_name",
    detail: "string — REST since-tracking (optional)",
    sortText: "1_11",
  },
  {
    label: "since_default",
    detail: "string — REST since-tracking default (optional)",
    sortText: "1_12",
  },
  { label: "completeness", detail: "boolean — completeness tracking (optional)", sortText: "1_13" },
  {
    label: "supports_signalling",
    detail: "boolean — signalling support (optional)",
    sortText: "1_14",
  },
];

const TRANSFORM_PROPS: readonly PropInfo[] = [
  { label: "type", detail: "string — transform type (required)", sortText: "0_01" },
  { label: "rules", detail: "object — DTL rules (dtl transform)", sortText: "0_02" },
  { label: "system", detail: "string — system id (http/rest transform)", sortText: "1_01" },
  { label: "operation", detail: "string — operation name (http/rest transform)", sortText: "1_02" },
  { label: "transform", detail: "array — sub-transforms (conditional)", sortText: "1_03" },
  { label: "condition", detail: "array — condition expression (conditional)", sortText: "1_04" },
  { label: "side_effects", detail: "boolean — allow side effects (optional)", sortText: "1_05" },
  { label: "xml_config", detail: "object — XML configuration (xml transform)", sortText: "1_06" },
  { label: "template", detail: "string — template string (template transform)", sortText: "1_07" },
];

const SINK_PROPS: readonly PropInfo[] = [
  { label: "type", detail: "string — sink type (required)", sortText: "0_01" },
  { label: "dataset", detail: "string — target dataset (dataset sink)", sortText: "1_01" },
  { label: "system", detail: "string — system id (sql/rest/elasticsearch)", sortText: "1_02" },
  { label: "table", detail: "string — table name (sql sink)", sortText: "1_03" },
  { label: "operation", detail: "string — operation name (rest sink)", sortText: "1_04" },
  { label: "primary_key", detail: "array — primary key columns (sql sink)", sortText: "1_05" },
  { label: "batch_size", detail: "integer — batch size (sql sink)", sortText: "1_06" },
  {
    label: "set_initial_offset",
    detail: "string — initial offset (dataset sink)",
    sortText: "1_07",
  },
  {
    label: "deletion_tracking",
    detail: "boolean — track deletions (dataset sink)",
    sortText: "1_08",
  },
  {
    label: "enable_optimistic_locking",
    detail: "boolean — optimistic locking (dataset sink)",
    sortText: "1_09",
  },
  { label: "side_effects", detail: "boolean — allow side effects (optional)", sortText: "1_10" },
];

const PUMP_PROPS: readonly PropInfo[] = [
  { label: "mode", detail: 'string — "scheduled" or "manual"', sortText: "0_01" },
  {
    label: "schedule_interval",
    detail: "integer — seconds between runs (optional)",
    sortText: "1_01",
  },
  { label: "cron_expression", detail: "string — cron schedule (optional)", sortText: "1_02" },
  { label: "run_at_startup", detail: "boolean — run on node start (optional)", sortText: "1_03" },
  { label: "max_retries", detail: "integer — retries on failure (optional)", sortText: "1_04" },
  { label: "max_read_timeout_seconds", detail: "integer (optional)", sortText: "1_05" },
  { label: "max_write_timeout_seconds", detail: "integer (optional)", sortText: "1_06" },
  {
    label: "rescan_run_count",
    detail: "integer — full rescan frequency (optional)",
    sortText: "1_07",
  },
  { label: "fallback_to_single_entities_on_error", detail: "boolean (optional)", sortText: "1_08" },
];

// ---------------------------------------------------------------------------
// Prefix scanner: determine key-position nesting context
// ---------------------------------------------------------------------------

/**
 * Walk `prefix` and return the nesting path of object keys leading to the
 * current cursor position. Returns null if the cursor is not at a key position.
 *
 * Example: `{"source":{"` → { path: ["source"], presentKeys: Set{} }
 */
export const getPropKeyContext = (
  prefix: string,
): { path: string[]; presentKeys: Set<string> } | null => {
  // Quick reject: must end with { or , followed by optional whitespace and an opening "
  if (!/[{,]\s*"[^"]*$/.test(prefix)) {
    return null;
  }

  const pathStack: string[] = [];
  const presentsStack: Array<Set<string>> = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let isKey = false;
  let curStr = "";
  let lastKey = "";

  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i];

    if (esc) {
      esc = false;

      if (inStr) {
        curStr += c;
      }

      continue;
    }

    if (c === "\\" && inStr) {
      esc = true;
      continue;
    }

    if (c === '"') {
      if (inStr) {
        // Closing quote — record as present key if we're at key position
        if (isKey && depth > 0) {
          lastKey = curStr;
          presentsStack[depth - 1].add(curStr);
        }
        inStr = false;
        curStr = "";
      } else {
        inStr = true;
        curStr = "";
      }
      continue;
    }

    if (inStr) {
      curStr += c;
      continue;
    }

    // Outside strings
    if (c === "{") {
      // Push the key whose value is this new object (only when already inside an object)
      if (depth >= 1) {
        pathStack.push(lastKey);
      }
      depth++;
      presentsStack.push(new Set());
      lastKey = "";
      isKey = true;
    } else if (c === "}") {
      presentsStack.pop();
      depth--;
      if (depth >= 1) {
        pathStack.pop();
      }
      isKey = false;
    } else if (c === ":") {
      isKey = false;
    } else if (c === ",") {
      isKey = true;
    } else if (c === "]") {
      isKey = false;
    }
  }

  if (!isKey || depth === 0) {
    return null;
  }

  // presentKeys = all fully-closed key strings at the current depth.
  // The partial key being typed is in curStr (inStr=true) — never added to the set,
  // so no removal is needed.
  const currentPresentKeys = new Set(presentsStack[depth - 1] ?? []);

  return { path: [...pathStack], presentKeys: currentPresentKeys };
};

// ---------------------------------------------------------------------------
// Prop completion builder
// ---------------------------------------------------------------------------
const toCompletionItem = (p: PropInfo): CompletionItem => ({
  label: p.label,
  kind: CompletionItemKind.Property,
  detail: p.detail,
  insertText: p.label,
  sortText: p.sortText,
});

export const buildPropCompletions = (
  path: string[],
  fileType: ConfigFileType,
  presentKeys: Set<string>,
): CompletionItem[] => {
  let props: readonly PropInfo[];

  if (path.length === 0) {
    // Root level — choose table by file type
    switch (fileType) {
      case "pipe":
        props = PIPE_ROOT_PROPS;
        break;
      case "system":
        props = SYSTEM_ROOT_PROPS;
        break;
      case "node-metadata":
        props = NODE_METADATA_ROOT_PROPS;
        break;
      default:
        props = UNKNOWN_ROOT_PROPS;
    }
  } else if (path[path.length - 1] === "source") {
    props = SOURCE_PROPS;
  } else if (path[path.length - 1] === "transform") {
    props = TRANSFORM_PROPS;
  } else if (path[path.length - 1] === "sink") {
    props = SINK_PROPS;
  } else if (path[path.length - 1] === "pump") {
    props = PUMP_PROPS;
  } else if (
    (path[path.length - 1] === "pipe_defaults" && fileType === "node-metadata") ||
    (path.length === 1 && path[0] === "pipe_defaults")
  ) {
    props = PIPE_ROOT_PROPS;
  } else if (
    (path[path.length - 1] === "system_defaults" && fileType === "node-metadata") ||
    (path.length === 1 && path[0] === "system_defaults")
  ) {
    props = SYSTEM_ROOT_PROPS;
  } else {
    return [];
  }

  return props.filter((p) => !presentKeys.has(p.label)).map(toCompletionItem);
};

// ---------------------------------------------------------------------------
// Completion item builders
// ---------------------------------------------------------------------------
export const buildSystemTypeCompletions = (): CompletionItem[] => {
  return SYSTEM_TYPES.map(({ label, detail, doc }) => ({
    label,
    kind: CompletionItemKind.EnumMember,
    detail,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**\`${label}\`** — ${detail}\n\n${doc}\n\n[📖 Documentation](https://docs.sesam.io/hub/documentation/service-configuration/systems/configuration-systems.html)`,
    },
    insertText: label,
    sortText: label,
  }));
};

export const buildSourceTypeCompletions = (): CompletionItem[] => {
  return PIPE_SOURCE_TYPES.map(({ label, detail, doc }) => ({
    label,
    kind: CompletionItemKind.EnumMember,
    detail,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**\`${label}\`** — pipe source type\n\n${doc}\n\n[📖 Documentation](https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources.html)`,
    },
    insertText: label,
    sortText: label,
  }));
};

export const buildFunctionCompletions = (): CompletionItem[] => {
  return getAllFunctions().map((fn: DtlFunction) => ({
    label: fn.name,
    kind: fn.kind === "transform" ? CompletionItemKind.Method : CompletionItemKind.Function,
    detail: fn.description,
    labelDetails: { description: fn.signature },
    documentation: {
      kind: MarkupKind.Markdown,
      value: buildFunctionMarkdown(fn),
    },
    sortText: fn.kind === "transform" ? `0_${fn.name}` : `1_${fn.name}`,
    insertText: fn.name,
  }));
};

export const buildVariableCompletions = (): CompletionItem[] => {
  const items: CompletionItem[] = Object.entries(DTL_VARIABLES).map(([name, desc]) => ({
    label: name,
    kind: CompletionItemKind.Variable,
    detail: desc,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${name}** — DTL built-in variable\n\n${desc}\n\n[📖 Documentation](https://docs.sesam.io/hub/dtl/dtl-variables.html)`,
    },
    insertText: name,
    sortText: `0_${name}`,
  }));
  ENTITY_RESERVED_FIELDS.forEach((field) => {
    items.push({
      label: field,
      kind: CompletionItemKind.Field,
      detail: "Sesam entity reserved field",
      insertText: field,
      sortText: `1_${field}`,
    });
  });
  return items;
};

// ---------------------------------------------------------------------------
// Hover helpers
// ---------------------------------------------------------------------------
export const getWordAtPosition = (document: TextDocument, position: Position): string | null => {
  const text = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }
  let end = offset;
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }
  if (start === end) {
    return null;
  }
  return text.slice(start, end);
};

export const isWordChar = (ch: string): boolean => {
  return /[a-zA-Z0-9_$\-!.]/.test(ch);
};

export const buildFunctionMarkdown = (fn: DtlFunction): string => {
  const kindLabel = fn.kind === "transform" ? "🔧 Transform" : "📦 Expression";
  const params = fn.params
    .map((p) => `- \`${p.name}\`${p.optional ? " *(optional)*" : ""} — ${p.description}`)
    .join("\n");
  const argInfo =
    fn.maxArgs === null
      ? `${fn.minArgs}+ arguments`
      : fn.minArgs === fn.maxArgs
        ? `${fn.minArgs} argument${fn.minArgs !== 1 ? "s" : ""}`
        : `${fn.minArgs}–${fn.maxArgs} arguments`;
  return [
    `**\`${fn.name}\`** — ${fn.category} · ${kindLabel}`,
    "",
    `\`\`\`\n${fn.signature}\n\`\`\``,
    "",
    fn.description,
    "",
    params ? `**Parameters** (${argInfo}):\n${params}` : `*No arguments.*`,
    "",
    `[📖 Documentation](${fn.docUrl})`,
  ].join("\n");
};

// ---------------------------------------------------------------------------
// Document Symbols helpers
// ---------------------------------------------------------------------------
export const lspRange = (r: DtlRange): Range => {
  return Range.create(
    Position.create(r.start.line, r.start.character),
    Position.create(r.end.line, r.end.character),
  );
};

export const findKeyOffset = (text: string, key: string, fromOffset = 0): number => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escaped}"\\s*:`);
  const m = pattern.exec(text.slice(fromOffset));
  return m ? fromOffset + m.index : -1;
};

/** Convert a zero-based character offset in `text` to an LSP Position. */
export const offsetToPosition = (text: string, offset: number): Position => {
  const clamped = Math.min(offset, text.length);
  let line = 0;
  let character = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return Position.create(line, character);
};

export const buildDocumentSymbols = (
  document: TextDocument,
  text: string,
  obj: Record<string, unknown>,
): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];

  // ── _id symbol ────────────────────────────────────────────────────────────
  const configId = obj["_id"];
  if (typeof configId === "string") {
    const off = findKeyOffset(text, "_id");
    if (off >= 0) {
      const pos = document.positionAt(off);
      const range = Range.create(pos, document.positionAt(off + 5));
      symbols.push(
        DocumentSymbol.create(`_id: ${configId}`, undefined, SymbolKind.Key, range, range, []),
      );
    }
  }

  // ── transform ─────────────────────────────────────────────────────────────
  const rawTransform = obj["transform"];
  if (rawTransform == null || typeof rawTransform !== "object") {
    return symbols;
  }

  // Normalise: always work with a flat list of step objects.
  const isArrayTransform = Array.isArray(rawTransform);
  const allSteps: unknown[] = isArrayTransform ? (rawTransform as unknown[]) : [rawTransform];

  // Collect only DTL steps that have a "rules" object, in document order.
  interface DtlStepInfo {
    rulesObj: Record<string, unknown>;
    rulesKeyOff: number;
    /** Exclusive end offset bounding this step (start of next step's rules, or text.length). */
    boundary: number;
  }

  const dtlStepInfos: DtlStepInfo[] = [];
  let searchFrom = 0;

  for (const step of allSteps) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      continue;
    }
    const rules = (step as Record<string, unknown>)["rules"];
    if (rules == null || typeof rules !== "object" || Array.isArray(rules)) {
      continue;
    }
    const rulesKeyOff = findKeyOffset(text, "rules", searchFrom);
    if (rulesKeyOff < 0) {
      continue;
    }
    dtlStepInfos.push({
      rulesObj: rules as Record<string, unknown>,
      rulesKeyOff,
      boundary: 0, // filled below
    });
    searchFrom = rulesKeyOff + 7; // advance past `"rules"`
  }

  // Set each step's boundary to the next step's rulesKeyOff, last step → text.length.
  for (let i = 0; i < dtlStepInfos.length; i++) {
    dtlStepInfos[i].boundary =
      i + 1 < dtlStepInfos.length ? dtlStepInfos[i + 1].rulesKeyOff : text.length;
  }

  if (dtlStepInfos.length === 0) {
    return symbols;
  }

  const allTopCalls = parseDtlText(text, "json").calls.filter(
    (c) => c.isTopLevel && c.functionName !== null,
  );

  // When the transform is an array with more than one DTL step, label each "dtl [N]".
  const multiStep = isArrayTransform && dtlStepInfos.length > 1;

  /** Build rule-name child symbols for one DTL step. */
  const buildStepRuleSymbols = ({
    rulesObj,
    rulesKeyOff,
    boundary,
  }: DtlStepInfo): DocumentSymbol[] => {
    const ruleNames = Object.keys(rulesObj);
    if (ruleNames.length === 0) {
      return [];
    }

    const ruleOffsets: Array<{ name: string; start: number; end: number }> = [];
    let ruleSearchFrom = rulesKeyOff;
    for (const name of ruleNames) {
      const off = findKeyOffset(text, name, ruleSearchFrom);
      if (off >= 0 && off < boundary) {
        ruleOffsets.push({ name, start: off, end: 0 });
        ruleSearchFrom = off + name.length + 3;
      }
    }
    ruleOffsets.sort((a, b) => a.start - b.start);
    for (let i = 0; i < ruleOffsets.length; i++) {
      ruleOffsets[i].end = i + 1 < ruleOffsets.length ? ruleOffsets[i + 1].start : boundary;
    }

    return ruleOffsets.map(({ name, start, end }) => {
      const callsInRule = allTopCalls.filter(
        (c) => c.range.start.offset >= start && c.range.start.offset < end,
      );
      const callSymbols = callsInRule.map((c) => {
        const r = lspRange(c.range);
        return DocumentSymbol.create(c.functionName!, undefined, SymbolKind.Function, r, r, []);
      });

      const namePos = document.positionAt(start);
      // range = full allocated region so VS Code cursor-tracking finds the deepest
      // symbol containing the cursor. selectionRange == range (containment satisfied).
      const fullRange = Range.create(namePos, document.positionAt(end));

      return DocumentSymbol.create(
        name,
        `${callSymbols.length} rule${callSymbols.length !== 1 ? "s" : ""}`,
        SymbolKind.Module,
        fullRange,
        fullRange,
        callSymbols,
      );
    });
  };

  // Build the child symbols that sit directly under "transform".
  const transformChildren: DocumentSymbol[] = [];

  for (let si = 0; si < dtlStepInfos.length; si++) {
    const stepInfo = dtlStepInfos[si];
    const ruleSymbols = buildStepRuleSymbols(stepInfo);
    if (ruleSymbols.length === 0) {
      continue;
    }

    const rulesPos = document.positionAt(Math.max(0, stepInfo.rulesKeyOff));
    const lastRule = ruleSymbols[ruleSymbols.length - 1];
    const rulesRange = Range.create(rulesPos, lastRule.range.end);

    if (isArrayTransform) {
      // Each DTL step is labelled "dtl" (or "dtl [N]" when there are multiple).
      const label = multiStep ? `dtl [${si + 1}]` : "dtl";
      transformChildren.push(
        DocumentSymbol.create(
          label,
          undefined,
          SymbolKind.Namespace,
          rulesRange,
          rulesRange,
          ruleSymbols,
        ),
      );
    } else {
      // Plain-object transform: keep existing "rules" wrapper.
      transformChildren.push(
        DocumentSymbol.create(
          "rules",
          undefined,
          SymbolKind.Namespace,
          rulesRange,
          rulesRange,
          ruleSymbols,
        ),
      );
    }
  }

  if (transformChildren.length === 0) {
    return symbols;
  }

  const transformOff = findKeyOffset(text, "transform");
  const transformPos = document.positionAt(Math.max(0, transformOff));
  const lastChild = transformChildren[transformChildren.length - 1];
  const transformRange = Range.create(transformPos, lastChild.range.end);

  symbols.push(
    DocumentSymbol.create(
      "transform",
      undefined,
      SymbolKind.Namespace,
      transformRange,
      transformRange,
      transformChildren,
    ),
  );

  return symbols;
};
