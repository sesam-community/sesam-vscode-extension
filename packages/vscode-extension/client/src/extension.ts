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
import {
  initCredentialManager,
  deleteToken,
  listStoredProfileNames,
  storeToken,
} from "./credential-manager";
import { buildDagIndex, buildSystemIndex, extractFullPipeInfo } from "./graph/pipe-dag-builder";
import { PipeDependentsProvider } from "./graph/PipeDependentsProvider";
import { PipeLineageProvider } from "./graph/PipeLineageProvider";
import { SystemPipesProvider } from "./graph/SystemPipesProvider";
import { PreviewPanel } from "./preview/PreviewPanel";
import {
  initProfileManager,
  getActiveProfileName,
  refreshStatusBar,
  resolveNodeUrl,
  runAddProfile,
  runDeleteProfile,
  runListProfiles,
  runSwitchProfile,
  confirmIfProduction,
} from "./profile-manager";
import { SesamErrorsProvider } from "./SesamErrorsProvider";
import { registerSesamLmTools } from "./lm-tools";
import { registerSesamChatParticipant } from "./sesam-chat-participant";
import { resolveCredentials } from "./credential-resolver";
import {
  fetchNodeStatusHint,
  startProvisioningPoller,
  extractSubscriptionId,
  clearWakeUpSent,
} from "./portal-client";
import { pingNode } from "./node-client";
import { disposeSesamChannel, getSesamChannel, logNodeRequest } from "./sesam-channel";
import { SesamRunner } from "./sesam-runner";
import { createNetworkStatusBar, trackRequest } from "./network-status";
import { NodeStatusPanel } from "./node-status/NodeStatusPanel";
import { ProfilesPanel } from "./profile-manager/ProfilesPanel";
import { ValidationFailedError } from "@sesam/core";

import type { DagIndex, FullPipeInfo, SystemEntry } from "./graph/pipe-dag-builder";

let client: LanguageClient;

// ---------------------------------------------------------------------------
// Node provisioning state
// ---------------------------------------------------------------------------

/** Active provisioning poller — at most one at a time. */
let _provisioningPoller: { stop: () => void } | null = null;

/**
 * Last text editor that held a sesam-config or JSON pipe/system file.
 * Updated whenever focus moves to a qualifying editor so commands like
 * `sesam.runPipe` still work when focus is in the terminal, output panel,
 * or the pipe preview webview.
 */
let _lastSesamEditor: vscode.TextEditor | undefined;

/**
 * Start polling the portal for the given credentials if the node is not ready.
 * Sets the `sesam.nodeProvisioning` context key so menus can disable themselves.
 * Calls `onReady` (and notifies PreviewPanel) when the node becomes available.
 */
const startPollerIfNeeded = (nodeUrl: string, jwt: string): void => {
  const subId = extractSubscriptionId(jwt);

  if (!subId) {
    return;
  }

  if (_provisioningPoller) {
    return; // already polling
  }

  void vscode.commands.executeCommand("setContext", "sesam.nodeProvisioning", true);
  PreviewPanel.currentPanel?.setNodeProvisioning(true);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusBarItem.text = "$(sync~spin) Sesam: node provisioning…";
  statusBarItem.tooltip = "Waiting for Sesam node to become available";
  statusBarItem.show();

  _provisioningPoller = startProvisioningPoller(
    jwt,
    subId,
    nodeUrl,
    (hint) => {
      statusBarItem.text = `$(sync~spin) Sesam: ${hint}`;
    },
    () => {
      _provisioningPoller = null;
      clearWakeUpSent(subId);
      statusBarItem.dispose();
      void vscode.commands.executeCommand("setContext", "sesam.nodeProvisioning", false);
      PreviewPanel.currentPanel?.setNodeProvisioning(false);
      void vscode.window.showInformationMessage(
        "Sesam: Node is ready. You can now run pipes and use live preview.",
      );
    },
  );
};

/**
 * If the node is hibernated/provisioning, start the wake-up + polling flow and
 * wait until the node is ready before resolving.  Returns `true` when the node
 * is (or became) ready, `false` if the user cancelled.
 */
const ensureNodeReady = async (nodeUrl: string, jwt: string): Promise<boolean> => {
  const hint = await fetchNodeStatusHint(nodeUrl, jwt);

  if (!hint) {
    return true; // node already reachable
  }

  // Node is hibernated / provisioning — inform the user and wait.
  const answer = await vscode.window.showWarningMessage(
    `Sesam: Node is not ready — ${hint}. Wake it up and wait?`,
    { modal: true },
    "Wake up & wait",
  );

  if (answer !== "Wake up & wait") {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const subId = extractSubscriptionId(jwt);

    if (!subId) {
      resolve(false);
      return;
    }

    if (_provisioningPoller) {
      // Already polling from another trigger — just wait for it to call onReady.
      // We piggyback by polling _provisioningPoller until it clears.
      const check = setInterval(() => {
        if (!_provisioningPoller) {
          clearInterval(check);
          resolve(true);
        }
      }, 3_000);

      return;
    }

    void vscode.commands.executeCommand("setContext", "sesam.nodeProvisioning", true);
    PreviewPanel.currentPanel?.setNodeProvisioning(true);

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    statusBarItem.text = "$(sync~spin) Sesam: node provisioning…";
    statusBarItem.tooltip = "Waiting for Sesam node to become available";
    statusBarItem.show();

    _provisioningPoller = startProvisioningPoller(
      jwt,
      subId,
      nodeUrl,
      (statusHint) => {
        statusBarItem.text = `$(sync~spin) Sesam: ${statusHint}`;
      },
      () => {
        _provisioningPoller = null;
        clearWakeUpSent(subId);
        statusBarItem.dispose();
        void vscode.commands.executeCommand("setContext", "sesam.nodeProvisioning", false);
        PreviewPanel.currentPanel?.setNodeProvisioning(false);
        resolve(true);
      },
    );
  });
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Wire the provisioning poller into PreviewPanel and NodeStatusPanel live eval failures
  PreviewPanel.onProvisioningNeeded = startPollerIfNeeded;
  NodeStatusPanel.onProvisioningNeeded = startPollerIfNeeded;

  // ── Network Status Bar (F23) ──────────────────────────────────────────────
  createNetworkStatusBar(context);

  // ── Sesam Output Channel ──────────────────────────────────────────────────
  // Write an initial line so the channel appears in the Output dropdown immediately.
  context.subscriptions.push({ dispose: disposeSesamChannel });
  getSesamChannel().appendLine("Sesam extension activated.");

  // ── Credential & Profile Managers (F03) ──────────────────────────────────
  initCredentialManager(context);
  initProfileManager(context);

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
  registerSesamChatParticipant(context, client);

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
    if (editor && getActivePipeId(editor) !== undefined) {
      _lastSesamEditor = editor;
    }

    const id = getActivePipeId(editor);
    lineageProvider.setCurrentPipe(id);
    dependentsProvider.setCurrentPipe(id);
    const activeKind = getActiveConfigKind(editor);
    systemPipesProvider.setCurrentConfig(id, activeKind);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(syncActivePipe));
  syncActivePipe(vscode.window.activeTextEditor);

  // Keep sesam-config files in the left column (ViewColumn.One) so they don't
  // open over the Preview panel or the Node Status panel in the right split.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (
        !editor ||
        editor.viewColumn === vscode.ViewColumn.One ||
        (!PreviewPanel.currentPanel && !NodeStatusPanel.currentPanel)
      ) {
        return;
      }

      const lang = editor.document.languageId;

      if (lang !== "sesam-config" && lang !== "json") {
        return;
      }

      void vscode.commands.executeCommand("workbench.action.moveEditorToFirstGroup");
    }),
  );

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

  // Clear the references view when a sesam config file is renamed so stale
  // results from before the rename don't persist.
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((event) => {
      const affectsSesam = event.files.some(
        ({ oldUri }) =>
          oldUri.fsPath.endsWith(".conf.json") ||
          oldUri.fsPath.endsWith(".conf.pipe") ||
          oldUri.fsPath.endsWith(".conf.system"),
      );

      if (affectsSesam) {
        // Re-run Find References on the renamed file so the view shows fresh
        // results instead of going into an error/stale state.
        setTimeout(() => {
          const editor = vscode.window.activeTextEditor;

          if (editor) {
            void vscode.commands.executeCommand("references-view.findReferences");
          }
        }, 300);
      }
    }),
  );

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

    vscode.commands.registerCommand("sesam.pipeRunningIndicator", () => {
      // No-op — this command exists only to show the spinning indicator
      // in the editor title while a pipe run is in progress.
    }),

    vscode.commands.registerCommand("sesam.runPipe", async () => {
      const editor =
        vscode.window.activeTextEditor ??
        _lastSesamEditor ??
        vscode.window.visibleTextEditors.find((e) => getActivePipeId(e) !== undefined);
      const pipeId = getActivePipeId(editor);

      if (!pipeId) {
        vscode.window.showWarningMessage("Sesam: No _id found in the active document.");
        return;
      }

      const creds = await resolveCredentials();

      if (!creds) {
        const action = await vscode.window.showErrorMessage(
          "Sesam: No credentials configured for this profile.",
          "Set JWT Token",
        );

        if (action === "Set JWT Token") {
          await vscode.commands.executeCommand("sesam.setToken");
        }

        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Sesam: Running pipe '${pipeId}'…`,
          cancellable: false,
        },
        async () => {
          void vscode.commands.executeCommand("setContext", "sesam.pipeRunning", true);

          try {
            const runner = new SesamRunner();
            const done = trackRequest("POST", `run-pipe/${pipeId}`);
            let runResult: Awaited<ReturnType<typeof runner.runPipe>>;

            try {
              runResult = await runner.runPipe(
                { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
                pipeId,
              );
              done(runResult.success);
            } catch (runErr) {
              done(false);
              throw runErr;
            }

            const result = runResult;

            if (result.success) {
              vscode.window.showInformationMessage(`Sesam: Pipe '${pipeId}' started successfully.`);
            } else {
              const hint = await fetchNodeStatusHint(creds.nodeUrl, creds.jwt);
              const detail = result.message ?? "unknown error";
              vscode.window.showErrorMessage(
                `Sesam: Failed to run '${pipeId}': ${detail}${hint ? `\n\n${hint}` : ""}`,
              );

              if (hint) {
                startPollerIfNeeded(creds.nodeUrl, creds.jwt);
              }
            }
          } catch (err) {
            const isAuth =
              typeof err === "object" &&
              err !== null &&
              (err as Record<string, unknown>)["kind"] === "auth";
            const detail = err instanceof Error ? err.message : String(err);
            const hint = isAuth ? null : await fetchNodeStatusHint(creds.nodeUrl, creds.jwt);
            vscode.window.showErrorMessage(
              `Sesam: Failed to run '${pipeId}': ${detail}${hint ? `\n\n${hint}` : ""}`,
            );

            if (hint) {
              startPollerIfNeeded(creds.nodeUrl, creds.jwt);
            }
          } finally {
            void vscode.commands.executeCommand("setContext", "sesam.pipeRunning", false);
          }
        },
      );
    }),

    vscode.commands.registerCommand("dtl.previewPipe", () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showWarningMessage("Pipe preview: No active editor.");
        return;
      }

      const errors = vscode.languages
        .getDiagnostics(editor.document.uri)
        .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);

      if (errors.length > 0) {
        vscode.window.showWarningMessage(
          `Pipe preview blocked: ${errors.length} error${errors.length === 1 ? "" : "s"} in this file. Fix all errors before previewing.`,
        );
        return;
      }

      PreviewPanel.createOrShow(context.extensionUri, editor.document, context);
    }),

    // ── Upload / Download ─────────────────────────────────────────────────
    vscode.commands.registerCommand("sesam.upload", async () => {
      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!workspaceDir) {
        vscode.window.showWarningMessage("Sesam: No workspace folder open.");
        return;
      }

      const creds = await resolveCredentials();

      if (!creds) {
        const action = await vscode.window.showErrorMessage(
          "Sesam: No credentials configured for this profile.",
          "Set JWT Token",
        );

        if (action === "Set JWT Token") {
          await vscode.commands.executeCommand("sesam.setToken");
        }

        return;
      }

      if (!(await confirmIfProduction("upload all configs"))) {
        return;
      }

      const uploadReady = await ensureNodeReady(creds.nodeUrl, creds.jwt);

      if (!uploadReady) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Sesam: Uploading…",
          cancellable: false,
        },
        async () => {
          const done = trackRequest("PUT", "upload/config");

          try {
            const runner = new SesamRunner();
            const result = await runner.upload(
              { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
              workspaceDir,
            );
            done(result.success);

            if (result.success) {
              vscode.window.showInformationMessage(
                `Sesam: Upload complete — ${result.pipesUploaded} pipes, ${result.systemsUploaded} systems.`,
              );
            } else {
              vscode.window.showErrorMessage(
                `Sesam: Upload failed: ${result.message ?? "unknown error"}`,
              );
            }
          } catch (err) {
            done(false);

            const isValidationError =
              err instanceof ValidationFailedError ||
              (typeof err === "object" &&
                err !== null &&
                (err as Record<string, unknown>)["kind"] === "validation" &&
                Array.isArray((err as Record<string, unknown>)["errors"]));

            if (isValidationError) {
              const validationErr = err as ValidationFailedError;
              const ch = getSesamChannel();
              ch.clear();

              const total = validationErr.errors.length;
              const header = `Upload blocked — ${total} validation error${total === 1 ? "" : "s"} found`;
              const rule = "─".repeat(header.length);
              ch.appendLine(rule);
              ch.appendLine(header);
              ch.appendLine(rule);
              ch.appendLine("");

              // Group errors by file for readability
              const byFile = new Map<string, typeof validationErr.errors>();

              for (const e of validationErr.errors) {
                const existing = byFile.get(e.file) ?? [];
                existing.push(e);
                byFile.set(e.file, existing);
              }

              for (const [absFile, errs] of byFile) {
                const rel = workspaceDir ? absFile.replace(workspaceDir + "/", "") : absFile;
                ch.appendLine(`  ${rel}`);

                for (const e of errs) {
                  const fileUri = vscode.Uri.file(absFile);
                  const lineNum = e.line ?? 1;
                  const colNum = e.column ?? 1;
                  const link = `${fileUri.toString()}:${lineNum}:${colNum}`;
                  const locLabel =
                    e.line != null
                      ? ` line ${e.line}${e.column != null ? `:${e.column}` : ""}`
                      : "";
                  ch.appendLine(`    ✗${locLabel}  ${e.message}`);
                  ch.appendLine(`      ${link}`);
                }

                ch.appendLine("");
              }

              ch.appendLine(
                `Fix the ${total} error${total === 1 ? "" : "s"} above, then upload again. Use "Fix with Copilot" in the notification to get AI assistance.`,
              );
              ch.show(false);

              const action = await vscode.window.showErrorMessage(
                `Sesam: Upload blocked — ${total} validation error${total === 1 ? "" : "s"}. See the Sesam output panel for details.`,
                "Fix with Copilot",
              );

              if (action === "Fix with Copilot") {
                // Read the contents of each erroring file so the agent has full context
                const uniqueFiles = [...new Set(validationErr.errors.map((e) => e.file))];
                const fileSections = await Promise.all(
                  uniqueFiles.map(async (absFile) => {
                    const rel = workspaceDir ? absFile.replace(workspaceDir + "/", "") : absFile;
                    const fileErrors = validationErr.errors
                      .filter((e) => e.file === absFile)
                      .map((e) => {
                        const loc = e.line != null ? ` line ${e.line}` : "";
                        return `  - ${e.message}${loc}`;
                      })
                      .join("\n");
                    try {
                      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(absFile));
                      const content = Buffer.from(raw).toString("utf-8");
                      return `### ${rel}\nErrors:\n${fileErrors}\n\nFile content:\n\`\`\`json\n${content}\n\`\`\``;
                    } catch {
                      return `### ${rel}\nErrors:\n${fileErrors}\n\n(Could not read file content)`;
                    }
                  }),
                );

                const query = [
                  "@sesam /fix My Sesam configs failed validation during upload. Here are the files with errors and their current content:",
                  "",
                  ...fileSections,
                ].join("\n");

                void vscode.commands.executeCommand("workbench.action.chat.open", { query });
              }
            } else {
              vscode.window.showErrorMessage(
                `Sesam: Upload failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        },
      );
    }),

    vscode.commands.registerCommand("sesam.download", async (opts?: { skipConfirm?: boolean }) => {
      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!workspaceDir) {
        vscode.window.showWarningMessage("Sesam: No workspace folder open.");
        return;
      }

      const creds = await resolveCredentials();

      if (!creds) {
        const action = await vscode.window.showErrorMessage(
          "Sesam: No credentials configured for this profile.",
          "Set JWT Token",
        );

        if (action === "Set JWT Token") {
          await vscode.commands.executeCommand("sesam.setToken");
        }

        return;
      }

      if (!(await confirmIfProduction("download all configs"))) {
        return;
      }

      const downloadReady = await ensureNodeReady(creds.nodeUrl, creds.jwt);

      if (!downloadReady) {
        return;
      }

      // Direct node connectivity check — logs to Sesam output channel
      getSesamChannel().appendLine(`[DOWNLOAD] pinging node ${creds.nodeUrl} …`);
      const ping = await pingNode(creds.nodeUrl, creds.jwt, logNodeRequest);
      getSesamChannel().appendLine(
        `[DOWNLOAD] ping: ${ping.status}${"message" in ping ? ` — ${ping.message}` : ""}`,
      );

      if (ping.status === "auth") {
        vscode.window
          .showErrorMessage(
            "Sesam: Authentication failed — JWT may be invalid or expired.",
            "Set JWT Token",
          )
          .then((action) => {
            if (action === "Set JWT Token") {
              void vscode.commands.executeCommand("sesam.setToken");
            }
          });

        return;
      }

      if (!opts?.skipConfirm) {
        const confirmed = await vscode.window.showWarningMessage(
          "Sesam: Download will overwrite local pipe and system configs. Continue?",
          { modal: true },
          "Download",
        );

        if (confirmed !== "Download") {
          return;
        }
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Sesam: Downloading…",
          cancellable: false,
        },
        async () => {
          const done = trackRequest("GET", "download/config");

          try {
            const runner = new SesamRunner();
            const result = await runner.download(
              { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
              {
                outDir: workspaceDir,
                formatter: (config) => formatSesamJson(config, 2, { reorderKeys: true }),
              },
            );
            done(true);
            vscode.window.showInformationMessage(
              `Sesam: Download complete — ${result.pipesWritten} pipes, ${result.systemsWritten} systems.`,
            );
          } catch (err) {
            done(false);
            vscode.window.showErrorMessage(
              `Sesam: Download failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      );
    }),

    // ── Upload / Download single file ─────────────────────────────────────
    vscode.commands.registerCommand("sesam.uploadFile", async () => {
      const editor =
        vscode.window.activeTextEditor ??
        _lastSesamEditor ??
        vscode.window.visibleTextEditors.find((e) => getActivePipeId(e) !== undefined);
      const pipeId = getActivePipeId(editor);

      if (!pipeId || !editor) {
        vscode.window.showWarningMessage("Sesam: No config _id found in the active document.");
        return;
      }

      const creds = await resolveCredentials();

      if (!creds) {
        const action = await vscode.window.showErrorMessage(
          "Sesam: No credentials configured for this profile.",
          "Set JWT Token",
        );

        if (action === "Set JWT Token") {
          await vscode.commands.executeCommand("sesam.setToken");
        }

        return;
      }

      if (!(await confirmIfProduction(`upload '${pipeId}'`))) {
        return;
      }

      const uploadReady = await ensureNodeReady(creds.nodeUrl, creds.jwt);

      if (!uploadReady) {
        return;
      }

      const filePath = editor.document.uri.fsPath;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Sesam: Uploading '${pipeId}'…`,
          cancellable: false,
        },
        async () => {
          const done = trackRequest("PUT", `upload/file/${pipeId}`);

          try {
            const runner = new SesamRunner();
            const result = await runner.uploadFile(
              { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
              filePath,
            );
            done(result.success);

            if (result.success) {
              vscode.window.showInformationMessage(`Sesam: '${pipeId}' uploaded successfully.`);
            } else {
              vscode.window.showErrorMessage(
                `Sesam: Upload failed: ${result.message ?? "unknown error"}`,
              );
            }
          } catch (err) {
            done(false);

            const isValidationError =
              err instanceof ValidationFailedError ||
              (typeof err === "object" &&
                err !== null &&
                (err as Record<string, unknown>)["kind"] === "validation" &&
                Array.isArray((err as Record<string, unknown>)["errors"]));

            if (isValidationError) {
              const validationErr = err as ValidationFailedError;
              const total = validationErr.errors.length;
              const ch = getSesamChannel();
              ch.clear();
              ch.appendLine(
                `Upload blocked — ${total} validation error${total === 1 ? "" : "s"} in '${pipeId}'`,
              );
              ch.appendLine("");

              for (const e of validationErr.errors) {
                const locLabel =
                  e.line != null ? ` line ${e.line}${e.column != null ? `:${e.column}` : ""}` : "";
                ch.appendLine(`  ✗${locLabel}  ${e.message}`);
              }

              ch.show(false);
              vscode.window.showErrorMessage(
                `Sesam: Upload blocked — ${total} validation error${total === 1 ? "" : "s"} in '${pipeId}'.`,
              );
            } else {
              vscode.window.showErrorMessage(
                `Sesam: Upload failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        },
      );
    }),

    vscode.commands.registerCommand("sesam.downloadFile", async () => {
      const editor =
        vscode.window.activeTextEditor ??
        _lastSesamEditor ??
        vscode.window.visibleTextEditors.find((e) => getActivePipeId(e) !== undefined);
      const pipeId = getActivePipeId(editor);

      if (!pipeId || !editor) {
        vscode.window.showWarningMessage("Sesam: No config _id found in the active document.");
        return;
      }

      const configType = getActiveConfigKind(editor) === "system" ? "system" : "pipe";
      const creds = await resolveCredentials();

      if (!creds) {
        const action = await vscode.window.showErrorMessage(
          "Sesam: No credentials configured for this profile.",
          "Set JWT Token",
        );

        if (action === "Set JWT Token") {
          await vscode.commands.executeCommand("sesam.setToken");
        }

        return;
      }

      const downloadReady = await ensureNodeReady(creds.nodeUrl, creds.jwt);

      if (!downloadReady) {
        return;
      }

      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!workspaceDir) {
        vscode.window.showWarningMessage("Sesam: No workspace folder open.");
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Sesam: This will overwrite the local file for '${pipeId}'. Continue?`,
        { modal: true },
        "Download",
      );

      if (confirmed !== "Download") {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Sesam: Downloading '${pipeId}'…`,
          cancellable: false,
        },
        async () => {
          const done = trackRequest("GET", `download/file/${pipeId}`);

          try {
            const runner = new SesamRunner();
            const result = await runner.downloadFile(
              { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
              pipeId,
              configType,
              {
                outDir: workspaceDir,
                formatter: (config) => formatSesamJson(config, 2, { reorderKeys: true }),
              },
            );
            done(true);
            vscode.window.showInformationMessage(
              `Sesam: '${pipeId}' downloaded to ${result.filePath.replace(workspaceDir + "/", "")}.`,
            );
          } catch (err) {
            done(false);
            vscode.window.showErrorMessage(
              `Sesam: Download failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      );
    }),

    // ── Status commands ───────────────────────────────────────────────────
    vscode.commands.registerCommand("sesam.pipeStatus", () => {
      const editor =
        vscode.window.activeTextEditor ??
        _lastSesamEditor ??
        vscode.window.visibleTextEditors.find((e) => getActivePipeId(e) !== undefined);
      const pipeId = getActivePipeId(editor);

      if (!pipeId) {
        vscode.window.showWarningMessage("Sesam: No _id found in the active document.");
        return;
      }

      NodeStatusPanel.createOrShow(pipeId);
    }),

    vscode.commands.registerCommand("sesam.nodeStatus", () => {
      NodeStatusPanel.createOrShow();
    }),

    vscode.commands.registerCommand("sesam.fixWithCopilot", async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showWarningMessage("Sesam: Open a Sesam config file to fix.");
        return;
      }

      const absFile = editor.document.uri.fsPath;
      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const rel = workspaceDir ? absFile.replace(workspaceDir + "/", "") : absFile;
      const content = editor.document.getText();

      const query = [
        "@sesam /fix Please fix any validation errors in this Sesam config file:",
        "",
        `### ${rel}`,
        `\`\`\`json`,
        content,
        `\`\`\``,
      ].join("\n");

      void vscode.commands.executeCommand("workbench.action.chat.open", { query });
    }),

    // ── F03: Secure credential commands ──────────────────────────────────
    vscode.commands.registerCommand("sesam.setToken", async () => {
      const activeProfile = getActiveProfileName();

      const jwt = await vscode.window.showInputBox({
        title: `Sesam: Set JWT Token — ${activeProfile}`,
        prompt: "Paste your JWT token (obtained from the Sesam portal)",
        placeHolder: "eyJ…",
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : "JWT cannot be empty"),
      });

      if (jwt === undefined) {
        return;
      }

      await storeToken(activeProfile, jwt.trim());
      refreshStatusBar();

      const nodeUrl = resolveNodeUrl(activeProfile);
      const ch = getSesamChannel();
      ch.appendLine(`[TOKEN] profile='${activeProfile}'  nodeUrl='${nodeUrl || "(none)"}'`);
      ch.show(true);

      if (nodeUrl) {
        ch.appendLine(`[TOKEN] pinging ${nodeUrl}/api/config …`);
        const ping = await pingNode(nodeUrl, jwt.trim(), logNodeRequest);
        ch.appendLine(
          `[TOKEN] ping result: ${ping.status}${"message" in ping ? `  — ${ping.message}` : ""}`,
        );

        if (ping.status === "ok") {
          vscode.window.showInformationMessage(
            `Sesam: JWT stored for '${activeProfile}' — node is reachable.`,
          );
        } else if (ping.status === "auth") {
          vscode.window.showWarningMessage(
            `Sesam: JWT stored, but authentication failed — token may be invalid or expired.`,
          );
        } else {
          vscode.window.showWarningMessage(
            `Sesam: JWT stored, but node is unreachable — ${ping.message}`,
          );
        }
      } else {
        ch.appendLine(
          `[setToken] no nodeUrl configured for '${activeProfile}' — skipping ping. Run 'Sesam: Add Profile' to set a node URL.`,
        );
        vscode.window.showWarningMessage(
          `Sesam: JWT stored for '${activeProfile}', but no node URL is configured. Run 'Sesam: Add Profile' to associate a node URL with this profile.`,
        );
      }
    }),

    vscode.commands.registerCommand("sesam.deleteToken", async () => {
      const names = listStoredProfileNames();

      if (names.length === 0) {
        vscode.window.showInformationMessage("Sesam: No stored profiles found.");
        return;
      }

      const picked = await vscode.window.showQuickPick(names, {
        title: "Sesam: Delete JWT — Select profile",
        placeHolder: "Select a profile to delete its JWT",
      });

      if (!picked) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Delete JWT for profile '${picked}'?`,
        { modal: true },
        "Delete",
      );

      if (confirmed !== "Delete") {
        return;
      }

      await deleteToken(picked);
      vscode.window.showInformationMessage(`Sesam: JWT deleted for profile '${picked}'.`);
    }),

    vscode.commands.registerCommand("sesam.addProfile", () => runAddProfile()),
    vscode.commands.registerCommand("sesam.deleteProfile", () => runDeleteProfile()),
    vscode.commands.registerCommand("sesam.listProfiles", () => runListProfiles()),
    vscode.commands.registerCommand("sesam.switchProfile", (targetProfile?: string) =>
      runSwitchProfile(targetProfile),
    ),
    vscode.commands.registerCommand("sesam.showProfiles", () =>
      ProfilesPanel.createOrShow(context.extensionUri),
    ),
    vscode.commands.registerCommand("sesam.refreshProfilesPanel", () =>
      ProfilesPanel.refreshIfOpen(),
    ),
    vscode.commands.registerCommand("sesam.refreshStatusBar", () => refreshStatusBar()),

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

    vscode.commands.registerCommand(
      "sesam.saveGeneratedPipe",
      async (jsonContent: string, suggestedName: string) => {
        const wsFolder = vscode.workspace.workspaceFolders?.[0];
        const defaultUri = wsFolder
          ? vscode.Uri.joinPath(wsFolder.uri, "pipes", suggestedName)
          : vscode.Uri.file(suggestedName);

        const saveUri = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { "Sesam config": ["conf.json", "conf.pipe", "json"] },
          title: "Save generated pipe",
        });

        if (!saveUri) {
          return;
        }

        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(jsonContent, "utf-8"));
        const doc = await vscode.workspace.openTextDocument(saveUri);
        await vscode.window.showTextDocument(doc);
      },
    ),

    vscode.commands.registerCommand("dtl.duplicatePipe", async (contextUri?: vscode.Uri) => {
      const sourceUri = contextUri ?? vscode.window.activeTextEditor?.document.uri;

      if (!sourceUri) {
        vscode.window.showWarningMessage("Sesam: No config file to duplicate.");
        return;
      }

      let parsed: Record<string, unknown>;

      try {
        const raw = await vscode.workspace.fs.readFile(sourceUri);
        parsed = JSON.parse(Buffer.from(raw).toString("utf-8")) as Record<string, unknown>;
      } catch {
        vscode.window.showErrorMessage("Sesam: Could not read or parse the config file.");
        return;
      }

      const originalId = typeof parsed["_id"] === "string" ? parsed["_id"] : "";
      const suggestedId = originalId ? `${originalId}-copy` : "copy";

      const newId = await vscode.window.showInputBox({
        prompt: `Enter the config _id for the duplicate (used as filename: <id>${sourceUri.fsPath.endsWith(".conf.pipe") ? ".conf.pipe" : sourceUri.fsPath.endsWith(".conf.system") ? ".conf.system" : ".conf.json"})`,
        value: suggestedId,
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

      if (!newId) {
        return;
      }

      const newContent = { ...parsed, _id: newId };
      const fsPath = sourceUri.fsPath;
      const ext = fsPath.endsWith(".conf.pipe")
        ? ".conf.pipe"
        : fsPath.endsWith(".conf.system")
          ? ".conf.system"
          : ".conf.json";
      const fileUri = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(fsPath)), `${newId}${ext}`);
      const reorderKeys =
        vscode.workspace.getConfiguration("dtl").get<boolean>("format.reorderKeys") ?? false;
      const formatted = formatSesamJson(newContent, 2, { reorderKeys });

      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(formatted, "utf-8"));
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand("dtl.createDownstreamPipe", async (contextUri?: vscode.Uri) => {
      const sourceUri = contextUri ?? vscode.window.activeTextEditor?.document.uri;

      if (!sourceUri) {
        vscode.window.showWarningMessage("Sesam: No config file open.");
        return;
      }

      let parsed: Record<string, unknown>;

      try {
        const raw = await vscode.workspace.fs.readFile(sourceUri);
        parsed = JSON.parse(Buffer.from(raw).toString("utf-8")) as Record<string, unknown>;
      } catch {
        vscode.window.showErrorMessage("Sesam: Could not read or parse the config file.");
        return;
      }

      const sourceId = typeof parsed["_id"] === "string" ? parsed["_id"] : "";

      if (!sourceId) {
        vscode.window.showWarningMessage("Sesam: Current config has no _id.");
        return;
      }

      const newId = await vscode.window.showInputBox({
        prompt: `Enter _id for the downstream pipe (source dataset: "${sourceId}")`,
        placeHolder: `${sourceId}-downstream`,
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

      if (!newId) {
        return;
      }

      const content = {
        _id: newId,
        type: "pipe",
        source: {
          type: "dataset",
          dataset: sourceId,
        },
      };

      const workspaceRoot =
        vscode.workspace.getWorkspaceFolder(sourceUri)?.uri ??
        vscode.workspace.workspaceFolders?.[0]?.uri ??
        vscode.Uri.file(path.dirname(sourceUri.fsPath));
      const folder = vscode.Uri.joinPath(workspaceRoot, "pipes");

      try {
        await vscode.workspace.fs.createDirectory(folder);
      } catch {
        // already exists — ignore
      }

      const fileUri = vscode.Uri.joinPath(folder, `${newId}.conf.json`);

      await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(JSON.stringify(content, null, 2) + "\n", "utf-8"),
      );
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand("dtl.renamePipe", async (contextUri?: vscode.Uri) => {
      const targetUri = contextUri ?? vscode.window.activeTextEditor?.document.uri;

      if (!targetUri) {
        vscode.window.showWarningMessage("Sesam: No config file to rename.");
        return;
      }

      let parsed: Record<string, unknown>;

      try {
        const raw = await vscode.workspace.fs.readFile(targetUri);
        parsed = JSON.parse(Buffer.from(raw).toString("utf-8")) as Record<string, unknown>;
      } catch {
        vscode.window.showErrorMessage("Sesam: Could not read or parse the config file.");
        return;
      }

      const currentId = typeof parsed["_id"] === "string" ? parsed["_id"] : "";

      const newId = await vscode.window.showInputBox({
        prompt: "Enter the new _id (the file will be renamed to match)",
        value: currentId,
        validateInput: (v) => {
          if (!v.trim()) {
            return "_id cannot be empty";
          }

          if (v.includes("/")) {
            return 'Cannot contain "/"';
          }

          if (v === currentId) {
            return "New _id must be different from the current one";
          }

          return null;
        },
      });

      if (!newId) {
        return;
      }

      const fsPath = targetUri.fsPath;
      const ext = fsPath.endsWith(".conf.pipe")
        ? ".conf.pipe"
        : fsPath.endsWith(".conf.system")
          ? ".conf.system"
          : ".conf.json";
      const newFileUri = vscode.Uri.joinPath(
        vscode.Uri.file(path.dirname(fsPath)),
        `${newId}${ext}`,
      );
      const renamedContent = { ...parsed, _id: newId };
      const reorderKeys =
        vscode.workspace.getConfiguration("dtl").get<boolean>("format.reorderKeys") ?? false;
      const formatted = formatSesamJson(renamedContent, 2, { reorderKeys });

      // Close the current editor before deleting the file
      const activeEditor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === targetUri.toString(),
      );

      if (activeEditor) {
        await vscode.window.showTextDocument(activeEditor.document, { preview: false });
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }

      await vscode.workspace.fs.writeFile(newFileUri, Buffer.from(formatted, "utf-8"));
      await vscode.workspace.fs.delete(targetUri);
      const doc = await vscode.workspace.openTextDocument(newFileUri);
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
  disposeSesamChannel();

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
