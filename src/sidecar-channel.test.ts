import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { mockExecSync, mockSpawn, mockReadEnvFile, mockRequest } = vi.hoisted(
  () => ({
    mockExecSync: vi.fn(),
    mockSpawn: vi.fn(),
    mockReadEnvFile: vi.fn(() => ({})),
    mockRequest: vi.fn(),
  }),
);

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('http', () => ({
  default: {
    request: (...args: unknown[]) => mockRequest(...args),
  },
}));

vi.mock('./env.js', () => ({
  readEnvFile: (...args: unknown[]) => mockReadEnvFile(...args),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  hostGatewayArgs: () => [],
}));

import { SidecarChannel } from './sidecar-channel.js';

class TestSidecarChannel extends SidecarChannel {
  constructor(hostPath: string) {
    super(
      {
        name: 'test-sidecar',
        jidPrefix: 'test:',
        imageName: 'example-sidecar:latest',
        sidecarPort: 3978,
        hostPort: 43978,
        envVars: ['TEST_SECRET'],
        writableMounts: [
          {
            hostPath,
            containerPath: '/data',
          },
        ],
      },
      {
        onMessage: () => {},
        onChatMetadata: () => {},
        registeredGroups: () => ({}),
      },
    );
  }
}

function createRequest(responseBody: string) {
  return (options: unknown, callback: (response: EventEmitter) => void) => {
    const response = new EventEmitter() as EventEmitter & { statusCode?: number };
    response.statusCode = 200;

    const request = new EventEmitter() as EventEmitter & {
      write: (body: string) => void;
      end: () => void;
    };

    request.write = () => {};
    request.end = () => {
      callback(response);
      response.emit('data', Buffer.from(responseBody));
      response.emit('end');
    };

    return request;
  };
}

describe('SidecarChannel writable mounts', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = path.join(
      os.tmpdir(),
      `nanoclaw-sidecar-test-${Date.now()}-${Math.random()}`,
    );
    mockReadEnvFile.mockReturnValue({ TEST_SECRET: 'secret-value' });
    mockRequest.mockImplementation(createRequest('{"status":"ok"}'));
    mockSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates and mounts writable host paths before starting the sidecar', async () => {
    const channel = new TestSidecarChannel(tempDir);

    await channel.connect();

    expect(fs.existsSync(tempDir)).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-v', `${tempDir}:/data`]),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    await channel.disconnect();
  });
});