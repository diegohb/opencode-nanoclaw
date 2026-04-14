/**
 * MS Teams channel for NanoClaw.
 * Uses the sidecar container pattern — a separate Docker container runs
 * the Bot Framework SDK and HTTP server. This class just provides config
 * and self-registers via the channel registry.
 */
import { SidecarChannel, SidecarConfig } from '../sidecar-channel.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

const TEAMS_SIDECAR_CONFIG: SidecarConfig = {
  name: 'msteams',
  jidPrefix: 'teams:',
  imageName: 'nanoclaw-teams-sidecar:latest',
  sidecarPort: 3978,
  hostPort: parseInt(readEnvFile(['TEAMS_PORT']).TEAMS_PORT || '3978', 10),
  envVars: ['TEAMS_APP_ID', 'TEAMS_APP_SECRET'],
};

class TeamsChannel extends SidecarChannel {
  constructor(opts: ChannelOpts) {
    super(TEAMS_SIDECAR_CONFIG, opts);
  }
}

// Self-register at import time.
// Factory returns null if credentials are missing (standard NanoClaw pattern).
registerChannel('msteams', (opts: ChannelOpts) => {
  const secrets = readEnvFile(['TEAMS_APP_ID', 'TEAMS_APP_SECRET']);
  if (!secrets.TEAMS_APP_ID || !secrets.TEAMS_APP_SECRET) {
    logger.debug('MS Teams credentials not found — channel disabled');
    return null;
  }
  return new TeamsChannel(opts);
});
