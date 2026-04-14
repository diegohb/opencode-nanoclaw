import fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-rc-test',
}));

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

import {
  startRemoteControl,
  stopRemoteControl,
  restoreRemoteControl,
  getActiveSession,
  _resetForTesting,
  _getStateFilePath,
} from './remote-control.js';

function createMockProcess(pid = 12345) {
  return {
    pid,
    unref: vi.fn(),
    kill: vi.fn(),
    stdin: { write: vi.fn(), end: vi.fn() },
  };
}

describe('remote-control', () => {
  const STATE_FILE = _getStateFilePath();
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let writeFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let unlinkSyncSpy: ReturnType<typeof vi.spyOn>;
  let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
  let openSyncSpy: ReturnType<typeof vi.spyOn>;
  let closeSyncSpy: ReturnType<typeof vi.spyOn>;

  let stdoutFileContent: string;

  beforeEach(() => {
    _resetForTesting();
    spawnMock.mockReset();
    stdoutFileContent = '';

    mkdirSyncSpy = vi
      .spyOn(fs, 'mkdirSync')
      .mockImplementation(() => undefined as any);
    writeFileSyncSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => {});
    unlinkSyncSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    openSyncSpy = vi.spyOn(fs, 'openSync').mockReturnValue(42 as any);
    closeSyncSpy = vi.spyOn(fs, 'closeSync').mockImplementation(() => {});

    readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: string,
    ) => {
      if (p.endsWith('remote-control.stdout')) return stdoutFileContent;
      if (p.endsWith('remote-control.json')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return '';
    }) as any);
  });

  afterEach(() => {
    _resetForTesting();
    vi.restoreAllMocks();
  });

  describe('startRemoteControl', () => {
    it('spawns opencode serve and returns the network URL', async () => {
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      stdoutFileContent = `
  Local access:       http://localhost:49152
  Network access:     http://192.168.1.100:49152
`;
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      const result = await startRemoteControl('user1', 'tg:123', '/project');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url).toMatch(
          /^http:\/\/opencode:[\w-]+@192\.168\.1\.100:49152\/?$/,
        );
      }
      const spawnCall = spawnMock.mock.calls[0];
      expect(spawnCall[0]).toBe('opencode');
      expect(spawnCall[1]).toContain('serve');
      expect(spawnCall[1]).toContain('--hostname');
      expect(spawnCall[1]).toContain('0.0.0.0');
      expect(spawnCall[2]).toMatchObject({ cwd: '/project', detached: true });
      expect(spawnCall[2].env?.OPENCODE_SERVER_PASSWORD).toBeDefined();
      expect(proc.unref).toHaveBeenCalled();
    });

    it('uses file descriptors for stdout/stderr (not pipes)', async () => {
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);
      stdoutFileContent = 'Network access:     http://192.168.1.100:49152\n';
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      await startRemoteControl('user1', 'tg:123', '/project');

      const spawnCall = spawnMock.mock.calls[0];
      const options = spawnCall[2];
      expect(options.stdio[0]).toBe('ignore');
      expect(typeof options.stdio[1]).toBe('number');
      expect(typeof options.stdio[2]).toBe('number');
    });

    it('closes file descriptors in parent after spawn', async () => {
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);
      stdoutFileContent = 'Network access:     http://192.168.1.100:49152\n';
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      await startRemoteControl('user1', 'tg:123', '/project');

      expect(openSyncSpy).toHaveBeenCalledTimes(2);
      expect(closeSyncSpy).toHaveBeenCalledTimes(2);
    });

    it('saves state to disk after capturing URL', async () => {
      const proc = createMockProcess(99999);
      spawnMock.mockReturnValue(proc);
      stdoutFileContent = 'Network access:     http://192.168.1.100:49152\n';
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      await startRemoteControl('user1', 'tg:123', '/project');

      expect(writeFileSyncSpy).toHaveBeenCalledWith(
        STATE_FILE,
        expect.stringContaining('"pid":99999'),
      );
      expect(writeFileSyncSpy).toHaveBeenCalledWith(
        STATE_FILE,
        expect.stringContaining('"port":'),
      );
      expect(writeFileSyncSpy).toHaveBeenCalledWith(
        STATE_FILE,
        expect.stringContaining('"password":'),
      );
    });

    it('returns existing URL if session is already active', async () => {
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);
      stdoutFileContent = 'Network access:     http://192.168.1.100:49152\n';
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      const result1 = await startRemoteControl('user1', 'tg:123', '/project');
      expect(result1.ok).toBe(true);

      const result2 = await startRemoteControl('user2', 'tg:456', '/project');
      expect(result2.ok).toBe(true);
      if (result2.ok && result1.ok) {
        expect(result2.url).toBe(result1.url);
      }
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('starts new session if existing process is dead', async () => {
      const proc1 = createMockProcess(11111);
      const proc2 = createMockProcess(22222);
      spawnMock.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation((() => true) as any);
      stdoutFileContent = 'Network access:     http://192.168.1.100:49152\n';
      await startRemoteControl('user1', 'tg:123', '/project');

      killSpy.mockImplementation(((pid: number, sig: any) => {
        if (pid === 11111 && (sig === 0 || sig === undefined)) {
          throw new Error('ESRCH');
        }
        return true;
      }) as any);

      stdoutFileContent = 'Network access:     http://192.168.1.100:49153\n';
      const result = await startRemoteControl('user1', 'tg:123', '/project');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url).toContain('http://');
        expect(result.url).toContain('@192.168.1.100:49153');
      }
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it('returns error if process exits before URL', async () => {
      const proc = createMockProcess(33333);
      spawnMock.mockReturnValue(proc);
      stdoutFileContent = '';

      vi.spyOn(process, 'kill').mockImplementation((() => {
        throw new Error('ESRCH');
      }) as any);

      const result = await startRemoteControl('user1', 'tg:123', '/project');
      expect(result).toEqual({
        ok: false,
        error: 'Process exited before producing URL',
      });
    });

    it('times out if URL never appears', async () => {
      vi.useFakeTimers();
      const proc = createMockProcess(44444);
      spawnMock.mockReturnValue(proc);
      stdoutFileContent = 'no url here';
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      const promise = startRemoteControl('user1', 'tg:123', '/project');

      for (let i = 0; i < 160; i++) {
        vi.advanceTimersByTime(200);
      }

      const result = await promise;
      expect(result).toEqual({
        ok: false,
        error: 'Timed out waiting for Remote Control URL',
      });

      vi.useRealTimers();
    });

    it('returns error if spawn throws', async () => {
      spawnMock.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = await startRemoteControl('user1', 'tg:123', '/project');
      expect(result).toEqual({
        ok: false,
        error: 'Failed to start: ENOENT',
      });
    });
  });

  describe('stopRemoteControl', () => {
    it('kills the process and clears state', async () => {
      const proc = createMockProcess(55555);
      spawnMock.mockReturnValue(proc);
      stdoutFileContent = 'Network access:     http://192.168.1.100:49152\n';
      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation((() => true) as any);

      await startRemoteControl('user1', 'tg:123', '/project');

      const result = stopRemoteControl();
      expect(result).toEqual({ ok: true });
      expect(killSpy).toHaveBeenCalledWith(55555, 'SIGTERM');
      expect(unlinkSyncSpy).toHaveBeenCalledWith(STATE_FILE);
      expect(getActiveSession()).toBeNull();
    });

    it('returns error when no session is active', () => {
      const result = stopRemoteControl();
      expect(result).toEqual({
        ok: false,
        error: 'No active Remote Control session',
      });
    });
  });

  describe('restoreRemoteControl', () => {
    it('restores session if state file exists and process is alive', () => {
      const session = {
        pid: 77777,
        url: 'http://opencode:Apple-Banana-Cherry@192.168.1.100:49152',
        port: 49152,
        password: 'Apple-Banana-Cherry',
        startedBy: 'user1',
        startedInChat: 'tg:123',
        startedAt: '2026-01-01T00:00:00.000Z',
      };
      readFileSyncSpy.mockImplementation(((p: string) => {
        if (p.endsWith('remote-control.json')) return JSON.stringify(session);
        return '';
      }) as any);
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      restoreRemoteControl();

      const active = getActiveSession();
      expect(active).not.toBeNull();
      expect(active!.pid).toBe(77777);
      expect(active!.url).toBe(
        'http://opencode:Apple-Banana-Cherry@192.168.1.100:49152',
      );
      expect(active!.port).toBe(49152);
      expect(active!.password).toBe('Apple-Banana-Cherry');
    });

    it('clears state if process is dead', () => {
      const session = {
        pid: 88888,
        url: 'http://opencode:Apple-Banana-Cherry@192.168.1.100:49152',
        port: 49152,
        password: 'Apple-Banana-Cherry',
        startedBy: 'user1',
        startedInChat: 'tg:123',
        startedAt: '2026-01-01T00:00:00.000Z',
      };
      readFileSyncSpy.mockImplementation(((p: string) => {
        if (p.endsWith('remote-control.json')) return JSON.stringify(session);
        return '';
      }) as any);
      vi.spyOn(process, 'kill').mockImplementation((() => {
        throw new Error('ESRCH');
      }) as any);

      restoreRemoteControl();

      expect(getActiveSession()).toBeNull();
      expect(unlinkSyncSpy).toHaveBeenCalled();
    });

    it('does nothing if no state file exists', () => {
      restoreRemoteControl();
      expect(getActiveSession()).toBeNull();
    });

    it('clears state on corrupted JSON', () => {
      readFileSyncSpy.mockImplementation(((p: string) => {
        if (p.endsWith('remote-control.json')) return 'not json{{{';
        return '';
      }) as any);

      restoreRemoteControl();

      expect(getActiveSession()).toBeNull();
      expect(unlinkSyncSpy).toHaveBeenCalled();
    });

    it('stopRemoteControl works after restoreRemoteControl', () => {
      const session = {
        pid: 77777,
        url: 'http://opencode:Apple-Banana-Cherry@192.168.1.100:49152',
        port: 49152,
        password: 'Apple-Banana-Cherry',
        startedBy: 'user1',
        startedInChat: 'tg:123',
        startedAt: '2026-01-01T00:00:00.000Z',
      };
      readFileSyncSpy.mockImplementation(((p: string) => {
        if (p.endsWith('remote-control.json')) return JSON.stringify(session);
        return '';
      }) as any);
      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation((() => true) as any);

      restoreRemoteControl();
      expect(getActiveSession()).not.toBeNull();

      const result = stopRemoteControl();
      expect(result).toEqual({ ok: true });
      expect(killSpy).toHaveBeenCalledWith(77777, 'SIGTERM');
      expect(unlinkSyncSpy).toHaveBeenCalled();
      expect(getActiveSession()).toBeNull();
    });

    it('startRemoteControl returns restored URL without spawning', () => {
      const session = {
        pid: 77777,
        url: 'http://opencode:Apple-Banana-Cherry@192.168.1.100:49152',
        port: 49152,
        password: 'Apple-Banana-Cherry',
        startedBy: 'user1',
        startedInChat: 'tg:123',
        startedAt: '2026-01-01T00:00:00.000Z',
      };
      readFileSyncSpy.mockImplementation(((p: string) => {
        if (p.endsWith('remote-control.json')) return JSON.stringify(session);
        return '';
      }) as any);
      vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

      restoreRemoteControl();

      return startRemoteControl('user2', 'tg:456', '/project').then(
        (result) => {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.url).toBe(
              'http://opencode:Apple-Banana-Cherry@192.168.1.100:49152',
            );
          }
          expect(spawnMock).not.toHaveBeenCalled();
        },
      );
    });
  });
});
