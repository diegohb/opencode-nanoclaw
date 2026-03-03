import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';

const originalCwd = process.cwd();

describe('group folder validation', () => {
  it('validates allowed folder names', () => {
    expect(isValidGroupFolder('family-chat')).toBe(true);
    expect(isValidGroupFolder('Team_42')).toBe(true);
  });

  it('rejects traversal and reserved names', () => {
    expect(isValidGroupFolder('../../etc')).toBe(false);
    expect(isValidGroupFolder('/tmp')).toBe(false);
    expect(isValidGroupFolder('global')).toBe(false);
    expect(isValidGroupFolder('')).toBe(false);
  });

  it.skip('resolves safe paths under groups directory', () => {
    const savedCwd = process.cwd();
    process.chdir(originalCwd);
    try {
      const resolved = resolveGroupFolderPath('family-chat');
      expect(
        resolved.split(path.sep).join('/').endsWith('/groups/family-chat'),
      ).toBe(true);
    } finally {
      process.chdir(savedCwd);
    }
  });

  it.skip('resolves safe paths under data ipc directory', () => {
    const savedCwd = process.cwd();
    process.chdir(originalCwd);
    try {
      const resolved = resolveGroupIpcPath('family-chat');
      expect(
        resolved.split(path.sep).join('/').endsWith('/data/ipc/family-chat'),
      ).toBe(true);
    } finally {
      process.chdir(savedCwd);
    }
  });

  it('throws for unsafe folder names', () => {
    expect(() => resolveGroupFolderPath('../../etc')).toThrow();
    expect(() => resolveGroupIpcPath('/tmp')).toThrow();
  });
});
