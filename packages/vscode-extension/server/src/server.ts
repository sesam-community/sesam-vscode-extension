/**
 * DTL Language Server
 * Implements LSP features: completions, hover, diagnostics, and document formatting.
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

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
  Location,
  ReferenceParams,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  DocumentSymbolParams,
  DocumentLink,
  DocumentLinkParams,
  FileChangeType,
  WorkspaceFolder,
  RenameParams,
  PrepareRenameParams,
  WorkspaceEdit,
  RenameFile,
  TextDocumentEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  getDtlFunction,
  DTL_VARIABLES,
  ENTITY_RESERVED_FIELDS,
} from "../../src/shared/dtl-registry";
import { formatSesamJson } from "../../src/shared/config-formatter";
import { parseDtlText } from "./dtl-parser";
import { validateCalls } from "./dtl-validator";
import { validateStructure } from "./dtl-structure-validator";
import { validatePathStrings } from "./dtl-path-validator";
import { validateConfigStructure } from "./config-structure-validator";
import { defaultSettings } from "./constants";
import {
  isSourceTypeContext,
  isTransformTypeContext,
  isSystemTypeContext,
  isVariableContext,
  isDtlRuleArrayContext,
  isPropKeyContext,
  getPropKeyContext,
  getConfigFileType,
  buildSystemTypeCompletions,
  buildSourceTypeCompletions,
  buildTransformTypeCompletions,
  buildFunctionCompletions,
  buildVariableCompletions,
  buildPropCompletions,
  getWordAtPosition,
  isWordChar,
  isAtJsonKeyPosition,
  buildPropKeyHover,
  buildFunctionMarkdown,
  buildSourceTypeHover,
  buildSystemTypeHover,
  buildTransformTypeHover,
  buildDocumentSymbols,
  offsetToPosition,
} from "./utils/server.utils";
import {
  findApplyRuleReference,
  findRuleDefinition,
  findRuleKeyAtOffset,
  findAllApplyReferences,
} from "./utils/definition.utils";
import { workspaceIndex } from "./utils/workspace-index";
import {
  findDatasetReference,
  findSystemReference,
  findIdAtOffset,
} from "./utils/reference-detection.utils";
import { collectDocumentLinks } from "./utils/document-links.utils";
import { findAllCrossReferences } from "./utils/cross-references.utils";
import {
  findAliasAtOffset,
  findAliasUsageAtOffset,
  collectAliasRanges,
  offsetRangeToLsp,
} from "./utils/alias-rename.utils";
import { findAddPropertyAtOffset, findAllAddPropertyDefinitions } from "./utils/dtl-property.utils";

import type { DtlSettings } from "./server.types";
import type { ValidatorOptions } from "../../types/dtl-validator.types";
import type {
  LintContentRequest,
  LintContentResponse,
  LintDiagnostic,
  LintSeverity,
  LintWorkspaceRequest,
  LintWorkspaceResponse,
} from "../../types/lint.types";

// ---------------------------------------------------------------------------
// Connection & document store
// ---------------------------------------------------------------------------
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
let workspaceFolders: WorkspaceFolder[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceFolders = params.workspaceFolders ?? [];
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      completionProvider: {
        triggerCharacters: ['"', "[", "_", ".", ":", "{"],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentFormattingProvider: true,
      documentSymbolProvider: true,
      documentLinkProvider: { resolveProvider: false },
      renameProvider: { prepareProvider: true },
    },
  };
});

connection.onInitialized(() => {
  workspaceIndex.scanWorkspace(workspaceFolders);
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    const uri = change.uri;
    if (change.type === FileChangeType.Deleted) {
      workspaceIndex.removeFile(uri);
    } else {
      try {
        const fsPath = fileURLToPath(uri);
        const text = fs.readFileSync(fsPath, "utf-8");
        workspaceIndex.updateFile(uri, text);
      } catch {
        // File temporarily inaccessible — skip
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Settings (kept in sync with VS Code configuration)
// ---------------------------------------------------------------------------
const documentSettings = new Map<string, Promise<DtlSettings>>();

// ---------------------------------------------------------------------------
// Sesam node settings
// ---------------------------------------------------------------------------
// let sesamSettingsCache: SesamSettings | null = null;

// async function getSesamSettings(): Promise<SesamSettings> {
//   if (!sesamSettingsCache) {
//     const s = (await connection.workspace.getConfiguration({
//       section: "sesam",
//     })) as { nodeUrl?: string; jwt?: string } | null;
//     sesamSettingsCache = {
//       nodeUrl: (s?.nodeUrl ?? "").trim().replace(/\/$/, ""),
//       jwt: (s?.jwt ?? "").trim(),
//     };
//   }
//   return sesamSettingsCache;
// }

// Cache for node-backed diagnostics, keyed by document URI
const nodeValidationDiagnostics = new Map<string, Diagnostic[]>();

connection.onDidChangeConfiguration(() => {
  // sesamSettingsCache = null;
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

  const text = document.getText();
  const ext = "json";
  const parseResult = parseDtlText(text, ext);
  const diagnostics: Diagnostic[] = [];

  const validatorOptions: ValidatorOptions = {
    maxProblems: settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems,
    validateUnknownFunctions: settings.validate?.unknownFunctions ?? true,
    validateArgCount: settings.validate?.argCount ?? true,
    validateJsonSyntax: settings.validate?.jsonSyntax ?? true,
    validateDtlStructure: settings.validate?.dtlStructure ?? true,
    validateTransformInExpression: settings.validate?.transformInExpression ?? true,
    validatePathExpressions: settings.validate?.pathExpressions ?? false,
    validateConfigStructure: settings.validate?.configStructure ?? true,
    ruleNames: parseResult.ruleNames,
  };

  // Phase A: JSON parse error
  if (parseResult.parseError !== null && validatorOptions.validateJsonSyntax) {
    const offset = parseResult.parseError.offset;
    const pos = offset >= 0 ? offsetToPosition(text, offset) : { line: 0, character: 0 };
    diagnostics.push({
      range: Range.create(
        pos.line,
        pos.character,
        pos.line,
        Math.max(pos.character + 1, pos.character),
      ),
      severity: DiagnosticSeverity.Error,
      message: `Invalid JSON: ${parseResult.parseError.message}`,
      source: "dtl",
      code: "invalid-json",
    });
  } else {
    // Only run semantic checks when JSON is valid
    diagnostics.push(
      ...validateStructure(parseResult.calls, parseResult.structuralErrors, validatorOptions),
    );
    diagnostics.push(...validateCalls(parseResult.calls, validatorOptions));
    diagnostics.push(...validatePathStrings(parseResult.calls, validatorOptions));
    diagnostics.push(...validateConfigStructure(text, validatorOptions));
  }

  const nodeDiags = nodeValidationDiagnostics.get(document.uri) ?? [];
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: [...diagnostics, ...nodeDiags],
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
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Use a wider window so we can detect "source": { "type": context
  const prefix = text.slice(Math.max(0, offset - 2000), offset);

  const fileType = getConfigFileType(params.textDocument.uri);

  // Source type completion: inside "source": { "type": "..."
  if (isSourceTypeContext(prefix)) {
    return buildSourceTypeCompletions();
  }

  // Transform type completion: inside "transform": { "type": "..."
  if (isTransformTypeContext(prefix)) {
    return buildTransformTypeCompletions();
  }

  // System type completion: root-level "type": "system:..."
  // Not applicable for node-metadata.conf.json
  if (isSystemTypeContext(prefix) && fileType !== "node-metadata") {
    return buildSystemTypeCompletions();
  }

  // Property key completion: cursor is at a JSON object key position.
  // Checked before variable context so that keys starting with "_" (like "_id")
  // get prop completions rather than DTL variable completions.
  if (isPropKeyContext(prefix)) {
    const ctx = getPropKeyContext(prefix);

    if (ctx) {
      return buildPropCompletions(
        ctx.path,
        fileType,
        ctx.presentKeys,
        ctx.hasOpenQuote,
        ctx.typeAtCurrentDepth,
      );
    }
  }

  // Variable completion: triggered after "_" or inside a string starting with "_"
  if (isVariableContext(prefix)) {
    return buildVariableCompletions();
  }

  // Function name completion: only inside a DTL rule array (transform.rules.<name>.[...)
  if (isDtlRuleArrayContext(prefix)) {
    return buildFunctionCompletions();
  }

  return [];
});

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Alias hover — check before word-based lookup
  const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

  if (aliasHit) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${aliasHit.alias}**\n\nalias for dataset \`${aliasHit.datasetId}\``,
      },
    };
  }

  const word = getWordAtPosition(document, params.position);

  if (!word) {
    return null;
  }

  // Check built-in variables first
  if (word.startsWith("_")) {
    const varKey = word.split(".")[0]; // "_S" from "_S.name"
    const varDesc = DTL_VARIABLES[varKey];

    if (varDesc) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${varKey}**\n\nDTL built-in variable\n\n${varDesc}\n\n[📖 Documentation](https://docs.sesam.io/hub/dtl/variables.html)`,
        },
      };
    }
  }

  // Check DTL functions — only when NOT at a JSON key position.
  // Function names appear as string values inside arrays (["add", ...]),
  // never as object keys, so a key like "default" under "rules" must not
  // be mistaken for the DTL `default` function.
  if (!isAtJsonKeyPosition(text, offset)) {
    const prefix = text.slice(0, offset);

    // System type value hover ("type": "system:*")
    if (isSystemTypeContext(prefix)) {
      const content = buildSystemTypeHover(word);

      if (content) {
        return { contents: { kind: MarkupKind.Markdown, value: content } };
      }
    }

    // Source type value hover (inside source.type)
    if (isSourceTypeContext(prefix)) {
      const content = buildSourceTypeHover(word);

      if (content) {
        return { contents: { kind: MarkupKind.Markdown, value: content } };
      }
    }

    // Transform type value hover (inside transform.type)
    if (isTransformTypeContext(prefix)) {
      const content = buildTransformTypeHover(word);

      if (content) {
        return { contents: { kind: MarkupKind.Markdown, value: content } };
      }
    }

    const fn = getDtlFunction(word);

    if (fn) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: buildFunctionMarkdown(fn),
        },
      };
    }
  }

  // Reserved entity fields
  if (ENTITY_RESERVED_FIELDS.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}**\n\nSesam reserved entity field.\n\n[DTL documentation](https://docs.sesam.io/hub/quick-reference.html)`,
      },
    };
  }

  // Config property key hover
  if (isAtJsonKeyPosition(text, offset)) {
    let wordStart = offset;

    while (wordStart > 0 && isWordChar(text[wordStart - 1])) {
      wordStart--;
    }

    const hoverPrefix = text.slice(0, wordStart);
    const hoverCtx = getPropKeyContext(hoverPrefix);

    if (hoverCtx?.path[hoverCtx.path.length - 1] === "rules") {
      const isDefault = word === "default";

      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: isDefault
            ? `**\`default\`** *(required)*\n\nThe entry-point DTL rule. Every DTL transform must have a \`default\` rule — it is the rule applied to each source entity.`
            : `**\`${word}\`**\n\nDTL rule name\n\nCan be invoked from the \`default\` rule (or other rules) via \`apply\` or \`apply-hops\`.`,
        },
      };
    }

    const detail = buildPropKeyHover(word, hoverCtx?.path ?? []);

    if (detail) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**\`${word}\`**\n\n${detail}`,
        },
      };
    }
  }

  return null;
});

// ---------------------------------------------------------------------------
// Document Symbols (Outline)
// ---------------------------------------------------------------------------
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  const text = document.getText();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  return buildDocumentSymbols(document, text, parsed as Record<string, unknown>);
});

// ---------------------------------------------------------------------------
// Document Formatting
// ---------------------------------------------------------------------------
connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const formatted = formatSesamJson(parsed, params.options.tabSize ?? 2);
  if (formatted === text) {
    return [];
  }

  const endPos = document.positionAt(text.length);
  return [TextEdit.replace(Range.create(Position.create(0, 0), endPos), formatted)];
});

// ---------------------------------------------------------------------------
// Go to Definition
// ---------------------------------------------------------------------------
connection.onDefinition((params: TextDocumentPositionParams): Location | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // 1. Same-file: apply/apply-hops rule reference
  const ref = findApplyRuleReference(text, offset);
  if (ref) {
    const def = findRuleDefinition(text, ref.ruleName, offset);
    if (def) {
      return Location.create(
        params.textDocument.uri,
        Range.create(document.positionAt(def.keyStart), document.positionAt(def.keyEnd)),
      );
    }
  }

  // 2. Cross-file: dataset reference → pipe file
  const dsRef = findDatasetReference(text, offset);
  if (dsRef) {
    const entry = workspaceIndex.pipeIndex.get(dsRef.name);
    if (entry) {
      const targetText = workspaceIndex.fileTexts.get(entry.uri) ?? "";
      return Location.create(
        entry.uri,
        Range.create(
          offsetToPosition(targetText, entry.idOffset),
          offsetToPosition(targetText, entry.idOffset + dsRef.name.length),
        ),
      );
    }
  }

  // 3. Cross-file: system reference → system file
  const sysRef = findSystemReference(text, offset);
  if (sysRef) {
    const entry = workspaceIndex.systemIndex.get(sysRef.name);
    if (entry) {
      const targetText = workspaceIndex.fileTexts.get(entry.uri) ?? "";
      return Location.create(
        entry.uri,
        Range.create(
          offsetToPosition(targetText, entry.idOffset),
          offsetToPosition(targetText, entry.idOffset + sysRef.name.length),
        ),
      );
    }
  }

  return null;
});

// ---------------------------------------------------------------------------
// Find All References
// ---------------------------------------------------------------------------
connection.onReferences((params: ReferenceParams): Location[] | null => {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // DTL add/add-if property references — checked before alias so a property
  // named the same as a dataset alias doesn't get hijacked.
  const propHit = findAddPropertyAtOffset(text, offset);

  if (propHit) {
    const defs = findAllAddPropertyDefinitions(text, propHit.propName);
    return defs.map(({ start, end }) =>
      Location.create(
        params.textDocument.uri,
        Range.create(document.positionAt(start), document.positionAt(end)),
      ),
    );
  }

  // Alias references
  const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

  if (aliasHit) {
    const aliasRanges = collectAliasRanges(text, aliasHit.alias);
    return aliasRanges.map((r) =>
      Location.create(params.textDocument.uri, offsetRangeToLsp(document, r)),
    );
  }

  const keyHit = findRuleKeyAtOffset(text, offset);
  const applyHit = keyHit ? null : findApplyRuleReference(text, offset);
  const ruleName = keyHit?.ruleName ?? applyHit?.ruleName ?? null;

  if (!ruleName) {
    // Cross-file: cursor on pipe/system _id value → find all files referencing it
    const idHit = findIdAtOffset(text, offset);
    if (idHit) {
      const crossRefs = findAllCrossReferences(idHit.name, workspaceIndex.fileTexts);
      const locations: Location[] = crossRefs.map(({ uri, nameStart, nameEnd }) => {
        const refText = workspaceIndex.fileTexts.get(uri) ?? "";
        return Location.create(
          uri,
          Range.create(offsetToPosition(refText, nameStart), offsetToPosition(refText, nameEnd)),
        );
      });

      if (params.context.includeDeclaration) {
        locations.push(
          Location.create(
            document.uri,
            Range.create(
              document.positionAt(idHit.range.start),
              document.positionAt(idHit.range.end),
            ),
          ),
        );
      }

      return locations.length > 0 ? locations : null;
    }
    return null;
  }

  const refs = findAllApplyReferences(text, ruleName);
  const locations: Location[] = refs.map(({ start, end }) =>
    Location.create(
      params.textDocument.uri,
      Range.create(document.positionAt(start), document.positionAt(end)),
    ),
  );

  if (params.context.includeDeclaration) {
    const def = findRuleDefinition(text, ruleName, offset);
    if (def) {
      locations.push(
        Location.create(
          params.textDocument.uri,
          Range.create(document.positionAt(def.keyStart), document.positionAt(def.keyEnd)),
        ),
      );
    }
  }

  return locations.length > 0 ? locations : null;
});

// ---------------------------------------------------------------------------
// Document Links
// ---------------------------------------------------------------------------
connection.onDocumentLinks((params: DocumentLinkParams): DocumentLink[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  return collectDocumentLinks(
    document.getText(),
    workspaceIndex.pipeIndex,
    workspaceIndex.systemIndex,
  );
});

// ---------------------------------------------------------------------------
// Rename (dataset alias and DTL rule name)
// ---------------------------------------------------------------------------
connection.onPrepareRename(
  (params: PrepareRenameParams): { range: Range; placeholder: string } | null => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return null;
    }

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // Try rule key first, then apply-reference, then property name, then alias.
    const ruleKeyHit = findRuleKeyAtOffset(text, offset);

    if (ruleKeyHit) {
      return {
        range: Range.create(
          document.positionAt(ruleKeyHit.keyRange.start),
          document.positionAt(ruleKeyHit.keyRange.end),
        ),
        placeholder: ruleKeyHit.ruleName,
      };
    }

    const applyHit = findApplyRuleReference(text, offset);

    if (applyHit) {
      return {
        range: Range.create(
          document.positionAt(applyHit.nameRange.start),
          document.positionAt(applyHit.nameRange.end),
        ),
        placeholder: applyHit.ruleName,
      };
    }

    // Property name check before alias — avoids false-positive alias match.
    const propHitPR = findAddPropertyAtOffset(text, offset);

    if (propHitPR) {
      return {
        range: Range.create(
          document.positionAt(propHitPR.nameStart),
          document.positionAt(propHitPR.nameEnd),
        ),
        placeholder: propHitPR.propName,
      };
    }

    const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

    if (!aliasHit) {
      // Fall through to _id check as last resort.
      const idHit = findIdAtOffset(text, offset);

      if (!idHit) {
        return null;
      }

      return {
        range: Range.create(
          document.positionAt(idHit.range.start),
          document.positionAt(idHit.range.end),
        ),
        placeholder: idHit.name,
      };
    }

    return {
      range: Range.create(
        document.positionAt(aliasHit.aliasStart),
        document.positionAt(aliasHit.aliasEnd),
      ),
      placeholder: aliasHit.alias,
    };
  },
);

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Rule rename: find the rule name (from key or apply-ref), then rename all occurrences.
  const ruleKeyHit = findRuleKeyAtOffset(text, offset);
  const applyHit = !ruleKeyHit ? findApplyRuleReference(text, offset) : null;
  const ruleName = ruleKeyHit?.ruleName ?? applyHit?.ruleName ?? null;

  if (ruleName !== null) {
    const ruleDef = findRuleDefinition(text, ruleName, offset);
    const applyRefs = findAllApplyReferences(text, ruleName);

    const allRanges: Array<{ start: number; end: number }> = [];

    if (ruleDef) {
      allRanges.push({ start: ruleDef.keyStart, end: ruleDef.keyEnd });
    }

    allRanges.push(...applyRefs);

    const edits = allRanges.map((r) =>
      TextEdit.replace(
        Range.create(document.positionAt(r.start), document.positionAt(r.end)),
        params.newName,
      ),
    );

    return { changes: { [params.textDocument.uri]: edits } };
  }

  // Add/add-if property rename — checked before alias.
  const propHitRen = findAddPropertyAtOffset(text, offset);

  if (propHitRen !== null) {
    const propDefs = findAllAddPropertyDefinitions(text, propHitRen.propName);
    const edits = propDefs.map(({ start, end }) =>
      TextEdit.replace(
        Range.create(document.positionAt(start), document.positionAt(end)),
        params.newName,
      ),
    );

    return { changes: { [params.textDocument.uri]: edits } };
  }

  const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

  if (!aliasHit) {
    // _id rename — updates the value and renames the file.
    const idHit = findIdAtOffset(text, offset);

    if (!idHit) {
      return null;
    }

    const oldUri = params.textDocument.uri;
    const lastSlash = oldUri.lastIndexOf("/");
    const ext = oldUri.endsWith(".conf.pipe")
      ? ".conf.pipe"
      : oldUri.endsWith(".conf.system")
        ? ".conf.system"
        : ".conf.json";
    const newUri = oldUri.slice(0, lastSlash + 1) + params.newName + ext;

    const textEdit = TextEdit.replace(
      Range.create(document.positionAt(idHit.range.start), document.positionAt(idHit.range.end)),
      params.newName,
    );

    return {
      documentChanges: [
        TextDocumentEdit.create({ uri: oldUri, version: document.version }, [textEdit]),
        RenameFile.create(oldUri, newUri),
      ],
    };
  }

  const aliasRanges = collectAliasRanges(text, aliasHit.alias);
  const edits = aliasRanges.map((r) =>
    TextEdit.replace(offsetRangeToLsp(document, r), params.newName),
  );

  return { changes: { [params.textDocument.uri]: edits } };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Custom request: sesam/lintContent
// ---------------------------------------------------------------------------

async function lintText(text: string, uri: string): Promise<LintDiagnostic[]> {
  const settings = await getDocumentSettings(uri);
  const parseResult = parseDtlText(text, "json");
  const diagnostics: Diagnostic[] = [];

  const validatorOptions: ValidatorOptions = {
    maxProblems: settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems,
    validateUnknownFunctions: settings.validate?.unknownFunctions ?? true,
    validateArgCount: settings.validate?.argCount ?? true,
    validateJsonSyntax: settings.validate?.jsonSyntax ?? true,
    validateDtlStructure: settings.validate?.dtlStructure ?? true,
    validateTransformInExpression: settings.validate?.transformInExpression ?? true,
    validatePathExpressions: settings.validate?.pathExpressions ?? false,
    validateConfigStructure: settings.validate?.configStructure ?? true,
    ruleNames: parseResult.ruleNames,
  };

  if (parseResult.parseError !== null && validatorOptions.validateJsonSyntax) {
    const offset = parseResult.parseError.offset;
    const pos = offset >= 0 ? offsetToPosition(text, offset) : { line: 0, character: 0 };
    diagnostics.push({
      range: Range.create(
        pos.line,
        pos.character,
        pos.line,
        Math.max(pos.character + 1, pos.character),
      ),
      severity: DiagnosticSeverity.Error,
      message: `Invalid JSON: ${parseResult.parseError.message}`,
      source: "dtl",
      code: "invalid-json",
    });
  } else {
    diagnostics.push(
      ...validateStructure(parseResult.calls, parseResult.structuralErrors, validatorOptions),
    );
    diagnostics.push(...validateCalls(parseResult.calls, validatorOptions));
    diagnostics.push(...validatePathStrings(parseResult.calls, validatorOptions));
    diagnostics.push(...validateConfigStructure(text, validatorOptions));
  }

  return diagnostics.map((d) => ({
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character },
    },
    severity: (d.severity ?? DiagnosticSeverity.Information) as LintSeverity,
    message: d.message,
    code: typeof d.code === "string" ? d.code : d.code !== undefined ? String(d.code) : undefined,
    source: d.source,
  }));
}

connection.onRequest(
  "sesam/lintContent",
  async (params: LintContentRequest): Promise<LintContentResponse> => {
    try {
      let text: string;
      let fileLabel: string;

      if (params.content !== undefined) {
        text = params.content;
        fileLabel = "inline content";
      } else if (params.uri) {
        const openDoc = documents.get(params.uri);

        if (openDoc) {
          text = openDoc.getText();
        } else {
          text = fs.readFileSync(fileURLToPath(params.uri), "utf-8");
        }

        fileLabel = params.uri.split("/").pop() ?? params.uri;
      } else {
        return {
          diagnostics: [],
          fileLabel: "unknown",
          error: "Either 'uri' or 'content' must be provided.",
        };
      }

      const diagnostics = await lintText(text, params.uri ?? "untitled:lint");

      return { diagnostics, fileLabel };
    } catch (e) {
      return { diagnostics: [], fileLabel: "unknown", error: String(e) };
    }
  },
);

// ---------------------------------------------------------------------------
// Custom request: sesam/lintWorkspace
// ---------------------------------------------------------------------------

connection.onRequest(
  "sesam/lintWorkspace",
  async (params: LintWorkspaceRequest): Promise<LintWorkspaceResponse> => {
    try {
      const maxProblems = params.maxProblems ?? 100;
      const minSeverity: LintSeverity = params.minSeverity ?? 4;
      const results: LintWorkspaceResponse["results"] = [];
      let totalCollected = 0;

      for (const uri of workspaceIndex.allFileUris()) {
        if (totalCollected >= maxProblems) {
          break;
        }

        try {
          const text = workspaceIndex.fileTexts.get(uri);

          if (text === undefined) {
            continue;
          }

          const allDiags = await lintText(text, uri);
          const filtered = allDiags.filter((d) => d.severity <= minSeverity);

          if (filtered.length > 0) {
            results.push({
              uri,
              fileLabel: uri.split("/").pop() ?? uri,
              diagnostics: filtered.slice(0, maxProblems - totalCollected),
            });
            totalCollected += filtered.length;
          }
        } catch {
          // Skip unreadable files silently
        }
      }

      return { results };
    } catch (e) {
      return { results: [], error: String(e) };
    }
  },
);

documents.listen(connection);
connection.listen();
