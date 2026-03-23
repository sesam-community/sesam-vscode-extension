/**
 * DTL Language Server
 * Implements LSP features: completions, hover, diagnostics, and document formatting.
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  Hover,
  MarkupKind,
  DocumentFormattingParams,
  TextEdit,
  Range,
  Position,
  Diagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import {
  getAllFunctions,
  getDtlFunction,
  DTL_VARIABLES,
  ENTITY_RESERVED_FIELDS,
  DtlFunction,
} from "../../src/shared/dtl-registry";
import { parseDtlText } from "./dtl-parser";
import { validateCalls, ValidatorOptions } from "./dtl-validator";
import { formatSesamJson } from "./dtl-formatter";

// ---------------------------------------------------------------------------
// Connection & document store
// ---------------------------------------------------------------------------
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      completionProvider: {
        triggerCharacters: ['"', "[", "_", ".", ":"],
        resolveProvider: false,
      },
      hoverProvider: true,
      documentFormattingProvider: true,
    },
  };
});

// ---------------------------------------------------------------------------
// Settings (kept in sync with VS Code configuration)
// ---------------------------------------------------------------------------
interface DtlSettings {
  maxNumberOfProblems: number;
  validate: {
    enabled: boolean;
    unknownFunctions: boolean;
    argCount: boolean;
  };
}

const defaultSettings: DtlSettings = {
  maxNumberOfProblems: 100,
  validate: { enabled: true, unknownFunctions: true, argCount: true },
};

const documentSettings = new Map<string, Promise<DtlSettings>>();

// ---------------------------------------------------------------------------
// Sesam node settings
// ---------------------------------------------------------------------------
interface SesamSettings {
  nodeUrl: string;
  jwt: string;
}

let sesamSettingsCache: SesamSettings | null = null;

async function getSesamSettings(): Promise<SesamSettings> {
  if (!sesamSettingsCache) {
    const s = (await connection.workspace.getConfiguration({
      section: "sesam",
    })) as { nodeUrl?: string; jwt?: string } | null;
    sesamSettingsCache = {
      nodeUrl: (s?.nodeUrl ?? "").trim().replace(/\/$/, ""),
      jwt: (s?.jwt ?? "").trim(),
    };
  }
  return sesamSettingsCache;
}

// Cache for node-backed diagnostics, keyed by document URI
const nodeValidationDiagnostics = new Map<string, Diagnostic[]>();

connection.onDidChangeConfiguration(() => {
  sesamSettingsCache = null;
  documentSettings.clear();
  documents.all().forEach(validateDocument);
});

async function getDocumentSettings(resource: string): Promise<DtlSettings> {
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace
      .getConfiguration({ scopeUri: resource, section: "dtl" })
      .then((s) => (s as DtlSettings) ?? defaultSettings);
    documentSettings.set(resource, result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation / Diagnostics
// ---------------------------------------------------------------------------
async function validateDocument(document: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(document.uri);

  if (!settings.validate?.enabled) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }

  const ext = "json";
  const parseResult = parseDtlText(document.getText(), ext);

  const validatorOptions: ValidatorOptions = {
    maxProblems:
      settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems,
    validateUnknownFunctions: settings.validate?.unknownFunctions ?? true,
    validateArgCount: settings.validate?.argCount ?? true,
  };

  const localDiagnostics: Diagnostic[] = validateCalls(
    parseResult.calls,
    validatorOptions,
  );

  const nodeDiags = nodeValidationDiagnostics.get(document.uri) ?? [];
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: [...localDiagnostics, ...nodeDiags],
  });
}

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

documents.onDidSave(async (event) => {
  const document = event.document;
  if (!document.uri.endsWith(".conf.json")) return;
  const nodeDiags = await validateDocumentWithNode(document);
  nodeValidationDiagnostics.set(document.uri, nodeDiags);
  validateDocument(document);
});

documents.onDidClose((event) => {
  documentSettings.delete(event.document.uri);
  nodeValidationDiagnostics.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------
// Node-backed config validation
// ---------------------------------------------------------------------------

interface ConfigError {
  msg: string;
  elements: string; // JSONPath like "$" or "$['transform']"
  level: string; // "error" | "critical" | "warning" | "info"
}

interface ValidateConfigResponse {
  "is-valid-config": boolean;
  "config-errors": ConfigError[];
}

function levelToSeverity(level: string): DiagnosticSeverity {
  switch (level) {
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    default: // "error" or "critical"
      return DiagnosticSeverity.Error;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function elementsToRange(
  document: TextDocument,
  text: string,
  elements: string,
): Range {
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
  return Range.create(
    Position.create(0, 0),
    Position.create(0, Number.MAX_SAFE_INTEGER),
  );
}

async function validateDocumentWithNode(
  document: TextDocument,
): Promise<Diagnostic[]> {
  const { nodeUrl, jwt } = await getSesamSettings();
  if (!nodeUrl || !jwt) return [];

  const text = document.getText();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  try {
    const response = await fetch(`${nodeUrl}/api/utils/validate-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `bearer ${jwt}`,
      },
      body: JSON.stringify([parsed]),
    });

    if (!response.ok) return [];

    const result = (await response.json()) as ValidateConfigResponse;
    if (result["is-valid-config"]) return [];

    return (result["config-errors"] ?? []).map((err) => ({
      range: elementsToRange(document, text, err.elements),
      message: `[Node] ${err.msg}`,
      severity: levelToSeverity(err.level),
      source: "sesam-node",
    }));
  } catch {
    // Network errors, auth failures, etc. — degrade silently
    return [];
  }
}

// ---------------------------------------------------------------------------
// System-type completions data
// ---------------------------------------------------------------------------
interface SystemTypeInfo {
  label: string; // full "system:xxx" value
  detail: string;
  doc: string;
}

const SYSTEM_TYPES: SystemTypeInfo[] = [
  {
    label: "system:elasticsearch",
    detail: "Elasticsearch system",
    doc: "Connect to an Elasticsearch cluster for indexing and querying.",
  },
  {
    label: "system:kafka",
    detail: "Kafka system",
    doc: "Connect to an Apache Kafka broker for producing/consuming messages.",
  },
  {
    label: "system:ldap",
    detail: "LDAP system",
    doc: "Connect to an LDAP/Active Directory server.",
  },
  {
    label: "system:microservice",
    detail: "Microservice system",
    doc: "Manages a Docker-based microservice running inside the Sesam node.",
  },
  {
    label: "system:mssql",
    detail: "Microsoft SQL Server system",
    doc: "Connect to a Microsoft SQL Server database.",
  },
  {
    label: "system:mssql-legacy",
    detail: "Legacy Microsoft SQL Server system",
    doc: "Legacy connector for Microsoft SQL Server (older driver).",
  },
  {
    label: "system:mysql",
    detail: "MySQL / MariaDB system",
    doc: "Connect to a MySQL or MariaDB database.",
  },
  {
    label: "system:oracle",
    detail: "Oracle Database system (JDBC)",
    doc: "Connect to an Oracle Database using JDBC.",
  },
  {
    label: "system:oracle_tns",
    detail: "Oracle Database system (TNS)",
    doc: "Connect to an Oracle Database via a TNS alias.",
  },
  {
    label: "system:postgresql",
    detail: "PostgreSQL system",
    doc: "Connect to a PostgreSQL database.",
  },
  {
    label: "system:rest",
    detail: "REST system",
    doc: "Generic REST/HTTP system with OAuth2, headers, operations, and retry config.",
  },
  {
    label: "system:smtp",
    detail: "SMTP system",
    doc: "Send email via an SMTP server.",
  },
  {
    label: "system:solr",
    detail: "Apache Solr system",
    doc: "Connect to an Apache Solr search platform.",
  },
  {
    label: "system:twilio",
    detail: "Twilio system",
    doc: "Send SMS/voice messages via Twilio.",
  },
  {
    label: "system:url",
    detail: "URL system",
    doc: "Simple HTTP/HTTPS system — the lightweight alternative to `system:rest`.",
  },
];

// ---------------------------------------------------------------------------
// Source-type completions data
// ---------------------------------------------------------------------------
interface SourceTypeInfo {
  label: string;
  detail: string;
  doc: string;
}

const PIPE_SOURCE_TYPES: SourceTypeInfo[] = [
  {
    label: "dataset",
    detail: "Read from a Sesam dataset",
    doc: "Reads entities from a Sesam dataset.\n\nRequired: `dataset`",
  },
  {
    label: "sql",
    detail: "Read from a SQL table via a SQL system",
    doc: "Reads rows from a SQL table via a SQL system.\n\nRequired: `system`, `table`",
  },
  {
    label: "rest",
    detail: "Read from a REST API via a REST system",
    doc: "Reads entities from a REST API via a REST system.\n\nRequired: `system`, `operation`",
  },
  {
    label: "json",
    detail: "Read JSON from a URL via a URL/REST system",
    doc: "Reads a JSON document from a URL.\n\nRequired: `system`, `url`",
  },
  {
    label: "csv",
    detail: "Read CSV via a URL/REST system",
    doc: "Reads a CSV file and emits one entity per row.\n\nRequired: `system`, `url`",
  },
  {
    label: "http_endpoint",
    detail: "Receive data pushed to an HTTP endpoint",
    doc: "Creates an HTTP inbound endpoint. Entities are pushed to it by an external system.",
  },
  {
    label: "embedded",
    detail: "Inline entities defined in the config",
    doc: "Emits a static list of entities defined directly in the config.\n\nRequired: `entities` (array)",
  },
  {
    label: "empty",
    detail: "Emits no entities (placeholder / testing)",
    doc: "Produces no entities — useful for placeholder pipes or testing transforms.",
  },
  {
    label: "union_datasets",
    detail: "Union multiple datasets into one stream",
    doc: "Merges the entity streams of several datasets (set union).\n\nRequired: `datasets` (array of dataset IDs)",
  },
  {
    label: "merge",
    detail: "Merge entities from multiple sources",
    doc: "Merges multiple source streams, grouping entities by `_id`.\n\nRequired: `sources` (array of source objects)",
  },
  {
    label: "merge_datasets",
    detail: "Keep latest version of each entity across datasets",
    doc: "Merges datasets and retains the latest version of each entity.\n\nRequired: `datasets` (array of dataset IDs)",
  },
  {
    label: "conditional",
    detail: "Pick a source based on a runtime condition",
    doc: "Selects from alternative source configs based on a runtime expression.\n\nRequired: `condition`, `alternatives`",
  },
  {
    label: "kafka",
    detail: "Read from Kafka via a Kafka system",
    doc: "Reads messages from a Kafka topic.\n\nRequired: `system`",
  },
  {
    label: "ldap",
    detail: "Read from LDAP via an LDAP system",
    doc: "Reads entries from an LDAP directory.\n\nRequired: `system`",
  },
  {
    label: "binary",
    detail: "Read binary data via a system",
    doc: "Reads binary blobs via a system that supports binary operations.\n\nRequired: `system`, `operation`",
  },
  {
    label: "sdshare",
    detail: "Read from an SDShare feed",
    doc: "Reads RDF fragments from an SDShare feed.\n\nRequired: `url`",
  },
  {
    label: "sparql",
    detail: "Read from a SPARQL endpoint",
    doc: "Executes a SPARQL query against an endpoint.\n\nRequired: `url`",
  },
  {
    label: "rdf",
    detail: "Read RDF data from a URL",
    doc: "Reads RDF data (Turtle, N-Triples, RDF/XML, …) from a URL.\n\nRequired: `url`",
  },
];

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------
connection.onCompletion(
  (params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // Use a wider window so we can detect "source": { "type": context
    const prefix = text.slice(Math.max(0, offset - 2000), offset);

    // Source type completion: inside "source": { "type": "..."
    if (isSourceTypeContext(prefix)) {
      return buildSourceTypeCompletions();
    }

    // System type completion: root-level "type": "system:..."
    if (isSystemTypeContext(prefix)) {
      return buildSystemTypeCompletions();
    }

    // Variable completion: triggered after "_" or inside a string starting with "_"
    if (isVariableContext(prefix)) {
      return buildVariableCompletions();
    }

    // Function name completion: cursor is after an opening "[" (possibly with a quote)
    if (isFunctionNameContext(prefix)) {
      return buildFunctionCompletions();
    }

    return [];
  },
);

function isSourceTypeContext(prefix: string): boolean {
  // Cursor is inside the value of "type" that lives inside a "source": { ... block
  return /"source"\s*:\s*\{[^{}]*"type"\s*:\s*"[^"]*$/.test(prefix);
}

function isSystemTypeContext(prefix: string): boolean {
  // Root-level "type" field — cursor is inside the value and it starts with
  // "system:" OR we just triggered after the opening quote / colon.
  // The root object has brace-depth 1 (only the outermost { is open).
  // We check: not inside a nested object (no unclosed { after the outermost one)
  // AND cursor is typing the value of a top-level "type" key.
  if (!/"type"\s*:\s*"[^"]*$/.test(prefix)) return false;
  // Count net open braces — at root level this should be exactly 1
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
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
  }
  return depth === 1;
}

function isVariableContext(prefix: string): boolean {
  // Cursor is inside a string that starts with _
  return /"\s*_[STPRB]?\.?[^"]*$/.test(prefix);
}

function isFunctionNameContext(prefix: string): boolean {
  // After [ optionally followed by whitespace and an opening quote
  return /\[\s*"[^"]*$/.test(prefix) || /\[\s*$/.test(prefix);
}

function buildSystemTypeCompletions(): CompletionItem[] {
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
}

function buildSourceTypeCompletions(): CompletionItem[] {
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
}

function buildFunctionCompletions(): CompletionItem[] {
  return getAllFunctions().map((fn: DtlFunction) => ({
    label: fn.name,
    kind:
      fn.kind === "transform"
        ? CompletionItemKind.Method
        : CompletionItemKind.Function,
    detail: fn.description,
    labelDetails: { description: fn.signature },
    documentation: {
      kind: MarkupKind.Markdown,
      value: buildFunctionMarkdown(fn),
    },
    sortText: fn.kind === "transform" ? `0_${fn.name}` : `1_${fn.name}`,
    insertText: fn.name,
  }));
}

function buildVariableCompletions(): CompletionItem[] {
  const items: CompletionItem[] = Object.entries(DTL_VARIABLES).map(
    ([name, desc]) => ({
      label: name,
      kind: CompletionItemKind.Variable,
      detail: desc,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${name}** — DTL built-in variable\n\n${desc}\n\n[📖 Documentation](https://docs.sesam.io/hub/dtl/dtl-variables.html)`,
      },
      insertText: name,
      sortText: `0_${name}`,
    }),
  );

  // Also suggest reserved entity fields
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
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const word = getWordAtPosition(document, params.position);
  if (!word) return null;

  // Check built-in variables first
  if (word.startsWith("_")) {
    const varKey = word.split(".")[0]; // "_S" from "_S.name"
    const varDesc = DTL_VARIABLES[varKey];
    if (varDesc) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${varKey}** — DTL built-in variable\n\n${varDesc}`,
        },
      };
    }
  }

  // Check DTL functions
  const fn = getDtlFunction(word);
  if (fn) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: buildFunctionMarkdown(fn),
      },
    };
  }

  // Reserved entity fields
  if (ENTITY_RESERVED_FIELDS.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** — Sesam reserved entity field.\n\n[DTL documentation](https://docs.sesam.io/hub/quick-reference.html)`,
      },
    };
  }

  return null;
});

function getWordAtPosition(
  document: TextDocument,
  position: Position,
): string | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Walk left to find word start
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;

  // Walk right to find word end
  let end = offset;
  while (end < text.length && isWordChar(text[end])) end++;

  if (start === end) return null;
  return text.slice(start, end);
}

function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_$\-!.]/.test(ch);
}

function buildFunctionMarkdown(fn: DtlFunction): string {
  const kindLabel = fn.kind === "transform" ? "🔧 Transform" : "📦 Expression";
  const params = fn.params
    .map(
      (p) =>
        `- \`${p.name}\`${p.optional ? " *(optional)*" : ""} — ${p.description}`,
    )
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
}

// ---------------------------------------------------------------------------
// Document Formatting
// ---------------------------------------------------------------------------
connection.onDocumentFormatting(
  (params: DocumentFormattingParams): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const text = document.getText();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }

    const formatted = formatSesamJson(parsed, params.options.tabSize ?? 2);
    if (formatted === text) return [];

    const endPos = document.positionAt(text.length);
    return [
      TextEdit.replace(Range.create(Position.create(0, 0), endPos), formatted),
    ];
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
documents.listen(connection);
connection.listen();
