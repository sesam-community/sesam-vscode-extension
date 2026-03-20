/**
 * DTL Extension — Client Entry Point
 * Activates the Language Server and registers client-side providers:
 *   - LanguageClient (LSP bridge)
 *   - Graph navigation tree view
 *   - Pipe preview webview command
 */

import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { PipeGraphProvider } from "./graph/PipeGraphProvider";
import { PreviewPanel } from "./preview/PreviewPanel";

let client: LanguageClient;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // ── Language Server ───────────────────────────────────────────────────────
  const serverModule = context.asAbsolutePath(
    path.join("dist", "server", "server.js"),
  );

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ["--nolazy", "--inspect=6009"],
      },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      {
        scheme: "file",
        language: "json",
        pattern: "**/{pipes,systems}/**/*.json",
      },
    ],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher(
          "**/{pipes,systems}/**/*.json",
        ),
      ],
    },
    traceOutputChannel: vscode.window.createOutputChannel(
      "DTL Language Server (Trace)",
    ),
  };

  client = new LanguageClient(
    "dtlLanguageServer",
    "DTL Language Server",
    serverOptions,
    clientOptions,
  );

  await client.start();

  // ── Graph Navigation Tree View ────────────────────────────────────────────
  const graphProvider = new PipeGraphProvider();

  const treeView = vscode.window.createTreeView("dtlGraphExplorer", {
    treeDataProvider: graphProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView);

  // Watch for file changes to update the graph
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{pipes,systems}/**/*.json",
  );
  watcher.onDidCreate(() => graphProvider.refresh());
  watcher.onDidChange(() => graphProvider.refresh());
  watcher.onDidDelete(() => graphProvider.refresh());
  context.subscriptions.push(watcher);

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("dtl.refreshGraph", () => {
      graphProvider.refresh();
      vscode.window.setStatusBarMessage("DTL: Graph refreshed", 2000);
    }),

    vscode.commands.registerCommand("dtl.previewPipe", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("DTL Preview: No active editor.");
        return;
      }
      PreviewPanel.createOrShow(context.extensionUri, editor.document);
    }),

    vscode.commands.registerCommand("dtl.openDocs", () => {
      vscode.env.openExternal(
        vscode.Uri.parse(
          "https://docs.sesam.io/hub/data-transformation-language.html",
        ),
      );
    }),
  );

  // Keep the PreviewPanel updated when the active document changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && PreviewPanel.currentPanel) {
        PreviewPanel.currentPanel.updateDocument(editor.document);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (PreviewPanel.currentPanel) {
        PreviewPanel.currentPanel.updateDocument(event.document);
      }
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
