const SETUP_CREDENTIAL_PATTERN =
  /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=/m;

export function hasConfiguredCredentials(envContent: string): boolean {
  return SETUP_CREDENTIAL_PATTERN.test(envContent);
}

/**
 * Provider env var names that are sufficient for the 'direct' credential
 * strategy in NanoClaw. Any one of these being set enables direct auth.
 */
const DIRECT_PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
] as const;

/**
 * Returns true when the .env content contains at least one provider key
 * that supports the 'direct' credential strategy.
 */
export function hasDirectProviderCredentials(envContent: string): boolean {
  return DIRECT_PROVIDER_KEYS.some((key) =>
    new RegExp(`^${key}=`, 'm').test(envContent),
  );
}

/**
 * Returns true when the .env content contains an OneCLI gateway URL,
 * indicating the 'onecli' credential strategy can be used.
 */
export function hasOneCLIConfig(envContent: string): boolean {
  return /^ONECLI_URL=/m.test(envContent);
}