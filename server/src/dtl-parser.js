"use strict";
/**
 * DTL Parser
 * Parses DTL arrays from document text and returns a position-aware node structure.
 * Handles both bare .dtl files (a JSON array of transform arrays) and
 * Sesam pipe/system .json configs (looks for transform.rules arrays).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDtlText = parseDtlText;
/** Converts a linear offset in text into {line, character}. */
function offsetToPosition(text, offset) {
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
    return { offset, line, character };
}
/**
 * Very lightweight structural parser that finds DTL array invocations.
 * We use a token-scanning approach rather than full JSON.parse so we can
 * retain character positions that JSON.parse drops.
 */
function parseDtlText(text, fileExtension) {
    const calls = [];
    const errors = [];
    let parsedJson;
    try {
        parsedJson = JSON.parse(text);
    }
    catch (e) {
        // Document not valid JSON yet — skip validation
        return { calls, errors };
    }
    // We still need positions, so we do a second pass using the raw text.
    // Strategy: walk the raw text with a simple scanner to locate array starts
    // after we know the structure from JSON.parse.
    const walker = new DtlWalker(text);
    if (fileExtension === "dtl") {
        // The file should be a JSON array (the rules list).
        if (Array.isArray(parsedJson)) {
            walker.walkRulesList(parsedJson, true, calls, errors);
        }
        else if (typeof parsedJson === "object" &&
            parsedJson !== null &&
            "transform" in parsedJson) {
            // Full pipe config stored as .dtl — support both shapes
            const transform = parsedJson["transform"];
            extractTransformCalls(transform, walker, calls, errors);
        }
    }
    else {
        // JSON file: look for transform rules
        if (typeof parsedJson === "object" && parsedJson !== null) {
            const obj = parsedJson;
            extractTransformCalls(obj["transform"], walker, calls, errors);
        }
        else if (Array.isArray(parsedJson)) {
            // Array of pipe configs
            for (const item of parsedJson) {
                if (typeof item === "object" && item !== null) {
                    extractTransformCalls(item["transform"], walker, calls, errors);
                }
            }
        }
    }
    return { calls, errors };
}
function extractTransformCalls(transform, walker, calls, errors) {
    if (!transform || typeof transform !== "object")
        return;
    const t = transform;
    // Standard DTL transform: { "type": "dtl", "rules": { "default": [...] } }
    if (t["rules"] && typeof t["rules"] === "object") {
        const rules = t["rules"];
        for (const ruleName of Object.keys(rules)) {
            if (Array.isArray(rules[ruleName])) {
                walker.walkRulesList(rules[ruleName], true, calls, errors);
            }
        }
    }
    // Shorthand inline rules array
    if (Array.isArray(transform)) {
        walker.walkRulesList(transform, true, calls, errors);
    }
}
/**
 * Walks the raw text to assign source positions to DTL calls found by JSON.parse.
 * This is a best-effort position finder: it scans for opening '[' characters and
 * tries to correlate them with the parsed structure. Accurate enough for diagnostics.
 */
class DtlWalker {
    constructor(text) {
        this.scanPos = 0;
        this.text = text;
    }
    walkRulesList(rules, isTopLevel, calls, errors) {
        for (const rule of rules) {
            if (!Array.isArray(rule))
                continue;
            this.walkDtlArray(rule, isTopLevel, calls, errors);
        }
    }
    walkDtlArray(arr, isTopLevel, calls, errors) {
        if (arr.length === 0)
            return;
        const firstName = typeof arr[0] === "string" ? arr[0] : null;
        const argCount = arr.length - 1;
        // Find the position of this array in the raw text
        const arrayStart = this.findNextArrayStart();
        if (arrayStart === -1)
            return;
        const arrayEnd = this.findMatchingClose(arrayStart);
        const startPos = offsetToPosition(this.text, arrayStart);
        const endPos = offsetToPosition(this.text, arrayEnd + 1);
        let nameRange = null;
        if (firstName !== null) {
            // Find the string inside the array
            const nameStart = this.findStringInside(arrayStart, firstName);
            if (nameStart !== -1) {
                nameRange = {
                    start: offsetToPosition(this.text, nameStart),
                    end: offsetToPosition(this.text, nameStart + firstName.length + 2), // +2 for quotes
                };
            }
        }
        calls.push({
            functionName: firstName,
            range: {
                start: startPos,
                end: endPos,
            },
            nameRange,
            argCount,
            isTopLevel,
        });
        // Advance scan position past the opening bracket so nested calls are found later
        this.scanPos = arrayStart + 1;
        // Recurse into any nested arrays (arguments that are themselves DTL calls)
        for (let i = 1; i < arr.length; i++) {
            if (Array.isArray(arr[i])) {
                this.walkDtlArray(arr[i], false, calls, errors);
            }
        }
        // After processing all children, advance past the closing bracket
        this.scanPos = arrayEnd + 1;
    }
    findNextArrayStart() {
        for (let i = this.scanPos; i < this.text.length; i++) {
            if (this.text[i] === "[")
                return i;
        }
        return -1;
    }
    findMatchingClose(openPos) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = openPos; i < this.text.length; i++) {
            const ch = this.text[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === "\\" && inString) {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (inString)
                continue;
            if (ch === "[" || ch === "{")
                depth++;
            if (ch === "]" || ch === "}") {
                depth--;
                if (depth === 0)
                    return i;
            }
        }
        return this.text.length - 1;
    }
    findStringInside(arrayStart, str) {
        const target = `"${str}"`;
        const searchFrom = arrayStart + 1;
        const idx = this.text.indexOf(target, searchFrom);
        // Make sure it's close enough to the array start (within a few tokens)
        if (idx !== -1 && idx < arrayStart + target.length + 5)
            return idx;
        return idx;
    }
}
//# sourceMappingURL=dtl-parser.js.map