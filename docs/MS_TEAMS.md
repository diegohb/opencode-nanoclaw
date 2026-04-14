# MS Teams Integration

This guide covers how to install, configure, and deploy Microsoft Teams integration for NanoClaw.

## Overview

NanoClaw's MS Teams integration uses a **sidecar container pattern**:

```
Teams Cloud ΓåÆ Teams Sidecar Container ΓåÆ NanoClaw Host ΓåÆ Container Agent
                    Γåæ                         Γöé
                    ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ Responses ΓöÇΓöÇΓöÇΓöÿ
```

The sidecar container runs the Bot Framework SDK and handles all Teams-specific communication. NanoClaw forwards inbound messages to your agent containers and routes responses back to Teams.

## Installation

### Prerequisites

- NanoClaw installed and configured (run `/setup` first)
- Docker or Apple Container runtime
- An Azure account (free tier works)
- Admin access to your Teams workspace (or ability to sideload apps)

### Step 1: Apply the Integration

Run the skill in Claude Code:

```
/add-ms-teams
```

This adds:

- `src/channels/msteams.ts` - Teams channel class
- `src/sidecar-channel.ts` - Sidecar infrastructure
- `container/teams-sidecar/` - Sidecar container
- `.claude/skills/add-ms-teams/` - Skill documentation

### Step 2: Build the Sidecar Container

```bash
./container/teams-sidecar/build.sh
```

## Configuration

### Step 1: Create Azure Bot Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Click **Create a resource** ΓåÆ Search for **Azure Bot** ΓåÆ Click **Create**
3. Fill in:
   - **Bot handle**: Choose a unique name (e.g., `nanoclaw-assistant`)
   - **Subscription**: Your Azure subscription
   - **Pricing tier**: Free (F0) for development
   - **Type of App**: **Single Tenant**
   - **Creation type**: **Create new Microsoft App ID**
4. Click **Review + create** ΓåÆ **Create**

### Step 2: Get Credentials

1. Go to your Bot resource ΓåÆ **Configuration**
2. Copy the **Microsoft App ID** (this is `TEAMS_APP_ID`)
3. Click **Manage Password** ΓåÆ **Certificates & secrets** ΓåÆ **Client secrets**
4. Click **New client secret** ΓåÆ Set description and expiry ΓåÆ **Add**
5. **Copy the Value immediately** (this is `TEAMS_APP_SECRET` - shown only once)

### Step 3: Enable Teams Channel

1. In Azure Bot ΓåÆ **Channels** ΓåÆ Click **Microsoft Teams**
2. Accept terms ΓåÆ **Apply**

### Step 4: Configure Messaging Endpoint

For local development:

```bash
ngrok http 3978
```

1. Copy the HTTPS URL from ngrok
2. In Azure Bot ΓåÆ **Configuration** ΓåÆ Set **Messaging endpoint**:
   ```
   https://your-ngrok-url.ngrok.io/api/messages
   ```

For production, use your server's public URL.

### Step 5: Add Credentials to NanoClaw

Add to `.env`:

```bash
TEAMS_APP_ID=your-app-id-here
TEAMS_APP_SECRET=your-app-secret-here
TEAMS_PORT=3978
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

### Step 6: Create Teams App Manifest

Create `teams-app/manifest.json`:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
  "manifestVersion": "1.17",
  "version": "1.0.0",
  "id": "<your-app-id>",
  "developer": {
    "name": "NanoClaw",
    "websiteUrl": "https://github.com/qwibitai/nanoclaw",
    "privacyUrl": "https://github.com/qwibitai/nanoclaw",
    "termsOfUseUrl": "https://github.com/qwibitai/nanoclaw"
  },
  "name": {
    "short": "NanoClaw",
    "full": "NanoClaw AI Assistant"
  },
  "description": {
    "short": "AI assistant powered by Claude",
    "full": "Personal AI assistant powered by Claude"
  },
  "icons": {
    "color": "color.png",
    "outline": "outline.png"
  },
  "bots": [
    {
      "botId": "<your-app-id>",
      "scopes": ["personal", "team", "groupChat"],
      "supportsFiles": false,
      "isNotificationOnly": false
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": []
}
```

Replace `<your-app-id>` with your Microsoft App ID.

Create icons:

- `color.png` - 192x192 pixels
- `outline.png` - 32x32 pixels

Zip all files into `teams-app.zip`.

### Step 7: Install in Teams

**For development (sideload):**

1. Open Teams ΓåÆ **Apps** ΓåÆ **Manage your apps**
2. **Upload a custom app** ΓåÆ Select `teams-app.zip`

**For organization-wide:**

1. Go to [Teams Admin Center](https://admin.teams.microsoft.com/)
2. **Teams apps** ΓåÆ **Manage apps** ΓåÆ **Upload new app**

## Deployment

### Restart NanoClaw

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user restart nanoclaw
```

### Register a Channel

1. Send any message to your bot in Teams
2. Check NanoClaw logs for the conversation ID:

```bash
tail -f logs/nanoclaw.log
```

3. Register the channel. For a main channel (responds to all messages):

```typescript
registerGroup('teams:<conversation-id>', {
  name: 'Teams Main',
  folder: 'teams_main',
  trigger: '@NanoClaw',
  added_at: new Date().toISOString(),
  requiresTrigger: false,
  isMain: true,
});
```

For additional channels (trigger-only):

```typescript
registerGroup('teams:<conversation-id>', {
  name: 'Project Team',
  folder: 'teams_project',
  trigger: '@NanoClaw',
  added_at: new Date().toISOString(),
  requiresTrigger: true,
});
```

### Test

Send a message in your registered Teams conversation:

- **Main channel**: Any message works
- **Non-main**: @mention the bot

The bot should respond within a few seconds.

## Architecture

### JID Format

```
teams:<conversation-id>
```

Example: `teams:19:abc123@thread.tacv2`

### Folder Naming

```
teams_main        # main control channel
teams_<name>      # additional channels
```

### Container Ports

| Port | Purpose                              |
| ---- | ------------------------------------ |
| 3978 | Teams sidecar (configurable)         |
| 3979 | Sidecar inbound server (configurable via `SIDECAR_INBOUND_PORT`) |

## Troubleshooting

### Bot not responding

1. Check credentials in `.env` AND `data/env/env`
2. Verify channel is registered:
   ```bash
   sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'teams:%'"
   ```
3. For non-main channels: message must include trigger (@mention)
4. Check service is running:
   ```bash
   # macOS
   launchctl list | grep nanoclaw
   # Linux
   systemctl --user status nanoclaw
   ```
5. Check sidecar container:
   ```bash
   docker ps | grep nanoclaw-sidecar-msteams
   ```

### Sidecar not starting

1. Check image exists: `docker images | grep nanoclaw-teams-sidecar`
2. Rebuild: `./container/teams-sidecar/build.sh`
3. Check port 3978 is available: `netstat -an | grep 3978`
4. Check logs: `docker logs nanoclaw-sidecar-msteams`

### Authentication errors

1. Verify App ID and Secret are correct
2. Ensure bot is "Single Tenant" (not Multi-Tenant)
3. Check secret hasn't expired in Azure Portal

### Teams not sending messages

1. Ensure Teams channel is enabled in Azure Bot
2. Verify bot app is installed in Teams
3. Check messaging endpoint is reachable from internet
4. For receiving all channel messages without @mention, see [RSC permissions](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-messages-with-rsc)

## Features

- Text messages in 1:1 chats, group chats, and channels
- @mention stripping (bot mention removed from message text)
- Message splitting for responses over 4000 characters
- Typing indicators while agent processes
- Proactive messaging via stored conversation references
- Multiple registered channels (main + additional)
