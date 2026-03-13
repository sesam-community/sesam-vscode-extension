"use strict";
/**
 * Pipe Graph Provider
 * Implements a VS Code TreeDataProvider that scans the workspace for Sesam pipe
 * and system config files and shows their DTL hop relationships in the sidebar.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipeGraphProvider = exports.PipeTreeItem = void 0;
const vscode = __importStar(require("vscode"));
class PipeTreeItem extends vscode.TreeItem {
    constructor(label, kind, fileUri, collapsible = vscode
        .TreeItemCollapsibleState.None) {
        super(label, collapsible);
        this.label = label;
        this.kind = kind;
        this.fileUri = fileUri;
        this.collapsible = collapsible;
        this.contextValue = kind;
        this.iconPath = this.pickIcon(kind);
        if (fileUri && (kind === "pipe" || kind === "system")) {
            this.tooltip = fileUri.fsPath;
            this.command = {
                command: "vscode.open",
                title: "Open",
                arguments: [fileUri],
            };
            this.resourceUri = fileUri;
        }
    }
    pickIcon(kind) {
        switch (kind) {
            case "pipe":
                return new vscode.ThemeIcon("git-merge");
            case "system":
                return new vscode.ThemeIcon("server");
            case "dataset-ref":
                return new vscode.ThemeIcon("database");
            case "rule":
                return new vscode.ThemeIcon("symbol-method");
            default:
                return new vscode.ThemeIcon("file");
        }
    }
}
exports.PipeTreeItem = PipeTreeItem;
// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
class PipeGraphProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.pipes = [];
        this.datasetIndex = new Map();
        this.initialized = false;
    }
    refresh() {
        this.initialized = false;
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!this.initialized) {
            await this.scanWorkspace();
            this.initialized = true;
        }
        if (!element) {
            // Root: list all pipes and systems
            return this.pipes.map((p) => new PipeTreeItem(p.id, p.kind, p.fileUri, p.hopDatasets.length > 0 || p.ruleNames.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None));
        }
        // Children of a pipe: hop targets + defined rules
        const pipe = this.pipes.find((p) => p.id === element.label);
        if (!pipe)
            return [];
        const children = [];
        // Dataset references from hops
        for (const ds of pipe.hopDatasets) {
            const resolvedUri = this.datasetIndex.get(ds);
            const item = new PipeTreeItem(ds, "dataset-ref", resolvedUri, vscode.TreeItemCollapsibleState.None);
            item.description = resolvedUri ? "✓ resolved" : "⚠ unresolved";
            item.tooltip = resolvedUri
                ? `Dataset found: ${resolvedUri.fsPath}`
                : `No file found defining dataset "${ds}"`;
            if (resolvedUri) {
                item.command = {
                    command: "vscode.open",
                    title: "Open dataset",
                    arguments: [resolvedUri],
                };
            }
            children.push(item);
        }
        // Named rules
        for (const rule of pipe.ruleNames) {
            const item = new PipeTreeItem(rule, "rule");
            item.tooltip = `DTL rule: ${rule}`;
            children.push(item);
        }
        return children;
    }
    // ── Workspace Scanning ──────────────────────────────────────────────────
    async scanWorkspace() {
        this.pipes = [];
        this.datasetIndex = new Map();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders)
            return;
        const config = vscode.workspace.getConfiguration("dtl");
        const scanDepth = config.get("graph.scanDepth", 3);
        // Find all JSON files
        const globDepth = Array.from({ length: scanDepth }, (_, i) => "*").join("/");
        const files = await vscode.workspace.findFiles(`**/*.json`, `**/node_modules/**`);
        // Also find .dtl files
        const dtlFiles = await vscode.workspace.findFiles("**/*.dtl", "**/node_modules/**");
        const allFiles = [...files, ...dtlFiles];
        for (const fileUri of allFiles) {
            try {
                const contents = await vscode.workspace.fs.readFile(fileUri);
                const text = Buffer.from(contents).toString("utf-8");
                const parsed = JSON.parse(text);
                const info = extractPipeInfo(parsed, fileUri);
                if (info) {
                    this.pipes.push(info);
                    // Index this pipe's _id for resolution by other pipes' hops
                    this.datasetIndex.set(info.id, fileUri);
                }
            }
            catch {
                // Not valid JSON or not a pipe config — skip
            }
        }
        // Sort pipes alphabetically
        this.pipes.sort((a, b) => a.id.localeCompare(b.id));
    }
}
exports.PipeGraphProvider = PipeGraphProvider;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractPipeInfo(parsed, fileUri) {
    if (typeof parsed !== "object" || parsed === null)
        return null;
    const obj = parsed;
    const id = typeof obj["_id"] === "string" ? obj["_id"] : null;
    if (!id)
        return null;
    const type = typeof obj["type"] === "string" ? obj["type"] : "pipe";
    const kind = type === "system" ? "system" : "pipe";
    const hopDatasets = new Set();
    const ruleNames = [];
    // Extract named rules from transform.rules
    const transform = obj["transform"];
    if (transform && typeof transform === "object") {
        const rules = transform["rules"];
        if (rules && typeof rules === "object") {
            ruleNames.push(...Object.keys(rules));
            // Walk rules looking for hops
            for (const ruleName of Object.keys(rules)) {
                const ruleArr = rules[ruleName];
                if (Array.isArray(ruleArr)) {
                    collectHopDatasets(ruleArr, hopDatasets);
                }
            }
        }
    }
    return {
        id,
        fileUri,
        kind,
        hopDatasets: [...hopDatasets],
        ruleNames,
    };
}
/** Recursively walk a DTL rules array and collect dataset names mentioned in hops. */
function collectHopDatasets(arr, out) {
    for (const item of arr) {
        if (!Array.isArray(item))
            continue;
        const head = item[0];
        if (head === "hops" || head === "apply-hops") {
            // hops spec is the second element (index 1 for hops, index 2 for apply-hops)
            const specIdx = head === "hops" ? 1 : 2;
            const spec = item[specIdx];
            if (spec && typeof spec === "object" && !Array.isArray(spec)) {
                const datasets = spec["datasets"];
                if (Array.isArray(datasets)) {
                    for (const ds of datasets) {
                        if (typeof ds === "string") {
                            // Dataset entry can be "datasetName ALIAS" — extract the name part
                            const parts = ds.trim().split(/\s+/);
                            if (parts.length > 0)
                                out.add(parts[0]);
                        }
                    }
                }
            }
        }
        // Recurse into nested arrays
        for (const child of item) {
            if (Array.isArray(child)) {
                collectHopDatasets(child, out);
            }
        }
    }
}
//# sourceMappingURL=PipeGraphProvider.js.map