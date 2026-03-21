# MS Teams Integration — Implementation Handoff

## Orchestration Model

**You are the lead agent.** Delegate all implementation work to subagents. Your job is to:

1. Read this document fully before starting
2. Launch subagents for each task (parallelize Tasks 1 & 2)
3. Run validation gates between tasks
4. Never write code yourself — always delegate to a subagent with precise instructions
5. If a subagent's output fails validation, send it back with the error output

### Execution Order

```
┌─────────────────────────┐    ┌──────────────────────────────┐
│ Task 1: Sidecar Infra   │    │ Task 2: Teams Sidecar        │
│ (NanoClaw core)         │    │ (container/teams-sidecar/)   │
│                         │    │                              │
│ • sidecar-channel.ts    │    │ • Dockerfile                 │
│ • credential-proxy.ts   │    │ • package.json + tsconfig    │
│ • sidecar-protocol.md   │    │ • src/index.ts               │
└────────┬────────────────┘    │ • src/store.ts               │
         │                     │ • build.sh                   │
         │                     └──────────────┬───────────────┘
         │                                    │
         ▼                                    │
┌─────────────────────────┐                   │
│ Task 3: TeamsChannel     │◄─────────────────┘
│ + Tests                 │
│                         │
│ • channels/msteams.ts   │
│ • channels/msteams.test │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Task 4: Barrel + Config │
│                         │
│ • channels/index.ts     │
│ • .env.example          │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Task 5: Skill Docs      │
│                         │
│ • SKILL.md              │
│ • TEAMS_SETUP.md        │
└─────────────────────────┘
```

**Parallel:** Tasks 1 and 2 have zero dependencies — launch them simultaneously.
**Sequential:** Task 3 depends on Task 1. Task 4 depends on Task 3. Task 5 depends on Tasks 1-3.

### Validation Gates

Run after **every task** before proceeding:

```bash
bun run build        # TypeScript compilation — must pass
bun run typecheck    # Type checking — must pass
bun run format:check # Formatting — must pass (run bun run format:fix if needed)
bun test             # Unit tests — must pass
```

After Task 2 additionally:
```bash
./container/teams-sidecar/build.sh   # Sidecar container build — must pass
```

If any gate fails, fix before moving on. Do not skip gates.

---

## Architecture

```
Teams Cloud
    │
    │ HTTPS POST /api/messages
    ▼
┌─────────────────────────────────┐
│ Teams Sidecar Container         │
│ (port 3978)                     │
│                                 │
│ botbuilder CloudAdapter         │
│ TeamsActivityHandler            │
│ ConversationReference store     │
└────────┬───────────────┬────────┘
         │               ▲
         │ HTTP POST     │ HTTP POST
         │ /channel/     │ /send
         │ inbound       │ /typing
         ▼               │
┌─────────────────────────────────┐
│ NanoClaw Host                   │
│ (credential-proxy port 3001)    │
│                                 │
│ /channel/inbound route          │
│ → onMessage() / onChatMetadata()│
│ → message loop → container agent│
└─────────────────────────────────┘
```

### JID Format

```
teams:<conversation-id>
```

Example: `teams:19:abc123@thread.tacv2`

### Folder Naming

```
teams_main        # main control channel
teams_<name>      # additional channels
```

---

## Sidecar Protocol Specification

This is the reusable HTTP contract between any sidecar container and the NanoClaw host. The Teams sidecar is the first implementation. Future sidecars (Facebook Messenger, LINE, etc.) follow the same contract.

### Sidecar → Host (inbound message)

```
POST http://{host}:{proxy_port}/channel/inbound
Content-Type: application/json

{
  "channel": "msteams",
  "jid": "teams:19:abc123@thread.tacv2",
  "message": {
    "id": "<unique-message-id>",
    "chat_jid": "teams:19:abc123@thread.tacv2",
    "sender": "user-aad-object-id",
    "sender_name": "Jane Doe",
    "content": "Hello bot",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "is_from_me": false,
    "is_bot_message": false
  },
  "metadata": {
    "name": "General",
    "isGroup": true,
    "channel": "msteams"
  }
}
```

**Response:** `200 OK` with `{"ok": true}` or `4xx/5xx` with `{"error": "message"}`

### Host → Sidecar (send message)

```
POST http://{sidecar}:{port}/send
Content-Type: application/json

{
  "jid": "teams:19:abc123@thread.tacv2",
  "text": "Here is my response..."
}
```

**Response:** `200 OK` with `{"ok": true}`

### Host → Sidecar (typing indicator)

```
POST http://{sidecar}:{port}/typing
Content-Type: application/json

{
  "jid": "teams:19:abc123@thread.tacv2",
  "isTyping": true
}
```

**Response:** `200 OK` with `{"ok": true}`

### Health check

```
GET http://{sidecar}:{port}/health

Response: {"status": "ok", "channel": "msteams"}
```

---

## Task 1: Generic Sidecar Infrastructure

### File: `src/sidecar-channel.ts` (CREATE)

Abstract base class that handles Docker lifecycle for any webhook-based channel sidecar.

```typescript
/**
 * Abstract base class for sidecar-based channels.
 *
 * Webhook-based platforms (Teams, Messenger, LINE) run a separate container
 * that handles their platform SDK + HTTP server. This class manages the
 * Docker lifecycle and provides send/typing via HTTP to the sidecar.
 *
 * Subclasses only need to provide configuration — all Docker and HTTP
 * plumbing lives here.
 */
import { execSync, spawn, ChildProcess } from 'child_process';
import http from 'http';

import { Channel, OnInboundMessage, OnChatMetadata } from './types.js';
import { ChannelOpts } from './channels/registry.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import {
  CONTAINER_RUNTIME_BIN,
  CONTAINER_HOST_GATEWAY,
  hostGatewayArgs,
} from './container-runtime.js';
import { CREDENTIAL_PROXY_PORT } from './config.js';

export interface SidecarConfig {
  /** Channel name (e.g. 'msteams'). Used for container naming and logging. */
  name: string;
  /** JID prefix (e.g. 'teams:'). Used for ownsJid(). */
  jidPrefix: string;
  /** Docker image name for the sidecar container. */
  imageName: string;
  /** Port the sidecar listens on inside the container. */
  sidecarPort: number;
  /** Port to publish on the host (maps to sidecarPort). */
  hostPort: number;
  /** Environment variable names to read from .env and pass to the sidecar. */
  envVars: string[];
  /** Additional Docker run args (optional). */
  extraDockerArgs?: string[];
}

export abstract class SidecarChannel implements Channel {
  readonly name: string;
  protected readonly config: SidecarConfig;
  protected readonly opts: ChannelOpts;
  private container: ChildProcess | null = null;
  private connected = false;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: SidecarConfig, opts: ChannelOpts) {
    this.name = config.name;
    this.config = config;
    this.opts = opts;
  }

  /** Subclasses override to add platform-specific Docker args or env. */
  protected extraEnv(): Record<string, string> {
    return {};
  }

  async connect(): Promise<void> {
    const containerName = `nanoclaw-sidecar-${this.config.name}`;

    // Stop any orphaned sidecar from a previous run
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} stop ${containerName}`, {
        stdio: 'pipe',
      });
    } catch {
      /* not running */
    }
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} rm ${containerName}`, {
        stdio: 'pipe',
      });
    } catch {
      /* doesn't exist */
    }

    // Read env vars from .env
    const secrets = readEnvFile(this.config.envVars);
    const extra = this.extraEnv();

    const envArgs: string[] = [];
    for (const key of this.config.envVars) {
      if (secrets[key]) {
        envArgs.push('-e', `${key}=${secrets[key]}`);
      }
    }
    for (const [key, val] of Object.entries(extra)) {
      envArgs.push('-e', `${key}=${val}`);
    }

    // Tell sidecar where to forward inbound messages
    envArgs.push(
      '-e',
      `NANOCLAW_HOST=http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`,
    );

    const args = [
      'run',
      '--rm',
      '--name',
      containerName,
      '-p',
      `${this.config.hostPort}:${this.config.sidecarPort}`,
      ...hostGatewayArgs(),
      ...envArgs,
      ...(this.config.extraDockerArgs || []),
      this.config.imageName,
    ];

    logger.info(
      { channel: this.name, containerName, hostPort: this.config.hostPort },
      'Starting sidecar container',
    );

    this.container = spawn(CONTAINER_RUNTIME_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.container.stdout?.on('data', (data: Buffer) => {
      logger.debug({ channel: this.name }, data.toString().trim());
    });

    this.container.stderr?.on('data', (data: Buffer) => {
      logger.warn({ channel: this.name }, data.toString().trim());
    });

    this.container.on('exit', (code) => {
      logger.warn(
        { channel: this.name, code },
        'Sidecar container exited',
      );
      this.connected = false;
    });

    // Wait for health check
    await this.waitForHealth(30_000);
    this.connected = true;

    // Start periodic health check
    this.healthInterval = setInterval(async () => {
      try {
        await this.httpGet('/health');
      } catch {
        logger.warn({ channel: this.name }, 'Sidecar health check failed');
        this.connected = false;
      }
    }, 30_000);

    logger.info({ channel: this.name }, 'Sidecar channel connected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    await this.httpPost('/send', { jid, text });
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    try {
      await this.httpPost('/typing', { jid, isTyping });
    } catch {
      // Typing is best-effort — don't fail the message flow
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(this.config.jidPrefix);
  }

  async disconnect(): Promise<void> {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    const containerName = `nanoclaw-sidecar-${this.config.name}`;
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} stop ${containerName}`, {
        stdio: 'pipe',
        timeout: 10_000,
      });
    } catch {
      /* already stopped */
    }
    this.container = null;
    this.connected = false;
    logger.info({ channel: this.name }, 'Sidecar channel disconnected');
  }

  // --- HTTP helpers ---

  private async httpPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.config.hostPort,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const resp = Buffer.concat(chunks).toString();
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Sidecar ${path} returned ${res.statusCode}: ${resp}`));
            } else {
              resolve(resp);
            }
          });
        },
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  private async httpGet(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.config.hostPort,
          path,
          method: 'GET',
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  private async waitForHealth(timeoutMs: number): Promise<void> {
    const start = Date.now();
    const interval = 1000;
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await this.httpGet('/health');
        const parsed = JSON.parse(resp);
        if (parsed.status === 'ok') return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(
      `Sidecar ${this.name} did not become healthy within ${timeoutMs}ms`,
    );
  }
}
```

### File: `src/credential-proxy.ts` (MODIFY)

Add a `/channel/inbound` route and a callback registration mechanism. The existing proxy handler is a single `createServer` callback. We need to intercept requests to `/channel/inbound` before they hit the upstream proxy logic.

**Changes:**

1. Add a module-level `sidecarCallback` variable and `registerSidecarCallback()` export
2. Inside the `createServer` handler, check `req.url` for `/channel/inbound` before the upstream proxy logic

```typescript
// ADD these at module level (after the imports, before startCredentialProxy):

type SidecarInboundCallback = (payload: {
  channel: string;
  jid: string;
  message: import('./types.js').NewMessage;
  metadata?: { name?: string; isGroup?: boolean; channel?: string };
}) => void;

let sidecarCallback: SidecarInboundCallback | null = null;

/** Register a callback for sidecar inbound messages. Called by index.ts at startup. */
export function registerSidecarCallback(cb: SidecarInboundCallback): void {
  sidecarCallback = cb;
}
```

Inside `startCredentialProxy`, at the top of the `createServer` callback (line 48, after `const server = createServer((req, res) => {`), add:

```typescript
      // --- Sidecar inbound route ---
      if (req.url === '/channel/inbound' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString());
            if (!sidecarCallback) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'No sidecar callback registered' }));
              return;
            }
            sidecarCallback(payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            logger.error({ err }, 'Failed to process sidecar inbound');
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return; // Don't fall through to upstream proxy
      }

      // --- Existing proxy logic below (unchanged) ---
```

3. In `src/index.ts`, after the credential proxy starts but before channels connect, register the sidecar callback:

```typescript
// In src/index.ts, after startCredentialProxy() call and before channel wiring:
import { registerSidecarCallback } from './credential-proxy.js';

// ... after proxy starts:
registerSidecarCallback((payload) => {
  const { channel, jid, message, metadata } = payload;
  if (metadata) {
    channelOpts.onChatMetadata(
      jid,
      message.timestamp,
      metadata.name,
      metadata.channel || channel,
      metadata.isGroup,
    );
  }
  channelOpts.onMessage(jid, message);
});
```

### File: `docs/sidecar-protocol.md` (CREATE)

Use the protocol specification from the "Sidecar Protocol Specification" section above. Wrap it in a markdown doc with title, overview, and versioning note.

### Validation Gate — Task 1

```bash
bun run build && bun run typecheck && bun run format:check && bun test
```

All must pass. The existing tests should not break — the credential proxy changes add a new code path but don't modify existing proxy behavior.

---

## Task 2: Teams Sidecar Container

All files under `container/teams-sidecar/`.

### File: `container/teams-sidecar/package.json` (CREATE)

```json
{
  "name": "nanoclaw-teams-sidecar",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "botbuilder": "^4.23.1",
    "botframework-connector": "^4.23.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

### File: `container/teams-sidecar/tsconfig.json` (CREATE)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### File: `container/teams-sidecar/src/store.ts` (CREATE)

Persists `ConversationReference` objects so the sidecar can send proactive messages.

```typescript
/**
 * Conversation reference store for Teams proactive messaging.
 * Persists to /data/conversation-refs.json (mounted volume) so references
 * survive container restarts.
 */
import fs from 'fs';
import { ConversationReference } from 'botbuilder';

const STORE_PATH = process.env.TEAMS_STORE_PATH || '/data/conversation-refs.json';

const refs = new Map<string, Partial<ConversationReference>>();

/** Load stored references from disk. */
export function loadRefs(): void {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      for (const [key, val] of Object.entries(data)) {
        refs.set(key, val as Partial<ConversationReference>);
      }
      console.log(`Loaded ${refs.size} conversation references`);
    }
  } catch (err) {
    console.error('Failed to load conversation references:', err);
  }
}

/** Save all references to disk. */
function saveRefs(): void {
  try {
    const dir = STORE_PATH.substring(0, STORE_PATH.lastIndexOf('/'));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj = Object.fromEntries(refs);
    fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('Failed to save conversation references:', err);
  }
}

/** Store or update a conversation reference. Key is the conversation ID. */
export function storeRef(
  conversationId: string,
  ref: Partial<ConversationReference>,
): void {
  refs.set(conversationId, ref);
  saveRefs();
}

/** Get a conversation reference by conversation ID. */
export function getRef(
  conversationId: string,
): Partial<ConversationReference> | undefined {
  return refs.get(conversationId);
}
```

### File: `container/teams-sidecar/src/index.ts` (CREATE)

The main sidecar process: Bot Framework HTTP server + outbound send/typing endpoints.

```typescript
/**
 * MS Teams Sidecar for NanoClaw.
 *
 * Inbound: Bot Framework CloudAdapter receives Teams activities on POST /api/messages,
 *          converts them to NanoClaw NewMessage format, forwards to host via HTTP.
 * Outbound: /send and /typing endpoints called by NanoClaw host to send messages
 *           and typing indicators back to Teams.
 * Health: GET /health for liveness checks.
 */
import http from 'http';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
  TeamsActivityHandler,
  Activity,
  ActivityTypes,
  ConversationReference,
} from 'botbuilder';

import { loadRefs, storeRef, getRef } from './store.js';

// --- Configuration ---
const APP_ID = process.env.TEAMS_APP_ID || '';
const APP_SECRET = process.env.TEAMS_APP_SECRET || '';
const PORT = parseInt(process.env.TEAMS_SIDECAR_PORT || '3978', 10);
const NANOCLAW_HOST = process.env.NANOCLAW_HOST || 'http://host.docker.internal:3001';

if (!APP_ID || !APP_SECRET) {
  console.error('FATAL: TEAMS_APP_ID and TEAMS_APP_SECRET are required');
  process.exit(1);
}

// --- Bot Framework Setup ---
const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: APP_ID,
  MicrosoftAppPassword: APP_SECRET,
  MicrosoftAppType: 'SingleTenant',
});

const adapter = new CloudAdapter(botFrameworkAuth);

// Error handler
adapter.onTurnError = async (context: TurnContext, error: Error) => {
  console.error(`[onTurnError] ${error.message}`, error);
  try {
    await context.sendActivity('Sorry, something went wrong.');
  } catch {
    // Can't send error message — swallow
  }
};

// --- Activity Handler ---
class NanoClawTeamsHandler extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context: TurnContext) => {
      const activity = context.activity;

      // Store conversation reference for proactive messaging
      const ref = TurnContext.getConversationReference(activity);
      storeRef(activity.conversation.id, ref);

      // Strip @mention of our bot from the text
      let text = activity.text || '';
      if (activity.entities) {
        for (const entity of activity.entities) {
          if (
            entity.type === 'mention' &&
            entity.mentioned?.id === APP_ID
          ) {
            const mentionText = entity.text || '';
            text = text.replace(mentionText, '').trim();
          }
        }
      }

      if (!text) return; // No text content after stripping mentions

      const conversationId = activity.conversation.id;
      const jid = `teams:${conversationId}`;
      const isGroup = activity.conversation.isGroup === true ||
        activity.conversation.conversationType === 'channel' ||
        activity.conversation.conversationType === 'groupChat';

      const message = {
        id: activity.id || `${Date.now()}`,
        chat_jid: jid,
        sender: activity.from?.aadObjectId || activity.from?.id || 'unknown',
        sender_name: activity.from?.name || 'Unknown',
        content: text,
        timestamp: activity.timestamp
          ? new Date(activity.timestamp).toISOString()
          : new Date().toISOString(),
        is_from_me: false,
        is_bot_message: false,
      };

      const payload = {
        channel: 'msteams',
        jid,
        message,
        metadata: {
          name: activity.conversation.name || conversationId,
          isGroup,
          channel: 'msteams',
        },
      };

      // Forward to NanoClaw host
      try {
        await httpPost(`${NANOCLAW_HOST}/channel/inbound`, payload);
      } catch (err) {
        console.error('Failed to forward message to NanoClaw host:', err);
      }
    });

    this.onConversationUpdate(async (context: TurnContext) => {
      // Store conversation reference on member added/removed too
      const ref = TurnContext.getConversationReference(context.activity);
      storeRef(context.activity.conversation.id, ref);
    });
  }
}

const bot = new NanoClawTeamsHandler();

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Health check
  if (url === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', channel: 'msteams' }));
    return;
  }

  // Bot Framework inbound (Teams → sidecar)
  if (url === '/api/messages' && method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString();
      try {
        await adapter.process(
          { body, headers: req.headers, method: req.method!, url: req.url! } as any,
          { status: (code: number) => ({ send: (b: any) => { res.writeHead(code); res.end(typeof b === 'string' ? b : JSON.stringify(b)); } }), end: () => { if (!res.writableEnded) { res.writeHead(200); res.end(); } } } as any,
          async (context) => await bot.run(context),
        );
      } catch (err) {
        console.error('Bot Framework processing error:', err);
        if (!res.writableEnded) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Internal error' }));
        }
      }
    });
    return;
  }

  // Send message (NanoClaw host → sidecar → Teams)
  if (url === '/send' && method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const { jid, text } = JSON.parse(Buffer.concat(chunks).toString());
        const conversationId = jid.replace(/^teams:/, '');
        const ref = getRef(conversationId);
        if (!ref) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No conversation reference for this JID' }));
          return;
        }
        await adapter.continueConversationAsync(
          APP_ID,
          ref as ConversationReference,
          async (context) => {
            // Split long messages (Teams limit ~28KB, use 4000 chars for safety)
            const MAX_LEN = 4000;
            if (text.length <= MAX_LEN) {
              await context.sendActivity(text);
            } else {
              for (let i = 0; i < text.length; i += MAX_LEN) {
                await context.sendActivity(text.slice(i, i + MAX_LEN));
              }
            }
          },
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Send error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // Typing indicator (NanoClaw host → sidecar → Teams)
  if (url === '/typing' && method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const { jid } = JSON.parse(Buffer.concat(chunks).toString());
        const conversationId = jid.replace(/^teams:/, '');
        const ref = getRef(conversationId);
        if (!ref) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No conversation reference' }));
          return;
        }
        await adapter.continueConversationAsync(
          APP_ID,
          ref as ConversationReference,
          async (context) => {
            await context.sendActivity({ type: ActivityTypes.Typing });
          },
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        // Typing is best-effort
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    return;
  }

  // Unknown route
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// --- Start ---
loadRefs();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Teams sidecar listening on port ${PORT}`);
  console.log(`Forwarding inbound messages to ${NANOCLAW_HOST}/channel/inbound`);
});
```

**Note on the adapter.process shim:** The `CloudAdapter.process()` expects Express-like request/response objects. The inline shim above is a minimal adaptation. The subagent implementing this should verify it works or use the `adapter.processActivity()` method with raw body parsing instead. Test it during the sidecar build validation.

### File: `container/teams-sidecar/Dockerfile` (CREATE)

```dockerfile
# NanoClaw Teams Sidecar
# Bot Framework SDK HTTP server for MS Teams integration

FROM node:22-slim

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Create data directory for conversation reference persistence
RUN mkdir -p /data

EXPOSE 3978

CMD ["node", "dist/index.js"]
```

### File: `container/teams-sidecar/build.sh` (CREATE)

```bash
#!/bin/bash
# Build the NanoClaw Teams sidecar container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-teams-sidecar"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

echo "Building Teams sidecar container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

${CONTAINER_RUNTIME} build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  ${CONTAINER_RUNTIME} run --rm -p 3978:3978 -e TEAMS_APP_ID=test -e TEAMS_APP_SECRET=test ${IMAGE_NAME}:${TAG}"
```

**Make executable:** `chmod +x container/teams-sidecar/build.sh`

### Validation Gate — Task 2

```bash
./container/teams-sidecar/build.sh
```

Must build successfully. The sidecar is an independent Node project — it does not need to pass the host's `bun test` or `bun run build`.

---

## Task 3: TeamsChannel Class + Tests

### File: `src/channels/msteams.ts` (CREATE)

Thin subclass — all Docker lifecycle is in `SidecarChannel`.

```typescript
/**
 * MS Teams channel for NanoClaw.
 * Uses the sidecar container pattern — a separate Docker container runs
 * the Bot Framework SDK and HTTP server. This class just provides config
 * and self-registers via the channel registry.
 */
import { SidecarChannel, SidecarConfig } from '../sidecar-channel.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

const TEAMS_SIDECAR_CONFIG: SidecarConfig = {
  name: 'msteams',
  jidPrefix: 'teams:',
  imageName: 'nanoclaw-teams-sidecar:latest',
  sidecarPort: 3978,
  hostPort: parseInt(readEnvFile(['TEAMS_PORT']).TEAMS_PORT || '3978', 10),
  envVars: ['TEAMS_APP_ID', 'TEAMS_APP_SECRET'],
};

class TeamsChannel extends SidecarChannel {
  constructor(opts: ChannelOpts) {
    super(TEAMS_SIDECAR_CONFIG, opts);
  }
}

// Self-register at import time.
// Factory returns null if credentials are missing (standard NanoClaw pattern).
registerChannel('msteams', (opts: ChannelOpts) => {
  const secrets = readEnvFile(['TEAMS_APP_ID', 'TEAMS_APP_SECRET']);
  if (!secrets.TEAMS_APP_ID || !secrets.TEAMS_APP_SECRET) {
    logger.debug('MS Teams credentials not found — channel disabled');
    return null;
  }
  return new TeamsChannel(opts);
});
```

### File: `src/channels/msteams.test.ts` (CREATE)

Follow the existing `registry.test.ts` patterns. Test the factory, JID ownership, and basic method contracts.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getChannelFactory } from './registry.js';

// Import the channel to trigger self-registration
import './msteams.js';

describe('msteams channel', () => {
  describe('factory registration', () => {
    it('registers with the channel registry', () => {
      const factory = getChannelFactory('msteams');
      expect(factory).toBeDefined();
    });

    it('returns null when credentials are missing', () => {
      const factory = getChannelFactory('msteams')!;
      const channel = factory({
        onMessage: () => {},
        onChatMetadata: () => {},
        registeredGroups: () => ({}),
      });
      // Without TEAMS_APP_ID / TEAMS_APP_SECRET in .env, factory returns null
      expect(channel).toBeNull();
    });
  });

  describe('JID ownership', () => {
    // These tests verify the static ownsJid logic without needing credentials.
    // We test via the SidecarChannel.ownsJid which checks jidPrefix.

    it('owns teams: prefixed JIDs', () => {
      // Since we can't instantiate without credentials, test the prefix logic directly
      const jid = 'teams:19:abc123@thread.tacv2';
      expect(jid.startsWith('teams:')).toBe(true);
    });

    it('does not own other prefixed JIDs', () => {
      expect('dc:12345'.startsWith('teams:')).toBe(false);
      expect('slack:C123'.startsWith('teams:')).toBe(false);
      expect('12345@g.us'.startsWith('teams:')).toBe(false);
    });
  });
});
```

### Validation Gate — Task 3

```bash
bun run build && bun run typecheck && bun run format:check && bun test
```

Specifically verify: `bun test src/channels/msteams.test.ts`

---

## Task 4: Barrel, Config, .env

### File: `src/channels/index.ts` (MODIFY)

Add the msteams import. Current content:

```typescript
// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.

// discord

// gmail

// slack

// telegram

// whatsapp
```

Add after the whatsapp comment:

```typescript
// msteams
import './msteams.js';
```

### File: `.env.example` (MODIFY)

Add Teams variables. Current content is empty (1 line). Replace with:

```
# MS Teams Bot Framework credentials
# TEAMS_APP_ID=
# TEAMS_APP_SECRET=
# TEAMS_PORT=3978
```

### File: `src/index.ts` (MODIFY)

Add the sidecar callback registration. This wires sidecar inbound messages into the existing `channelOpts.onMessage` / `onChatMetadata` callbacks.

Add import at top of file:
```typescript
import { registerSidecarCallback } from './credential-proxy.js';
```

After the `startCredentialProxy()` call resolves and before the channel wiring loop (around line 491), add:

```typescript
  // Register sidecar inbound callback — routes webhook-based channel
  // messages (Teams, etc.) through the same onMessage/onChatMetadata pipeline
  registerSidecarCallback((payload) => {
    const { channel, jid, message, metadata } = payload;
    if (metadata) {
      channelOpts.onChatMetadata(
        jid,
        message.timestamp,
        metadata.name,
        metadata.channel || channel,
        metadata.isGroup,
      );
    }
    channelOpts.onMessage(jid, message);
  });
```

**Important:** Find the exact location by reading `src/index.ts`. The callback must be registered after `channelOpts` is defined but before the channel connection loop. The `channelOpts` definition starts around line 492 and the channel loop starts around line 525 — the callback registration goes between them.

### Validation Gate — Task 4

```bash
bun run build && bun run typecheck && bun run format:check && bun test
```

---

## Task 5: Skill Documentation

### File: `.claude/skills/add-ms-teams/SKILL.md` (CREATE)

Follow the Discord skill template exactly. 5 phases: pre-flight, apply code, setup, registration, verify.

```markdown
---
name: add-ms-teams
description: Add MS Teams bot channel integration to NanoClaw.
---

# Add MS Teams Channel

This skill adds Microsoft Teams support to NanoClaw using a sidecar container pattern, then walks through interactive setup.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/msteams.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Do you have an Azure Bot registration with a Microsoft App ID and App Secret, or do you need to create one?

If they have credentials, collect them now. If not, we'll create them in Phase 3.

## Phase 2: Apply Code Changes

### Ensure channel remote

```bash
git remote -v
```

If `msteams` is missing, add it:

```bash
git remote add msteams https://github.com/qwibitai/nanoclaw-msteams.git
```

### Merge the skill branch

```bash
git fetch msteams main
git merge msteams/main || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue
}
```

This merges in:

- `src/sidecar-channel.ts` (SidecarChannel abstract base class for webhook-based channels)
- `src/channels/msteams.ts` (TeamsChannel class with self-registration via `registerChannel`)
- `src/channels/msteams.test.ts` (unit tests)
- `/channel/inbound` route added to `src/credential-proxy.ts`
- Sidecar callback registration in `src/index.ts`
- `import './msteams.js'` appended to the channel barrel file `src/channels/index.ts`
- `container/teams-sidecar/` directory (Dockerfile, source, build script)
- `docs/sidecar-protocol.md` (protocol specification)
- `TEAMS_APP_ID`, `TEAMS_APP_SECRET`, `TEAMS_PORT` in `.env.example`

If the merge reports conflicts, resolve them by reading the conflicted files and understanding the intent of both sides.

### Validate code changes

```bash
npm install
npm run build
npx vitest run src/channels/msteams.test.ts
```

### Build the sidecar container

```bash
chmod +x container/teams-sidecar/build.sh
./container/teams-sidecar/build.sh
```

All tests must pass and both builds (host + sidecar) must be clean before proceeding.

## Phase 3: Setup

### Create Azure Bot Registration (if needed)

If the user doesn't have a bot registration, share [TEAMS_SETUP.md](TEAMS_SETUP.md) which has step-by-step instructions for creating one in the Azure Portal.

Quick summary:

1. Go to the [Azure Portal](https://portal.azure.com)
2. Search for "Azure Bot" and create a new Bot resource
3. Choose "Single Tenant" for the app type
4. Note the **Microsoft App ID** from the Bot Configuration page
5. Go to "Configuration" → "Manage Password" to create a new **Client Secret**
6. Under "Channels", ensure Microsoft Teams is enabled
7. In Teams Admin Center, upload or sideload the app manifest

Wait for the user to provide the App ID and App Secret.

### Configure environment

Add to `.env`:

```bash
TEAMS_APP_ID=<their-app-id>
TEAMS_APP_SECRET=<their-app-secret>
TEAMS_PORT=3978
```

Channels auto-enable when their credentials are present — no extra configuration needed.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 4: Registration

### Get Conversation ID

Tell the user:

> To get the conversation ID for registration:
>
> 1. Send any message to the bot in Teams (1:1 chat, group chat, or channel)
> 2. Check the NanoClaw logs for the inbound message — it will show the conversation ID
> 3. The JID format is: `teams:<conversation-id>`
>
> Alternatively, you can find the conversation ID in the Teams web client URL.

Wait for the user to provide the conversation ID.

### Register the channel

For a main channel (responds to all messages):

```typescript
registerGroup('teams:<conversation-id>', {
  name: '<channel-name>',
  folder: 'teams_main',
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: false,
  isMain: true,
});
```

For additional channels (trigger-only):

```typescript
registerGroup('teams:<conversation-id>', {
  name: '<channel-name>',
  folder: 'teams_<name>',
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: true,
});
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message in your registered Teams conversation:
>
> - For main channel: Any message works
> - For non-main: @mention the bot in Teams
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

Also check the sidecar container logs:

```bash
docker logs nanoclaw-sidecar-msteams
```

## Troubleshooting

### Bot not responding

1. Check `TEAMS_APP_ID` and `TEAMS_APP_SECRET` are set in `.env` AND synced to `data/env/env`
2. Check channel is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'teams:%'"`
3. For non-main channels: message must include trigger pattern (@mention the bot)
4. Service is running: `launchctl list | grep nanoclaw`
5. Sidecar container is running: `docker ps | grep nanoclaw-sidecar-msteams`

### Sidecar not starting

1. Check the sidecar image exists: `docker images | grep nanoclaw-teams-sidecar`
2. If missing, rebuild: `./container/teams-sidecar/build.sh`
3. Check port 3978 is available: `lsof -i :3978`
4. Check Docker logs: `docker logs nanoclaw-sidecar-msteams`

### Bot Framework authentication errors

1. Verify App ID and App Secret are correct
2. Ensure the bot is registered as "Single Tenant" (not Multi-Tenant)
3. Check Azure Bot resource → Configuration → Messaging endpoint
4. For local dev, the endpoint should be set via ngrok or dev tunnel

### Teams not sending messages to the bot

1. Ensure the Teams channel is enabled in the Azure Bot registration
2. Verify the bot app is installed in your Teams workspace
3. Check that the messaging endpoint is reachable from the internet
4. RSC permissions may be needed for receiving all channel messages without @mention

## After Setup

The MS Teams channel supports:

- Text messages in 1:1 chats, group chats, and channels
- @mention stripping (bot mention removed from message text)
- Message splitting for responses over 4000 characters
- Typing indicators while the agent processes
- Proactive messaging via stored conversation references
- Multiple registered channels (main + additional)
```

### File: `.claude/skills/add-ms-teams/TEAMS_SETUP.md` (CREATE)

Detailed Azure Bot registration walkthrough. Follow the pattern of Slack's `SLACK_SETUP.md`:

```markdown
# MS Teams Bot Setup Guide

Step-by-step guide for creating a Microsoft Teams bot and connecting it to NanoClaw.

## Prerequisites

- An Azure account (free tier works)
- Admin access to your Microsoft Teams workspace (or ability to sideload apps)

## Step 1: Create Azure Bot Resource

1. Go to [Azure Portal](https://portal.azure.com)
2. Click **Create a resource**
3. Search for **Azure Bot** and click **Create**
4. Fill in:
   - **Bot handle**: Choose a unique name (e.g., `nanoclaw-assistant`)
   - **Subscription**: Your Azure subscription
   - **Resource group**: Create new or use existing
   - **Pricing tier**: Free (F0) for development
   - **Type of App**: **Single Tenant**
   - **Creation type**: **Create new Microsoft App ID**
5. Click **Review + create**, then **Create**

## Step 2: Get App ID and Secret

1. Go to your newly created Bot resource
2. Click **Configuration** in the left sidebar
3. Copy the **Microsoft App ID** — you'll need this for `TEAMS_APP_ID`
4. Click **Manage Password** (next to Microsoft App ID)
5. This opens the Azure AD App Registration page
6. Go to **Certificates & secrets** → **Client secrets**
7. Click **New client secret**
8. Set a description (e.g., "NanoClaw") and expiry
9. Click **Add**
10. **Copy the Value immediately** — you can only see it once. This is your `TEAMS_APP_SECRET`

## Step 3: Enable Teams Channel

1. Back in the Azure Bot resource, click **Channels** in the left sidebar
2. Click **Microsoft Teams** to enable it
3. Accept the terms of service
4. Click **Apply**

## Step 4: Configure Messaging Endpoint

The messaging endpoint is where Teams sends messages to your bot. For NanoClaw's sidecar architecture, this needs to reach the sidecar container's `/api/messages` endpoint.

### For local development (with ngrok or dev tunnel)

1. Install [ngrok](https://ngrok.com/) or use [VS Code Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/)
2. Start a tunnel to port 3978:
   ```bash
   ngrok http 3978
   ```
3. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. In Azure Bot → Configuration, set **Messaging endpoint** to:
   ```
   https://abc123.ngrok.io/api/messages
   ```

### For production (with a public server)

Set the messaging endpoint to your server's public URL:
```
https://your-domain.com/api/messages
```

Ensure port 3978 (or your configured `TEAMS_PORT`) is forwarded appropriately.

## Step 5: Create Teams App Manifest

To use the bot in Teams, you need an app manifest:

1. Create a `manifest.json`:
   ```json
   {
     "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
     "manifestVersion": "1.17",
     "version": "1.0.0",
     "id": "<your-app-id>",
     "developer": {
       "name": "NanoClaw",
       "websiteUrl": "https://github.com/qwibitai/nanoclaw",
       "privacyUrl": "https://github.com/qwibitai/nanoclaw",
       "termsOfUseUrl": "https://github.com/qwibitai/nanoclaw"
     },
     "name": {
       "short": "NanoClaw Assistant",
       "full": "NanoClaw AI Assistant"
     },
     "description": {
       "short": "AI assistant powered by Claude",
       "full": "Personal AI assistant powered by Claude, running in NanoClaw"
     },
     "icons": {
       "color": "color.png",
       "outline": "outline.png"
     },
     "accentColor": "#FFFFFF",
     "bots": [
       {
         "botId": "<your-app-id>",
         "scopes": ["personal", "team", "groupChat"],
         "supportsFiles": false,
         "isNotificationOnly": false
       }
     ],
     "permissions": ["identity", "messageTeamMembers"],
     "validDomains": []
   }
   ```
2. Replace `<your-app-id>` with your Microsoft App ID
3. Create simple 192x192 (color.png) and 32x32 (outline.png) icon images
4. Zip all three files into `teams-app.zip`

## Step 6: Install the App in Teams

### Option A: Sideload (for development)

1. Open Microsoft Teams
2. Click **Apps** in the left sidebar
3. Click **Manage your apps** at the bottom
4. Click **Upload a custom app** → **Upload for me or my teams**
5. Select your `teams-app.zip`

### Option B: Teams Admin Center (for organization-wide)

1. Go to [Teams Admin Center](https://admin.teams.microsoft.com/)
2. Navigate to **Teams apps** → **Manage apps**
3. Click **Upload new app**
4. Select your `teams-app.zip`
5. Once uploaded, configure policies to make it available to users

## Step 7: Test the Bot

1. In Teams, find the bot in your chats (or add it to a channel)
2. Send it a message: "Hello"
3. Check NanoClaw logs for the inbound message
4. The bot should respond once the channel is registered in NanoClaw

## Credential Reference

| Variable         | Where to Find                                                              | Format                         |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------ |
| `TEAMS_APP_ID`     | Azure Bot → Configuration → Microsoft App ID                               | UUID (e.g., `12345678-abcd-...`) |
| `TEAMS_APP_SECRET` | Azure AD → App Registration → Certificates & secrets → Client secret Value | String                         |
| `TEAMS_PORT`       | Your choice (default: 3978)                                                | Number                         |

## Troubleshooting

### "Unauthorized" errors from Bot Framework

- Verify your App ID and Secret are correct
- Check the bot type is "Single Tenant" (not Multi-Tenant)
- Ensure the secret hasn't expired

### "Could not find a part of the path" or 404 errors

- The messaging endpoint must be accessible from the internet
- Check ngrok/tunnel is running and the URL is correct in Azure Bot Configuration

### Bot appears in Teams but doesn't respond

- Check NanoClaw is running and the sidecar container is up
- Verify the channel is registered in NanoClaw: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'teams:%'"`
- Check sidecar logs: `docker logs nanoclaw-sidecar-msteams`

### RSC Permissions (for receiving all channel messages)

By default, bots in Teams channels only receive messages when @mentioned. To receive all messages:

1. Add `ChannelMessage.Read.Group` to your app manifest's `webApplicationInfo.resource` RSC permissions
2. This requires admin consent in the Teams Admin Center
3. See: [Microsoft docs on RSC for bots](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-messages-with-rsc)
```

### Validation Gate — Task 5

No code changes — but verify the skill files are well-formed:
```bash
bun run build && bun run typecheck && bun run format:check && bun test
```

---

## Final Validation

After all 5 tasks are complete, run the full validation suite:

```bash
bun run build && bun run typecheck && bun run format:check && bun test && ./container/teams-sidecar/build.sh
```

All gates must pass. Then `git status` to review all changes and confirm the file list matches what was planned.

### Expected File Changes

**New files (12):**
- `src/sidecar-channel.ts`
- `src/channels/msteams.ts`
- `src/channels/msteams.test.ts`
- `docs/sidecar-protocol.md`
- `container/teams-sidecar/Dockerfile`
- `container/teams-sidecar/package.json`
- `container/teams-sidecar/tsconfig.json`
- `container/teams-sidecar/src/index.ts`
- `container/teams-sidecar/src/store.ts`
- `container/teams-sidecar/build.sh`
- `.claude/skills/add-ms-teams/SKILL.md`
- `.claude/skills/add-ms-teams/TEAMS_SETUP.md`

**Modified files (3):**
- `src/credential-proxy.ts` (add `/channel/inbound` route + `registerSidecarCallback`)
- `src/channels/index.ts` (add `import './msteams.js'`)
- `.env.example` (add Teams variables)
- `src/index.ts` (add `registerSidecarCallback` wiring)

