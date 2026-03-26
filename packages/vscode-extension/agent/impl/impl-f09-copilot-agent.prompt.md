# F09: Copilot Agent Participant (@sesam)

> **Status**: `planned`
> **Rollout Phase**: Phase 4 - AI & Visual Polish
> **Depends on**: [F20 — Language Model Tools API](impl-f20-lm-tools-api.prompt.md) (`planned`)
> **Tracking**: [README.md](README.md)

---

## Summary

Register a VS Code Chat Participant (`@sesam`) that understands Sesam DTL, pipe configuration, and
sesam-py. Users can ask questions like `@sesam generate a pipe that fetches from REST and maps to CRM`,
`@sesam explain this transform`, or `@sesam write a test for this pipe` directly in the Copilot Chat panel.

---

## VS Code Chat Participant API Key Points

- API: `vscode.chat.createChatParticipant('sesam', handler)`
- Participant appears in Copilot Chat with `@sesam` mention
- Can use `vscode.LanguageModelTool` for structured tool calls (VS Code 1.90+)
- `ChatResponseStream` used to stream Markdown responses, attach file references, and open commands

---

## Implementation Phases

### Phase A: Basic @sesam Participant Registration

1. Create `client/src/sesamChatParticipant.ts`.
2. Register participant on activation:
   ```ts
   const participant = vscode.chat.createChatParticipant('sesam.agent', handleRequest);
   participant.iconPath = new vscode.ThemeIcon('circuit-board');
   ```
3. Add an intent router inside `handleRequest`:
   - Detect keywords `generate`, `create`, `new pipe` -> `handleGeneratePipe`
   - Detect keywords `explain`, `what does` -> `handleExplain`
   - Detect keywords `test`, `write test` -> `handleGenerateTest`
   - Detect keywords `run`, `upload`, `download`, `sesam-py` -> `handleCliGuidance`
   - Fallback: general DTL Q&A with RAG over `dtl-registry.ts` data
4. Add `package.json` contribution:
   ```jsonc
   "contributes": {
     "chatParticipants": [{
       "id": "sesam.agent",
       "name": "sesam",
       "description": "Sesam DTL and sesam-py expert"
     }]
   }
   ```

### Phase B: Generate Pipe Intent

1. Build a system prompt that includes:
   - DTL function reference (from `src/shared/dtl-registry.ts`)
   - Template of a valid Sesam pipe JSON structure
   - Examples of source, transform, and sink configs
2. On user request, send the system prompt + user message to the language model
   (`vscode.lm.selectChatModels(...)`).
3. Stream the generated pipe JSON as a fenced code block in the chat response.
4. Attach an "Insert into new file" button via `ChatResponseCommand`:
   - Creates `<inferred-name>.conf.json` in the workspace.

### Phase C: Explain Transform Intent

1. If the user has an active editor with a DTL file, inject the current file content into the prompt.
2. If `@sesam explain` is invoked without active editor, ask the user to share the transform.
3. Add `@sesam` as a CodeLens action on transform arrays: "Explain with @sesam" -> opens chat
   with the current pipe pre-pasted.

### Phase D: Generate Test Intent

1. Accept a pipe name or active file as context.
2. Generate:
   - `<pipe-name>.test.json` with realistic sample input entities
   - `expected/<pipe-name>.json` with the expected transformation output
3. Offer to write both files directly via "Save test files" button in the chat response.

### Phase E: CLI Guidance Intent

1. For questions about sesam-py commands, answer from a built-in knowledge base
   derived from the sesam-py README (stored as a `rag-sesam-py.ts` const or embedded JSON).
2. Show command syntax, flags, and examples in the chat response.
3. Optionally append a "Run this command" button that triggers `sesam.runCommand` (F01).

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | `chatParticipants` contribution, activation event `onLanguageModelTool` |
| `client/src/extension.ts` | Register participant on activation |
| `client/src/sesamChatParticipant.ts` (new) | Full participant implementation |
| `client/src/ragSesamPy.ts` (new) | Embedded sesam-py knowledge base for CLI guidance |
| `src/shared/dtl-registry.ts` | Ensure all DTL functions are exported for use in system prompt |

---

## Dependencies

- VS Code 1.90+ (Chat Participant API + Language Model API)
- **F02** - DTL registry as RAG source
- **F01** - "Run command" actions delegate to sesam commands (F01)
- GitHub Copilot extension must be installed (API provided by Copilot)
