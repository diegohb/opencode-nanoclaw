const DIRECT_PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENCODE_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'GITHUB_TOKEN',
] as const;

const DIRECT_PROVIDER_PATTERNS = DIRECT_PROVIDER_KEYS.map(
  (key) => new RegExp(`^${key}=`, 'm'),
);

export function hasConfiguredCredentials(envContent: string): boolean {
  return hasDirectProviderCredentials(envContent);
}

/**
 * Provider env var names that are sufficient for the 'direct' credential
 * strategy in NanoClaw. Any one of these being set enables direct auth.
 */
export function hasDirectProviderCredentials(envContent: string): boolean {
  return DIRECT_PROVIDER_PATTERNS.some((pattern) => pattern.test(envContent));
}

/**
 * Returns true when the .env content contains an OneCLI gateway URL,
 * indicating the 'onecli' credential strategy can be used.
 */
export function hasOneCLIConfig(envContent: string): boolean {
  return /^ONECLI_URL=/m.test(envContent);
}