import fs from 'fs';
import os from 'os';
import path from 'path';

import { CredentialStrategy, OpencodeConfig } from './types.js';

const PROVIDER_API_KEY_ENV_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  copilot: 'GITHUB_TOKEN',
};

function getModelProvider(model?: string): string | undefined {
  if (!model) return undefined;
  const [provider] = model.split('/');
  return provider || undefined;
}

function hasConfigFields(config?: OpencodeConfig): boolean {
  return Boolean(
    config?.provider || config?.apiKey || config?.model || config?.small_model,
  );
}

export function readHostOpencodeModel(): {
  model?: string;
  small_model?: string;
} | null {
  const cfgPath = path.join(
    os.homedir(),
    '.config',
    'opencode',
    'opencode.json',
  );
  if (!fs.existsSync(cfgPath)) return null;
  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const stripped = raw
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const model = typeof parsed.model === 'string' ? parsed.model : undefined;
    const small_model =
      typeof parsed.small_model === 'string' ? parsed.small_model : undefined;
    return model || small_model ? { model, small_model } : null;
  } catch {
    return null;
  }
}

export function resolveApiKeyEnvVar(
  config?: OpencodeConfig,
): string | undefined {
  if (config?.apiKey) return config.apiKey;

  const provider =
    config?.provider ??
    getModelProvider(config?.model) ??
    getModelProvider(config?.small_model);

  if (provider) {
    return PROVIDER_API_KEY_ENV_VARS[provider.toLowerCase()];
  }

  return process.env.OPENCODE_API_KEY ? 'OPENCODE_API_KEY' : undefined;
}

export function resolveEffectiveOpencodeConfig(
  groupConfig?: OpencodeConfig,
  inputConfig?: OpencodeConfig,
): { config?: OpencodeConfig; usedHostModelDefaults: boolean } {
  let config: OpencodeConfig | undefined = {
    ...groupConfig,
    ...inputConfig,
  };
  if (!hasConfigFields(config)) {
    config = undefined;
  }

  let usedHostModelDefaults = false;
  if (!config || (!config.model && !config.small_model)) {
    const hostModel = readHostOpencodeModel();
    if (hostModel) {
      config = {
        ...config,
        model: hostModel.model,
        small_model: hostModel.small_model,
      };
      usedHostModelDefaults = Boolean(hostModel.model || hostModel.small_model);
    }
  }

  if (!config && process.env.OPENCODE_API_KEY) {
    config = { provider: 'opencode' };
  }

  if (!config) {
    return { config: undefined, usedHostModelDefaults };
  }

  const apiKey = resolveApiKeyEnvVar(config);
  if (apiKey && apiKey !== config.apiKey) {
    config = { ...config, apiKey };
  }

  return { config, usedHostModelDefaults };
}

export function resolveCredentialStrategy(
  configuredStrategy: CredentialStrategy | undefined,
  config?: OpencodeConfig,
): CredentialStrategy {
  if (configuredStrategy) return configuredStrategy;

  const apiKeyEnvVar = resolveApiKeyEnvVar(config);
  if (apiKeyEnvVar && process.env[apiKeyEnvVar]) {
    return 'direct';
  }

  return 'onecli';
}
