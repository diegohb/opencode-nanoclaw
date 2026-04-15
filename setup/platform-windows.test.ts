import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('platform windows behavior', () => {
  it('reports Windows as a first-class platform', async () => {
    vi.doMock('os', () => ({
      default: {
        platform: () => 'win32',
      },
    }));

    const { getPlatform } = await import('./platform.js');

    expect(getPlatform()).toBe('windows');
  });

  it('uses where.exe to resolve node on Windows', async () => {
    const execSync = vi.fn(() => 'C:\\Program Files\\nodejs\\node.exe\r\n');

    vi.doMock('child_process', () => ({ execSync }));
    vi.doMock('os', () => ({
      default: {
        platform: () => 'win32',
      },
    }));
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      execPath: 'C:\\node.exe',
    });

    const { getNodePath } = await import('./platform.js');

    expect(getNodePath()).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(execSync).toHaveBeenCalledWith('where.exe node', {
      encoding: 'utf-8',
    });
  });

  it('uses where.exe to detect commands on Windows', async () => {
    const execSync = vi.fn();

    vi.doMock('child_process', () => ({ execSync }));
    vi.doMock('os', () => ({
      default: {
        platform: () => 'win32',
      },
    }));
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      execPath: 'C:\\node.exe',
    });

    const { commandExists } = await import('./platform.js');

    expect(commandExists('docker')).toBe(true);
    expect(execSync).toHaveBeenCalledWith('where.exe docker', {
      stdio: 'ignore',
    });
  });

  it('uses cmd.exe start to open the browser on Windows', async () => {
    const execSync = vi.fn();

    vi.doMock('child_process', () => ({ execSync }));
    vi.doMock('os', () => ({
      default: {
        platform: () => 'win32',
      },
    }));
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      execPath: 'C:\\node.exe',
      env: process.env,
    });

    const { openBrowser } = await import('./platform.js');

    expect(openBrowser('https://example.com')).toBe(true);
    expect(execSync).toHaveBeenCalledWith(
      'cmd.exe /c start "" "https://example.com"',
      { stdio: 'ignore' },
    );
  });
});