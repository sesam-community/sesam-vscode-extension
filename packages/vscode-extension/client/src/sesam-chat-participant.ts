import * as path from "node:path";

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import { getAllFunctions, DTL_VARIABLES } from "../../src/shared/dtl-registry";

import type { LintContentRequest, LintContentResponse } from "../../types/lint.types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARTICIPANT_ID = "sesam.agent";

const SESAM_SOURCE_TYPES = [
  "binary",
  "conditional",
  "csv",
  "dataset",
  "embedded",
  "empty",
  "http_endpoint",
  "json",
  "kafka",
  "ldap",
  "merge",
  "merge_datasets",
  "rdf",
  "rest",
  "sdshare",
  "sparql",
  "sql",
  "union_datasets",
] as const;

const SESAM_SYSTEM_TYPES = [
  "elasticsearch",
  "kafka",
  "ldap",
  "microservice",
  "mssql",
  "mysql",
  "oracle",
  "postgresql",
  "rest",
  "smtp",
  "solr",
  "twilio",
  "url",
] as const;

const CLI_KNOWLEDGE = `
sesam-py CLI reference:

  sesam upload [--use-internal-parser]   Upload all local config files to the connected node
  sesam download                         Download all configs from node to local directory
  sesam run [<pipe-id>]                  Run all pipes, or a specific pipe by its _id
  sesam status                           Show execution status for all pipes
  sesam test                             Run all registered tests (uses testdata/ directory)
  sesam log <pipe-id>                    Tail the execution log for a pipe
  sesam get-dataset <dataset-id>         Fetch all entities from a dataset (JSON output)
  sesam put-dataset <dataset-id>         Upload entities from stdin to a dataset
  sesam wipe                             Wipe all state from the node (destructive!)
  sesam subscribe <pipe-id>              Watch a pipe's execution in real-time

Authentication — set env vars or configure ~/.sesam/config.ini:
  SESAM_NODE=https://<your-node>.sesam.cloud
  SESAM_JWT=<your-jwt-token>

  [sesam]
  node = https://<your-node>.sesam.cloud
  jwt  = <your-jwt-token>
`.trim();

// ---------------------------------------------------------------------------
// System prompt builders  (evaluated once at module load)
// ---------------------------------------------------------------------------

const buildFunctionReference = (): string =>
  getAllFunctions()
    .map((f) => `- ${f.name} [${f.kind}]: ${f.signature} — ${f.description}`)
    .join("\n");

const buildVariableReference = (): string =>
  Object.entries(DTL_VARIABLES)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

const DTL_REFERENCE = `
DTL built-in variables:
${buildVariableReference()}

DTL functions:
${buildFunctionReference()}
`.trim();

const GENERATE_PIPE_SYSTEM_PROMPT = `
You are an expert in Sesam DTL (Data Transformation Language) pipe configuration.
Your task is to generate a BRAND NEW Sesam pipe config from scratch, based ONLY on the user's description.
Do NOT reference, analyse, or modify any existing file. The user is asking for new content.

Rules for the generated config:
- Every config MUST have "_id" (string) and "type": "pipe"
- "source" object must have a valid "type" field
- DTL transforms belong in "transform": {"type": "dtl", "rules": {"default": [...]}}
- Each rule is a JSON array whose first element is the function name string

Available source types: ${SESAM_SOURCE_TYPES.join(", ")}
Available system types: ${SESAM_SYSTEM_TYPES.join(", ")}

${DTL_REFERENCE}

Return the new pipe as a fenced JSON code block. After the code block, briefly describe what it does.
`.trim();

const EXPLAIN_SYSTEM_PROMPT = `
You are an expert in Sesam DTL (Data Transformation Language) pipe configuration.
When given a Sesam pipe config or DTL transform, explain:
1. What the pipe reads from (source type, dataset, or system)
2. What each transform rule does in plain language
3. What the output entities will look like

${DTL_REFERENCE}

Be clear and concise. Use bullet points. Do not repeat the raw JSON verbatim.
`.trim();

const GENERATE_TEST_SYSTEM_PROMPT = `
You are an expert in Sesam DTL testing.
Given a Sesam pipe config, generate realistic test data:
- "input.json": an array of 2–3 sample input entities matching the pipe's source schema
- "expected.json": the expected output entities after all DTL transforms have been applied

Output format:
### input.json
\`\`\`json
[...array of input entities...]
\`\`\`

### expected.json
\`\`\`json
[...array of expected output entities...]
\`\`\`

Then briefly explain what scenario is being tested.

${DTL_REFERENCE}
`.trim();

const CLI_SYSTEM_PROMPT = `
You are a sesam-py CLI expert.
${CLI_KNOWLEDGE}

Answer the user's question with the exact command syntax, relevant flags, and a short example.
If the user asks about a workflow, show the sequence of commands with brief explanations.
`.trim();

const DEFAULT_SYSTEM_PROMPT = `
You are an expert in the Sesam integration platform, DTL (Data Transformation Language), and sesam-py.
Answer questions about DTL functions, pipe configurations, system configurations, and best practices.
Be concise and practical. Include short code examples when helpful.

${DTL_REFERENCE}
`.trim();

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

type Intent = "generate" | "explain" | "test" | "cli" | "default";

const detectIntent = (prompt: string, command: string | undefined): Intent => {
  if (command === "generate") {
    return "generate";
  }

  if (command === "explain") {
    return "explain";
  }

  if (command === "test") {
    return "test";
  }

  if (command === "cli") {
    return "cli";
  }

  const lower = prompt.toLowerCase();

  if (/\b(generate|create|new pipe|write a pipe|build a pipe)\b/.test(lower)) {
    return "generate";
  }

  if (/\b(explain|what does|how does|describe|what is this)\b/.test(lower)) {
    return "explain";
  }

  if (/\b(test|write test|generate test|create test|sample data)\b/.test(lower)) {
    return "test";
  }

  if (/\b(sesam-py|sesam upload|sesam download|sesam run|sesam wipe|cli command)\b/.test(lower)) {
    return "cli";
  }

  return "default";
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getActiveFileContent = async (): Promise<
  { content: string; filename: string; uri: vscode.Uri } | undefined
> => {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return undefined;
  }

  return {
    content: editor.document.getText(),
    filename: path.basename(editor.document.fileName),
    uri: editor.document.uri,
  };
};

const extractReferencedContent = async (
  references: readonly vscode.ChatPromptReference[],
): Promise<string | undefined> => {
  for (const ref of references) {
    if (ref.value instanceof vscode.Uri) {
      const bytes = await vscode.workspace.fs.readFile(ref.value);
      return Buffer.from(bytes).toString("utf8");
    }

    if (ref.value instanceof vscode.Location) {
      const doc = await vscode.workspace.openTextDocument(ref.value.uri);
      return doc.getText(ref.value.range);
    }
  }

  return undefined;
};

const extractFirstCodeBlock = (text: string): string | undefined => {
  const match = text.match(/```(?:json)?\n([\s\S]*?)```/);
  return match?.[1]?.trim();
};

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

const handleGeneratePipe = async (
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  client: LanguageClient,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> => {
  const description = request.prompt.trim();

  if (description.length < 5) {
    stream.markdown(
      "Please describe the pipe you want to generate. For example:\n\n" +
        '`@sesam /generate a pipe that reads from a REST system "hr-api" and maps employeeId to _T.id`',
    );
    return {};
  }

  stream.progress("Generating pipe config…");

  // Explicitly pass only the description — do not forward request.references so that
  // any implicitly injected workspace context (Agent mode) cannot misdirect the model.
  const messages = [
    vscode.LanguageModelChatMessage.User(GENERATE_PIPE_SYSTEM_PROMPT),
    vscode.LanguageModelChatMessage.User(`Generate a new pipe: ${description}`),
  ];

  const response = await request.model.sendRequest(messages, {}, token);
  let full = "";

  for await (const chunk of response.text) {
    if (token.isCancellationRequested) {
      break;
    }

    full += chunk;
    stream.markdown(chunk);
  }

  // Lint the generated JSON if a code block was found
  const generated = extractFirstCodeBlock(full);

  if (generated) {
    // Extract _id for the suggested filename
    let pipeId = "generated-pipe";

    try {
      const parsed = JSON.parse(generated) as Record<string, unknown>;

      if (typeof parsed._id === "string") {
        pipeId = parsed._id;
      }
    } catch {
      // ignore — use default
    }

    const suggestedName = `${pipeId}.conf.json`;

    try {
      const lintRequest: LintContentRequest = { content: generated };
      const lintResult = await client.sendRequest<LintContentResponse>(
        "sesam/lintContent",
        lintRequest,
      );

      const errorCount = lintResult.diagnostics.filter((d) => d.severity === 1).length;
      const warnCount = lintResult.diagnostics.filter((d) => d.severity === 2).length;

      if (lintResult.diagnostics.length > 0) {
        stream.markdown(
          `\n\n> **Lint result**: ${errorCount} error(s), ${warnCount} warning(s) in the generated config. Review before saving.`,
        );
      } else {
        stream.markdown(`\n\n> **Lint result**: No issues found ✓`);
      }
    } catch {
      // Lint unavailable — don't block the response
    }

    stream.button({
      command: "sesam.saveGeneratedPipe",
      title: `$(save) Save as ${suggestedName}`,
      arguments: [generated, suggestedName],
    });
  }

  return {};
};

const handleExplain = async (
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> => {
  stream.progress("Analysing transform…");

  const refContent = await extractReferencedContent(request.references);
  const activeFile = refContent === undefined ? await getActiveFileContent() : undefined;
  const pipeContent = refContent ?? activeFile?.content;

  let userMessage = request.prompt;

  if (pipeContent) {
    userMessage = `${request.prompt}\n\nPipe config:\n\`\`\`json\n${pipeContent}\n\`\`\``;
  }

  const messages = [
    vscode.LanguageModelChatMessage.User(EXPLAIN_SYSTEM_PROMPT),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  const response = await request.model.sendRequest(messages, {}, token);

  for await (const chunk of response.text) {
    if (token.isCancellationRequested) {
      break;
    }

    stream.markdown(chunk);
  }

  if (activeFile) {
    stream.reference(activeFile.uri);
  }

  return {};
};

const handleGenerateTest = async (
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> => {
  stream.progress("Generating test data…");

  const refContent = await extractReferencedContent(request.references);
  const activeFile = refContent === undefined ? await getActiveFileContent() : undefined;
  const pipeContent = refContent ?? activeFile?.content;

  if (!pipeContent) {
    stream.markdown(
      "No pipe config found. Open a pipe config file in the editor or drag it into the chat, then try again.",
    );
    return {};
  }

  // Extract pipe _id for suggested file names
  let pipeId = "pipe";

  try {
    const parsed = JSON.parse(pipeContent) as Record<string, unknown>;

    if (typeof parsed._id === "string") {
      pipeId = parsed._id;
    }
  } catch {
    // ignore — use default pipeId
  }

  const userMessage = [
    request.prompt || "Generate test data for this pipe.",
    `\nPipe config:\n\`\`\`json\n${pipeContent}\n\`\`\``,
    `\nSuggest file names: testdata/${pipeId}-input.json and testdata/${pipeId}-expected.json`,
  ].join("\n");

  const messages = [
    vscode.LanguageModelChatMessage.User(GENERATE_TEST_SYSTEM_PROMPT),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  const response = await request.model.sendRequest(messages, {}, token);

  for await (const chunk of response.text) {
    if (token.isCancellationRequested) {
      break;
    }

    stream.markdown(chunk);
  }

  if (activeFile) {
    stream.reference(activeFile.uri);
  }

  return {};
};

const handleCliGuidance = async (
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> => {
  stream.progress("Looking up sesam-py commands…");

  const messages = [
    vscode.LanguageModelChatMessage.User(CLI_SYSTEM_PROMPT),
    vscode.LanguageModelChatMessage.User(request.prompt),
  ];

  const response = await request.model.sendRequest(messages, {}, token);

  for await (const chunk of response.text) {
    if (token.isCancellationRequested) {
      break;
    }

    stream.markdown(chunk);
  }

  return {};
};

const handleDefaultQA = async (
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> => {
  const refContent = await extractReferencedContent(request.references);
  const activeFile = refContent === undefined ? await getActiveFileContent() : undefined;
  const contextContent = refContent ?? activeFile?.content;

  let userMessage = request.prompt;

  if (contextContent) {
    userMessage = `${request.prompt}\n\nConfig context:\n\`\`\`json\n${contextContent}\n\`\`\``;
  }

  const messages = [
    vscode.LanguageModelChatMessage.User(DEFAULT_SYSTEM_PROMPT),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  const response = await request.model.sendRequest(messages, {}, token);

  for await (const chunk of response.text) {
    if (token.isCancellationRequested) {
      break;
    }

    stream.markdown(chunk);
  }

  if (activeFile) {
    stream.reference(activeFile.uri);
  }

  return {};
};

// ---------------------------------------------------------------------------
// Main handler + registration
// ---------------------------------------------------------------------------

const makeHandler =
  (client: LanguageClient) =>
  async (
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> => {
    const intent = detectIntent(request.prompt, request.command);

    switch (intent) {
      case "generate":
        return handleGeneratePipe(request, stream, client, token);
      case "explain":
        return handleExplain(request, stream, token);
      case "test":
        return handleGenerateTest(request, stream, token);
      case "cli":
        return handleCliGuidance(request, stream, token);
      default:
        return handleDefaultQA(request, stream, token);
    }
  };

export const registerSesamChatParticipant = (
  context: vscode.ExtensionContext,
  client: LanguageClient,
): void => {
  if (!vscode.chat?.createChatParticipant) {
    console.warn(
      "[sesam] vscode.chat.createChatParticipant not available — skipping @sesam participant.",
    );
    return;
  }

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, makeHandler(client));
  participant.iconPath = new vscode.ThemeIcon("circuit-board");
  context.subscriptions.push(participant);
};
