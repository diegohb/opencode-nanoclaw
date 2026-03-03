# Enhanced Execution Plan: NanoClaw → OpenCode SDK Conversion

> **Handoff document** — validated against the actual codebase on 2026-03-03.  
> Companion to `docs/oc-conversion.md` (the original plan) and `docs/oc-conversion-changesync.md` (upstream fixes).
>
> **Target file:** Copy this to `docs/enhanced-oc-conversion.md` when ready to commit.

---

## Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default model | `opencode/kimi-k2.5-free` | Free tier, no API key required. Users override via `.env` or `ContainerConfig`. |
| Commit strategy | 25 atomic commits | Maximum granularity, easy review and revert. |
| Instructions file | `AGENTS.md` only | Clean break. No CLAUDE.md references in opencode.json instructions field. |
| Shadow .env scope | All groups with project root access | More thorough than upstream (main-only). Check `additionalMounts` too. |
| Branch | `feature/opencode-conversion` from `main` | Standard feature branch. |

---

## Reference Material

| Resource | Purpose |
|----------|---------|
| `docs/oc-conversion.md` | Original conversion plan with phase breakdown |
| `docs/oc-conversion-changesync.md` | 4 upstream fixes to incorporate (1.1.3 → 1.1.6) |
| `docs/SPEC.md` | Current architecture specification |
| PR #9 `aoberoi/nanoclaw` (`alt-runtimes` branch) | Battle-tested OpenCode runner implementation |
| `opencode-sdk-reference.md` (in PR #9) | Full `@opencode-ai/sdk` v1.2.9 API reference |

### How to Access PR #9 Reference Code

```bash
# Get the proven opencode-runner.ts implementation
gh api repos/aoberoi/nanoclaw/contents/container/agent-runner/src/opencode-runner.ts?ref=alt-runtimes --jq ".content" | python -m base64 -d

# Get the SDK reference document
gh api repos/aoberoi/nanoclaw/contents/.claude/skills/add-opencode-runtime/opencode-sdk-reference.md?ref=alt-runtimes --jq ".content" | python -m base64 -d
```

---

## Pre-Work

```bash
git checkout -b feature/opencode-conversion
```

---

## Phase 1: Core Infrastructure (Commits 1-7)

### Commit 1: Add OpenCode SDK dependency

**File:** `container/agent-runner/package.json`

**Current state (line 12):**
```json
"@anthropic-ai/claude-agent-sdk": "^0.2.34",
```

**Target:**
```json
"@opencode-ai/sdk": "latest",
```

Keep all other deps: `@modelcontextprotocol/sdk` ^1.12.1, `cron-parser` ^5.0.0, `zod` ^4.0.0.

---

### Commit 2: Create opencode-runner.ts

**File:** `container/agent-runner/src/opencode-runner.ts` (NEW, ~300 lines)

This is the core conversion. **Use PR #9's `opencode-runner.ts` as the starting template** and apply these modifications:

#### Changes from PR #9's version:

1. **Default model** — Change from `'anthropic/claude-sonnet-4-20250514'` to `'opencode/kimi-k2.5-free'`
2. **Default provider** — Change from `'anthropic'` to `'opencode'`
3. **Instructions field** — Change `'CLAUDE.md'` to `'AGENTS.md'`, and `/workspace/global/CLAUDE.md` to `/workspace/global/AGENTS.md`
4. **Multi-provider support** — In `writeOpencodeConfig()`, detect provider from secrets:
   ```typescript
   // Determine provider and model from config or secrets
   const oc = containerInput.opencodeConfig;
   let provider = oc?.provider || 'opencode';
   let model = oc?.model || 'opencode/kimi-k2.5-free';

   // Auto-detect provider from available secrets
   if (!oc?.provider && containerInput.secrets) {
     if (containerInput.secrets['ANTHROPIC_API_KEY']) {
       provider = 'anthropic';
       model = oc?.model || 'anthropic/claude-sonnet-4-20250514';
     } else if (containerInput.secrets['OPENROUTER_API_KEY']) {
       provider = 'openrouter';
       model = oc?.model || 'openrouter/anthropic/claude-sonnet-4';
     }
   }
   ```
5. **Export name** — Export as `main()` (not `runOpenCode()`) since index.ts will call `main()`

#### Architecture (preserved from PR #9):

```
readStdin() -> writeOpencodeConfig() -> createOpencode() -> event.subscribe()
    -> session.create/get() -> prompt loop:
        session.prompt() with 2min timeout <-> SSE text fallback
        -> writeOutput() -> waitForIpcMessage() -> repeat or exit
```

#### What to port from current `index.ts`:
- `readStdin()`, `writeOutput()`, `log()` — I/O utilities
- `drainIpcInput()`, `waitForIpcMessage()`, `shouldClose()` — IPC polling
- `OUTPUT_START_MARKER`, `OUTPUT_END_MARKER`, `IPC_INPUT_DIR` constants
- `ContainerInput`, `ContainerOutput` interfaces (add `opencodeConfig` field)

#### What NOT to port:
- `MessageStream` class — OpenCode uses request-response, not streaming input
- `parseTranscript()`, `formatTranscriptMarkdown()` — OpenCode persists sessions natively
- `createPreCompactHook()` — No transcript archiving needed
- `createSanitizeBashHook()` — OpenCode has its own isolation model (see Secret Sanitization section)
- `getSessionSummary()` — OpenCode manages summaries internally
- `query()` invocation — Replaced by `session.prompt()`
- `SessionEntry`, `SessionsIndex` — OpenCode has native session management

#### Key SDK patterns (from SDK reference):

```typescript
import { createOpencode } from '@opencode-ai/sdk';

// createOpencode() spawns `opencode serve` subprocess, config via OPENCODE_CONFIG_CONTENT env
// Set OPENCODE_PROJECT before calling to control project root
process.env.OPENCODE_PROJECT = '/workspace/group';
process.env.XDG_STATE_HOME = '/workspace/opencode-state'; // session persistence

const { client, server } = await createOpencode({
  hostname: '127.0.0.1',
  port: 4096,
  config: { model: 'opencode/kimi-k2.5-free' },
});

// SSE: message.part.updated carries FULL accumulated text (overwrite, don't append)
// session.prompt() is BLOCKING long-poll, SSE runs concurrently as fallback
// PromptTimeoutError after 2 minutes prevents indefinite hangs
```

---

### Commit 3: Replace index.ts with OpenCode dispatch

**File:** `container/agent-runner/src/index.ts`

Replace entire 588-line file with:
```typescript
import { main } from './opencode-runner.js';
main();
```

---

### Commit 4: Update Dockerfile for OpenCode

**File:** `container/Dockerfile`

| Line | Current | New |
|------|---------|-----|
| 2 | `# Runs Claude Agent SDK` | `# Runs OpenCode SDK` |
| ~33 | `npm install -g agent-browser @anthropic-ai/claude-code` | `npm install -g agent-browser opencode-ai` |

The entrypoint script (`/app/entrypoint.sh`) stays unchanged — it re-compiles TS and runs `node /tmp/dist/index.js`.

---

### Commit 5: Update types.ts with OpenCode config

**File:** `src/types.ts` (line 22, `ContainerConfig` interface)

**Current:**
```typescript
export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
}
```

**Target:**
```typescript
export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
  opencodeConfig?: {
    provider?: string;   // default: 'opencode'
    apiKey?: string;     // env var name (optional for free providers)
    model?: string;      // default: 'opencode/kimi-k2.5-free'
  };
}
```

---

### Commit 6: Update container-runner.ts + shadow .env fix

**File:** `src/container-runner.ts`

#### 6a. Remove Claude sessions mount (lines 103-151)

Delete the entire block that:
- Creates `data/sessions/{group}/.claude/` directory
- Writes `settings.json` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`
- Syncs skills from `container/skills/` into `.claude/skills/`
- Mounts to `/home/node/.claude`

#### 6b. Add OpenCode state mount (replace the removed block)

```typescript
// Per-group OpenCode state directory for session persistence
const openCodeStateDir = path.join(DATA_DIR, 'sessions', group.folder, 'opencode-state');
fs.mkdirSync(openCodeStateDir, { recursive: true });
mounts.push({
  hostPath: openCodeStateDir,
  containerPath: '/workspace/opencode-state',
  readonly: false,
});
```

#### 6c. Keep container skills sync (but update mount path)

Skills from `container/skills/` (like `agent-browser.md`) still need to be available in the container. Mount them to a path OpenCode can find:

```typescript
// Sync container-side skills (agent-browser etc.) into a workspace location
const skillsSrc = path.join(process.cwd(), 'container', 'skills');
if (fs.existsSync(skillsSrc)) {
  const skillsDst = path.join(DATA_DIR, 'sessions', group.folder, 'container-skills');
  for (const skillDir of fs.readdirSync(skillsSrc)) {
    const srcDir = path.join(skillsSrc, skillDir);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    fs.cpSync(srcDir, path.join(skillsDst, skillDir), { recursive: true });
  }
  mounts.push({
    hostPath: skillsDst,
    containerPath: '/workspace/skills',
    readonly: true,
  });
}
```

#### 6d. Shadow .env fix (for ALL groups with project root access)

After the main group's project root mount (line ~83) and after any additionalMounts:

```typescript
// Shadow .env so the agent cannot read secrets from any mounted directory.
// Secrets are passed via stdin instead (see readSecrets()).
if (isMain) {
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    mounts.push({
      hostPath: '/dev/null',
      containerPath: '/workspace/project/.env',
      readonly: true,
    });
  }
}

// Also shadow .env in additional mounts that might contain secrets
if (group.containerConfig?.additionalMounts) {
  for (const mount of group.containerConfig.additionalMounts) {
    const envInMount = path.join(mount.hostPath, '.env');
    if (fs.existsSync(envInMount)) {
      const containerMountPath = mount.containerPath || `/workspace/extra/${path.basename(mount.hostPath)}`;
      mounts.push({
        hostPath: '/dev/null',
        containerPath: path.join(containerMountPath, '.env'),
        readonly: true,
      });
    }
  }
}
```

#### 6e. Update readSecrets() (line 207)

**Current:**
```typescript
return readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
```

**Target:**
```typescript
return readEnvFile(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']);
```

---

### Commit 7: Fix WhatsApp message normalization

**File:** `src/channels/whatsapp.ts`

Upstream fix from commit 16ab463.

**Add import (top of file):**
```typescript
import { normalizeMessageContent } from '@whiskeysockets/baileys';
```

**In `messages.upsert` handler (around line 172):** After getting `msg`, normalize before content extraction:

```typescript
// Normalize wrapped message types (viewOnce, ephemeral, edited, etc.)
const normalized = normalizeMessageContent(msg.message);
if (!normalized) continue;

const content =
  normalized.conversation ||
  normalized.extendedTextMessage?.text ||
  normalized.imageMessage?.caption ||
  normalized.videoMessage?.caption ||
  '';
```

Replace the current direct access to `msg.message.conversation`, etc. with the normalized versions.

---

## Phase 2: File Renames (Commits 8-11)

### Commit 8: Rename CLAUDE.md to AGENTS.md

```bash
git mv CLAUDE.md AGENTS.md
git mv groups/main/CLAUDE.md groups/main/AGENTS.md
git mv groups/global/CLAUDE.md groups/global/AGENTS.md
```

**Content updates in each file:**
- Root `AGENTS.md`: Update header from "Personal Claude assistant" to "Personal AI assistant" (full content update in Commit 21)
- `groups/main/AGENTS.md` and `groups/global/AGENTS.md`: Replace any "Claude" references with "assistant" or "AI"

---

### Commit 9: Move .claude/skills/ to .opencode/skills/

**Important:** `.opencode/skills/` already exists with `intellisearch/`. Must merge, not overwrite.

```bash
# Move each skill directory individually (git mv handles tracking)
for dir in add-discord add-gmail add-parallel add-slack add-telegram-swarm add-telegram add-voice-transcription convert-to-apple-container customize debug get-qodo-rules qodo-pr-resolver setup update x-integration; do
  git mv ".claude/skills/$dir" ".opencode/skills/$dir"
done

# Remove empty .claude/ directory
rmdir .claude/skills .claude 2>/dev/null || true
```

**Update `.gitignore`** — Remove `.opencode/` from ignore list (currently on line ~36):
```
# REMOVE this line:
.opencode/
```

---

### Commit 10: Update hardcoded skill paths + auto-init fix

#### Files with `.claude/skills/` references:

| File | Line | Change |
|------|------|--------|
| `skills-engine/replay.ts` | 32, 39 | `.claude/skills/` -> `.opencode/skills/` |
| `skills-engine/uninstall.ts` | 87 | `.claude/skills/` -> `.opencode/skills/` (error message) |
| `setup/register.ts` | 136-149 | `CLAUDE.md` -> `AGENTS.md` (file paths and log messages) |

#### Skills auto-init fix (upstream 5c58ea0)

**File:** `skills-engine/apply.ts`

Add import and auto-init guard before `readState()` call (around line 41):

```typescript
import { initNanoclawDir } from './init.js';
import { NANOCLAW_DIR, STATE_FILE } from './constants.js';

// In applySkill(), before readState():
const statePath = path.join(projectRoot, NANOCLAW_DIR, STATE_FILE);
if (!fs.existsSync(statePath)) {
  initNanoclawDir();
}
const currentState = readState();
```

Note: `NANOCLAW_DIR` is already imported from constants (line 8). `STATE_FILE` needs to be added to that import. `path` and `fs` are already imported. Just add `initNanoclawDir` import and the guard.

---

### Commit 11: Update .gitignore and GitHub workflows

#### `.gitignore` changes:

```diff
- !groups/main/CLAUDE.md
+ !groups/main/AGENTS.md
- !groups/global/CLAUDE.md
+ !groups/global/AGENTS.md
- .opencode/
```

#### `.github/workflows/skill-pr.yml` (6 occurrences):

All `.claude/skills/` -> `.opencode/skills/` (path filters, checkout paths, skill detection logic).

#### `.github/workflows/update-tokens.yml` (2 occurrences):

`CLAUDE.md` -> `AGENTS.md` in path trigger filter and token counting.

#### `.github/workflows/skill-drift.yml` (1 occurrence):

`.claude/skills/` -> `.opencode/skills/` in `validate-all-skills.ts` reference.

---

## Phase 3: Skills Updates (Commits 12-14)

### Commit 12: Update setup skill

**File:** `.opencode/skills/setup/SKILL.md`

Major changes:
- **Step 4 (Claude auth)** -> Replace with OpenCode setup. No Claude subscription needed.
- Remove references to `CLAUDE_CODE_OAUTH_TOKEN`, Claude Max subscription, claude.ai/settings
- Add note: "OpenCode Zen (free, no API key) is the default. Optionally configure `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` in `.env` for paid models."
- Update container build: `opencode-ai` instead of `@anthropic-ai/claude-code`

### Commit 13: Update debug skill

**File:** `.opencode/skills/debug/SKILL.md`

Replace:
- `CLAUDE_CODE_OAUTH_TOKEN` -> `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` (both optional)
- `.claude` sessions path -> `opencode-state` directory
- Claude-specific error messages -> OpenCode equivalents
- Claude SDK query loop -> OpenCode `session.prompt()` loop

### Commit 14: Update remaining skills

Batch update across all other skills. Primary operation: **search-and-replace** in all `.opencode/skills/*/SKILL.md` and related files:

| Find | Replace |
|------|---------|
| `CLAUDE.md` | `AGENTS.md` |
| `.claude/skills/` | `.opencode/skills/` |
| `.claude/` | `.opencode/` (context-dependent) |
| `Claude Code` | `OpenCode` |
| `claude-agent-sdk` | `@opencode-ai/sdk` |
| `@anthropic-ai/claude-code` | `opencode-ai` |

Skills needing **special attention:**
- **`customize/SKILL.md`** — References to `CLAUDE.md` in customization instructions
- **`add-telegram-swarm/SKILL.md`** — Agent Teams references (note: OpenCode has native subagents)
- **`add-gmail/`** — `modify/` patches reference `container/agent-runner/src/index.ts` which is now a shim; update patch targets
- **`update/SKILL.md`** — Remove Claude-specific merge logic, update paths
- **`add-voice-transcription/`** — Update error message reference from Claude to OpenCode

---

## Phase 4: Setup & Configuration (Commits 15-16)

### Commit 15: Update setup scripts + command injection fix

#### `setup/verify.ts`

**Fix 1: Command injection (lines 71-73)** — Upstream 7702316:

```typescript
// BEFORE (vulnerable):
const pid = fs.readFileSync(pidFile, 'utf-8').trim();
if (pid) {
  execSync(`kill -0 ${pid}`, { stdio: 'ignore' });
  service = 'running';
}

// AFTER (safe):
const raw = fs.readFileSync(pidFile, 'utf-8').trim();
const pid = Number(raw);
if (raw && Number.isInteger(pid) && pid > 0) {
  process.kill(pid, 0);
  service = 'running';
}
```

**Fix 2: Credentials check (line 102)** — Make optional for free tier:

```typescript
// BEFORE:
if (/^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=/m.test(envContent)) {
  credentials = 'configured';
}

// AFTER:
if (/^(ANTHROPIC_API_KEY|OPENROUTER_API_KEY)=/m.test(envContent)) {
  credentials = 'configured';
} else {
  credentials = 'free_tier'; // OpenCode Zen works without API keys
}
```

**Fix 3: Overall status** — Don't require credentials for passing verification:

```typescript
// BEFORE:
const status = service === 'running' && credentials !== 'missing' && ...

// AFTER:
const status = service === 'running' && whatsappAuth !== 'not_found' && registeredGroups > 0
  ? 'success'
  : 'failed';
// credentials check is informational only (free tier is valid)
```

#### `setup/register.ts`

Lines 136-149: Replace CLAUDE.md paths and log messages:

```typescript
const mdFiles = [
  path.join(projectRoot, 'groups', 'global', 'AGENTS.md'),
  path.join(projectRoot, 'groups', 'main', 'AGENTS.md'),
];
// ...
logger.info({ file: mdFile }, 'Updated AGENTS.md');
```

---

### Commit 16: Populate .env.example

**File:** `.env.example`

```env
# NanoClaw Configuration
# ======================

# Assistant name (default: Andy)
# ASSISTANT_NAME="Andy"

# Model configuration
# Default: OpenCode Zen (free Kimi K2.5, no API key required)
# Uncomment ONE provider below to use paid models:

# Anthropic (direct)
# ANTHROPIC_API_KEY=sk-ant-...

# OpenRouter (access to multiple providers)
# OPENROUTER_API_KEY=sk-or-...
```

---

## Phase 5: Documentation (Commits 17-21)

### Commit 17: Replace SDK documentation

**Delete or replace:** `docs/SDK_DEEP_DIVE.md`

**Create or update with:** OpenCode SDK reference covering:
- `createOpencode()` — start server + get client
- `session.prompt()` — blocking long-poll for responses
- `event.subscribe()` — SSE event stream
- `Config` type — `opencode.json` format
- Key event types: `message.part.updated`, `session.idle`, `session.error`
- Session persistence pattern

Can reference the comprehensive SDK reference from PR #9's `opencode-sdk-reference.md`.

### Commit 18: Update README.md

Full rewrite focusing on:
- **No Claude subscription required** — OpenCode Zen is free
- Updated prerequisites (no Claude auth step)
- Architecture diagram with OpenCode SDK
- Simplified quick start
- Model configuration options (free vs paid)

### Commit 19: Update SPEC.md and REQUIREMENTS.md

**`docs/SPEC.md` changes:**
- Technology stack: `@opencode-ai/sdk` instead of `@anthropic-ai/claude-agent-sdk`, `opencode-ai` CLI instead of `@anthropic-ai/claude-code`
- Architecture diagram: Update container section (opencode-runner.ts, createOpencode(), session.prompt())
- Memory system: `AGENTS.md` instead of `CLAUDE.md`
- Session management: OpenCode session API (`XDG_STATE_HOME`, `session.create/get/prompt`)
- Credential storage: OpenCode Zen (no auth) + optional `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`
- Folder structure: `.opencode/skills/` instead of `.claude/skills/`
- Configuration section: Remove `CLAUDE_CODE_*` env vars, add OpenCode config
- MCP section: No changes needed (already MCP-compatible)

**`docs/REQUIREMENTS.md` changes:**
- Architecture decisions referencing Claude -> OpenCode

### Commit 20: Update SECURITY.md

- Remove `CLAUDE_CODE_OAUTH_TOKEN` references
- Auth token handling: No mandatory credential for OpenCode Zen
- Document optional provider key handling (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`)
- Shadow .env protection documentation

### Commit 21: Update AGENTS.md with project context

Root `AGENTS.md` — update:
- Header: "Personal AI assistant" (not "Personal Claude assistant")
- Quick Context: "routes messages to OpenCode SDK running in containers"
- Key Files table: Add `opencode-runner.ts`, update `CLAUDE.md` -> `AGENTS.md` references
- Skills table: paths are now `.opencode/skills/`
- Development section: Update container build notes

---

## Phase 6: Testing & Verification (Commits 22-25)

### Commit 22: Update test assertions for new paths

**Files and changes:**

| Test File | Changes |
|-----------|---------|
| `skills-engine/__tests__/uninstall.test.ts:39,147` | `.claude/skills/` -> `.opencode/skills/` |
| `skills-engine/__tests__/replay.test.ts:34,57` | `.claude/skills/` -> `.opencode/skills/` |
| `skills-engine/__tests__/fetch-upstream.test.ts:11,82,105` | `.claude/skills/update/scripts/` -> `.opencode/skills/update/scripts/` |
| `setup/register.test.ts:172` | `CLAUDE.md` -> `AGENTS.md` in assertion text |
| `setup/environment.test.ts:80,84,85,87,94` | `CLAUDE_CODE_OAUTH_TOKEN` -> `OPENROUTER_API_KEY` in regex and test names |

### Commit 23: Update WhatsApp tests for normalization

**File:** `src/channels/whatsapp.test.ts`

Add test cases for `normalizeMessageContent` usage:
- Test with wrapped message types (viewOnceMessageV2, ephemeralMessage, editedMessage)
- Test that normalized content is correctly extracted
- Test null/undefined message handling

### Commit 24: Final verification and cleanup

```bash
npm run build                    # TypeScript compilation must pass
npx vitest run                   # All tests must pass
./container/build.sh             # Container must build (Linux/WSL)
docker run --rm nanoclaw-agent:latest opencode --version  # CLI must work
```

Fix any issues found during verification.

### Commit 25: Final cleanup

Any remaining fixups from verification. If no issues, this commit can be skipped.

---

## Secret Sanitization Analysis

### Current Approach (Claude SDK)

The current `index.ts` has a `createSanitizeBashHook()` that intercepts `PreToolUse` events for `Bash` tools and strips `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` from the subprocess environment.

### OpenCode Approach

1. **Secrets are NOT in `process.env`** — The runner reads secrets from stdin and passes them to `opencode.json` config as `apiKey` fields. They're not set in the runner's `process.env`, so child processes spawned by OpenCode's Bash tool should not inherit them.

2. **Config env var** — `createOpencode()` passes config via `OPENCODE_CONFIG_CONTENT` env var to the subprocess. This contains the full config JSON including API keys. Need to verify if OpenCode strips this from Bash subprocess environments.

3. **Plugin hooks** — OpenCode supports `tool.execute.before` and `shell.env` plugin hooks (npm packages listed in `config.plugin`). If needed, a minimal plugin could strip sensitive env vars.

4. **Recommendation** — Verify that secrets don't leak by:
   - Checking OpenCode source for env sanitization
   - Running a test: `opencode run "echo $OPENCODE_CONFIG_CONTENT"` and verifying it's empty
   - If leaked, implement via `opencode.json` plugin or by unsetting `OPENCODE_CONFIG_CONTENT` after server startup

---

## Files NOT Changed (Verified Against Codebase)

These files require zero modifications:

| File | Reason |
|------|--------|
| `container/agent-runner/src/ipc-mcp-stdio.ts` | Already MCP-compatible, protocol-agnostic |
| `container/agent-runner/tsconfig.json` | TypeScript config, unchanged |
| `src/index.ts` | Host orchestrator, no Claude SDK references |
| `src/ipc.ts` | Host-side IPC, unchanged protocol |
| `src/router.ts` | Message formatting, runtime-agnostic |
| `src/db.ts` | SQLite schema, no runtime references |
| `src/group-queue.ts` | Concurrency control, runtime-agnostic |
| `src/mount-security.ts` | Mount validation, no Claude references |
| `src/config.ts` | Constants only, no Claude references |
| `src/container-runtime.ts` | Docker/Apple Container abstraction |
| `src/formatting.test.ts` | Formatting tests, no Claude references |
| `src/db.test.ts` | Database tests |
| `src/group-queue.test.ts` | Queue tests |
| `src/group-folder.test.ts` | Folder tests |
| `src/task-scheduler.test.ts` | Scheduler tests |
| `src/ipc-auth.test.ts` | IPC auth tests |
| `src/container-runtime.test.ts` | Runtime tests |
| `src/routing.test.ts` | Routing tests |
| `src/container-runner.test.ts` | May need minor updates if it tests mount logic |

---

## Complete File Change Manifest

### Phase 1 — Core Infrastructure
```
M  container/agent-runner/package.json          # SDK dependency swap
A  container/agent-runner/src/opencode-runner.ts # New runner (~300 lines)
M  container/agent-runner/src/index.ts           # Thin shim (2 lines)
M  container/Dockerfile                          # CLI swap
M  src/types.ts                                  # Add opencodeConfig
M  src/container-runner.ts                       # Mounts, secrets, shadow .env
M  src/channels/whatsapp.ts                      # normalizeMessageContent
```

### Phase 2 — File Renames
```
R  CLAUDE.md -> AGENTS.md
R  groups/main/CLAUDE.md -> groups/main/AGENTS.md
R  groups/global/CLAUDE.md -> groups/global/AGENTS.md
R  .claude/skills/* -> .opencode/skills/*         # 15 directories
M  skills-engine/replay.ts                       # Path update
M  skills-engine/uninstall.ts                    # Path update
M  skills-engine/apply.ts                        # Auto-init fix
M  setup/register.ts                             # AGENTS.md references
M  .gitignore                                    # Tracking rules
M  .github/workflows/skill-pr.yml               # 6 path updates
M  .github/workflows/update-tokens.yml           # 2 path updates
M  .github/workflows/skill-drift.yml             # 1 path update
```

### Phase 3 — Skills Updates
```
M  .opencode/skills/setup/SKILL.md              # Major rewrite
M  .opencode/skills/debug/SKILL.md              # Major rewrite
M  .opencode/skills/customize/SKILL.md          # Path + name updates
M  .opencode/skills/update/SKILL.md             # Path + logic updates
M  .opencode/skills/add-telegram/SKILL.md       # Minimal
M  .opencode/skills/add-slack/SKILL.md          # Minimal
M  .opencode/skills/add-gmail/SKILL.md + modify/* # Patch target updates
M  .opencode/skills/add-telegram-swarm/SKILL.md # Agent Teams note
M  .opencode/skills/add-voice-transcription/SKILL.md  # Error ref
M  .opencode/skills/x-integration/SKILL.md      # Path updates
M  .opencode/skills/convert-to-apple-container/SKILL.md  # Dockerfile ref
M  .opencode/skills/add-parallel/SKILL.md       # OpenCode native agents
```

### Phase 4 — Setup & Config
```
M  setup/verify.ts                               # Command injection + credentials
M  setup/register.ts                             # AGENTS.md (already in Phase 2)
M  .env.example                                  # Populate
```

### Phase 5 — Documentation
```
M  docs/SDK_DEEP_DIVE.md                         # Replace or delete + create new
M  README.md                                     # Full rewrite
M  docs/SPEC.md                                  # Architecture update
M  docs/REQUIREMENTS.md                          # Decisions update
M  docs/SECURITY.md                              # Auth handling
M  AGENTS.md                                     # Project context
```

### Phase 6 — Testing
```
M  skills-engine/__tests__/uninstall.test.ts     # Path assertions
M  skills-engine/__tests__/replay.test.ts        # Path assertions
M  skills-engine/__tests__/fetch-upstream.test.ts # Path assertions
M  setup/register.test.ts                        # AGENTS.md assertion
M  setup/environment.test.ts                     # Env var assertions
M  src/channels/whatsapp.test.ts                 # Normalization tests
```

---

## Estimated Totals

| Category | Files | Est. Lines |
|----------|-------|------------|
| Core infrastructure | 7 | ~600 |
| File renames/moves | ~20 | ~50 |
| Code path updates | 8 | ~50 |
| Skills updates | ~15 | ~500 |
| Setup & config | 3 | ~80 |
| Documentation | 6 | ~400 |
| Tests | 6 | ~100 |
| **Total** | **~65** | **~1,780** |
