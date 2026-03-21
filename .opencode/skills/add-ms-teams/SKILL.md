---
name: add-ms-teams
description: Add MS Teams bot channel integration to NanoClaw.
---

# Add MS Teams Channel

This skill adds Microsoft Teams support to NanoClaw using a sidecar container pattern, then walks through interactive setup.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/msteams.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Do you have an Azure Bot registration with a Microsoft App ID and App Secret, or do you need to create one?

If they have credentials, collect them now. If not, we'll create them in Phase 3.

## Phase 2: Apply Code Changes

### Ensure channel remote

```bash
git remote -v
```

If `msteams` is missing, add it:

```bash
git remote add msteams https://github.com/qwibitai/nanoclaw-msteams.git
```

### Merge the skill branch

```bash
git fetch msteams main
git merge msteams/main || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue
}
```

This merges in:

- `src/sidecar-channel.ts` (SidecarChannel abstract base class for webhook-based channels)
- `src/channels/msteams.ts` (TeamsChannel class with self-registration via `registerChannel`)
- `src/channels/msteams.test.ts` (unit tests)
- `/channel/inbound` route added to `src/credential-proxy.ts`
- Sidecar callback registration in `src/index.ts`
- `import './msteams.js'` appended to the channel barrel file `src/channels/index.ts`
- `container/teams-sidecar/` directory (Dockerfile, source, build script)
- `docs/sidecar-protocol.md` (protocol specification)
- `TEAMS_APP_ID`, `TEAMS_APP_SECRET`, `TEAMS_PORT` in `.env.example`

If the merge reports conflicts, resolve them by reading the conflicted files and understanding the intent of both sides.

### Validate code changes

```bash
npm install
npm run build
npx vitest run src/channels/msteams.test.ts
```

### Build the sidecar container

```bash
chmod +x container/teams-sidecar/build.sh
./container/teams-sidecar/build.sh
```

All tests must pass and both builds (host + sidecar) must be clean before proceeding.

## Phase 3: Setup

### Create Azure Bot Registration (if needed)

If the user doesn't have a bot registration, share [TEAMS_SETUP.md](TEAMS_SETUP.md) which has step-by-step instructions for creating one in the Azure Portal.

Quick summary:

1. Go to the [Azure Portal](https://portal.azure.com)
2. Search for "Azure Bot" and create a new Bot resource
3. Choose "Single Tenant" for the app type
4. Note the **Microsoft App ID** from the Bot Configuration page
5. Go to "Configuration" → "Manage Password" to create a new **Client Secret**
6. Under "Channels", ensure Microsoft Teams is enabled
7. In Teams Admin Center, upload or sideload the app manifest

Wait for the user to provide the App ID and App Secret.

### Configure environment

Add to `.env`:

```bash
TEAMS_APP_ID=<their-app-id>
TEAMS_APP_SECRET=<their-app-secret>
TEAMS_PORT=3978
```

Channels auto-enable when their credentials are present — no extra configuration needed.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 4: Registration

### Get Conversation ID

Tell the user:

> To get the conversation ID for registration:
>
> 1. Send any message to the bot in Teams (1:1 chat, group chat, or channel)
> 2. Check the NanoClaw logs for the inbound message — it will show the conversation ID
> 3. The JID format is: `teams:<conversation-id>`
>
> Alternatively, you can find the conversation ID in the Teams web client URL.

Wait for the user to provide the conversation ID.

### Register the channel

For a main channel (responds to all messages):

```typescript
registerGroup('teams:<conversation-id>', {
  name: '<channel-name>',
  folder: 'teams_main',
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: false,
  isMain: true,
});
```

For additional channels (trigger-only):

```typescript
registerGroup('teams:<conversation-id>', {
  name: '<channel-name>',
  folder: 'teams_<name>',
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: true,
});
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message in your registered Teams conversation:
>
> - For main channel: Any message works
> - For non-main: @mention the bot in Teams
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

Also check the sidecar container logs:

```bash
docker logs nanoclaw-sidecar-msteams
```

## Troubleshooting

### Bot not responding

1. Check `TEAMS_APP_ID` and `TEAMS_APP_SECRET` are set in `.env` AND synced to `data/env/env`
2. Check channel is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'teams:%'"`
3. For non-main channels: message must include trigger pattern (@mention the bot)
4. Service is running: `launchctl list | grep nanoclaw`
5. Sidecar container is running: `docker ps | grep nanoclaw-sidecar-msteams`

### Sidecar not starting

1. Check the sidecar image exists: `docker images | grep nanoclaw-teams-sidecar`
2. If missing, rebuild: `./container/teams-sidecar/build.sh`
3. Check port 3978 is available: `lsof -i :3978`
4. Check Docker logs: `docker logs nanoclaw-sidecar-msteams`

### Bot Framework authentication errors

1. Verify App ID and App Secret are correct
2. Ensure the bot is registered as "Single Tenant" (not Multi-Tenant)
3. Check Azure Bot resource → Configuration → Messaging endpoint
4. For local dev, the endpoint should be set via ngrok or dev tunnel

### Teams not sending messages to the bot

1. Ensure the Teams channel is enabled in the Azure Bot registration
2. Verify the bot app is installed in your Teams workspace
3. Check that the messaging endpoint is reachable from the internet
4. RSC permissions may be needed for receiving all channel messages without @mention

## After Setup

The MS Teams channel supports:

- Text messages in 1:1 chats, group chats, and channels
- @mention stripping (bot mention removed from message text)
- Message splitting for responses over 4000 characters
- Typing indicators while the agent processes
- Proactive messaging via stored conversation references
- Multiple registered channels (main + additional)
