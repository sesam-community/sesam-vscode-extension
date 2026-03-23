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
  TextDocumentPositionParams,
  Hover,
  MarkupKind,
  DocumentFormattingParams,
  TextEdit,
  Range,
  Position,
  Diagnostic,
  DocumentSymbol,
  DocumentSymbolParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import {
  getDtlFunction,
  DTL_VARIABLES,
  ENTITY_RESERVED_FIELDS,
} from "../../src/shared/dtl-registry";
import { parseDtlText } from "./dtl-parser";
import { validateCalls, ValidatorOptions } from "./dtl-validator";
import { formatSesamJson } from "../../src/shared/config-formatter";
import type { DtlSettings, SesamSettings } from "./types";
import { defaultSettings } from "./constants";
import {
  isSourceTypeContext,
  isSystemTypeContext,
  isVariableContext,
  isFunctionNameContext,
  buildSystemTypeCompletions,
  buildSourceTypeCompletions,
  buildFunctionCompletions,
  buildVariableCompletions,
  getWordAtPosition,
  buildFunctionMarkdown,
  buildDocumentSymbols,
} from "./utils";

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
      documentSymbolProvider: true,
    },
  };
});

// ---------------------------------------------------------------------------
// Settings (kept in sync with VS Code configuration)
// ---------------------------------------------------------------------------
const documentSettings = new Map<string, Promise<DtlSettings>>();

// ---------------------------------------------------------------------------
// Sesam node settings
// ---------------------------------------------------------------------------
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

documents.onDidClose((event) => {
  documentSettings.delete(event.document.uri);
  nodeValidationDiagnostics.delete(event.document.uri);
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

// ---------------------------------------------------------------------------
// Document Symbols (Outline)
// ---------------------------------------------------------------------------
connection.onDocumentSymbol(
  (params: DocumentSymbolParams): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const text = document.getText();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return [];
    return buildDocumentSymbols(
      document,
      text,
      parsed as Record<string, unknown>,
    );
  },
);

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
