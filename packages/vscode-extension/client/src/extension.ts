/**
 * DTL Extension — Client Entry Point
 * Activates the Language Server and registers client-side providers:
 *   - LanguageClient (LSP bridge)
 *   - Graph navigation tree view
 *   - Pipe preview webview command
 */

import * as path from "node:path";

import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import { formatSesamJson } from "../../src/shared/config-formatter";
import { buildDagIndex, buildSystemIndex, extractFullPipeInfo } from "./graph/pipe-dag-builder";
import { PipeDependentsProvider } from "./graph/PipeDependentsProvider";
import { PipeLineageProvider } from "./graph/PipeLineageProvider";
import { SystemPipesProvider } from "./graph/SystemPipesProvider";
import { PreviewPanel } from "./preview/PreviewPanel";
import { SesamErrorsProvider } from "./SesamErrorsProvider";
import { registerSesamLmTools } from "./lm-tools";

import type { DagIndex, FullPipeInfo, SystemEntry } from "./graph/pipe-dag-builder";

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // ── Language Server ───────────────────────────────────────────────────────
  const serverModule = context.asAbsolutePath(path.join("dist", "server", "server.js"));

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

  // Diagnostics store: populated by LSP middleware so they stay out of the
  // built-in Problems panel but are still visible in the Sesam panel view.
  const diagnosticsStore = new Map<string, vscode.Diagnostic[]>();
  const _onDiagnosticsChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(_onDiagnosticsChanged);

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      {
        scheme: "file",
        language: "json",
        pattern: "**/{pipes,systems}/**/*.json",
      },
      {
        scheme: "file",
        language: "sesam-config",
      },
    ],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher("**/{pipes,systems}/**/*.json"),
        vscode.workspace.createFileSystemWatcher("**/*.conf.{json,pipe,system}"),
      ],
    },
    traceOutputChannel: vscode.window.createOutputChannel("DTL Language Server (Trace)"),
    middleware: {
      handleDiagnostics(uri, diagnostics, next) {
        // Also store in our private map so the Sesam panel can display them.
        diagnosticsStore.set(uri.toString(), diagnostics);
        _onDiagnosticsChanged.fire();
        // Call next() so VS Code also gets squiggly lines, file badges, and the Problems panel.
        next(uri, diagnostics);
      },
    },
  };

  client = new LanguageClient(
    "dtlLanguageServer",
    "DTL Language Server",
    serverOptions,
    clientOptions,
  );

  await client.start();

  registerSesamLmTools(context, client);

  // ── Pipe DAG Views (Lineage + Dependents) ───────────────────────────────
  const dagRef: { current: DagIndex | null } = { current: null };
  const systemRef: { current: Map<string, SystemEntry> | null } = { current: null };
  const lineageProvider = new PipeLineageProvider(dagRef);
  const dependentsProvider = new PipeDependentsProvider(dagRef);
  const systemPipesProvider = new SystemPipesProvider(dagRef, systemRef);

  const lineageView = vscode.window.createTreeView("sesamPipeLineage", {
    treeDataProvider: lineageProvider,
    showCollapseAll: true,
  });
  const dependentsView = vscode.window.createTreeView("sesamPipeDependents", {
    treeDataProvider: dependentsProvider,
    showCollapseAll: true,
  });
  const systemPipesView = vscode.window.createTreeView("sesamSystemPipes", {
    treeDataProvider: systemPipesProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(lineageView, dependentsView, systemPipesView);

  // ── Sesam Errors Panel View ───────────────────────────────────────────────
  const errorsProvider = new SesamErrorsProvider(
    diagnosticsStore,
    _onDiagnosticsChanged.event,
    context,
  );
  const errorsView = vscode.window.createTreeView("sesamErrorsList", {
    treeDataProvider: errorsProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(errorsView);

  // Sync active config to all DAG views
  const syncActivePipe = (editor: vscode.TextEditor | undefined): void => {
    const id = getActivePipeId(editor);
    lineageProvider.setCurrentPipe(id);
    dependentsProvider.setCurrentPipe(id);
    const activeKind = getActiveConfigKind(editor);
    systemPipesProvider.setCurrentConfig(id, activeKind);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(syncActivePipe));
  syncActivePipe(vscode.window.activeTextEditor);

  // Initial DAG scan
  void buildDagFromWorkspace().then(({ index, systems }) => {
    dagRef.current = index;
    systemRef.current = systems;
    lineageProvider.refresh();
    dependentsProvider.refresh();
    systemPipesProvider.refresh();
  });

  const rescanDag = (): void => {
    void buildDagFromWorkspace().then(({ index, systems }) => {
      dagRef.current = index;
      systemRef.current = systems;
      lineageProvider.refresh();
      dependentsProvider.refresh();
      systemPipesProvider.refresh();
    });
  };

  // Watch for file changes to update the graph
  const watcher = vscode.workspace.createFileSystemWatcher("**/{pipes,systems}/**/*.json");
  watcher.onDidCreate(() => {
    rescanDag();
  });
  watcher.onDidChange(() => {
    rescanDag();
  });
  watcher.onDidDelete(() => {
    rescanDag();
  });
  context.subscriptions.push(watcher);

  const confWatcher = vscode.workspace.createFileSystemWatcher("**/*.conf.{json,pipe,system}");
  confWatcher.onDidCreate(() => {
    rescanDag();
  });
  confWatcher.onDidChange(() => {
    rescanDag();
  });
  confWatcher.onDidDelete(() => {
    rescanDag();
  });
  context.subscriptions.push(confWatcher);

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("sesam.clearErrors", () => {
      diagnosticsStore.clear();
      _onDiagnosticsChanged.fire();
    }),

    vscode.commands.registerCommand("dtl.refreshDag", () => {
      rescanDag();
      vscode.window.setStatusBarMessage("Sesam: DAG refreshed", 2000);
    }),

    vscode.commands.registerCommand("dtl.previewPipe", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Pipe preview: No active editor.");
        return;
      }
      PreviewPanel.createOrShow(context.extensionUri, editor.document);
    }),

    vscode.commands.registerCommand("dtl.openDocs", () => {
      vscode.env.openExternal(
        vscode.Uri.parse("https://docs.sesam.io/hub/data-transformation-language.html"),
      );
    }),

    vscode.commands.registerCommand("sesam.formatDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "sesam-config") {
        vscode.window.showWarningMessage("Sesam: No active Sesam config file to format.");
        return;
      }
      const text = editor.document.getText();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        vscode.window.showWarningMessage("Sesam: File is not valid JSON.");
        return;
      }
      const tabSize = typeof editor.options.tabSize === "number" ? editor.options.tabSize : 2;
      const reorderKeys =
        vscode.workspace.getConfiguration("dtl").get<boolean>("format.reorderKeys") ?? false;
      const formatted = formatSesamJson(parsed, tabSize, { reorderKeys });
      if (formatted === text) {
        return;
      }
      await editor.edit((editBuilder) => {
        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(text.length),
        );
        editBuilder.replace(fullRange, formatted);
      });
    }),

    vscode.commands.registerCommand("dtl.newConfFile", async (contextUri?: vscode.Uri) => {
      // ── Step 1: choose template ──────────────────────────────────────
      const TEMPLATES = [
        {
          label: "$(symbol-namespace) Simple pipe",
          description: '{ "_id", "type": "pipe", "source": { ... } }',
          id: "simple-pipe",
        },
        {
          label: "$(symbol-namespace) Pipe with DTL transform",
          description: "Pipe + source + DTL rules block",
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
      if (!template) {
        return;
      }

      // ── Step 2: choose source type (pipes) or system type ────────────
      const SOURCE_TYPES: Array<{
        label: string;
        description: string;
        source: object;
      }> = [
        {
          label: "dataset",
          description: "Read from a Sesam dataset",
          source: { type: "dataset", dataset: "<dataset-id>" },
        },
        {
          label: "sql",
          description: "Read from a SQL table via a SQL system",
          source: { type: "sql", system: "<system-id>", table: "<table>" },
        },
        {
          label: "rest",
          description: "Read from a REST API via a REST system",
          source: {
            type: "rest",
            system: "<system-id>",
            operation: "<operation>",
          },
        },
        {
          label: "json",
          description: "Read JSON from a URL via a URL/REST system",
          source: { type: "json", system: "<system-id>", url: "<url>" },
        },
        {
          label: "csv",
          description: "Read CSV via a URL/REST system",
          source: { type: "csv", system: "<system-id>", url: "<url>" },
        },
        {
          label: "http_endpoint",
          description: "Receive data pushed to an HTTP endpoint",
          source: { type: "http_endpoint" },
        },
        {
          label: "embedded",
          description: "Inline entities defined in the config",
          source: { type: "embedded", entities: [] },
        },
        {
          label: "empty",
          description: "Emits no entities (placeholder / testing)",
          source: { type: "empty" },
        },
        {
          label: "union_datasets",
          description: "Union multiple datasets into one stream",
          source: { type: "union_datasets", datasets: ["<dataset-id>"] },
        },
        {
          label: "merge",
          description: "Merge entities from multiple sources",
          source: { type: "merge", sources: [] },
        },
        {
          label: "merge_datasets",
          description: "Merge datasets, keeping latest version per entity",
          source: { type: "merge_datasets", datasets: ["<dataset-id>"] },
        },
        {
          label: "conditional",
          description: "Pick a source based on a runtime condition",
          source: {
            type: "conditional",
            condition: "<expr>",
            alternatives: {},
          },
        },
        {
          label: "kafka",
          description: "Read from Kafka via a Kafka system",
          source: { type: "kafka", system: "<system-id>" },
        },
        {
          label: "ldap",
          description: "Read from LDAP via an LDAP system",
          source: { type: "ldap", system: "<system-id>" },
        },
        {
          label: "binary",
          description: "Read binary data via a system",
          source: {
            type: "binary",
            system: "<system-id>",
            operation: "<operation>",
          },
        },
        {
          label: "sdshare",
          description: "Read from an SDShare feed",
          source: { type: "sdshare", url: "<url>" },
        },
        {
          label: "sparql",
          description: "Read from a SPARQL endpoint",
          source: { type: "sparql", url: "<url>" },
        },
        {
          label: "rdf",
          description: "Read RDF data from a URL",
          source: { type: "rdf", url: "<url>" },
        },
      ];

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

      let sourceStub: object | null = null;
      let systemType = "";

      if (template.id === "simple-pipe" || template.id === "dtl-pipe") {
        const picked = await vscode.window.showQuickPick(SOURCE_TYPES, {
          placeHolder: "Select source type",
          title: "New Sesam Config File — Source type",
          matchOnDescription: true,
        });
        if (!picked) {
          return;
        }
        sourceStub = picked.source;
      } else {
        const picked = await vscode.window.showQuickPick(SYSTEM_TYPES, {
          placeHolder: "Select system type",
          title: "New Sesam Config File — System type",
        });
        if (!picked) {
          return;
        }
        systemType = picked;
      }

      // ── Step 3: ask for _id ──────────────────────────────────────────
      const configId = await vscode.window.showInputBox({
        prompt: `Enter the config _id (used as filename: <id>.conf.json)`,
        placeHolder: template.id === "system" ? "my-rest-system" : "my-pipe-id",
        validateInput: (v) => {
          if (!v.trim()) {
            return "_id cannot be empty";
          }
          if (v.includes("/")) {
            return 'Cannot contain "/"';
          }
          return null;
        },
      });
      if (!configId) {
        return;
      }

      // ── Step 4: build content ────────────────────────────────────────
      let content: object;
      if (template.id === "simple-pipe") {
        content = { _id: configId, type: "pipe", source: sourceStub };
      } else if (template.id === "dtl-pipe") {
        content = {
          _id: configId,
          type: "pipe",
          source: sourceStub,
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
      // Always place pipes under <root>/pipes/ and systems under <root>/systems/
      const subdir = template.id === "system" ? "systems" : "pipes";

      let workspaceRoot: vscode.Uri;
      if (contextUri) {
        const stat = await vscode.workspace.fs.stat(contextUri);
        const ctxDir =
          stat.type === vscode.FileType.Directory
            ? contextUri
            : vscode.Uri.file(path.dirname(contextUri.fsPath));
        // Walk up from the context dir to find (or use) a workspace folder root
        workspaceRoot = vscode.workspace.getWorkspaceFolder(ctxDir)?.uri ?? ctxDir;
      } else {
        workspaceRoot =
          vscode.workspace.workspaceFolders?.[0]?.uri ??
          (vscode.window.activeTextEditor
            ? vscode.Uri.file(path.dirname(vscode.window.activeTextEditor.document.uri.fsPath))
            : vscode.Uri.file("."));
      }

      const folder = vscode.Uri.joinPath(workspaceRoot, subdir);
      // Create the subdirectory if it doesn't exist
      try {
        await vscode.workspace.fs.createDirectory(folder);
      } catch {
        // already exists — ignore
      }

      // ── Step 6: write and open ────────────────────────────────────────
      const ext = ".conf.json";
      const fileUri = vscode.Uri.joinPath(folder, `${configId}${ext}`);
      const text = JSON.stringify(content, null, 2) + "\n";
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(text, "utf-8"));
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc);
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
      if (
        PreviewPanel.currentPanel &&
        event.document === vscode.window.activeTextEditor?.document
      ) {
        PreviewPanel.currentPanel.updateDocument(event.document);
      }
    }),
    vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document.languageId !== "sesam-config") {
        return;
      }
      const text = event.document.getText();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      const editor = vscode.window.visibleTextEditors.find((e) => e.document === event.document);
      const tabSize = typeof editor?.options.tabSize === "number" ? editor.options.tabSize : 2;
      const reorderKeys =
        vscode.workspace.getConfiguration("dtl").get<boolean>("format.reorderKeys") ?? false;
      const formatted = formatSesamJson(parsed, tabSize, { reorderKeys });
      if (formatted === text) {
        return;
      }
      const fullRange = new vscode.Range(
        event.document.positionAt(0),
        event.document.positionAt(text.length),
      );
      event.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange, formatted)]));
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

// ---------------------------------------------------------------------------
// DAG helpers (module-level so they don't close over extension context)
// ---------------------------------------------------------------------------

/** Extract the _id from the currently open document (if it is a pipe OR system config). */
function getActivePipeId(editor: vscode.TextEditor | undefined): string | undefined {
  if (!editor) {
    return undefined;
  }
  const doc = editor.document;
  if (
    doc.languageId !== "sesam-config" &&
    doc.languageId !== "json" &&
    !doc.fileName.endsWith(".conf.pipe") &&
    !doc.fileName.endsWith(".conf.json") &&
    !doc.fileName.endsWith(".conf.system")
  ) {
    return undefined;
  }
  try {
    const obj = JSON.parse(doc.getText()) as Record<string, unknown>;
    return typeof obj["_id"] === "string" ? obj["_id"] : undefined;
  } catch {
    return undefined;
  }
}

/** Return the kind of the currently open config, or null if not a sesam config. */
function getActiveConfigKind(editor: vscode.TextEditor | undefined): "system" | "pipe" | null {
  if (!editor) {
    return null;
  }

  const doc = editor.document;

  try {
    const obj = JSON.parse(doc.getText()) as Record<string, unknown>;
    const t = typeof obj["type"] === "string" ? obj["type"] : "";
    if (t.startsWith("system:") || t === "system") {
      return "system";
    }
    const id = obj["_id"];
    if (typeof id === "string" && id) {
      return "pipe";
    }
  } catch {
    // ignore
  }

  return null;
}

/** Scan all workspace JSON/conf files, extract pipe info, and build the DagIndex. */
async function buildDagFromWorkspace(): Promise<{
  index: DagIndex;
  systems: Map<string, SystemEntry>;
}> {
  const files = await vscode.workspace.findFiles(
    "**/*.{json,conf.pipe,conf.system,conf.json}",
    "**/node_modules/**",
  );
  const infos = (
    await Promise.all(
      files.map(async (uri) => {
        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(raw).toString("utf-8");
          return extractFullPipeInfo(JSON.parse(text) as unknown, uri.toString());
        } catch {
          return null;
        }
      }),
    )
  ).filter((x): x is FullPipeInfo => x !== null);
  return { index: buildDagIndex(infos), systems: buildSystemIndex(infos) };
}
