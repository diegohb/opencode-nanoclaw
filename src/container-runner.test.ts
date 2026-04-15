import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Hoisted spy so the OneCLI mock can reference it before variable declarations
const { mockApplyContainerConfig } = vi.hoisted(() => ({
  mockApplyContainerConfig: vi.fn().mockResolvedValue(true),
}));

// Mock config
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000, // 30min
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000, // 30min
  ONECLI_URL: 'http://localhost:10254',
  TIMEZONE: 'America/Los_Angeles',
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      copyFileSync: vi.fn(),
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

// Mock container-runtime
vi.mock('./container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  hostGatewayArgs: () => [],
  readonlyMountArgs: (h: string, c: string) => ['-v', `${h}:${c}:ro`],
  stopContainer: vi.fn(),
}));

// Mock OneCLI SDK — use hoisted shared spy so call count is trackable across tests
vi.mock('@onecli-sh/sdk', () => ({
  OneCLI: class {
    applyContainerConfig = mockApplyContainerConfig;
    createAgent = vi.fn().mockResolvedValue({ id: 'test' });
    ensureAgent = vi
      .fn()
      .mockResolvedValue({ name: 'test', identifier: 'test', created: true });
  },
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (cb) cb(null);
        return new EventEmitter();
      },
    ),
  };
});

import { runContainerAgent, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';
import fs from 'fs';
import { logger } from './logger.js';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(
  proc: ReturnType<typeof createFakeProcess>,
  output: ContainerOutput,
) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // No output emitted — fire the hard timeout
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });

  it('merges group OpenCode config into container input', async () => {
    const inputChunks: string[] = [];
    fakeProc.stdin.on('data', (chunk) => {
      inputChunks.push(chunk.toString());
    });

    const resultPromise = runContainerAgent(
      {
        ...testGroup,
        containerConfig: {
          opencodeConfig: {
            provider: 'opencode',
            apiKey: 'OPENCODE_API_KEY',
            model: 'opencode/custom-model',
          },
        },
      },
      testInput,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(10);

    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await resultPromise;

    expect(JSON.parse(inputChunks.join(''))).toMatchObject({
      opencodeConfig: {
        provider: 'opencode',
        apiKey: 'OPENCODE_API_KEY',
        model: 'opencode/custom-model',
      },
    });
  });

  it('uses host OpenCode model defaults when group config omits models', async () => {
    const existsSync = vi.mocked(fs.existsSync);
    const readFileSync = vi.mocked(fs.readFileSync);
    existsSync.mockImplementation(
      (path) =>
        String(path).includes('.config') || String(path).includes('/logs'),
    );
    readFileSync.mockImplementation((path) => {
      if (String(path).includes('.config')) {
        return '{"model":"opencode/primary","small_model":"opencode/small"}';
      }
      return '';
    });

    const inputChunks: string[] = [];
    fakeProc.stdin.on('data', (chunk) => {
      inputChunks.push(chunk.toString());
    });

    const resultPromise = runContainerAgent(
      {
        ...testGroup,
        containerConfig: {
          opencodeConfig: {
            provider: 'opencode',
            apiKey: 'OPENCODE_API_KEY',
          },
        },
      },
      testInput,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(10);

    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await resultPromise;

    expect(JSON.parse(inputChunks.join(''))).toMatchObject({
      opencodeConfig: {
        provider: 'opencode',
        apiKey: 'OPENCODE_API_KEY',
        model: 'opencode/primary',
        small_model: 'opencode/small',
      },
    });
  });

  it('mounts only runtime-adjacent OpenCode defaults into the container', async () => {
    const existsSync = vi.mocked(fs.existsSync);
    existsSync.mockImplementation(
      (path) =>
        String(path).includes('.opencode') || String(path).includes('/logs'),
    );

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});

    await vi.advanceTimersByTimeAsync(10);

    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const spawnCalls = vi.mocked(spawn).mock.calls;
    const containerArgs = spawnCalls[spawnCalls.length - 1]?.[1] as string[];

    expect(
      containerArgs.some((arg) =>
        arg.includes('/workspace/opencode-defaults/opencode.json'),
      ),
    ).toBe(true);
    expect(
      containerArgs.some((arg) =>
        arg.includes('/workspace/opencode-defaults/skills'),
      ),
    ).toBe(true);
    expect(containerArgs.some((arg) => arg.includes('package.json'))).toBe(
      false,
    );
    expect(containerArgs.some((arg) => arg.includes('bun.lock'))).toBe(false);
    expect(containerArgs.some((arg) => arg.includes('node_modules'))).toBe(
      false,
    );
  });
});

describe('container-runner credential strategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    mockApplyContainerConfig.mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('onecli strategy (default): calls applyContainerConfig and sends no secrets', async () => {
    const inputChunks: string[] = [];
    fakeProc.stdin.on('data', (chunk) => inputChunks.push(chunk.toString()));

    const resultPromise = runContainerAgent(
      {
        ...testGroup,
        containerConfig: {
          // credentialStrategy omitted → defaults to 'onecli'
          opencodeConfig: {
            provider: 'anthropic',
            apiKey: 'ANTHROPIC_API_KEY',
          },
        },
      },
      testInput,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    // OneCLI should have been consulted
    expect(mockApplyContainerConfig).toHaveBeenCalled();

    // No secrets should be forwarded to the container
    const parsed = JSON.parse(inputChunks.join(''));
    expect(parsed.secrets).toBeUndefined();
  });

  it('direct strategy: skips applyContainerConfig and forwards secret from env', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-directvalue');

    const inputChunks: string[] = [];
    fakeProc.stdin.on('data', (chunk) => inputChunks.push(chunk.toString()));

    const resultPromise = runContainerAgent(
      {
        ...testGroup,
        containerConfig: {
          credentialStrategy: 'direct',
          opencodeConfig: {
            provider: 'anthropic',
            apiKey: 'ANTHROPIC_API_KEY',
          },
        },
      },
      testInput,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    // OneCLI should NOT have been called for this container
    expect(mockApplyContainerConfig).not.toHaveBeenCalled();

    // Secret should be forwarded via stdin
    const parsed = JSON.parse(inputChunks.join(''));
    expect(parsed.secrets).toMatchObject({
      ANTHROPIC_API_KEY: 'sk-ant-test-directvalue',
    });
  });

  it('direct strategy: warns when apiKey env var is absent', async () => {
    // Ensure the env var is not set
    delete process.env.ANTHROPIC_API_KEY;

    const inputChunks: string[] = [];
    fakeProc.stdin.on('data', (chunk) => inputChunks.push(chunk.toString()));

    const resultPromise = runContainerAgent(
      {
        ...testGroup,
        containerConfig: {
          credentialStrategy: 'direct',
          opencodeConfig: {
            provider: 'anthropic',
            apiKey: 'ANTHROPIC_API_KEY',
          },
        },
      },
      testInput,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    // No secrets in payload when env var is missing
    const parsed = JSON.parse(inputChunks.join(''));
    expect(parsed.secrets).toBeUndefined();

    // A warning should have been logged
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'ANTHROPIC_API_KEY' }),
      expect.stringContaining('apiKey env var not found'),
    );
  });

  it('direct strategy with no apiKey: no secrets, no OneCLI', async () => {
    const inputChunks: string[] = [];
    fakeProc.stdin.on('data', (chunk) => inputChunks.push(chunk.toString()));

    const resultPromise = runContainerAgent(
      {
        ...testGroup,
        containerConfig: {
          credentialStrategy: 'direct',
          opencodeConfig: {
            provider: 'opencode',
            model: 'opencode/kimi-k2.5-free',
          },
        },
      },
      testInput,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(mockApplyContainerConfig).not.toHaveBeenCalled();

    const parsed = JSON.parse(inputChunks.join(''));
    expect(parsed.secrets).toBeUndefined();
  });
});
