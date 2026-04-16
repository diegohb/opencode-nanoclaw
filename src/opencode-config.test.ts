import fs from 'fs';
import os from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveApiKeyEnvVar,
  resolveCredentialStrategy,
  resolveEffectiveOpencodeConfig,
} from './opencode-config.js';

describe('opencode config resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('prefers explicit apiKey env var name', () => {
    expect(
      resolveApiKeyEnvVar({ provider: 'anthropic', apiKey: 'CUSTOM_KEY' }),
    ).toBe('CUSTOM_KEY');
  });

  it('infers apiKey env var name from provider', () => {
    expect(resolveApiKeyEnvVar({ provider: 'openai' })).toBe('OPENAI_API_KEY');
  });

  it('infers apiKey env var name from model provider prefix', () => {
    expect(resolveApiKeyEnvVar({ model: 'openrouter/sonnet' })).toBe(
      'OPENROUTER_API_KEY',
    );
  });

  it('falls back to OPENCODE_API_KEY when no provider is specified and env is present', () => {
    vi.stubEnv('OPENCODE_API_KEY', 'oc-test');
    expect(resolveApiKeyEnvVar()).toBe('OPENCODE_API_KEY');
  });

  it('returns undefined when no provider or fallback env can be resolved', () => {
    expect(resolveApiKeyEnvVar()).toBeUndefined();
  });

  it('merges group and input config and infers provider env var', () => {
    const resolved = resolveEffectiveOpencodeConfig(
      { provider: 'anthropic', model: 'anthropic/claude-sonnet-4' },
      { small_model: 'anthropic/claude-haiku-4' },
    );

    expect(resolved.usedHostModelDefaults).toBe(false);
    expect(resolved.config).toMatchObject({
      provider: 'anthropic',
      model: 'anthropic/claude-sonnet-4',
      small_model: 'anthropic/claude-haiku-4',
      apiKey: 'ANTHROPIC_API_KEY',
    });
  });

  it('uses host OpenCode model defaults when explicit models are absent', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/tmp/home');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '{"model":"opencode/primary","small_model":"opencode/small"}',
    );

    const resolved = resolveEffectiveOpencodeConfig({ provider: 'opencode' });

    expect(resolved.usedHostModelDefaults).toBe(true);
    expect(resolved.config).toMatchObject({
      provider: 'opencode',
      model: 'opencode/primary',
      small_model: 'opencode/small',
      apiKey: 'OPENCODE_API_KEY',
    });
  });

  it('creates default opencode config when only OPENCODE_API_KEY is available', () => {
    vi.stubEnv('OPENCODE_API_KEY', 'oc-test');

    const resolved = resolveEffectiveOpencodeConfig();

    expect(resolved.usedHostModelDefaults).toBe(false);
    expect(resolved.config).toMatchObject({
      provider: 'opencode',
      apiKey: 'OPENCODE_API_KEY',
    });
  });
});

describe('credential strategy resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('respects explicit onecli strategy', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    expect(
      resolveCredentialStrategy('onecli', {
        provider: 'anthropic',
        apiKey: 'ANTHROPIC_API_KEY',
      }),
    ).toBe('onecli');
  });

  it('defaults to direct when the resolved credential exists in the environment', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    expect(
      resolveCredentialStrategy(undefined, { provider: 'anthropic' }),
    ).toBe('direct');
  });

  it('defaults to onecli when no direct credential can be resolved', () => {
    expect(
      resolveCredentialStrategy(undefined, { provider: 'anthropic' }),
    ).toBe('onecli');
  });
});
