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
      {
        scheme: "file",
        language: "json",
        pattern: "**/*.conf.json",
      },
    ],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher(
          "**/{pipes,systems}/**/*.json",
        ),
        vscode.workspace.createFileSystemWatcher("**/*.conf.json"),
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

  const confWatcher =
    vscode.workspace.createFileSystemWatcher("**/*.conf.json");
  confWatcher.onDidCreate(() => graphProvider.refresh());
  confWatcher.onDidChange(() => graphProvider.refresh());
  confWatcher.onDidDelete(() => graphProvider.refresh());
  context.subscriptions.push(confWatcher);

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

    vscode.commands.registerCommand(
      "dtl.newConfFile",
      async (contextUri?: vscode.Uri) => {
        // ── Step 1: choose template ──────────────────────────────────────
        const TEMPLATES = [
          {
            label: "$(symbol-namespace) Simple pipe",
            description: '{ "_id", "type": "pipe" }',
            id: "simple-pipe",
          },
          {
            label: "$(symbol-namespace) Pipe with DTL transform",
            description: "Pipe + DTL rules block",
            id: "dtl-pipe",
          },
          {
            label: "$(gear) System",
            description: "system:<type>",
            id: "system",
          },
        ];

        const template = await vscode.window.showQuickPick(TEMPLATES, {
          placeHolder: "Select config template",
          title: "New Sesam Config File",
        });
        if (!template) return;

        // ── Step 2: choose system type if needed ─────────────────────────
        const SYSTEM_TYPES = [
          "system:elasticsearch",
          "system:kafka",
          "system:ldap",
          "system:microservice",
          "system:mssql",
          "system:mysql",
          "system:oracle",
          "system:postgresql",
          "system:rest",
          "system:smtp",
          "system:solr",
          "system:twilio",
          "system:url",
        ];

        let systemType = "";
        if (template.id === "system") {
          const picked = await vscode.window.showQuickPick(SYSTEM_TYPES, {
            placeHolder: "Select system type",
            title: "New Sesam Config File — System type",
          });
          if (!picked) return;
          systemType = picked;
        }

        // ── Step 3: ask for _id ──────────────────────────────────────────
        const configId = await vscode.window.showInputBox({
          prompt: "Enter the config _id (used as filename: <id>.conf.json)",
          placeHolder:
            template.id === "system" ? "my-rest-system" : "my-pipe-id",
          validateInput: (v) => {
            if (!v.trim()) return "_id cannot be empty";
            if (v.includes("/")) return 'Cannot contain "/"';
            return null;
          },
        });
        if (!configId) return;

        // ── Step 4: build content ────────────────────────────────────────
        let content: object;
        if (template.id === "simple-pipe") {
          content = { _id: configId, type: "pipe" };
        } else if (template.id === "dtl-pipe") {
          content = {
            _id: configId,
            type: "pipe",
            transform: {
              type: "dtl",
              rules: {
                default: [["copy", "_id"]],
              },
            },
          };
        } else {
          content = { _id: configId, type: systemType };
        }

        // ── Step 5: resolve target folder ────────────────────────────────
        let folder: vscode.Uri;
        if (contextUri) {
          const stat = await vscode.workspace.fs.stat(contextUri);
          folder =
            stat.type === vscode.FileType.Directory
              ? contextUri
              : vscode.Uri.file(path.dirname(contextUri.fsPath));
        } else if (vscode.window.activeTextEditor) {
          folder = vscode.Uri.file(
            path.dirname(vscode.window.activeTextEditor.document.uri.fsPath),
          );
        } else {
          folder =
            vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(".");
        }

        // ── Step 6: write and open ────────────────────────────────────────
        const fileUri = vscode.Uri.joinPath(folder, `${configId}.conf.json`);
        const text = JSON.stringify(content, null, 2) + "\n";
        await vscode.workspace.fs.writeFile(
          fileUri,
          Buffer.from(text, "utf-8"),
        );
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      },
    ),
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
