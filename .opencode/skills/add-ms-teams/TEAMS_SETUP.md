# MS Teams Bot Setup Guide

Step-by-step guide for creating a Microsoft Teams bot and connecting it to NanoClaw.

## Prerequisites

- An Azure account (free tier works)
- Admin access to your Microsoft Teams workspace (or ability to sideload apps)

## Step 1: Create Azure Bot Resource

1. Go to [Azure Portal](https://portal.azure.com)
2. Click **Create a resource**
3. Search for **Azure Bot** and click **Create**
4. Fill in:
   - **Bot handle**: Choose a unique name (e.g., `nanoclaw-assistant`)
   - **Subscription**: Your Azure subscription
   - **Resource group**: Create new or use existing
   - **Pricing tier**: Free (F0) for development
   - **Type of App**: **Single Tenant**
   - **Creation type**: **Create new Microsoft App ID**
5. Click **Review + create**, then **Create**

## Step 2: Get App ID and Secret

1. Go to your newly created Bot resource
2. Click **Configuration** in the left sidebar
3. Copy the **Microsoft App ID** — you'll need this for `TEAMS_APP_ID`
4. Click **Manage Password** (next to Microsoft App ID)
5. This opens the Azure AD App Registration page
6. Go to **Certificates & secrets** → **Client secrets**
7. Click **New client secret**
8. Set a description (e.g., "NanoClaw") and expiry
9. Click **Add**
10. **Copy the Value immediately** — you can only see it once. This is your `TEAMS_APP_SECRET`

## Step 3: Enable Teams Channel

1. Back in the Azure Bot resource, click **Channels** in the left sidebar
2. Click **Microsoft Teams** to enable it
3. Accept the terms of service
4. Click **Apply**

## Step 4: Configure Messaging Endpoint

The messaging endpoint is where Teams sends messages to your bot. For NanoClaw's sidecar architecture, this needs to reach the sidecar container's `/api/messages` endpoint.

### For local development (with ngrok or dev tunnel)

1. Install [ngrok](https://ngrok.com/) or use [VS Code Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/)
2. Start a tunnel to port 3978:
   ```bash
   ngrok http 3978
   ```
3. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. In Azure Bot → Configuration, set **Messaging endpoint** to:
   ```
   https://abc123.ngrok.io/api/messages
   ```

### For production (with a public server)

Set the messaging endpoint to your server's public URL:

```
https://your-domain.com/api/messages
```

Ensure port 3978 (or your configured `TEAMS_PORT`) is forwarded appropriately.

## Step 5: Create Teams App Manifest

To use the bot in Teams, you need an app manifest:

1. Create a `manifest.json`:
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
       "short": "NanoClaw Assistant",
       "full": "NanoClaw AI Assistant"
     },
     "description": {
       "short": "AI assistant powered by Claude",
       "full": "Personal AI assistant powered by Claude, running in NanoClaw"
     },
     "icons": {
       "color": "color.png",
       "outline": "outline.png"
     },
     "accentColor": "#FFFFFF",
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
2. Replace `<your-app-id>` with your Microsoft App ID
3. Create simple 192x192 (color.png) and 32x32 (outline.png) icon images
4. Zip all three files into `teams-app.zip`

## Step 6: Install the App in Teams

### Option A: Sideload (for development)

1. Open Microsoft Teams
2. Click **Apps** in the left sidebar
3. Click **Manage your apps** at the bottom
4. Click **Upload a custom app** → **Upload for me or my teams**
5. Select your `teams-app.zip`

### Option B: Teams Admin Center (for organization-wide)

1. Go to [Teams Admin Center](https://admin.teams.microsoft.com/)
2. Navigate to **Teams apps** → **Manage apps**
3. Click **Upload new app**
4. Select your `teams-app.zip`
5. Once uploaded, configure policies to make it available to users

## Step 7: Test the Bot

1. In Teams, find the bot in your chats (or add it to a channel)
2. Send it a message: "Hello"
3. Check NanoClaw logs for the inbound message
4. The bot should respond once the channel is registered in NanoClaw

## Credential Reference

| Variable           | Where to Find                                                              | Format                           |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------- |
| `TEAMS_APP_ID`     | Azure Bot → Configuration → Microsoft App ID                               | UUID (e.g., `12345678-abcd-...`) |
| `TEAMS_APP_SECRET` | Azure AD → App Registration → Certificates & secrets → Client secret Value | String                           |
| `TEAMS_PORT`       | Your choice (default: 3978)                                                | Number                           |

## Troubleshooting

### "Unauthorized" errors from Bot Framework

- Verify your App ID and Secret are correct
- Check the bot type is "Single Tenant" (not Multi-Tenant)
- Ensure the secret hasn't expired

### "Could not find a part of the path" or 404 errors

- The messaging endpoint must be accessible from the internet
- Check ngrok/tunnel is running and the URL is correct in Azure Bot Configuration

### Bot appears in Teams but doesn't respond

- Check NanoClaw is running and the sidecar container is up
- Verify the channel is registered in NanoClaw: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'teams:%'"`
- Check sidecar logs: `docker logs nanoclaw-sidecar-msteams`

### RSC Permissions (for receiving all channel messages)

By default, bots in Teams channels only receive messages when @mentioned. To receive all messages:

1. Add `ChannelMessage.Read.Group` to your app manifest's `webApplicationInfo.resource` RSC permissions
2. This requires admin consent in the Teams Admin Center
3. See: [Microsoft docs on RSC for bots](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-messages-with-rsc)
