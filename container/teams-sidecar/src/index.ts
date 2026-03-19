/**
 * MS Teams Sidecar for NanoClaw.
 *
 * Inbound: Bot Framework CloudAdapter receives Teams activities on POST /api/messages,
 *          converts them to NanoClaw NewMessage format, forwards to host via HTTP.
 * Outbound: /send and /typing endpoints called by NanoClaw host to send messages
 *           and typing indicators back to Teams.
 * Health: GET /health for liveness checks.
 */
import http from 'http';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
  TeamsActivityHandler,
  Activity,
  ActivityTypes,
  ConversationReference,
} from 'botbuilder';

import { loadRefs, storeRef, getRef } from './store.js';

// --- Configuration ---
const APP_ID = process.env.TEAMS_APP_ID || '';
const APP_SECRET = process.env.TEAMS_APP_SECRET || '';
const PORT = parseInt(process.env.TEAMS_SIDECAR_PORT || '3978', 10);
const NANOCLAW_HOST =
  process.env.NANOCLAW_HOST || 'http://host.docker.internal:3001';

if (!APP_ID || !APP_SECRET) {
  console.error('FATAL: TEAMS_APP_ID and TEAMS_APP_SECRET are required');
  process.exit(1);
}

// --- Bot Framework Setup ---
const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: APP_ID,
  MicrosoftAppPassword: APP_SECRET,
  MicrosoftAppType: 'SingleTenant',
});

const adapter = new CloudAdapter(botFrameworkAuth);

// Error handler
adapter.onTurnError = async (context: TurnContext, error: Error) => {
  console.error(`[onTurnError] ${error.message}`, error);
  try {
    await context.sendActivity('Sorry, something went wrong.');
  } catch {
    // Can't send error message — swallow
  }
};

// --- Helper: HTTP POST ---
async function httpPost(url: string, data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Activity Handler ---
class NanoClawTeamsHandler extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context: TurnContext) => {
      const activity = context.activity;

      // Store conversation reference for proactive messaging
      const ref = TurnContext.getConversationReference(activity);
      storeRef(activity.conversation.id, ref);

      // Strip @mention of our bot from the text
      let text = activity.text || '';
      if (activity.entities) {
        for (const entity of activity.entities) {
          if (entity.type === 'mention' && entity.mentioned?.id === APP_ID) {
            const mentionText = entity.text || '';
            text = text.replace(mentionText, '').trim();
          }
        }
      }

      if (!text) return; // No text content after stripping mentions

      const conversationId = activity.conversation.id;
      const jid = `teams:${conversationId}`;
      const isGroup =
        activity.conversation.isGroup === true ||
        activity.conversation.conversationType === 'channel' ||
        activity.conversation.conversationType === 'groupChat';

      const message = {
        id: activity.id || `${Date.now()}`,
        chat_jid: jid,
        sender: activity.from?.aadObjectId || activity.from?.id || 'unknown',
        sender_name: activity.from?.name || 'Unknown',
        content: text,
        timestamp: activity.timestamp
          ? new Date(activity.timestamp).toISOString()
          : new Date().toISOString(),
        is_from_me: false,
        is_bot_message: false,
      };

      const payload = {
        channel: 'msteams',
        jid,
        message,
        metadata: {
          name: activity.conversation.name || conversationId,
          isGroup,
          channel: 'msteams',
        },
      };

      // Forward to NanoClaw host
      try {
        await httpPost(`${NANOCLAW_HOST}/channel/inbound`, payload);
      } catch (err) {
        console.error('Failed to forward message to NanoClaw host:', err);
      }
    });

    this.onConversationUpdate(async (context: TurnContext) => {
      // Store conversation reference on member added/removed too
      const ref = TurnContext.getConversationReference(context.activity);
      storeRef(context.activity.conversation.id, ref);
    });
  }
}

const bot = new NanoClawTeamsHandler();

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Health check
  if (url === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', channel: 'msteams' }));
    return;
  }

  // Bot Framework inbound (Teams → sidecar)
  if (url === '/api/messages' && method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString();
      try {
        await adapter.process(
          {
            body,
            headers: req.headers,
            method: req.method!,
            url: req.url!,
          } as any,
          {
            status: (code: number) => ({
              send: (b: any) => {
                res.writeHead(code);
                res.end(typeof b === 'string' ? b : JSON.stringify(b));
              },
            }),
            end: () => {
              if (!res.writableEnded) {
                res.writeHead(200);
                res.end();
              }
            },
          } as any,
          async (context) => await bot.run(context),
        );
      } catch (err) {
        console.error('Bot Framework processing error:', err);
        if (!res.writableEnded) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Internal error' }));
        }
      }
    });
    return;
  }

  // Send message (NanoClaw host → sidecar → Teams)
  if (url === '/send' && method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const { jid, text } = JSON.parse(Buffer.concat(chunks).toString());
        const conversationId = jid.replace(/^teams:/, '');
        const ref = getRef(conversationId);
        if (!ref) {
          res.writeHead(404);
          res.end(
            JSON.stringify({ error: 'No conversation reference for this JID' }),
          );
          return;
        }
        await adapter.continueConversationAsync(
          APP_ID,
          ref as ConversationReference,
          async (context) => {
            // Split long messages (Teams limit ~28KB, use 4000 chars for safety)
            const MAX_LEN = 4000;
            if (text.length <= MAX_LEN) {
              await context.sendActivity(text);
            } else {
              for (let i = 0; i < text.length; i += MAX_LEN) {
                await context.sendActivity(text.slice(i, i + MAX_LEN));
              }
            }
          },
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Send error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // Typing indicator (NanoClaw host → sidecar → Teams)
  if (url === '/typing' && method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const { jid } = JSON.parse(Buffer.concat(chunks).toString());
        const conversationId = jid.replace(/^teams:/, '');
        const ref = getRef(conversationId);
        if (!ref) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No conversation reference' }));
          return;
        }
        await adapter.continueConversationAsync(
          APP_ID,
          ref as ConversationReference,
          async (context) => {
            await context.sendActivity({ type: ActivityTypes.Typing });
          },
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        // Typing is best-effort
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    return;
  }

  // Unknown route
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// --- Start ---
loadRefs();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Teams sidecar listening on port ${PORT}`);
  console.log(
    `Forwarding inbound messages to ${NANOCLAW_HOST}/channel/inbound`,
  );
});
