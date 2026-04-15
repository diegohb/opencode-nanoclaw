import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('register.run', () => {
  let tmpDir: string;
  let emitStatus: ReturnType<typeof vi.fn>;
  let initDatabase: ReturnType<typeof vi.fn>;
  let setRegisteredGroup: ReturnType<typeof vi.fn>;

  async function loadRegisterModule(validFolder = true) {
    vi.resetModules();
    emitStatus = vi.fn();
    initDatabase = vi.fn();
    setRegisteredGroup = vi.fn();

    vi.doMock('../src/config.ts', () => ({
      STORE_DIR: path.join(tmpDir, 'store'),
    }));
    vi.doMock('../src/db.ts', () => ({
      initDatabase,
      setRegisteredGroup,
    }));
    vi.doMock('../src/group-folder.ts', () => ({
      isValidGroupFolder: vi.fn(() => validFolder),
    }));
    vi.doMock('../src/logger.ts', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));
    vi.doMock('./status.ts', () => ({ emitStatus }));

    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    return import('./register.ts');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-register-run-'));
    fs.mkdirSync(path.join(tmpDir, 'groups', 'main'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'groups', 'global'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'groups', 'main', 'AGENTS.md'),
      '# Andy\n\nYou are Andy.\n\n## Admin Context',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'groups', 'global', 'AGENTS.md'),
      '# Andy\n\nYou are Andy.',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies the global AGENTS template and writes registration', async () => {
    const { run } = await loadRegisterModule();

    await run([
      '--jid',
      '123@g.us',
      '--name',
      'Dev Team',
      '--trigger',
      '@Andy',
      '--folder',
      'telegram_dev-team',
      '--channel',
      'telegram',
    ]);

    expect(initDatabase).toHaveBeenCalled();
    expect(setRegisteredGroup).toHaveBeenCalledWith(
      '123@g.us',
      expect.objectContaining({
        name: 'Dev Team',
        folder: 'telegram_dev-team',
        trigger: '@Andy',
        isMain: false,
      }),
    );
    expect(
      fs.readFileSync(
        path.join(tmpDir, 'groups', 'telegram_dev-team', 'AGENTS.md'),
        'utf-8',
      ),
    ).toContain('You are Andy');
    expect(emitStatus).toHaveBeenCalledWith(
      'REGISTER_CHANNEL',
      expect.objectContaining({
        STATUS: 'success',
        CHANNEL: 'telegram',
        FOLDER: 'telegram_dev-team',
      }),
    );
  });

  it('never overwrites an existing AGENTS.md during registration', async () => {
    const destDir = path.join(tmpDir, 'groups', 'slack_main');
    fs.mkdirSync(destDir, { recursive: true });
    const destFile = path.join(destDir, 'AGENTS.md');
    fs.writeFileSync(destFile, '# Custom\n\nDo not replace this file.');

    const { run } = await loadRegisterModule();

    await run([
      '--jid',
      '456@g.us',
      '--name',
      'Slack Main',
      '--trigger',
      '@Andy',
      '--folder',
      'slack_main',
      '--channel',
      'slack',
      '--is-main',
    ]);

    expect(fs.readFileSync(destFile, 'utf-8')).toContain(
      'Do not replace this file.',
    );
  });

  it('updates AGENTS files and .env when assistant name changes', async () => {
    fs.mkdirSync(path.join(tmpDir, 'groups', 'existing'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'groups', 'existing', 'AGENTS.md'),
      '# Andy\n\nYou are Andy.',
    );

    const { run } = await loadRegisterModule();

    await run([
      '--jid',
      '789@g.us',
      '--name',
      'Discord Main',
      '--trigger',
      '@Andy',
      '--folder',
      'discord_main',
      '--channel',
      'discord',
      '--is-main',
      '--assistant-name',
      'Luna',
    ]);

    expect(
      fs.readFileSync(path.join(tmpDir, 'groups', 'main', 'AGENTS.md'), 'utf-8'),
    ).toContain('# Luna');
    expect(
      fs.readFileSync(
        path.join(tmpDir, 'groups', 'existing', 'AGENTS.md'),
        'utf-8',
      ),
    ).toContain('You are Luna');
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')).toContain(
      'ASSISTANT_NAME="Luna"',
    );
    expect(emitStatus).toHaveBeenCalledWith(
      'REGISTER_CHANNEL',
      expect.objectContaining({ NAME_UPDATED: true, ASSISTANT_NAME: 'Luna' }),
    );
  });
});