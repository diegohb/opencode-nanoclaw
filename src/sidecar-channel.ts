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
      logger.warn({ channel: this.name, code }, 'Sidecar container exited');
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
              reject(
                new Error(
                  `Sidecar ${path} returned ${res.statusCode}: ${resp}`,
                ),
              );
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
