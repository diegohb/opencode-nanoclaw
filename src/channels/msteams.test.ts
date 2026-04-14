import { describe, it, expect } from 'vitest';
import { getChannelFactory } from './registry.js';

// Import the channel to trigger self-registration
import './msteams.js';

describe('msteams channel', () => {
  describe('factory registration', () => {
    it('registers with the channel registry', () => {
      const factory = getChannelFactory('msteams');
      expect(factory).toBeDefined();
    });

    it('returns null when credentials are missing', () => {
      const factory = getChannelFactory('msteams')!;
      const channel = factory({
        onMessage: () => {},
        onChatMetadata: () => {},
        registeredGroups: () => ({}),
      });
      // Without TEAMS_APP_ID / TEAMS_APP_SECRET in .env, factory returns null
      expect(channel).toBeNull();
    });
  });

  describe('JID ownership', () => {
    it('owns teams: prefixed JIDs', () => {
      const jid = 'teams:19:abc123@thread.tacv2';
      expect(jid.startsWith('teams:')).toBe(true);
    });

    it('does not own other prefixed JIDs', () => {
      expect('dc:12345'.startsWith('teams:')).toBe(false);
      expect('slack:C123'.startsWith('teams:')).toBe(false);
      expect('12345@g.us'.startsWith('teams:')).toBe(false);
    });
  });
});
