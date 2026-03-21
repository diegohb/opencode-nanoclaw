# OpenCode SDK Deep Dive

NanoClaw alternative to Claude Agent SDK, using `@opencode-ai/sdk` (v1.2.27). OpenCode SDK provides a modern, streaming-first API with built-in session management, MCP server support, and multi-provider compatibility.

## Architecture Overview

### Key Differences from Claude Agent SDK

| Aspect               | Claude Agent SDK                                | OpenCode SDK                                 |
| -------------------- | ----------------------------------------------- | -------------------------------------------- |
| **Runtime**          | Spawns CLI subprocess via stdin/stdout          | HTTP/REST + SSE streaming                    |
| **Session Model**    | V1: one-shot `query()`, V2: persistent sessions | Persistent sessions always                   |
| **Tool System**      | Built-in tools only                             | Built-in + MCP servers                       |
| **Streaming**        | Async generator over JSON-lines                 | Server-Sent Events (SSE)                     |
| **Configuration**    | Programmatic options only                       | Config file (opencode.json) + env vars       |
| **Model Support**    | Anthropic only                                  | Multi-provider (Anthropic, OpenRouter, etc.) |
| **Permission Model** | `canUseTool` callback                           | Config-based permissions                     |

### Architecture

```
NanoClaw (Orchestrator)
  └── container-runner (spawns container)
        └── opencode-runner (Node.js)
              ├── createOpencode() → SDK server (HTTP)
              ├── client.session.prompt() → HTTP POST /session/{id}/prompt
              └── client.event.subscribe() → SSE stream
```

OpenCode SDK runs an HTTP server locally. Client communicates via REST API for commands and SSE for real-time events. Configuration loaded from `opencode.json`, API keys via environment variables.

## Core APIs

### 1. `createOpencode()` - Initialization

Creates the SDK server and client.

```typescript
import { createOpencode } from '@opencode-ai/sdk';

const { client, server } = await createOpencode({
  hostname: '127.0.0.1',
  port: 4096,
  signal?: AbortSignal,
  timeout?: number,
  config?: Config
});

// client: OpencodeClient - SDK client
// server: { url: string; close(): void } - Server control
```

**Options:**

- `hostname`: Server bind address (default: random local port)
- `port`: Server port (default: random available)
- `signal`: AbortSignal for graceful shutdown
- `config`: Initial config object (overrides opencode.json)

---

### 2. `client.session.prompt()` - Send Message

Send a prompt to a session and wait for the complete response.

```typescript
const response = await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: 'text', text: 'Your message here' }],
  },
});

if (response.error) {
  console.error('Error:', response.error);
} else {
  const text = extractText(response.data?.parts);
}
```

**Request:**

```typescript
{ path: { id: string }, body: { parts: Array<{ type, text?, url? }> } }
```

**Behavior:**

- Blocking call - waits for complete assistant response
- Returns full message in `response.data.parts`
- Use `client.event.subscribe()` concurrently for streaming

---

### 3. `client.event.subscribe()` - Event Stream

Subscribe to real-time Server-Sent Events (SSE).

```typescript
const { stream } = await client.event.subscribe();

for await (const event of stream) {
  if (event.type === 'message.part.updated') {
    const part = event.properties?.part;
    if (part?.type === 'text' && part.text) {
      console.log('Streaming text:', part.text); // Full accumulated text
    }
  }
}
```

**Key Event Types:**

- `message.updated`: Full message update
- `message.part.updated`: Streaming part update (full text, not delta)
- `message.removed`: Message deleted

## Configuration

### Config File (`opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-20250514",
  "small_model": "anthropic/claude-haiku-4-20250514",
  "permission": {
    "edit": "allow",
    "bash": "allow",
    "webfetch": "allow"
  },
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["node", "/path/to/server.js"],
      "environment": { "API_KEY": "..." }
    }
  },
  "instructions": ["AGENTS.md"]
}
```

### Model Selection

Models: `provider/modelID` (e.g., `anthropic/claude-sonnet-4-20250514`)

**Auto-detection:**

- `ANTHROPIC_API_KEY` → Anthropic provider
- `OPENROUTER_API_KEY` → OpenRouter provider
- Default: `opencode/kimi-k2.5-free`

**API keys via env vars:** `export ANTHROPIC_API_KEY="sk-ant-..."`

### Permission System

```typescript
type Permission = 'ask' | 'allow' | 'deny';

interface Permissions {
  edit?: Permission; // File edits
  bash?:
    | Permission
    | {
        // Bash commands
        [command: string]: Permission;
      };
  webfetch?: Permission;
}
```

- `allow`: Auto-approve
- `deny`: Block
- `ask`: Prompt user (TUI mode only)

## Session Management

### Create Session

```typescript
const { data } = await client.session.create({
  body: { title: 'My Session' },
});
const sessionId = data.id;
```

### Resume Session

```typescript
const check = await client.session.get({ path: { id: sessionId } });

if (check.error) {
  // Create new
  const created = await client.session.create({ body: { title: 'New' } });
  sessionId = created.data.id;
} else {
  // Reuse existing
  sessionId = check.data.id;
}
```

**NanoClaw Pattern:** Store `sessionId` in group metadata for reuse.

### Session Persistence

Sessions persist to `XDG_STATE_HOME` (default: `~/.local/state/opencode`).

**NanoClaw Configuration:**

```typescript
process.env.XDG_STATE_HOME = '/workspace/opencode-state';
process.env.OPENCODE_PROJECT = '/workspace/group';
```

### Session Operations

| Method                   | Purpose                         |
| ------------------------ | ------------------------------- |
| `create({ body })`       | Create new session              |
| `get({ path })`          | Get session details             |
| `list()`                 | List all sessions               |
| `update({ path, body })` | Update title, metadata          |
| `delete({ path })`       | Delete session + data           |
| `abort({ path })`        | Abort running session           |
| `fork({ path })`         | Fork at specific message        |
| `prompt({ path, body })` | Send message, wait for response |
| `messages({ path })`     | List messages                   |
| `diff({ path })`         | Get file diffs                  |

## Tool System

### Built-in Tools

OpenCode provides comprehensive tools (auto-discovered via `client.tool.ids()`):

- **File:** Read, write, search, diff
- **Bash:** Execute shell commands
- **WebFetch:** Fetch and parse web content
- **LSP:** Language server diagnostics
- **Project:** List files, analyze structure

### MCP Servers

Model Context Protocol (MCP) servers extend tool capabilities:

```json
{
  "mcp": {
    "custom-tools": {
      "type": "local",
      "command": ["node", "/path/to/server.js"],
      "environment": { "API_KEY": "..." }
    }
  }
}
```

**NanoClaw IPC Server:**

```json
{
  "mcp": {
    "nanoclaw": {
      "type": "local",
      "command": ["node", "/tmp/dist/ipc-mcp-stdio.js"],
      "environment": {
        "NANOCLAW_CHAT_JID": "...",
        "NANOCLAW_GROUP_FOLDER": "..."
      }
    }
  }
}
```

### Tool Permissions

Tool usage controlled via `permission` config. No runtime callbacks.

**Example:**

```json
{
  "permission": {
    "bash": { "rm": "deny", "git": "allow" },
    "edit": "ask"
  }
}
```

## Event System

### Subscription Pattern

```typescript
const { stream } = await client.event.subscribe();

try {
  for await (const event of stream) {
    switch (event.type) {
      case 'message.part.updated':
        const part = event.properties?.part;
        if (part?.type === 'text' && part.text) {
          console.log('Streaming:', part.text);
        }
        break;
      case 'message.updated':
        console.log('Message complete');
        break;
    }
  }
} catch {
  // Stream ended
}

// Cleanup: await stream.return(undefined as never).catch(() => {});
```

**Key Behavior:**

- Each `message.part.updated` carries full accumulated text (not deltas)
- Use as fallback when `session.prompt()` response is empty
- Stream continues until `return()` called or server closes

## Code Examples

### Basic Usage

```typescript
import { createOpencode } from '@opencode-ai/sdk';

const { client, server } = await createOpencode();

// Create session
const { data: session } = await client.session.create({
  body: { title: 'test' },
});

// Send prompt
const { data: response } = await client.session.prompt({
  path: { id: session.id },
  body: { parts: [{ type: 'text', text: 'Hello!' }] },
});

console.log(extractText(response.parts));

server.close();
```

### NanoClaw Integration Pattern

```typescript
const { client, server } = await createOpencode({
  hostname: '127.0.0.1',
  port: 4096,
  config: { model: 'anthropic/claude-sonnet-4' },
});

// Resume or create session
let sessionId: string;
const check = await client.session.get({ path: { id: storedSessionId } });
sessionId = check.error
  ? (await client.session.create({ body: { title: 'nanoclaw' } })).data.id
  : storedSessionId;

// Event stream for fallback text
const { stream } = await client.event.subscribe();
let lastText = '';
(async () => {
  for await (const event of stream) {
    if (event.type === 'message.part.updated') {
      const part = event.properties?.part;
      if (part?.type === 'text' && part.text) lastText = part.text;
    }
  }
})();

// Query loop
while (true) {
  const response = await client.session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: 'text', text: userMessage }] },
  });

  const text = extractText(response.data?.parts) || lastText;
  console.log('Response:', text);
}

server.close();
```

### Helper: Extract Text

```typescript
function extractText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
    .join('');
}
```

### Error Handling

```typescript
const response = await client.session.prompt({
  path: { id: sessionId },
  body: { parts: [{ type: 'text', text: 'Hello' }] },
});

if (response.error) {
  console.error('Prompt failed:', response.error);
  // Handle error: retry, create new session, etc.
} else {
  console.log('Success:', extractText(response.data?.parts));
}
```

## API Reference

### Main Client

```typescript
interface OpencodeClient {
  session: SessionAPI;
  event: EventAPI;
  config: ConfigAPI;
  tool: ToolAPI;
  project: ProjectAPI;
  instance: InstanceAPI;
}
```

### Session API

```typescript
interface SessionAPI {
  create(options: Options): Promise<RequestResult<Session, Error>>;
  get(options: Options): Promise<RequestResult<Session, Error>>;
  list(): Promise<RequestResult<Session[], never>>;
  update(options: Options): Promise<RequestResult<Session, Error>>;
  delete(options: Options): Promise<RequestResult<boolean, Error>>;
  abort(options: Options): Promise<RequestResult<boolean, Error>>;
  prompt(options: Options): Promise<RequestResult<PromptResponse, Error>>;
  messages(options: Options): Promise<RequestResult<Message[], Error>>;
  fork(options: Options): Promise<RequestResult<Session, never>>;
  diff(options: Options): Promise<RequestResult<FileDiff[], Error>>;
}
```

### Event API

```typescript
interface EventAPI {
  subscribe(): Promise<{ stream: AsyncIterable<Event> }>;
}
```

### Config API

```typescript
interface ConfigAPI {
  get(): Promise<RequestResult<Config, never>>;
  update(): Promise<RequestResult<Config, Error>>;
  providers(): Promise<RequestResult<Provider[], never>>;
}
```

### Tool API

```typescript
interface ToolAPI {
  ids(): Promise<RequestResult<string[], Error>>;
  list(options: Options): Promise<RequestResult<Tool[], Error>>;
}
```

### RequestResult

```typescript
interface RequestResult<TData, TError> {
  data?: TData;
  error?: TError;
  response?: Response;
}
```

### Message & Part Types

```typescript
interface Message {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  time: { created: number; completed?: number };
  agent: string;
  model: { providerID: string; modelID: string };
}

interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'text';
  text: string;
}

interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'tool';
  callID: string;
  tool: string;
  state: ToolState;
}
```

### Tool State

```typescript
type ToolState =
  | { status: 'pending'; input: Record<string, unknown> }
  | { status: 'running'; input: Record<string, unknown>; title?: string }
  | {
      status: 'completed';
      input: Record<string, unknown>;
      output: string;
      title: string;
    }
  | { status: 'error'; input: Record<string, unknown>; error: string };
```

## Migration: Claude SDK → OpenCode SDK

| Claude SDK                     | OpenCode SDK                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| `query({ prompt, ... })`       | `createOpencode()` + `session.create()` + `session.prompt()` |
| AsyncGenerator of `SDKMessage` | `event.subscribe()` SSE stream + `prompt()` response         |
| `continue: true`               | Resume session via `session.get()`                           |
| `permissionMode: 'allow'`      | Config `{ permission: { edit: 'allow', bash: 'allow' } }`    |
| `mcpServers`                   | Config `{ mcp: { ... } }`                                    |
| `systemPrompt`                 | Config `instructions` + AGENTS.md                            |
| Fork via `forkSession: true`   | `session.fork()` API                                         |

## Key Differences Summary

1. **No subprocess spawning** - HTTP server instead of CLI
2. **Config-first** - opencode.json vs programmatic options
3. **Multi-provider** - Not Anthropic-only
4. **SSE streaming** - Server-Sent Events vs JSON-lines
5. **No canUseTool callback** - Config-based permissions
6. **Built-in session persistence** - No manual resume handling
7. **MCP servers** - First-class tool extension mechanism
