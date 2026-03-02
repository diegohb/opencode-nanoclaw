# Upstream Changes to Sync (1.1.3 → 1.1.6)

**Upstream Repository:** https://github.com/qwibitai/nanoclaw  
**Current Local Version:** 1.1.3  
**Upstream Version:** 1.1.6

---

## MUST-HAVES (Applied During Conversion)

These changes are critical security or functionality fixes that should be incorporated during the OpenCode conversion:

### 1. Command Injection Fix (Security) ✅ CRITICAL

**Commit:** 7702316  
**File:** `setup/verify.ts`

**Issue:** PID file reading used unsanitized input in `execSync()`, allowing command injection.

**Fix:**

```typescript
// BEFORE (vulnerable):
const pid = fs.readFileSync(pidFile, 'utf-8').trim();
if (pid) {
  execSync(`kill -0 ${pid}`, { stdio: 'ignore' });
}

// AFTER (safe):
const raw = fs.readFileSync(pidFile, 'utf-8').trim();
const pid = Number(raw);
if (raw && Number.isInteger(pid) && pid > 0) {
  process.kill(pid, 0);
}
```

**Action:** Include in Commit 14 (setup scripts update)

---

### 2. Shadow .env in Container (Security) ✅ CRITICAL

**Commit:** bae8538  
**File:** `src/container-runner.ts`

**Issue:** Agent could read `.env` file from mounted project root, exposing secrets.

**Fix:** Mount `/dev/null` over `/workspace/project/.env`:

```typescript
// Shadow .env so the agent cannot read secrets from the mounted project root.
// Secrets are passed via stdin instead (see readSecrets()).
const envFile = path.join(projectRoot, '.env');
if (fs.existsSync(envFile)) {
  mounts.push({
    hostPath: '/dev/null',
    containerPath: '/workspace/project/.env',
    readonly: true,
  });
}
```

**Action:** Include in Commit 6 (container-runner update)

---

### 3. WhatsApp Message Normalization (Functionality)

**Commit:** 16ab463  
**Files:** `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`

**Issue:** WhatsApp wraps messages in container types (viewOnceMessageV2, ephemeralMessage, editedMessage) making content inaccessible.

**Fix:** Use `normalizeMessageContent()` from baileys:

```typescript
import { normalizeMessageContent } from '@whiskeysockets/baileys';

// In messages.upsert handler:
const normalized = normalizeMessageContent(msg.message);
if (!normalized) continue;

// Then use normalized instead of msg.message for content extraction
const content =
  normalized.conversation ||
  normalized.extendedTextMessage?.text ||
  normalized.imageMessage?.caption ||
  normalized.videoMessage?.caption ||
  '';
```

**Action:** Include in Commit 6 (alongside container-runner) or separate commit

---

### 4. Skills Auto-Initialize (Functionality)

**Commit:** 5c58ea0  
**File:** `skills-engine/apply.ts`

**Issue:** First-time skill application fails if `.nanoclaw/state.yaml` doesn't exist.

**Fix:** Auto-initialize skills system:

```typescript
import { initNanoclawDir } from './init.js';

// In applySkill():
const statePath = path.join(projectRoot, NANOCLAW_DIR, STATE_FILE);
if (!fs.existsSync(statePath)) {
  initNanoclawDir();
}
const currentState = readState();
```

**Action:** Include in Commit 9 (path updates) or separate commit

---

## NICE-TO-HAVES (Port Later)

These changes are useful but can be applied after the OpenCode conversion:

### 1. Third-Party Model Support

**Commit:** 51bb329  
**Files:** `README.md`, `README_zh.md`, `src/container-runner.ts`

**Change:** Added `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` to secrets reading:

```typescript
function readSecrets(): Record<string, string> {
  return readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL', // NEW
    'ANTHROPIC_AUTH_TOKEN', // NEW
  ]);
}
```

**Relevance:** Not needed for OpenCode conversion (different auth model). May be useful for Anthropic provider in OpenCode later.

---

### 2. CJK Font Support for Screenshots

**Commit:** d48ef91  
**File:** `container/Dockerfile`

**Change:** Added Chinese/Japanese/Korean font packages for Chromium screenshots.

**Relevance:** Include if users need browser automation with CJK content.

---

### 3. New `/update-nanoclaw` Skill

**Commit:** 3475e89  
**File:** `.claude/skills/update-nanoclaw/SKILL.md`

**Purpose:** Syncs customized NanoClaw installs with upstream without losing local changes.

**Relevance:** Very useful for ongoing maintenance. Should be ported to `.opencode/skills/update-nanoclaw/` after conversion.

---

### 4. New `/convert-to-apple-container` Skill

**Commits:** 5c2a832, bae8538  
**Files:** `.claude/skills/convert-to-apple-container/*`

**Purpose:** Converts Docker-based installs to Apple Container (macOS native).

**Relevance:** macOS users may want this. Port after conversion.

---

### 5. Contributors File

**Commits:** Multiple  
**File:** `CONTRIBUTORS.md`

**Purpose:** Lists project contributors.

**Relevance:** Documentation, port when convenient.

---

## Version History

| Version | Date       | Key Changes                                              |
| ------- | ---------- | -------------------------------------------------------- |
| 1.1.4   | 2026-03-01 | Third-party model support                                |
| 1.1.5   | 2026-03-01 | WhatsApp message normalization, token docs               |
| 1.1.6   | 2026-03-02 | Skills auto-init, shadow .env fix, command injection fix |

---

## Commits Between 1.1.3 and 1.1.6

```
5c58ea0 fix: auto-initialize skills system when applying first skill
bae8538 Fix/shadow env in container (#646)
7702316 fix: prevent command injection in setup verify PID check
62c25b1 chore: bump version to 1.1.6
5c2a832 Merge pull request #609 from neocode24/feat/cjk-fonts
77641b0 chore: bump version to 1.1.5
16ab463 fix: normalize wrapped WhatsApp messages before reading content (#628)
94680e9 chore: bump version to 1.1.4
51bb329 feat: add third-party model support (#592)
80cdd23 chore: remove old /update skill, replaced by /update-nanoclaw
3475e89 skill: add /update-nanoclaw for syncing customized installs with upstream (#217)
d48ef91 fix: add CJK font support for Chromium screenshots
```
