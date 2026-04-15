/**
 * OpenCode Agent Runner
 * Alternative runtime that uses OpenCode instead of Claude Code SDK.
 * Same stdin/stdout protocol and IPC mechanism as the Claude runner.
 */

import fs from 'fs';
import path from 'path';
import { createOpencode } from '@opencode-ai/sdk';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  /**
   * Provider secrets forwarded by the host for the 'direct' credential
   * strategy. Keyed by the env var name (e.g. 'ANTHROPIC_API_KEY').
   * Empty or absent for the 'onecli' strategy.
   */
  secrets?: Record<string, string>;
  runtime?: string;
  opencodeConfig?: {
    provider?: string;
    /**
     * Name of the env var / secrets key holding the provider API key.
     * Resolved via `secrets[apiKey]` when the 'direct' strategy is active.
     */
    apiKey?: string;
    model?: string;
    small_model?: string;
  };
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;
const PROMPT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const OPENCODE_DEFAULTS_CONFIG = '/workspace/opencode-defaults/opencode.json';

class PromptTimeoutError extends Error {
  constructor() {
    super(`session.prompt() timed out after ${PROMPT_TIMEOUT_MS / 1000}s`);
    this.name = 'PromptTimeoutError';
  }
}

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[opencode-runner] ${message}`);
}

function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(
          `Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

function readJsonConfig(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    log(
      `Failed to read config ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeInstructions(base: unknown, additions: string[]): string[] {
  const merged = new Set<string>();
  if (Array.isArray(base)) {
    for (const entry of base) {
      if (typeof entry === 'string') merged.add(entry);
    }
  }
  for (const entry of additions) {
    merged.add(entry);
  }
  return [...merged];
}

/**
 * Write opencode.json config to the workspace.
 */
function writeOpencodeConfig(containerInput: ContainerInput): void {
  const oc = containerInput.opencodeConfig;
  const defaults = readJsonConfig(OPENCODE_DEFAULTS_CONFIG) ?? {};

  // Only override model when explicitly requested — otherwise global OpenCode
  // config (e.g. ~/.config/opencode/config.json) picks the model.
  const model = oc?.model ?? null;
  const smallModel = oc?.small_model ?? null;

  // Only set provider block when an explicit apiKey is forwarded.
  const apiKey =
    oc?.apiKey && containerInput.secrets?.[oc.apiKey]
      ? containerInput.secrets[oc.apiKey]
      : undefined;
  const provider = oc?.provider ?? null;

  // MCP server path (compiled dist location at container runtime)
  const mcpServerPath = '/tmp/dist/ipc-mcp-stdio.js';

  const permission = {
    ...asRecord(defaults.permission),
    edit: 'allow',
    bash: 'allow',
    webfetch: 'allow',
  };

  const providerConfig = asRecord(defaults.provider);
  if (provider && apiKey) {
    const existingProvider = asRecord(providerConfig[provider]);
    providerConfig[provider] = {
      ...existingProvider,
      options: {
        ...asRecord(existingProvider.options),
        apiKey,
      },
    };
  }

  const mcp = {
    ...asRecord(defaults.mcp),
    nanoclaw: {
      type: 'local',
      command: ['node', mcpServerPath],
      environment: {
        NANOCLAW_CHAT_JID: containerInput.chatJid,
        NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
        NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
      },
    },
  };

  const instructions = mergeInstructions(defaults.instructions, [
    'AGENTS.md',
    ...(!containerInput.isMain && fs.existsSync('/workspace/global/AGENTS.md')
      ? ['/workspace/global/AGENTS.md']
      : []),
  ]);

  const config: Record<string, unknown> = {
    ...defaults,
    $schema:
      typeof defaults.$schema === 'string'
        ? defaults.$schema
        : 'https://opencode.ai/config.json',
    ...(model ? { model } : {}),
    ...(smallModel ? { small_model: smallModel } : {}),
    permission,
    ...(Object.keys(providerConfig).length > 0 ? { provider: providerConfig } : {}),
    mcp,
    instructions,
  };

  const configPath = '/workspace/group/opencode.json';
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  log(`Wrote opencode.json to ${configPath}`);
}

/**
 * Extract text from message parts.
 */
function extractText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
    .join('');
}

export async function main(): Promise<void> {
  // Read input from stdin
  const inputRaw = fs.readFileSync(0, 'utf-8');
  let containerInput: ContainerInput;
  try {
    containerInput = JSON.parse(inputRaw);
  } catch (err) {
    log(
      `Failed to parse stdin: ${err instanceof Error ? err.message : String(err)}`,
    );
    writeOutput({
      status: 'error',
      result: null,
      error: 'Invalid input JSON',
    });
    return;
  }

  log('Starting OpenCode runtime...');

  // Write opencode.json configuration
  writeOpencodeConfig(containerInput);

  // Pin OpenCode's state dir to the mounted host directory for session persistence
  const OPENCODE_STATE_DIR = '/workspace/opencode-state';
  process.env.XDG_STATE_HOME = OPENCODE_STATE_DIR;

  // Change CWD to the group workspace so OpenCode finds opencode.json there.
  // The entrypoint runs `cd /app` before launching node, so we must set CWD
  // explicitly — otherwise OpenCode looks for project config in /app and falls
  // back to its own global default model.
  process.chdir('/workspace/group');
  // Also set OPENCODE_CONFIG explicitly so config discovery uses our file
  // regardless of git-root traversal behaviour.
  const configPath = '/workspace/group/opencode.json';
  process.env.OPENCODE_CONFIG = configPath;
  log(`Using config: ${configPath}`);

  // Start OpenCode server and get client.
  // Do NOT pass config here — all settings (model, provider, permissions) are already
  // written to opencode.json above. Passing config here would set OPENCODE_CONFIG_CONTENT
  // at priority 6, which can override and strip the provider API key from opencode.json.
  const { client, server } = await createOpencode({
    hostname: '127.0.0.1',
    port: 4096,
  });

  log('OpenCode server started');

  try {
    // Reuse an existing session if one was stored, otherwise create a new one
    let sessionId: string;
    if (containerInput.sessionId) {
      const check = await client.session.get({
        path: { id: containerInput.sessionId },
      });
      if (check.error) {
        log(
          `Stored session ${containerInput.sessionId} not found, creating new session`,
        );
        const created = await client.session.create({
          body: { title: `nanoclaw-${containerInput.groupFolder}` },
        });
        if (created.error)
          throw new Error(
            `Failed to create session: ${JSON.stringify(created.error)}`,
          );
        sessionId = created.data!.id;
      } else {
        sessionId = containerInput.sessionId;
        log(`Resuming session: ${sessionId}`);
      }
    } else {
      const created = await client.session.create({
        body: { title: `nanoclaw-${containerInput.groupFolder}` },
      });
      if (created.error)
        throw new Error(
          `Failed to create session: ${JSON.stringify(created.error)}`,
        );
      sessionId = created.data!.id;
      log(`Session created: ${sessionId}`);
    }

    // Set up SSE event stream.
    // session.prompt() returns when the assistant message is *created* (not completed).
    // The actual text content arrives via SSE message.part.updated events.
    // We wait for session.idle (fires when the full turn is done) before reading the result.
    const eventResult = await client.event.subscribe();
    const eventStream = eventResult.stream;
    // Idle-gate: resolves when session.idle fires for our session.
    // Reset before each prompt by replacing idleResolve.
    // eslint-disable-next-line prefer-const
    let idleResolve: (() => void) | undefined;
    let idlePromise = new Promise<void>((r) => { idleResolve = r; });

    const eventProcessor = (async () => {
      try {
        for await (const event of eventStream) {
          const evt = event as {
            type?: string;
            properties?: Record<string, unknown>;
          };
          if (evt.type === 'session.idle') {
            const props = evt.properties as { sessionID?: string } | undefined;
            if (props?.sessionID === sessionId) {
              idleResolve?.();
            }
          } else if (evt.type === 'session.error') {
            log(`Session error: ${JSON.stringify(evt.properties)}`);
          }
        }
      } catch {
        // Stream ended or aborted
      }
    })();

    // Build initial prompt
    let prompt = containerInput.prompt;
    if (containerInput.isScheduledTask) {
      prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
    }
    const pending = drainIpcInput();
    if (pending.length > 0) {
      log(
        `Draining ${pending.length} pending IPC messages into initial prompt`,
      );
      prompt += '\n' + pending.join('\n');
    }

    // Query loop: send prompt → wait for session.idle → write output → wait for IPC → repeat
    while (true) {
      log(`Sending prompt (${prompt.length} chars)...`);

      // Reset idle gate for this turn
      idlePromise = new Promise<void>((r) => { idleResolve = r; });

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new PromptTimeoutError()), PROMPT_TIMEOUT_MS),
        );

        // Submit the prompt. Returns when the assistant message is created (not necessarily done).
        await Promise.race([
          client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [{ type: 'text' as const, text: prompt }],
            },
          }),
          timeoutPromise,
        ]);

        // Wait for session.idle — fires when the full assistant turn is complete.
        await Promise.race([idlePromise, timeoutPromise]);

        // After idle, fetch messages and extract text from the last assistant turn.
        // session.messages() returns Array<{ info: Message; parts: Part[] }> — parts are
        // available directly, no SSE buffering needed.
        let result: string | null = null;
        const msgsResult = await client.session.messages({
          path: { id: sessionId },
        });
        if (!msgsResult.error && msgsResult.data) {
          const items = msgsResult.data as Array<{
            info?: { id?: string; role?: string; error?: unknown };
            parts?: Array<{ type?: string; text?: string }>;
          }>;

          // Walk backwards to find the last assistant message
          for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.info?.role === 'assistant') {
              if (item.info.error) {
                log(`Assistant message error: ${JSON.stringify(item.info.error)}`);
              }
              const textParts = (item.parts ?? []).filter((p) => p.type === 'text' && p.text);
              result = textParts.map((p) => p.text!).join('') || null;
              break;
            }
          }
        } else {
          log(`Messages API error: ${JSON.stringify(msgsResult.error)}`);
        }
        log(`Got response: ${result ? result.slice(0, 200) : '(empty)'}...`);

        writeOutput({
          status: 'success',
          result,
          newSessionId: sessionId,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log(`Query error: ${errorMessage}`);
        writeOutput({
          status: 'error',
          result: null,
          newSessionId: sessionId,
          error: errorMessage,
        });
        if (err instanceof PromptTimeoutError) {
          log(
            'Prompt timed out — exiting container so host can spawn a fresh one',
          );
          break;
        }
      }

      // Check for close before waiting
      if (shouldClose()) {
        log('Close sentinel received after query, exiting');
        break;
      }

      // Wait for next IPC message or close
      log('Waiting for next IPC message...');
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }

    // Clean up — signal the async generator to stop
    await eventStream.return(undefined as never).catch(() => {});
    await eventProcessor.catch(() => {});
  } finally {
    server.close();
    log('OpenCode server stopped');
    process.exit(0);
  }
}
