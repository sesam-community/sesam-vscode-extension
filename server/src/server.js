"use strict";
/**
 * DTL Language Server
 * Implements LSP features: completions, hover, diagnostics, and document formatting.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const dtl_registry_1 = require("../../src/shared/dtl-registry");
const dtl_parser_1 = require("./dtl-parser");
const dtl_validator_1 = require("./dtl-validator");
// ---------------------------------------------------------------------------
// Connection & document store
// ---------------------------------------------------------------------------
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
connection.onInitialize((_params) => {
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            completionProvider: {
                triggerCharacters: ['"', "[", "_", "."],
                resolveProvider: false,
            },
            hoverProvider: true,
            documentFormattingProvider: true,
        },
    };
});
const defaultSettings = {
    maxNumberOfProblems: 100,
    validate: { enabled: true, unknownFunctions: true, argCount: true },
};
const documentSettings = new Map();
connection.onDidChangeConfiguration(() => {
    documentSettings.clear();
    documents.all().forEach(validateDocument);
});
async function getDocumentSettings(resource) {
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace
            .getConfiguration({ scopeUri: resource, section: "dtl" })
            .then((s) => s ?? defaultSettings);
        documentSettings.set(resource, result);
    }
    return result;
}
// ---------------------------------------------------------------------------
// Validation / Diagnostics
// ---------------------------------------------------------------------------
async function validateDocument(document) {
    const settings = await getDocumentSettings(document.uri);
    if (!settings.validate?.enabled) {
        connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
        return;
    }
    const ext = document.uri.endsWith(".dtl") ? "dtl" : "json";
    const parseResult = (0, dtl_parser_1.parseDtlText)(document.getText(), ext);
    const validatorOptions = {
        maxProblems: settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems,
        validateUnknownFunctions: settings.validate?.unknownFunctions ?? true,
        validateArgCount: settings.validate?.argCount ?? true,
    };
    const diagnostics = (0, dtl_validator_1.validateCalls)(parseResult.calls, validatorOptions);
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
connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return [];
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
});
function isVariableContext(prefix) {
    // Cursor is inside a string that starts with _
    return /"\s*_[STPRB]?\.?[^"]*$/.test(prefix);
}
function isFunctionNameContext(prefix) {
    // After [ optionally followed by whitespace and an opening quote
    return /\[\s*"[^"]*$/.test(prefix) || /\[\s*$/.test(prefix);
}
function buildFunctionCompletions() {
    return (0, dtl_registry_1.getAllFunctions)().map((fn) => ({
        label: fn.name,
        kind: fn.kind === "transform"
            ? node_1.CompletionItemKind.Method
            : node_1.CompletionItemKind.Function,
        detail: fn.signature,
        documentation: {
            kind: node_1.MarkupKind.Markdown,
            value: buildFunctionMarkdown(fn),
        },
        sortText: fn.kind === "transform" ? `0_${fn.name}` : `1_${fn.name}`,
        insertText: fn.name,
    }));
}
function buildVariableCompletions() {
    const items = Object.entries(dtl_registry_1.DTL_VARIABLES).map(([name, desc]) => ({
        label: name,
        kind: node_1.CompletionItemKind.Variable,
        detail: "DTL built-in variable",
        documentation: {
            kind: node_1.MarkupKind.Markdown,
            value: desc,
        },
        insertText: name,
        sortText: `0_${name}`,
    }));
    // Also suggest reserved entity fields
    dtl_registry_1.ENTITY_RESERVED_FIELDS.forEach((field) => {
        items.push({
            label: field,
            kind: node_1.CompletionItemKind.Field,
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
connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return null;
    const word = getWordAtPosition(document, params.position);
    if (!word)
        return null;
    // Check built-in variables first
    if (word.startsWith("_")) {
        const varKey = word.split(".")[0]; // "_S" from "_S.name"
        const varDesc = dtl_registry_1.DTL_VARIABLES[varKey];
        if (varDesc) {
            return {
                contents: {
                    kind: node_1.MarkupKind.Markdown,
                    value: `**${varKey}** — DTL built-in variable\n\n${varDesc}`,
                },
            };
        }
    }
    // Check DTL functions
    const fn = (0, dtl_registry_1.getDtlFunction)(word);
    if (fn) {
        return {
            contents: {
                kind: node_1.MarkupKind.Markdown,
                value: buildFunctionMarkdown(fn),
            },
        };
    }
    // Reserved entity fields
    if (dtl_registry_1.ENTITY_RESERVED_FIELDS.includes(word)) {
        return {
            contents: {
                kind: node_1.MarkupKind.Markdown,
                value: `**${word}** — Sesam reserved entity field.\n\n[DTL documentation](https://docs.sesam.io/hub/quick-reference.html)`,
            },
        };
    }
    return null;
});
function getWordAtPosition(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    // Walk left to find word start
    let start = offset;
    while (start > 0 && isWordChar(text[start - 1]))
        start--;
    // Walk right to find word end
    let end = offset;
    while (end < text.length && isWordChar(text[end]))
        end++;
    if (start === end)
        return null;
    return text.slice(start, end);
}
function isWordChar(ch) {
    return /[a-zA-Z0-9_$\-!.]/.test(ch);
}
function buildFunctionMarkdown(fn) {
    const kindLabel = fn.kind === "transform" ? "🔧 Transform" : "📦 Expression";
    const params = fn.params
        .map((p) => `- \`${p.name}\`${p.optional ? " *(optional)*" : ""} — ${p.description}`)
        .join("\n");
    const argInfo = fn.maxArgs === null
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
connection.onDocumentFormatting((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return [];
    const text = document.getText();
    const isDtl = document.uri.endsWith(".dtl");
    try {
        const parsed = JSON.parse(text);
        if (isDtl) {
            // Reformat the entire file as a prettily indented JSON array
            const formatted = JSON.stringify(parsed, null, params.options.tabSize ?? 2);
            if (formatted === text)
                return [];
            return [
                node_1.TextEdit.replace(node_1.Range.create(node_1.Position.create(0, 0), document.positionAt(text.length)), formatted + "\n"),
            ];
        }
        else {
            // JSON pipe config: format only transform.rules sub-arrays
            return formatJsonPipeConfig(parsed, text, params.options.tabSize ?? 2);
        }
    }
    catch {
        // Not valid JSON — skip formatting
        return [];
    }
});
function formatJsonPipeConfig(parsed, originalText, tabSize) {
    if (typeof parsed !== "object" || parsed === null)
        return [];
    const obj = parsed;
    const transform = obj["transform"];
    if (!transform || typeof transform !== "object")
        return [];
    const t = transform;
    const rules = t["rules"];
    if (!rules || typeof rules !== "object")
        return [];
    // Replace only the "rules" value in the JSON text
    const rulesSerialized = JSON.stringify(rules, null, tabSize);
    const rulesRawMatch = /"rules"\s*:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/m.exec(originalText);
    if (!rulesRawMatch)
        return [];
    const matchStart = rulesRawMatch.index + rulesRawMatch[0].indexOf(rulesRawMatch[1]);
    const matchEnd = matchStart + rulesRawMatch[1].length;
    // Re-indent with the tab size
    const indented = rulesSerialized.split("\n").join("\n" + " ".repeat(tabSize));
    if (indented === rulesRawMatch[1])
        return [];
    const startPos = offsetToLspPosition(originalText, matchStart);
    const endPos = offsetToLspPosition(originalText, matchEnd);
    return [node_1.TextEdit.replace(node_1.Range.create(startPos, endPos), indented)];
}
function offsetToLspPosition(text, offset) {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") {
            line++;
            character = 0;
        }
        else {
            character++;
        }
    }
    return node_1.Position.create(line, character);
}
// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map