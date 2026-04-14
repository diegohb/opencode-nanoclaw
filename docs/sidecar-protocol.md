# Sidecar Protocol Specification

This document defines the reusable HTTP contract between any sidecar container and the NanoClaw host. The Teams sidecar is the first implementation. Future sidecars (Facebook Messenger, LINE, etc.) follow the same contract.

## Overview

Sidecar containers handle platform-specific SDKs and webhooks, translating them to a simple HTTP protocol that NanoClaw understands. This separation allows NanoClaw to support webhook-based platforms without embedding their SDKs directly.

## Endpoints

### Sidecar ΓåÆ Host (inbound message)

```
POST http://{host}:{proxy_port}/channel/inbound
Content-Type: application/json

{
  "channel": "msteams",
  "jid": "teams:19:abc123@thread.tacv2",
  "message": {
    "id": "<unique-message-id>",
    "chat_jid": "teams:19:abc123@thread.tacv2",
    "sender": "user-aad-object-id",
    "sender_name": "Jane Doe",
    "content": "Hello bot",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "is_from_me": false,
    "is_bot_message": false
  },
  "metadata": {
    "name": "General",
    "isGroup": true,
    "channel": "msteams"
  }
}
```

**Response:** `200 OK` with `{"ok": true}` or `4xx/5xx` with `{"error": "message"}`

### Host ΓåÆ Sidecar (send message)

```
POST http://{sidecar}:{port}/send
Content-Type: application/json

{
  "jid": "teams:19:abc123@thread.tacv2",
  "text": "Here is my response..."
}
```

**Response:** `200 OK` with `{"ok": true}`

### Host ΓåÆ Sidecar (typing indicator)

```
POST http://{sidecar}:{port}/typing
Content-Type: application/json

{
  "jid": "teams:19:abc123@thread.tacv2",
  "isTyping": true
}
```

**Response:** `200 OK` with `{"ok": true}`

### Health check

```
GET http://{sidecar}:{port}/health

Response: {"status": "ok", "channel": "msteams"}
```

## Versioning

This protocol is versioned as part of the NanoClaw codebase. Breaking changes require updates to both the host and sidecar containers simultaneously.
