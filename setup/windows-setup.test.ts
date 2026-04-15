import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('native Windows setup guidance', () => {
  it('fails container setup early with WSL guidance on native Windows', async () => {
    const emitStatus = vi.fn();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    vi.doMock('./platform.js', () => ({
      commandExists: vi.fn(() => true),
      isNativeWindows: vi.fn(() => true),
    }));
    vi.doMock('./status.ts', () => ({ emitStatus }));
    vi.doMock('../src/logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { run } = await import('./container.ts');

    await expect(run(['--runtime', 'docker'])).rejects.toThrow('exit:2');
    expect(emitStatus).toHaveBeenCalledWith(
      'SETUP_CONTAINER',
      expect.objectContaining({
        ERROR: 'native_windows_not_supported',
        GUIDANCE: 'use_wsl2_or_linux',
      }),
    );
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('fails service setup early with WSL guidance on native Windows', async () => {
    const emitStatus = vi.fn();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    vi.doMock('./platform.js', () => ({
      getPlatform: vi.fn(() => 'windows'),
      getNodePath: vi.fn(() => 'C:\\Program Files\\nodejs\\node.exe'),
      getServiceManager: vi.fn(() => 'none'),
      hasSystemd: vi.fn(() => false),
      isNativeWindows: vi.fn(() => true),
      isRoot: vi.fn(() => false),
      isWSL: vi.fn(() => false),
    }));
    vi.doMock('./status.ts', () => ({ emitStatus }));
    vi.doMock('../src/logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const { run } = await import('./service.ts');

    await expect(run([])).rejects.toThrow('exit:2');
    expect(emitStatus).toHaveBeenCalledWith(
      'SETUP_SERVICE',
      expect.objectContaining({
        ERROR: 'native_windows_not_supported',
        GUIDANCE: 'use_wsl2_or_linux',
      }),
    );
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});