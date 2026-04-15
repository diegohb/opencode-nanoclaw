const SETUP_CREDENTIAL_PATTERN =
  /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=/m;

export function hasConfiguredCredentials(envContent: string): boolean {
  return SETUP_CREDENTIAL_PATTERN.test(envContent);
}