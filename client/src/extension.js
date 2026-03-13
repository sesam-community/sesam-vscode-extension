"use strict";
/**
 * DTL Extension — Client Entry Point
 * Activates the Language Server and registers client-side providers:
 *   - LanguageClient (LSP bridge)
 *   - Graph navigation tree view
 *   - Pipe preview webview command
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
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const node_1 = require("vscode-languageclient/node");
const PipeGraphProvider_1 = require("./graph/PipeGraphProvider");
const PreviewPanel_1 = require("./preview/PreviewPanel");
let client;
async function activate(context) {
    // ── Language Server ───────────────────────────────────────────────────────
    const serverModule = context.asAbsolutePath(path.join("dist", "server", "server.js"));
    const serverOptions = {
        run: {
            module: serverModule,
            transport: node_1.TransportKind.ipc,
        },
        debug: {
            module: serverModule,
            transport: node_1.TransportKind.ipc,
            options: {
                execArgv: ["--nolazy", "--inspect=6009"],
            },
        },
    };
    const clientOptions = {
        documentSelector: [
            { scheme: "file", language: "dtl" },
            { scheme: "file", language: "json", pattern: "**/*.dtl" },
            {
                scheme: "file",
                language: "json",
                pattern: "**/{pipes,systems}/**/*.json",
            },
        ],
        synchronize: {
            fileEvents: [
                vscode.workspace.createFileSystemWatcher("**/*.dtl"),
                vscode.workspace.createFileSystemWatcher("**/{pipes,systems}/**/*.json"),
            ],
        },
        traceOutputChannel: vscode.window.createOutputChannel("DTL Language Server (Trace)"),
    };
    client = new node_1.LanguageClient("dtlLanguageServer", "DTL Language Server", serverOptions, clientOptions);
    await client.start();
    // ── Graph Navigation Tree View ────────────────────────────────────────────
    const graphProvider = new PipeGraphProvider_1.PipeGraphProvider();
    const treeView = vscode.window.createTreeView("dtlGraphExplorer", {
        treeDataProvider: graphProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);
    // Watch for file changes to update the graph
    const watcher = vscode.workspace.createFileSystemWatcher("**/{pipes,systems}/**/*.json");
    watcher.onDidCreate(() => graphProvider.refresh());
    watcher.onDidChange(() => graphProvider.refresh());
    watcher.onDidDelete(() => graphProvider.refresh());
    context.subscriptions.push(watcher);
    // ── Commands ──────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("dtl.refreshGraph", () => {
        graphProvider.refresh();
        vscode.window.setStatusBarMessage("DTL: Graph refreshed", 2000);
    }), vscode.commands.registerCommand("dtl.previewPipe", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("DTL Preview: No active editor.");
            return;
        }
        PreviewPanel_1.PreviewPanel.createOrShow(context.extensionUri, editor.document);
    }), vscode.commands.registerCommand("dtl.openDocs", () => {
        vscode.env.openExternal(vscode.Uri.parse("https://docs.sesam.io/hub/data-transformation-language.html"));
    }));
    // Keep the PreviewPanel updated when the active document changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && PreviewPanel_1.PreviewPanel.currentPanel) {
            PreviewPanel_1.PreviewPanel.currentPanel.updateDocument(editor.document);
        }
    }), vscode.workspace.onDidChangeTextDocument((event) => {
        if (PreviewPanel_1.PreviewPanel.currentPanel) {
            PreviewPanel_1.PreviewPanel.currentPanel.updateDocument(event.document);
        }
    }));
}
function deactivate() {
    return client?.stop();
}
//# sourceMappingURL=extension.js.map