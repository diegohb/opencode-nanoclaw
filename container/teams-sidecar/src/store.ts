/**
 * Conversation reference store for Teams proactive messaging.
 * Persists to /data/conversation-refs.json (mounted volume) so references
 * survive container restarts.
 */
import fs from 'fs';
import { ConversationReference } from 'botbuilder';

const STORE_PATH =
  process.env.TEAMS_STORE_PATH || '/data/conversation-refs.json';

const refs = new Map<string, Partial<ConversationReference>>();

/** Load stored references from disk. */
export function loadRefs(): void {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      for (const [key, val] of Object.entries(data)) {
        refs.set(key, val as Partial<ConversationReference>);
      }
      console.log(`Loaded ${refs.size} conversation references`);
    }
  } catch (err) {
    console.error('Failed to load conversation references:', err);
  }
}

/** Save all references to disk. */
function saveRefs(): void {
  try {
    const dir = STORE_PATH.substring(0, STORE_PATH.lastIndexOf('/'));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj = Object.fromEntries(refs);
    fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('Failed to save conversation references:', err);
  }
}

/** Store or update a conversation reference. Key is the conversation ID. */
export function storeRef(
  conversationId: string,
  ref: Partial<ConversationReference>,
): void {
  refs.set(conversationId, ref);
  saveRefs();
}

/** Get a conversation reference by conversation ID. */
export function getRef(
  conversationId: string,
): Partial<ConversationReference> | undefined {
  return refs.get(conversationId);
}
