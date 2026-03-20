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
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['"', "[", "_", "."],
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

connection.onDidChangeConfiguration(() => {
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

  const diagnostics: Diagnostic[] = validateCalls(
    parseResult.calls,
    validatorOptions,
  );
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

documents.onDidClose((event) => {
  documentSettings.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------
connection.onCompletion(
  (params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // Determine context by looking backwards from cursor
    const prefix = text.slice(Math.max(0, offset - 100), offset);

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

function isVariableContext(prefix: string): boolean {
  // Cursor is inside a string that starts with _
  return /"\s*_[STPRB]?\.?[^"]*$/.test(prefix);
}

function isFunctionNameContext(prefix: string): boolean {
  // After [ optionally followed by whitespace and an opening quote
  return /\[\s*"[^"]*$/.test(prefix) || /\[\s*$/.test(prefix);
}

function buildFunctionCompletions(): CompletionItem[] {
  return getAllFunctions().map((fn: DtlFunction) => ({
    label: fn.name,
    kind:
      fn.kind === "transform"
        ? CompletionItemKind.Method
        : CompletionItemKind.Function,
    detail: fn.signature,
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
      detail: "DTL built-in variable",
      documentation: {
        kind: MarkupKind.Markdown,
        value: desc,
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

/** Context stack entries used by the Sesam JSON formatter. */
enum FmtContext {
  Root,
  String,
  Array,
  Object,
  Escape,
}

function sortObjectKeysRecursively(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeysRecursively);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeysRecursively(
      (obj as Record<string, unknown>)[key],
    );
  }
  return sorted;
}

/**
 * Formats a parsed JSON value as a Sesam pipe config:
 *   - Object keys sorted alphabetically at every level
 *   - Object properties each on their own line with indentation
 *   - Array items (DTL rule lists) separated by spaces; each sub-array
 *     opened on a new line when nested inside another array
 *
 * Ported from https://github.com/BaardBouvet/dtl-vscode-extension
 */
function formatSesamJson(value: unknown, tabSize: number): string {
  const indentation = " ".repeat(tabSize);
  const compact = JSON.stringify(sortObjectKeysRecursively(value), null, 0);

  let output = "";
  let indent = 0;
  const stack: FmtContext[] = [FmtContext.Object];
  let prev = "";

  for (let i = 0; i < compact.length; i++) {
    const c = compact[i];

    const peek = (): string | undefined =>
      i < compact.length - 1 ? compact[i + 1] : undefined;
    const peekStack = (): FmtContext => stack[stack.length - 1];

    // ── Context tracking ──────────────────────────────────────────────────
    if (peekStack() === FmtContext.Escape) {
      stack.pop();
    }

    if (peekStack() === FmtContext.String) {
      if (c === '"') stack.pop();
      else if (c === "\\") stack.push(FmtContext.Escape);
    } else {
      if (c === '"') {
        stack.push(FmtContext.String);
      } else if (c === "{") {
        if (peekStack() === FmtContext.Object) indent++;
        stack.push(FmtContext.Object);
      } else if (c === "}") {
        stack.pop();
        if (peekStack() === FmtContext.Object) indent--;
      } else if (c === "[") {
        stack.push(FmtContext.Array);
        indent++;
      } else if (c === "]") {
        stack.pop();
        indent--;
      }
    }

    const ctx = peekStack(); // context AFTER stack update

    // ── Whitespace BEFORE char ─────────────────────────────────────────────
    if (ctx !== FmtContext.String && ctx !== FmtContext.Escape) {
      // Newline before closing `}` (unless empty object)
      if (c === "}" && prev !== "{") {
        output += "\n";
        output +=
          ctx === FmtContext.Array
            ? indentation.repeat(Math.max(0, indent - 1))
            : indentation.repeat(Math.max(0, indent));
      }

      // Newline before `[` when it opens an array inside another array
      if (
        c === "[" &&
        stack.length > 1 &&
        stack[stack.length - 2] === FmtContext.Array
      ) {
        output += "\n";
        output += indentation.repeat(Math.max(0, indent - 1));
      }

      // Extra newline before closing `]` when the previous char was also `]`
      // (aligns the end of the outer rules list)
      if (c === "]" && prev === "]") {
        output += "\n";
        output += indentation.repeat(Math.max(0, indent));
      }
    }

    output += c;

    // ── Whitespace AFTER char ──────────────────────────────────────────────
    if (ctx !== FmtContext.String && ctx !== FmtContext.Escape) {
      // Newline after `{` (unless empty object)
      if (c === "{" && peek() !== "}") {
        output += "\n";
        output += indentation.repeat(indent);
      }
      if (c === ",") {
        if (ctx === FmtContext.Object) {
          output += "\n";
          output += indentation.repeat(indent);
        } else if (ctx === FmtContext.Array) {
          output += " ";
        }
      }
      if (c === ":") {
        output += " ";
      }
    }

    prev = c;
  }

  return output;
}

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
