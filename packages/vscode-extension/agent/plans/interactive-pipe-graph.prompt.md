# F15: Interactive Pipe Graph with Navigation

> **Status**: `planned`
> **Rollout Phase**: Phase 2
> **Tracking**: [README.md](../impl/README.md)
> **Depends on**: [F14 — Cross-file Navigation](cross-file-navigation.prompt.md) (workspace index)
> **Supersedes**: [F07 — Pipe Graph Enhancements](../impl/impl-f07-pipe-graph.prompt.md) (Phase A)

---

## Summary

Replace the sidebar tree view with an interactive `vis-network` pipe graph in a VS Code webview
panel. Nodes represent pipes and systems; edges represent data flow (source/sink) and lookups
(hops). Clicking a node opens the pipe/system config file. The graph auto-updates when files
change.

This is the VS Code equivalent of the Management Studio's pipe graph canvas — the same dark
background, circular icon nodes, solid/dashed edges, and click-to-navigate behaviour, adapted
for local development without a running Sesam node.

---

## Motivation

The current `PipeGraphProvider` sidebar shows a flat alphabetical list of pipes with hop datasets
as children. This is functional but lacks visual context — you can't see the full upstream →
downstream flow at a glance. Management Studio users rely on the interactive graph for
understanding pipe relationships:

```
hubspot-company-collect ──→ hubspot-company-enrich ──→ global-organisation
                               ↑ (hops)                  ──→ global-organisation-no-us…
                        hubspot-company-insert-share-rest ──→ hubspot-company-classification
```

A visual graph in VS Code reproduces this mental model for local development.

---

## Architecture

### Component overview

```
┌─────────────────────────────────────────────────────┐
│  VS Code Extension Host                             │
│                                                     │
│  PipeGraphPanel (client/src/graph/)                  │
│  ├── Creates WebviewPanel                           │
│  ├── Reads pipe/system files (workspace scan)       │
│  ├── Builds graph data: nodes[] + edges[]           │
│  └── Sends graph data to webview via postMessage    │
│                                                     │
│  ↕ postMessage protocol                             │
│                                                     │
│  Webview (client/src/graph/webview/)                 │
│  ├── graph.html — container + styles                │
│  ├── graph.ts — vis-network init + event handlers   │
│  └── icons.ts — SVG icon generators for node types  │
└─────────────────────────────────────────────────────┘
```

### Data flow

```
1. User runs "Sesam: Open Pipe Graph" command (or clicks sidebar button)
2. PipeGraphPanel scans workspace (reuses PipeGraphProvider scan logic)
3. Builds { nodes, edges } from pipe/system configs:
   - Source dataset refs → solid edge from upstream pipe
   - Hops dataset refs → dashed edge from lookup pipe
   - System refs → edge to/from system node
4. Sends { type: "setGraph", nodes, edges } to webview
5. Webview initialises vis-network with the data
6. User clicks a node → webview sends { type: "openFile", id, kind }
7. Extension host opens the corresponding file via vscode.commands
```

### How the webconsole does it

The Management Studio uses **vis-network ^9.1.9** with:
- `circularImage` node shape (SVG icons rendered to data URLs)
- Manual horizontal linear layout (`x = index * STEP_X`, `fixed.x = true`, physics disabled)
- Dashed edges for lookups (`dashes: true`)
- Click handler: `network.on('click')` → reads `node.meta.type` + `node.meta.ownId` → navigates
- Edge labels show queue sizes (not applicable locally)
- Node colours driven by runtime state (not applicable locally — use static colours)

Key difference: the webconsole shows a **single pipe's flow** (one upstream → pipe → downstream).
Our graph shows the **full workspace** — all pipes and their interconnections.

---

## Implementation Steps

### Phase A — Graph Data Model

#### Step 1: Create `graph-data.ts`

**File**: `client/src/graph/graph-data.ts`

Pure functions to transform pipe/system configs into graph data.

**Types:**

```ts
interface GraphNode {
  id: string;
  label: string;
  kind: "pipe" | "system";
  fileUri: string; // file:// URI for navigation
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  dashes: boolean; // true for hops, false for source/sink
  label?: string;  // optional annotation
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

**Functions:**

##### `buildGraphData(pipes: PipeInfo[]): GraphData`

1. Create a `GraphNode` for each pipe/system from `PipeInfo[]`
2. For each pipe, extract upstream relationships:
   - **Source dataset** (`source.dataset`) → solid edge from the upstream pipe (if it exists
     in the workspace) to this pipe
   - **Hops datasets** (from `collectHopDatasets`) → dashed edge from the lookup pipe to this pipe
   - **System references** (`source.system`, `sink.system`) → edge between pipe and system node
3. Deduplicate edges by `from+to+dashes`
4. Return `{ nodes, edges }`

##### `buildSubgraph(pipeId: string, pipes: PipeInfo[], depth: number): GraphData`

Build a focused subgraph centred on a single pipe, expanding `depth` levels upstream and
downstream. Used for the "Show graph for this pipe" command.

1. Start with `pipeId`
2. BFS outward: find upstream pipes (by source.dataset), downstream pipes (by who uses this
   pipe's `_id` as source.dataset), and hop connections
3. Stop at `depth` levels (default: 2)
4. Return filtered `GraphData` containing only reachable nodes/edges

#### Step 2: Extend `PipeInfo` with source/system extraction

**File**: `client/src/graph/PipeGraphProvider.ts`

The existing `extractPipeInfo` extracts `_id`, `type`, `hopDatasets`, `ruleNames`. Extend it:

```ts
interface PipeInfo {
  id: string;
  fileUri: vscode.Uri;
  kind: "pipe" | "system";
  hopDatasets: string[];
  ruleNames: string[];
  // NEW:
  sourceDatasets: string[];    // from source.dataset or source.datasets
  sourceSystem: string | null; // from source.system
  sinkSystem: string | null;   // from sink.system
}
```

Add extraction logic for `source.dataset`/`source.datasets` (handles merge/union sources)
and `source.system`/`sink.system`.

---

### Phase B — Webview Panel

#### Step 3: Create `PipeGraphPanel.ts`

**File**: `client/src/graph/PipeGraphPanel.ts`

VS Code WebviewPanel following the same pattern as `PreviewPanel.ts`:

```ts
class PipeGraphPanel {
  static currentPanel: PipeGraphPanel | undefined;
  private static readonly viewType = "sesamPipeGraph";

  static createOrShow(extensionUri: vscode.Uri, focusPipeId?: string): void
  private constructor(panel, extensionUri)
  
  refresh(): void           // Re-scan workspace, rebuild graph, send to webview
  focusOnPipe(pipeId: string): void  // Zoom/center on a specific node
  
  private _buildHtml(): string  // Webview HTML with vis-network bundle
  private _handleMessage(msg): void  // Handle openFile, nodeHover, etc.
}
```

**Webview panel options:**
- `enableScripts: true`
- `retainContextWhenHidden: true`
- `localResourceRoots: [extensionUri/dist/graph]` (bundled vis-network)

**Message protocol:**

| Direction | Type | Payload | Action |
|---|---|---|---|
| Host → Webview | `setGraph` | `{ nodes: GraphNode[], edges: GraphEdge[] }` | Render graph |
| Host → Webview | `focusNode` | `{ nodeId: string }` | Centre + highlight node |
| Host → Webview | `setTheme` | `{ kind: "dark" \| "light" }` | Switch colours |
| Webview → Host | `openFile` | `{ id: string, kind: "pipe" \| "system" }` | Open config file |
| Webview → Host | `showGraphFor` | `{ id: string }` | Rebuild subgraph around node |

#### Step 4: Register command and watcher

**File**: `client/src/extension.ts`

- Register `dtl.openPipeGraph` command → `PipeGraphPanel.createOrShow()`
- Register `dtl.showGraphForPipe` command → opens graph focused on active file's `_id`
- Wire file watchers to call `PipeGraphPanel.currentPanel?.refresh()`

---

### Phase C — Webview Rendering (vis-network)

#### Step 5: Add vis-network dependency

```bash
pnpm add vis-network vis-data
```

Bundle into the webview via a separate Vite config entry or inline the ESM module.

#### Step 6: Create webview source files

**Directory**: `client/src/graph/webview/`

##### `graph.html`

Container HTML with:
- Full-viewport `<div id="graph-container">` for vis-network canvas
- Toolbar: search input, layout toggle, zoom controls, "Show full graph" / "Show focused" toggle
- Status bar: node count, edge count
- VS Code CSS variable theming (dark/light auto-detection via `document.body.dataset.vscodeThemeKind`)

##### `graph.ts`

Main webview script:

```ts
const vscode = acquireVsCodeApi();
let network: Network;

// Listen for messages from extension host
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "setGraph":
      renderGraph(msg.nodes, msg.edges);
      break;
    case "focusNode":
      network.focus(msg.nodeId, { scale: 1.2, animation: true });
      network.selectNodes([msg.nodeId]);
      break;
  }
});

function renderGraph(nodes: GraphNode[], edges: GraphEdge[]) {
  const visNodes = nodes.map(n => ({
    id: n.id,
    label: n.label,
    shape: "circularImage",
    image: getIconDataUrl(n.kind),
    size: 30,
    color: getNodeColor(n.kind),
    font: { color: "#d0d0d0", size: 12, face: "monospace" },
  }));

  const visEdges = edges.map(e => ({
    id: e.id,
    from: e.from,
    to: e.to,
    dashes: e.dashes,
    arrows: { to: { enabled: true } },
    width: 2,
    color: { color: e.dashes ? "#ff6b6b88" : "#ff6b6b", highlight: "#ff8888" },
    smooth: { type: "cubicBezier", forceDirection: "horizontal" },
    label: e.label,
    font: { color: "#888", size: 10 },
  }));

  const data = { nodes: new DataSet(visNodes), edges: new DataSet(visEdges) };

  const options = {
    layout: {
      hierarchical: {
        enabled: true,
        direction: "LR",           // left-to-right (matches webconsole flow)
        sortMethod: "directed",
        levelSeparation: 250,
        nodeSpacing: 80,
      },
    },
    physics: { enabled: false },   // deterministic layout
    interaction: {
      hover: true,
      tooltipDelay: 200,
      navigationButtons: true,     // zoom/pan buttons
      keyboard: true,              // arrow keys to navigate
    },
    nodes: {
      borderWidth: 2,
      shapeProperties: { useBorderWithImage: true },
    },
  };

  network = new Network(container, data, options);

  // Click → open file
  network.on("click", (params) => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0];
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        vscode.postMessage({ type: "openFile", id: node.id, kind: node.kind });
      }
    }
  });

  // Double-click → show focused subgraph
  network.on("doubleClick", (params) => {
    if (params.nodes.length > 0) {
      vscode.postMessage({ type: "showGraphFor", id: params.nodes[0] });
    }
  });
}
```

##### `icons.ts`

SVG icon generators matching the webconsole style:

```ts
function pipeIcon(color: string): string {
  // Returns base64 data URL of pipe SVG icon (reel shape)
}
function systemIcon(color: string): string {
  // Returns base64 data URL of system SVG icon (gear/sun shape)
}
function getIconDataUrl(kind: "pipe" | "system"): string {
  return kind === "system" ? systemIcon("#ff6b6b") : pipeIcon("#ff6b6b");
}
```

#### Step 7: Create Vite config for webview bundle

**File**: `vite.config.graph.ts`

Separate Vite build for the webview:
- Entry: `client/src/graph/webview/graph.ts`
- Output: `dist/graph/graph.js`
- Bundles `vis-network` and `vis-data` into a single file
- Target: ES2020 (browser)
- No externals (everything bundled for webview sandbox)

Update `package.json` build script:
```json
"build": "vite build -c vite.config.client.ts && vite build -c vite.config.server.ts && vite build -c vite.config.graph.ts"
```

---

### Phase D — Styling and Theming

#### Step 8: Match Management Studio visual style

Node and edge styling to match the webconsole screenshot:

| Element | Style |
|---|---|
| Background | `#2d333b` (dark) / `#f7f8f8` (light) — from VS Code theme |
| Pipe node | Circular, red/coral border (`#ff6b6b`), pipe reel icon |
| System node | Circular, red/coral border, gear icon |
| Unresolved node | Grey border, dimmed icon |
| Source/sink edge | Solid, red/coral, arrow at target end |
| Hops edge | Dashed, lighter red, arrow at target end |
| Node label | Below node, monospace, `#d0d0d0` |
| Hover | Brighten node border, show tooltip with file path |
| Selected | Bold border, highlighted colour |

#### Step 9: Theme auto-detection

In webview, detect VS Code theme:

```ts
const isDark = document.body.dataset.vscodeThemeKind?.includes("dark");
```

Apply colour scheme accordingly. Listen for `colorThemeKind` changes.

---

### Phase E — Search, Filter, and Toolbar

#### Step 10: Search and highlight

- Text input in toolbar: type a pipe name → matching nodes glow, non-matching dim
- `network.selectNodes(matchingIds)` + `network.focus()` on first match
- Debounced input (300ms)

#### Step 11: Layout toggle

- Button to switch between:
  - **Hierarchical LR** (default — left-to-right directed flow)
  - **Hierarchical UD** (top-down)
  - **Force-directed** (organic clustering)
- `network.setOptions({ layout: { ... } })` on toggle

#### Step 12: Context actions

Right-click a node → VS Code-style context menu (via `postMessage`):
- "Open Config File" — opens the pipe/system file
- "Show Graph for This Pipe" — rebuilds focused subgraph
- "Copy Pipe ID" — copies `_id` to clipboard
- "Find All References" — triggers LSP Find All References on the pipe's `_id`

---

### Phase F — Integration with Existing Tree View

#### Step 13: Coordinate tree view and graph

- Clicking a pipe in the `PipeGraphProvider` tree view highlights it in the graph
  (if the graph panel is open)
- Selecting a node in the graph highlights it in the tree view
  (via `treeView.reveal()`)
- Both views share the same underlying `PipeInfo[]` data

#### Step 14: "Show in Graph" tree view action

Add a context menu item to `PipeTreeItem` in the tree view:
- Right-click a pipe → "Show in Graph" → opens/focuses graph panel, centres on that node

---

### Phase G — Tests

#### Step 15: Unit tests for graph data model

**File**: `tests/graph-data.test.ts`

**`buildGraphData`:**
- Three pipes: A → B → C (linear flow) → correct nodes and solid edges
- Pipe with hops → dashed edge to lookup pipe
- Pipe with system reference → system node + edge created
- Pipe referencing non-existent dataset → edge not created (no dangling edges)
- Self-referencing pipe → no self-loop edge

**`buildSubgraph`:**
- Centre pipe with depth 1 → includes only direct neighbours
- Centre pipe with depth 2 → includes neighbours of neighbours
- Pipe with no connections → single node, no edges

---

## Relevant Files

### Files to create

| File | Purpose |
|---|---|
| `client/src/graph/graph-data.ts` | Graph data model — builds nodes/edges from pipe configs |
| `client/src/graph/PipeGraphPanel.ts` | WebviewPanel for the interactive graph |
| `client/src/graph/webview/graph.html` | Webview HTML container + toolbar |
| `client/src/graph/webview/graph.ts` | Webview script — vis-network init + event handlers |
| `client/src/graph/webview/icons.ts` | SVG icon generators for pipe/system nodes |
| `vite.config.graph.ts` | Vite build config for webview bundle |
| `tests/graph-data.test.ts` | Unit tests for graph data building |

### Files to modify

| File | Changes |
|---|---|
| `client/src/graph/PipeGraphProvider.ts` | Extend `PipeInfo` with `sourceDatasets`, `sourceSystem`, `sinkSystem`; export `extractPipeInfo` and `collectHopDatasets` |
| `client/src/extension.ts` | Register `dtl.openPipeGraph`, `dtl.showGraphForPipe` commands; wire graph panel to file watchers |
| `package.json` | Add `vis-network`, `vis-data` dependencies; add commands; add build script |

### Files to reference

| File | Useful pattern |
|---|---|
| `client/src/preview/PreviewPanel.ts` | Webview creation, postMessage protocol, `_buildHtml()` |
| `client/src/graph/PipeGraphProvider.ts` | Workspace scanning, `extractPipeInfo`, `collectHopDatasets` |
| Webconsole `StaticGraph.jsx` | vis-network options, click handler, node rendering |
| Webconsole `Flow.jsx` | Node/edge data building from pipe configs |
| Webconsole `graph_icons.tsx` | SVG icon generation pattern |
| Webconsole `graph.ts` | `getComponentType`, `getNodeLabel`, colour logic |

---

## Verification

1. **Unit tests** — `pnpm test` passes `graph-data.test.ts`
2. **Open graph** — Run "Sesam: Open Pipe Graph" command → webview opens with all workspace
   pipes/systems as nodes
3. **Layout** — Nodes arranged left-to-right showing flow direction; source pipes on left,
   downstream pipes on right
4. **Edge types** — Source/sink connections are solid; hops/lookup connections are dashed
5. **Click navigation** — Click a node → corresponding config file opens in the editor
6. **Double-click focus** — Double-click a node → graph rebuilds showing only that pipe's
   neighbourhood (upstream + downstream)
7. **Search** — Type in search box → matching nodes highlight, view centres on first match
8. **Theme** — Graph background and colours adapt to VS Code dark/light theme
9. **File changes** — Create/modify/delete a pipe file → graph auto-refreshes
10. **Tree view integration** — Click pipe in tree → node highlights in graph; click node in
    graph → tree scrolls to pipe
11. **Existing features** — Tree view, preview panel, LSP features all still work

---

## Decisions

| Decision | Rationale |
|---|---|
| **vis-network** library | Same library as webconsole; proven for pipe graphs; `circularImage` node shape matches the existing visual language |
| **Hierarchical LR layout** (default) | Left-to-right flow matches the webconsole's linear layout and natural reading direction for data pipelines |
| **Physics disabled** | Deterministic layout — graph doesn't bounce or rearrange; matches webconsole behaviour |
| **Separate Vite build for webview** | Webview runs in an iframe sandbox — needs its own bundled JS with no Node.js dependencies |
| **Reuse `PipeInfo` from `PipeGraphProvider`** | Avoid duplicating workspace scan logic; extend the existing interface |
| **Keep tree view alongside graph** | Tree view is better for quick alphabetical lookup; graph is better for understanding relationships. Serve different use cases |
| **Click = open file, Double-click = focused subgraph** | Single interaction model; avoids button overload |

## Future considerations

- **Live status overlay** — When F03 credentials are configured, poll the Sesam node and
  overlay running/failed/stopped badges on nodes (Phase C of F07)
- **Edge queue labels** — When connected to a node, show entity queue sizes on edges
  (matches webconsole behaviour)
- **Minimap** — For very large workspaces, add a minimap in the corner
- **Export** — "Export as PNG/SVG" button for documentation
- **Diff highlighting** — When F06 status/diff is implemented, highlight modified pipes in
  the graph with a special border colour
