import {
  DiagnosticSeverity,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
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
import { SYSTEM_TYPES, PIPE_SOURCE_TYPES, PIPE_TRANSFORM_TYPES } from "../constants";

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

export const isTransformTypeContext = (prefix: string): boolean => {
  // Single transform object: "transform": { "type": "
  if (/"transform"\s*:\s*\{[^{}]*"type"\s*:\s*"[^"]*$/.test(prefix)) {
    return true;
  }
  // Array of transforms: "transform": [{ "type": "
  if (/"transform"\s*:\s*\[[^{}[\]]*\{[^{}]*"type"\s*:\s*"[^"]*$/.test(prefix)) {
    return true;
  }

  return false;
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

/**
 * Returns true when the cursor is inside a DTL rule array, i.e. the JSON
 * nesting path leading to the current position is:
 *   transform > rules > <rule-name> > [ (current array, possibly nested deeper)
 *
 * Handles both object-style transforms ({"transform":{...}}) and
 * array-style transforms ({"transform":[{...}]}).
 */
export const isDtlRuleArrayContext = (prefix: string): boolean => {
  // Quick bail: we must be after a `[` (array value context)
  if (!/\[\s*(?:"[^"]*)?$/.test(prefix)) {
    return false;
  }

  type Frame = { container: "object" | "array"; openedByKey: string | null };

  const stack: Frame[] = [];
  let inStr = false;
  let escape = false;
  let curStr = "";
  let lastKey: string | null = null;
  let afterColon = false;

  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];

    if (escape) {
      if (inStr) {
        curStr += ch;
      }

      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      if (inStr) {
        lastKey = curStr;
        inStr = false;
      } else {
        inStr = true;
        curStr = "";
      }

      continue;
    }

    if (inStr) {
      curStr += ch;
      continue;
    }

    if (ch === ":") {
      afterColon = true;
    } else if (ch === "{" || ch === "[") {
      stack.push({
        container: ch === "{" ? "object" : "array",
        openedByKey: afterColon ? lastKey : null,
      });
      afterColon = false;
      lastKey = null;
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      afterColon = false;
    } else if (ch === ",") {
      afterColon = false;
    }
  }

  // Walk up from the current stack top through nested arrays to find the
  // innermost *named* array (one opened by a key), then check the path.
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];

    if (frame.container !== "array") {
      break; // hit an object boundary — stop
    }

    if (frame.openedByKey !== null) {
      // This is a named array. Check: is it a rule array under rules under transform?
      return (
        i >= 3 &&
        stack[i - 1].container === "object" &&
        stack[i - 1].openedByKey === "rules" &&
        stack[i - 2].container === "object"
      );
    }

    // openedByKey is null => anonymous array (nested inside another array), keep going up
  }

  return false;
};

// A cursor is at a property key position when the most recent non-whitespace
// character (outside strings) before the opening " is { or ,
// Also detects unquoted keys being typed (no opening ").
export const isPropKeyContext = (prefix: string): boolean => {
  return /[{,]\s*"[^"]*$/.test(prefix) || /[{,]\s*[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix);
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
  /** Snippet for the value portion, e.g. '"$0"' (default), '{$0}', '[$0]', '$0' */
  valueSnippet?: string;
  /** Optional documentation URL shown in hover */
  docUrl?: string;
}

const PIPE_DOCS = "https://docs.sesam.io/hub/documentation/service-configuration/pipes";

const PIPE_ROOT_PROPS: readonly PropInfo[] = [
  {
    label: "_id",
    detail: "string — unique pipe identifier (required)",
    sortText: "0_01",
    docUrl: `${PIPE_DOCS}/configuration-pipes.html`,
  },
  {
    label: "type",
    detail: 'string — must be "pipe" (required)',
    sortText: "0_02",
    docUrl: `${PIPE_DOCS}/configuration-pipes.html`,
  },
  {
    label: "source",
    detail: "object — data source (required)",
    sortText: "0_03",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-sources.html`,
  },
  {
    label: "transform",
    detail: "object | array — DTL transform (optional)",
    sortText: "1_01",
    valueSnippet: '{\n\t"type": "dtl",\n\t"rules": {\n\t\t"default": [$0]\n\t}\n}',
    docUrl: `${PIPE_DOCS}/configuration-transforms.html`,
  },
  {
    label: "sink",
    detail: "object — data sink (optional)",
    sortText: "1_02",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-sinks.html`,
  },
  {
    label: "pump",
    detail: "object — scheduling config (optional)",
    sortText: "1_03",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-pump.html`,
  },
  {
    label: "metadata",
    detail: "object — arbitrary metadata (optional)",
    sortText: "1_04",
    valueSnippet: "{$0}",
  },
  {
    label: "description",
    detail: "string — human-readable description (optional)",
    sortText: "1_05",
  },
  { label: "comment", detail: "string — internal note (optional)", sortText: "1_06" },
  {
    label: "namespaces",
    detail: "boolean — enable namespacing (optional)",
    sortText: "1_07",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "add_namespaces",
    detail: "boolean (optional)",
    sortText: "1_08",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "remove_namespaces",
    detail: "boolean (optional)",
    sortText: "1_09",
    valueSnippet: "${0|true,false|}",
  },
  { label: "batch_size", detail: "integer (optional)", sortText: "1_10", valueSnippet: "$0" },
  {
    label: "checkpoint_interval",
    detail: "integer (optional)",
    sortText: "1_11",
    valueSnippet: "$0",
  },
  { label: "compaction", detail: "object (optional)", sortText: "1_12", valueSnippet: "{$0}" },
  {
    label: "expose_entity_id",
    detail: "boolean (optional)",
    sortText: "1_13",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "merge_existing_namespaces",
    detail: "boolean (optional)",
    sortText: "1_14",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "infer_pipe_entity_types",
    detail: "boolean (optional)",
    sortText: "1_15",
    valueSnippet: "${0|true,false|}",
  },
];

const SYS_CONFIG_DOCS =
  "https://docs.sesam.io/hub/documentation/service-configuration/systems/configuration-systems.html";

const SYSTEM_ROOT_PROPS: readonly PropInfo[] = [
  {
    label: "_id",
    detail: "string — unique system identifier (required)",
    sortText: "0_01",
    docUrl: SYS_CONFIG_DOCS,
  },
  {
    label: "type",
    detail: 'string — must be "system:*" (required)',
    sortText: "0_02",
    docUrl: SYS_CONFIG_DOCS,
  },
  {
    label: "metadata",
    detail: "object — arbitrary metadata (optional)",
    sortText: "1_01",
    valueSnippet: "{$0}",
  },
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
    valueSnippet: "{$0}",
  },
  {
    label: "system_defaults",
    detail: "object — default settings for all systems (optional)",
    sortText: "0_04",
    valueSnippet: "{$0}",
  },
  {
    label: "global_defaults",
    detail: "object — defaults for both pipes and systems (optional)",
    sortText: "1_01",
    valueSnippet: "{$0}",
  },
  {
    label: "feature_flags",
    detail: "object — enable/disable experimental features (optional)",
    sortText: "1_02",
    valueSnippet: "{$0}",
  },
  {
    label: "namespaces",
    detail: "object — namespace configuration (optional)",
    sortText: "1_03",
    valueSnippet: "{$0}",
  },
  {
    label: "metadata",
    detail: "object — node-level metadata tags (optional)",
    sortText: "1_04",
    valueSnippet: "{$0}",
  },
  { label: "description", detail: "string (optional)", sortText: "1_05" },
  { label: "comment", detail: "string (optional)", sortText: "1_06" },
];

// Combined superset for unknown .conf.json files
const UNKNOWN_ROOT_PROPS: readonly PropInfo[] = [
  ...PIPE_ROOT_PROPS,
  ...SYSTEM_ROOT_PROPS.filter((p) => !PIPE_ROOT_PROPS.some((q) => q.label === p.label)),
];

const SOURCE_PROPS: readonly PropInfo[] = [
  // ── Universal ────────────────────────────────────────────────────────────
  {
    label: "type",
    detail: "string — source type (required)",
    sortText: "0_01",
    docUrl: `${PIPE_DOCS}/configuration-sources.html#type-of-sources`,
  },

  // ── Dataset source ───────────────────────────────────────────────────────
  {
    label: "dataset",
    detail: "string — source dataset name (dataset source)",
    sortText: "1_01",
    docUrl: `${PIPE_DOCS}/configuration-sources-dataset.html`,
  },
  {
    label: "subset",
    detail: "array — DTL expression to filter entities (dataset/json/binary source)",
    sortText: "2_02",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-dataset.html`,
  },
  {
    label: "completeness",
    detail: "boolean — enable completeness tracking (dataset source)",
    sortText: "2_03",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-dataset.html`,
  },
  {
    label: "initial_completeness",
    detail: "boolean — treat first run as complete (dataset source)",
    sortText: "2_04",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-dataset.html`,
  },
  {
    label: "include_previous_versions",
    detail: "boolean — include older entity versions (dataset/union_datasets source)",
    sortText: "2_05",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-dataset.html`,
  },
  {
    label: "include_replaced",
    detail: "boolean — include replaced entities (dataset source)",
    sortText: "2_06",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-dataset.html`,
  },

  // ── SQL source ───────────────────────────────────────────────────────────
  {
    label: "system",
    detail: "string — system id (sql/rest/json/ldap/kafka/...)",
    sortText: "1_02",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "table",
    detail: "string — table name (sql/csv source)",
    sortText: "1_03",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "query",
    detail: "string — SQL query override (sql source)",
    sortText: "2_01",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "primary_key",
    detail: "string or array — primary key column(s) (sql/csv source)",
    sortText: "1_13",
    valueSnippet: '["$0"]',
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "updated_column",
    detail: "string — column holding last-updated timestamp for since-tracking (sql source)",
    sortText: "2_08",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "schema",
    detail: "string — database schema name (sql source)",
    sortText: "2_09",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "fetch_size",
    detail: "integer — rows per fetch batch (sql/ldap source)",
    sortText: "2_10",
    valueSnippet: "$0",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "whitelist",
    detail: "array — columns to include (sql/csv source)",
    sortText: "2_12",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "blacklist",
    detail: "array — columns to exclude (sql/csv source)",
    sortText: "2_13",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },
  {
    label: "preserve_null_values",
    detail: "boolean — keep SQL NULL as null in entities (sql source)",
    sortText: "2_14",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-sql.html`,
  },

  // ── URL-based sources ────────────────────────────────────────────────────
  {
    label: "url",
    detail: "string — URL (json/csv/binary/sdshare/rdf/sparql source)",
    sortText: "1_04",
    docUrl: `${PIPE_DOCS}/configuration-sources-json.html`,
  },
  {
    label: "headers",
    detail: "object — HTTP request headers (json/rest source)",
    sortText: "2_15",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-sources-json.html`,
  },
  {
    label: "page_size",
    detail: "integer — page size for paged sources (json/ldap/binary source)",
    sortText: "2_11",
    valueSnippet: "$0",
    docUrl: `${PIPE_DOCS}/configuration-sources-json.html`,
  },

  // ── REST source ──────────────────────────────────────────────────────────
  {
    label: "operation",
    detail: "string — operation name (rest/kafka source)",
    sortText: "1_05",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },
  {
    label: "operations",
    detail: "object — operation definitions map (rest source)",
    sortText: "2_16",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },
  {
    label: "payload",
    detail: "object — request body template (rest source)",
    sortText: "2_17",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },
  {
    label: "response_property",
    detail: "string — response body property containing entities (rest source)",
    sortText: "2_18",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },
  {
    label: "id_expression",
    detail: "string — Jinja template producing entity _id (rest source)",
    sortText: "2_19",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },
  {
    label: "rate_limiting_retries",
    detail: "integer — retries on HTTP 429 responses (rest source)",
    sortText: "2_20",
    valueSnippet: "$0",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },
  {
    label: "rate_limiting_delay",
    detail: "integer — seconds to wait after HTTP 429 (rest source)",
    sortText: "2_21",
    valueSnippet: "$0",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },
  {
    label: "trace",
    detail: "boolean — log full request/response (rest/http_endpoint source)",
    sortText: "2_22",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-rest.html`,
  },

  // ── CSV source ───────────────────────────────────────────────────────────
  {
    label: "has_header",
    detail: "boolean — first row is a header row (csv source)",
    sortText: "2_23",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-csv.html`,
  },
  {
    label: "field_names",
    detail: "array — column names when no header row (csv source)",
    sortText: "2_24",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-csv.html`,
  },
  {
    label: "delimiter",
    detail: "string — field separator character (csv source)",
    sortText: "2_25",
    docUrl: `${PIPE_DOCS}/configuration-sources-csv.html`,
  },
  {
    label: "encoding",
    detail: "string — file encoding, e.g. utf-8 (csv source)",
    sortText: "2_26",
    docUrl: `${PIPE_DOCS}/configuration-sources-csv.html`,
  },
  {
    label: "auto_dialect",
    detail: "boolean — auto-detect CSV dialect (csv source)",
    sortText: "2_27",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-csv.html`,
  },

  // ── HTTP endpoint source ─────────────────────────────────────────────────
  {
    label: "auto_populate_dataset",
    detail: "boolean — auto-create target dataset (http_endpoint source)",
    sortText: "2_28",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-http.html`,
  },
  {
    label: "validation_expression",
    detail: "array — DTL expression to validate incoming entities (http_endpoint source)",
    sortText: "2_29",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-http.html`,
  },

  // ── Embedded source ──────────────────────────────────────────────────────
  {
    label: "entities",
    detail: "array — inline entity list (embedded source)",
    sortText: "1_06",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-embedded.html`,
  },

  // ── Datasets-based sources ───────────────────────────────────────────────
  {
    label: "datasets",
    detail: "array — dataset names (union_datasets/merge/merge_datasets source)",
    sortText: "1_07",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-union-datasets.html`,
  },
  {
    label: "initial_datasets",
    detail: "array — bootstrap datasets for first run (union_datasets/merge source)",
    sortText: "2_30",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-union-datasets.html`,
  },
  {
    label: "ignore_non_existent_datasets",
    detail: "boolean — skip missing datasets instead of failing (union_datasets/merge source)",
    sortText: "2_31",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-union-datasets.html`,
  },
  {
    label: "prefix_ids",
    detail: "boolean — prefix entity _id with dataset name (union_datasets source)",
    sortText: "2_32",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-union-datasets.html`,
  },
  {
    label: "require_populated_input",
    detail: "boolean — require non-empty input datasets (dataset/union/merge source)",
    sortText: "2_07",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-union-datasets.html`,
  },

  // ── Merge source ─────────────────────────────────────────────────────────
  {
    label: "equality",
    detail: "array — equality expressions for merge grouping (merge source)",
    sortText: "2_33",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-merge.html`,
  },
  {
    label: "identity",
    detail: "string — merge identity strategy (merge source)",
    sortText: "2_34",
    docUrl: `${PIPE_DOCS}/configuration-sources-merge.html`,
  },
  {
    label: "strategy",
    detail: "string — merge or partition strategy (merge/merge_datasets/kafka source)",
    sortText: "2_35",
    docUrl: `${PIPE_DOCS}/configuration-sources-merge.html`,
  },
  {
    label: "max_merged",
    detail: "integer — max entities in one merged group (merge source)",
    sortText: "2_36",
    valueSnippet: "$0",
    docUrl: `${PIPE_DOCS}/configuration-sources-merge.html`,
  },

  // ── Conditional source ───────────────────────────────────────────────────
  {
    label: "condition",
    detail: "array — DTL condition expression (conditional source)",
    sortText: "1_09",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-conditional.html`,
  },
  {
    label: "alternatives",
    detail: "object — named alternative sources keyed by condition value (conditional source)",
    sortText: "1_10",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-sources-conditional.html`,
  },

  // ── Kafka source ─────────────────────────────────────────────────────────
  {
    label: "topic",
    detail: "string — Kafka topic name (kafka source)",
    sortText: "1_08",
    docUrl: `${PIPE_DOCS}/configuration-sources-kafka.html`,
  },
  {
    label: "partitions",
    detail: "integer or array — Kafka partitions to consume (kafka source)",
    sortText: "2_37",
    valueSnippet: "$0",
    docUrl: `${PIPE_DOCS}/configuration-sources-kafka.html`,
  },
  {
    label: "seek_to_beginning",
    detail: "boolean — start consuming from partition beginning (kafka source)",
    sortText: "2_38",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-kafka.html`,
  },
  {
    label: "consumer_timeout_ms",
    detail: "integer — Kafka consumer idle timeout in ms (kafka source)",
    sortText: "2_39",
    valueSnippet: "$0",
    docUrl: `${PIPE_DOCS}/configuration-sources-kafka.html`,
  },

  // ── LDAP source ──────────────────────────────────────────────────────────
  {
    label: "search_base",
    detail: "string — LDAP search base DN (ldap source)",
    sortText: "2_40",
    docUrl: `${PIPE_DOCS}/configuration-sources-ldap.html`,
  },
  {
    label: "search_filter",
    detail: "string — LDAP search filter expression (ldap source)",
    sortText: "2_41",
    docUrl: `${PIPE_DOCS}/configuration-sources-ldap.html`,
  },
  {
    label: "attributes",
    detail: "array — LDAP attributes to retrieve (ldap source)",
    sortText: "2_42",
    valueSnippet: "[$0]",
    docUrl: `${PIPE_DOCS}/configuration-sources-ldap.html`,
  },
  {
    label: "id_attribute",
    detail: "string — LDAP attribute to use as entity _id (ldap source)",
    sortText: "2_43",
    docUrl: `${PIPE_DOCS}/configuration-sources-ldap.html`,
  },

  // ── SDShare / RDF sources ────────────────────────────────────────────────
  {
    label: "sort_lists",
    detail: "boolean — sort RDF list values (sdshare/rdf source)",
    sortText: "2_44",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-sdshare.html`,
  },

  // ── SPARQL source ────────────────────────────────────────────────────────
  {
    label: "fragments_query",
    detail: "string — SPARQL query that returns the fragment list (sparql source)",
    sortText: "1_11",
    docUrl: `${PIPE_DOCS}/configuration-sources-sparql.html`,
  },
  {
    label: "fragment_query",
    detail: "string — SPARQL query for a single fragment (sparql source)",
    sortText: "1_12",
    docUrl: `${PIPE_DOCS}/configuration-sources-sparql.html`,
  },

  // ── RDF source ───────────────────────────────────────────────────────────
  {
    label: "format",
    detail: 'string — RDF serialization format, e.g. "turtle" (rdf source)',
    sortText: "2_45",
    docUrl: `${PIPE_DOCS}/configuration-sources-rdf.html`,
  },
  {
    label: "is_sorted",
    detail: "boolean — entities are already sorted in the source (rdf source)",
    sortText: "2_46",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources-rdf.html`,
  },

  // ── Cross-type optional ──────────────────────────────────────────────────
  {
    label: "supports_signalling",
    detail: "boolean — enable pipe signalling (dataset/union/binary/merge_datasets source)",
    sortText: "2_47",
    valueSnippet: "${0|true,false|}",
    docUrl: `${PIPE_DOCS}/configuration-sources.html`,
  },
  {
    label: "if_source_empty",
    detail: 'string — action when source is empty: "fail", "accept", or "ignore" (optional)',
    sortText: "2_48",
    docUrl: `${PIPE_DOCS}/configuration-sources.html`,
  },

  // ── Common ────────────────────────────────────────────────────────────────
  {
    label: "comment",
    detail: "string or array — human-readable comment (all source types)",
    sortText: "3_01",
    docUrl: `${PIPE_DOCS}/configuration-sources.html`,
  },
];

const TRANSFORM_PROPS: readonly PropInfo[] = [
  {
    label: "type",
    detail: "string — transform type (required)",
    sortText: "0_01",
    docUrl: `${PIPE_DOCS}/configuration-transforms.html#type-of-transforms`,
  },
  {
    label: "rules",
    detail: "object — DTL rules (dtl transform)",
    sortText: "0_02",
    valueSnippet: "{$0}",
    docUrl: `${PIPE_DOCS}/configuration-transforms-dtl.html`,
  },
  { label: "system", detail: "string — system id (http/rest transform)", sortText: "1_01" },
  { label: "operation", detail: "string — operation name (http/rest transform)", sortText: "1_02" },
  {
    label: "transform",
    detail: "array — sub-transforms (conditional)",
    sortText: "1_03",
    valueSnippet: "[$0]",
  },
  {
    label: "condition",
    detail: "array — condition expression (conditional)",
    sortText: "1_04",
    valueSnippet: "[$0]",
  },
  {
    label: "side_effects",
    detail: "boolean — allow side effects (optional)",
    sortText: "1_05",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "xml_config",
    detail: "object — XML configuration (xml transform)",
    sortText: "1_06",
    valueSnippet: "{$0}",
  },
  { label: "template", detail: "string — template string (template transform)", sortText: "1_07" },
];

const SINK_PROPS: readonly PropInfo[] = [
  {
    label: "type",
    detail: "string — sink type (required)",
    sortText: "0_01",
    docUrl: `${PIPE_DOCS}/configuration-sinks.html`,
  },
  { label: "dataset", detail: "string — target dataset (dataset sink)", sortText: "1_01" },
  { label: "system", detail: "string — system id (sql/rest/elasticsearch)", sortText: "1_02" },
  { label: "table", detail: "string — table name (sql sink)", sortText: "1_03" },
  { label: "operation", detail: "string — operation name (rest sink)", sortText: "1_04" },
  {
    label: "primary_key",
    detail: "array — primary key columns (sql sink)",
    sortText: "1_05",
    valueSnippet: "[$0]",
  },
  {
    label: "batch_size",
    detail: "integer — batch size (sql sink)",
    sortText: "1_06",
    valueSnippet: "$0",
  },
  {
    label: "set_initial_offset",
    detail: "string — initial offset (dataset sink)",
    sortText: "1_07",
  },
  {
    label: "deletion_tracking",
    detail: "boolean — track deletions (dataset sink)",
    sortText: "1_08",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "enable_optimistic_locking",
    detail: "boolean — optimistic locking (dataset sink)",
    sortText: "1_09",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "side_effects",
    detail: "boolean — allow side effects (optional)",
    sortText: "1_10",
    valueSnippet: "${0|true,false|}",
  },
];

const PUMP_PROPS: readonly PropInfo[] = [
  { label: "mode", detail: 'string — "scheduled" or "manual"', sortText: "0_01" },
  {
    label: "schedule_interval",
    detail: "integer — seconds between runs (optional)",
    sortText: "1_01",
    valueSnippet: "$0",
  },
  { label: "cron_expression", detail: "string — cron schedule (optional)", sortText: "1_02" },
  {
    label: "run_at_startup",
    detail: "boolean — run on node start (optional)",
    sortText: "1_03",
    valueSnippet: "${0|true,false|}",
  },
  {
    label: "max_retries",
    detail: "integer — retries on failure (optional)",
    sortText: "1_04",
    valueSnippet: "$0",
  },
  {
    label: "max_read_timeout_seconds",
    detail: "integer (optional)",
    sortText: "1_05",
    valueSnippet: "$0",
  },
  {
    label: "max_write_timeout_seconds",
    detail: "integer (optional)",
    sortText: "1_06",
    valueSnippet: "$0",
  },
  {
    label: "rescan_run_count",
    detail: "integer — full rescan frequency (optional)",
    sortText: "1_07",
    valueSnippet: "$0",
  },
  {
    label: "fallback_to_single_entities_on_error",
    detail: "boolean (optional)",
    sortText: "1_08",
    valueSnippet: "${0|true,false|}",
  },
];

// ---------------------------------------------------------------------------
// Phase C — type-specific prop narrowing
// ---------------------------------------------------------------------------

const SOURCE_TYPE_KEYS: Readonly<Record<string, readonly string[]>> = {
  dataset: [
    "dataset",
    "subset",
    "completeness",
    "initial_completeness",
    "require_populated_input",
    "include_previous_versions",
    "include_replaced",
    "supports_signalling",
    "if_source_empty",
    "comment",
  ],
  sql: [
    "system",
    "table",
    "query",
    "primary_key",
    "updated_column",
    "schema",
    "fetch_size",
    "whitelist",
    "blacklist",
    "preserve_null_values",
    "if_source_empty",
    "comment",
  ],
  rest: [
    "system",
    "operation",
    "url",
    "headers",
    "operations",
    "payload",
    "response_property",
    "id_expression",
    "rate_limiting_retries",
    "rate_limiting_delay",
    "trace",
    "if_source_empty",
    "comment",
  ],
  json: ["system", "url", "headers", "page_size", "subset", "if_source_empty", "comment"],
  csv: [
    "url",
    "system",
    "primary_key",
    "has_header",
    "field_names",
    "delimiter",
    "encoding",
    "auto_dialect",
    "whitelist",
    "blacklist",
    "if_source_empty",
    "comment",
  ],
  http_endpoint: ["auto_populate_dataset", "trace", "validation_expression", "comment"],
  embedded: ["entities", "if_source_empty", "comment"],
  empty: ["comment"],
  union_datasets: [
    "datasets",
    "initial_datasets",
    "ignore_non_existent_datasets",
    "require_populated_input",
    "include_previous_versions",
    "supports_signalling",
    "prefix_ids",
    "if_source_empty",
    "comment",
  ],
  merge: [
    "datasets",
    "initial_datasets",
    "ignore_non_existent_datasets",
    "require_populated_input",
    "equality",
    "identity",
    "strategy",
    "max_merged",
    "supports_signalling",
    "if_source_empty",
    "comment",
  ],
  merge_datasets: [
    "datasets",
    "initial_datasets",
    "ignore_non_existent_datasets",
    "require_populated_input",
    "strategy",
    "supports_signalling",
    "if_source_empty",
    "comment",
  ],
  conditional: ["condition", "alternatives", "comment"],
  kafka: [
    "system",
    "topic",
    "partitions",
    "seek_to_beginning",
    "strategy",
    "consumer_timeout_ms",
    "comment",
  ],
  ldap: [
    "system",
    "search_base",
    "search_filter",
    "attributes",
    "id_attribute",
    "fetch_size",
    "if_source_empty",
    "comment",
  ],
  binary: ["system", "url", "subset", "page_size", "supports_signalling", "comment"],
  sdshare: ["system", "url", "sort_lists", "if_source_empty", "comment"],
  sparql: ["system", "fragments_query", "fragment_query", "if_source_empty", "comment"],
  rdf: ["system", "url", "format", "sort_lists", "is_sorted", "if_source_empty", "comment"],
};

const TRANSFORM_TYPE_KEYS: Readonly<Record<string, readonly string[]>> = {
  dtl: ["rules"],
  http: ["system", "operation", "side_effects"],
  rest: ["system", "operation", "side_effects"],
  conditional: ["transform", "condition"],
  xml: ["xml_config"],
  template: ["template"],
};

const SINK_TYPE_KEYS: Readonly<Record<string, readonly string[]>> = {
  dataset: ["dataset", "deletion_tracking", "enable_optimistic_locking", "set_initial_offset"],
  sql: ["system", "table", "primary_key", "batch_size"],
  rest: ["system", "operation", "side_effects", "batch_size"],
  http: ["system", "operation", "side_effects", "batch_size"],
  elasticsearch: ["system", "batch_size"],
  kafka: ["system", "operation"],
  solr: ["system", "batch_size"],
  mail: ["system"],
  smtp: ["system"],
};

const narrowByType = <T extends { label: string }>(
  all: readonly T[],
  typeMap: Readonly<Record<string, readonly string[]>>,
  typeValue: string,
): readonly T[] => {
  const keys = typeMap[typeValue];

  return keys !== undefined ? all.filter((p) => keys.includes(p.label)) : all;
};

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
): {
  path: string[];
  presentKeys: Set<string>;
  hasOpenQuote: boolean;
  typeAtCurrentDepth: string | null;
} | null => {
  const hasOpenQuote = /[{,]\s*"[^"]*$/.test(prefix);
  const hasUnquotedWord = /[{,]\s*[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix);

  if (!hasOpenQuote && !hasUnquotedWord) {
    return null;
  }

  const pathStack: string[] = [];
  const presentsStack: Array<Set<string>> = [];
  const typeAtDepth: string[] = [];
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
        } else if (!isKey && depth > 0 && lastKey === "type") {
          typeAtDepth[depth - 1] = curStr;
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

  return {
    path: [...pathStack],
    presentKeys: currentPresentKeys,
    hasOpenQuote,
    typeAtCurrentDepth: typeAtDepth[depth - 1] ?? null,
  };
};

// ---------------------------------------------------------------------------
// Prop completion builder
// ---------------------------------------------------------------------------
const toCompletionItem = (p: PropInfo, hasOpenQuote: boolean): CompletionItem => {
  const valueSnippet = p.valueSnippet ?? '"$0"';
  const insertText = hasOpenQuote
    ? `${p.label}": ${valueSnippet}`
    : `"${p.label}": ${valueSnippet}`;

  return {
    label: p.label,
    kind: CompletionItemKind.Property,
    detail: p.detail,
    insertText,
    insertTextFormat: InsertTextFormat.Snippet,
    filterText: p.label,
    sortText: p.sortText,
  };
};

export const buildPropCompletions = (
  path: string[],
  fileType: ConfigFileType,
  presentKeys: Set<string>,
  hasOpenQuote = true,
  typeAtCurrentDepth: string | null = null,
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
    props =
      typeAtCurrentDepth !== null
        ? narrowByType(SOURCE_PROPS, SOURCE_TYPE_KEYS, typeAtCurrentDepth)
        : SOURCE_PROPS;
  } else if (path[path.length - 1] === "transform") {
    props =
      typeAtCurrentDepth !== null
        ? narrowByType(TRANSFORM_PROPS, TRANSFORM_TYPE_KEYS, typeAtCurrentDepth)
        : TRANSFORM_PROPS;
  } else if (path[path.length - 1] === "sink") {
    props =
      typeAtCurrentDepth !== null
        ? narrowByType(SINK_PROPS, SINK_TYPE_KEYS, typeAtCurrentDepth)
        : SINK_PROPS;
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

  return props
    .filter((p) => !presentKeys.has(p.label))
    .map((p) => toCompletionItem(p, hasOpenQuote));
};

// ---------------------------------------------------------------------------
// Prop hover: path-aware lookup + key-position guard
// ---------------------------------------------------------------------------

const PROP_TABLE_BY_PATH = (path: string[]): readonly PropInfo[] => {
  const tail = path[path.length - 1];

  if (path.length === 0) {
    return PIPE_ROOT_PROPS;
  }

  switch (tail) {
    case "source":
      return SOURCE_PROPS;
    case "transform":
      return TRANSFORM_PROPS;
    case "sink":
      return SINK_PROPS;
    case "pump":
      return PUMP_PROPS;
    case "pipe_defaults":
      return PIPE_ROOT_PROPS;
    case "system_defaults":
      return SYSTEM_ROOT_PROPS;
    default:
      return [
        ...PIPE_ROOT_PROPS,
        ...SYSTEM_ROOT_PROPS,
        ...NODE_METADATA_ROOT_PROPS,
        ...SOURCE_PROPS,
        ...TRANSFORM_PROPS,
        ...SINK_PROPS,
        ...PUMP_PROPS,
      ];
  }
};

/**
 * Returns true when `offset` is inside a JSON key string —
 * i.e. after the word's closing `"` comes optional whitespace then `:`.
 */
export const isAtJsonKeyPosition = (text: string, offset: number): boolean => {
  let i = offset;

  while (i < text.length && /[a-zA-Z0-9_$\-!.]/.test(text[i])) {
    i++;
  }

  if (text[i] !== '"') {
    return false;
  }

  i++;

  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }

  return text[i] === ":";
};

export const buildPropKeyHover = (word: string, path: string[]): string | null => {
  const table = PROP_TABLE_BY_PATH(path);
  const prop = table.find((p) => p.label === word);

  if (!prop) {
    return null;
  }

  return prop.docUrl
    ? `${prop.detail}\n\n[\ud83d\udcd6 Documentation](${prop.docUrl})`
    : prop.detail;
};

// ---------------------------------------------------------------------------
// Type value hover builders (for hovering over source/transform/system type values)
// ---------------------------------------------------------------------------

const buildTypeHoverContent = (
  label: string,
  categoryLabel: string,
  doc: string,
  docUrl: string,
): string =>
  `**\`${label}\`**\n\n${categoryLabel}\n\n${doc}\n\n[\ud83d\udcd6 Documentation](${docUrl})`;

export const buildSourceTypeHover = (word: string): string | null => {
  const info = PIPE_SOURCE_TYPES.find((t) => t.label === word);

  return info ? buildTypeHoverContent(info.label, "pipe source type", info.doc, info.docUrl) : null;
};

export const buildSystemTypeHover = (word: string): string | null => {
  const info = SYSTEM_TYPES.find((t) => t.label === word);

  return info ? buildTypeHoverContent(info.label, "system type", info.doc, info.docUrl) : null;
};

export const buildTransformTypeHover = (word: string): string | null => {
  const info = PIPE_TRANSFORM_TYPES.find((t) => t.label === word);

  return info
    ? buildTypeHoverContent(info.label, "pipe transform type", info.doc, info.docUrl)
    : null;
};

// ---------------------------------------------------------------------------
// Completion item builders
// ---------------------------------------------------------------------------
export const buildSystemTypeCompletions = (): CompletionItem[] => {
  return SYSTEM_TYPES.map(({ label, detail, doc, docUrl }) => ({
    label,
    kind: CompletionItemKind.EnumMember,
    detail,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**\`${label}\`**\n\n${detail}\n\n${doc}\n\n[📖 Documentation](${docUrl})`,
    },
    insertText: label,
    sortText: label,
  }));
};

export const buildSourceTypeCompletions = (): CompletionItem[] => {
  return PIPE_SOURCE_TYPES.map(({ label, detail, doc, docUrl }) => ({
    label,
    kind: CompletionItemKind.EnumMember,
    detail,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**\`${label}\`**\n\npipe source type\n\n${doc}\n\n[📖 Documentation](${docUrl})`,
    },
    insertText: label,
    sortText: label,
  }));
};

export const buildTransformTypeCompletions = (): CompletionItem[] => {
  return PIPE_TRANSFORM_TYPES.map(({ label, detail, doc, docUrl }) => ({
    label,
    kind: CompletionItemKind.EnumMember,
    detail,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**\`${label}\`**\n\npipe transform type\n\n${doc}\n\n[📖 Documentation](${docUrl})`,
    },
    insertText: label,
    sortText: label,
  }));
};

export const buildFunctionCompletions = (): CompletionItem[] => {
  return getAllFunctions().map((fn: DtlFunction) => {
    // The user has already typed `[` (which VS Code auto-closes to `[]`).
    // We only fill in the content between the brackets, e.g.:
    //   "add", "${1:property}", "${2:value}"
    // so the final result is ["add", "property", "value"].
    const required = fn.params.filter((p) => !p.optional);
    const paramSnippets = required.map((p, i) => `"\${${i + 1}:${p.name}}"`);
    const insertText =
      paramSnippets.length > 0 ? `"${fn.name}", ${paramSnippets.join(", ")}` : `"${fn.name}"`;

    return {
      label: fn.name,
      kind: fn.kind === "transform" ? CompletionItemKind.Method : CompletionItemKind.Function,
      detail: fn.description,
      labelDetails: { description: fn.signature },
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildFunctionMarkdown(fn),
      },
      sortText: fn.kind === "transform" ? `0_${fn.name}` : `1_${fn.name}`,
      insertText,
      insertTextFormat: InsertTextFormat.Snippet,
      filterText: fn.name,
    };
  });
};

export const buildVariableCompletions = (): CompletionItem[] => {
  const items: CompletionItem[] = Object.entries(DTL_VARIABLES).map(([name, desc]) => ({
    label: name,
    kind: CompletionItemKind.Variable,
    detail: desc,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${name}**\n\nDTL built-in variable\n\n${desc}\n\n[📖 Documentation](https://docs.sesam.io/hub/dtl/variables.html)`,
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
  const docUrl = fn.docUrl.includes("#") ? fn.docUrl : `${fn.docUrl}#${fn.name}`;

  return [
    `**\`${fn.name}\`** — ${fn.category} · ${kindLabel}`,
    "",
    `\`\`\`\n${fn.signature}\n\`\`\``,
    "",
    fn.description,
    "",
    params ? `**Parameters** (${argInfo}):\n${params}` : `*No arguments.*`,
    "",
    `[📖 Documentation](${docUrl})`,
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
