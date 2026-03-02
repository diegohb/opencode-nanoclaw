# NanoClaw → OpenCode Conversion Plan

**Source Version:** 1.1.3 (cloned from qwibitai/nanoclaw)  
**Current Upstream:** 1.1.6  
**Target:** Full OpenCode SDK conversion (no Claude fallback)

## Executive Summary

Convert NanoClaw from Claude Code Agent SDK to OpenCode SDK as the **exclusive** runtime. This is a **full conversion** (no Claude fallback), renaming `CLAUDE.md` → `AGENTS.md` and `.claude/skills/` → `.opencode/skills/`.

**Default Model:** OpenCode Zen (free Kimi K2.5, no API key required)

---

## Architecture Comparison

### Current (Claude SDK)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NanoClaw Host Process                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ WhatsApp     │  │ Task         │  │ container-runner.ts      │  │
│  │ Channel      │  │ Scheduler    │  │  - Build mounts          │  │
│  │              │  │              │  │  - Spawn containers      │  │
│  └──────────────┘  └──────────────┘  │  - Stream output         │  │
│                                       └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                           │
         docker run -i --rm (stdin: JSON with secrets)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Container (nanoclaw-agent:latest)                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ agent-runner/src/index.ts                                     │  │
│  │  - Calls @anthropic-ai/claude-agent-sdk query()               │  │
│  │  - Streams results via OUTPUT_START/END markers               │  │
│  │  - Polls /workspace/ipc/input/ for follow-up messages         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Target (OpenCode SDK)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NanoClaw Host Process                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ WhatsApp     │  │ Task         │  │ container-runner.ts      │  │
│  │ Channel      │  │ Scheduler    │  │  - Build mounts          │  │
│  │              │  │              │  │  - Spawn containers      │  │
│  └──────────────┘  └──────────────┘  │  - Stream output         │  │
│                                       └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                           │
         docker run -i --rm (stdin: JSON with config)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Container (nanoclaw-agent:latest)                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ agent-runner/src/opencode-runner.ts                           │  │
│  │  - Starts OpenCode server via createOpencode()                │  │
│  │  - Writes opencode.json to workspace                          │  │
│  │  - Uses client.session.prompt() for queries                   │  │
│  │  - SSE streaming via client.event.subscribe()                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Infrastructure

### 1.1 Container Agent Runner (`container/agent-runner/`)

| File                     | Action      | Details                                                         |
| ------------------------ | ----------- | --------------------------------------------------------------- |
| `package.json`           | **Replace** | Remove `@anthropic-ai/claude-agent-sdk`, add `@opencode-ai/sdk` |
| `src/index.ts`           | **Replace** | Replace Claude SDK query loop with OpenCode dispatch            |
| `src/opencode-runner.ts` | **Create**  | New implementation with OpenCode Zen default                    |
| `src/ipc-mcp-stdio.ts`   | **Keep**    | Already MCP-compatible, no changes needed                       |

**Key changes in opencode-runner.ts:**

```typescript
// Default config for OpenCode Zen (free, no API key)
const config = {
  model: 'opencode/kimi-k2.5-free',
  provider: { opencode: {} },  // No apiKey needed
  permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' },
  mcp: { nanoclaw: { type: 'local', command: ['node', mcpServerPath], environment: {...} } },
  instructions: ['AGENTS.md', ...]  // Changed from CLAUDE.md
};
```

### 1.2 Dockerfile (`container/Dockerfile`)

| Line  | Current                                                  | New                                        |
| ----- | -------------------------------------------------------- | ------------------------------------------ |
| 2     | `# Runs Claude Agent SDK`                                | `# Runs OpenCode SDK`                      |
| 32-33 | `npm install -g agent-browser @anthropic-ai/claude-code` | `npm install -g agent-browser opencode-ai` |

### 1.3 Host Container Runner (`src/container-runner.ts`)

| Change                          | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| Remove Claude-specific mounts   | `.claude` sessions directory                                 |
| Add OpenCode state mount        | `/workspace/opencode-state` for session persistence          |
| Remove `CLAUDE_CODE_*` env vars | Lines 120-127                                                |
| Update secrets reading          | Remove `CLAUDE_CODE_OAUTH_TOKEN`, add optional provider keys |

### 1.4 Types (`src/types.ts`)

Add OpenCode config to `ContainerConfig`:

```typescript
export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
  opencodeConfig?: {
    provider?: string; // default: 'opencode'
    apiKey?: string; // Env var name (optional for free providers)
    model?: string; // default: 'opencode/kimi-k2.5-free'
  };
}
```

---

## Phase 2: File Renames

### 2.1 Memory Files (CLAUDE.md → AGENTS.md)

| Current Path              | New Path                  |
| ------------------------- | ------------------------- |
| `CLAUDE.md`               | `AGENTS.md`               |
| `groups/main/CLAUDE.md`   | `groups/main/AGENTS.md`   |
| `groups/global/CLAUDE.md` | `groups/global/AGENTS.md` |

### 2.2 Skills Directory (`.claude/skills/` → `.opencode/skills/`)

| Current           | New                 |
| ----------------- | ------------------- |
| `.claude/skills/` | `.opencode/skills/` |

All skill folders move:

- `setup/`
- `debug/`
- `customize/`
- `update/`
- `x-integration/`
- `add-telegram/`
- `add-slack/`
- `add-telegram-swarm/`
- `add-voice-transcription/`
- `add-gmail/`
- `qodo-pr-resolver/`
- `get-qodo-rules/`
- `convert-to-apple-container/`
- `skill-creator/`
- `intellisearch/`

### 2.3 Code Updates for New Paths

| File                      | Changes                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `src/container-runner.ts` | Update skill sync path from `.claude/skills/` to `.opencode/skills/` |
| `skills-engine/*.ts`      | Update all hardcoded paths                                           |
| `scripts/*.ts`            | Update validation scripts                                            |
| `.github/workflows/*.yml` | Update path filters                                                  |
| `.gitignore`              | Update tracking rules                                                |

---

## Phase 3: Skills Update

### 3.1 Skills Requiring Major Changes

| Skill                 | Changes Needed                                                                        |
| --------------------- | ------------------------------------------------------------------------------------- |
| `setup/`              | Replace Claude auth (step 4) with OpenCode setup; update container build instructions |
| `debug/`              | Replace all Claude-specific debugging (CLAUDE_CODE_OAUTH_TOKEN, sessions path, etc.)  |
| `customize/`          | Update CLAUDE.md references to AGENTS.md                                              |
| `add-parallel/`       | Remove Agent Teams references (OpenCode has native subagents)                         |
| `add-telegram-swarm/` | Rewrite for OpenCode's native agent system                                            |
| `add-gmail/`          | Update modify/ patches for new codebase                                               |

### 3.2 Skills with Minor/No Changes

| Skill                         | Changes Needed                                   |
| ----------------------------- | ------------------------------------------------ |
| `x-integration/`              | Update paths only                                |
| `update/`                     | Update paths, remove Claude-specific merge logic |
| `add-telegram/`               | Minimal - channel logic unchanged                |
| `add-slack/`                  | Minimal - channel logic unchanged                |
| `add-voice-transcription/`    | Update error message reference                   |
| `convert-to-apple-container/` | Update Dockerfile references                     |
| `qodo-pr-resolver/`           | No changes (independent of agent runtime)        |
| `get-qodo-rules/`             | No changes                                       |
| `skill-creator/`              | Update template for OpenCode format              |
| `intellisearch/`              | No changes                                       |

---

## Phase 4: Setup & Configuration

### 4.1 Setup Scripts (`setup/`)

| File                  | Changes                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `verify.ts`           | Replace `CLAUDE_CODE_OAUTH_TOKEN` check; **fix command injection** in PID check (7702316) |
| `register.ts`         | Update CLAUDE.md → AGENTS.md in templates                                                 |
| `environment.test.ts` | Update env var tests                                                                      |
| `index.ts`            | Update container build for OpenCode                                                       |

### 4.2 Environment Variables

| Remove                                         | Add (Optional)                             |
| ---------------------------------------------- | ------------------------------------------ |
| `CLAUDE_CODE_OAUTH_TOKEN`                      | `OPENROUTER_API_KEY` (if using OpenRouter) |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`         | `ANTHROPIC_API_KEY` (if using Anthropic)   |
| `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | —                                          |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY`              | —                                          |

### 4.3 Configuration Files

| File           | Action                                 |
| -------------- | -------------------------------------- |
| `.env.example` | Populate with OpenCode-compatible vars |

---

## Phase 5: Documentation

### 5.1 Files to Update

| File                                  | Scope of Changes                                      |
| ------------------------------------- | ----------------------------------------------------- |
| `README.md`                           | Complete rewrite of installation, architecture, usage |
| `CLAUDE.md` → `AGENTS.md`             | Rename, update project context                        |
| `docs/SPEC.md`                        | Replace all Claude references with OpenCode           |
| `docs/SDK_DEEP_DIVE.md`               | Replace with OpenCode SDK documentation               |
| `docs/REQUIREMENTS.md`                | Update architecture decisions                         |
| `docs/SECURITY.md`                    | Update auth token handling                            |
| `docs/nanoclaw-architecture-final.md` | Update architecture diagrams                          |

### 5.2 Key Documentation Changes

1. **Installation**: No Claude subscription required
2. **Authentication**: OpenCode Zen = no auth needed
3. **Architecture**: OpenCode server mode with SSE streaming
4. **Tools**: OpenCode's native tool set + MCP

---

## Phase 6: Testing & Verification

### 6.1 Build Verification

```bash
./container/build.sh
docker run --rm nanoclaw-agent:latest opencode --version
npm run build
```

### 6.2 Functional Tests

- [ ] Container starts with OpenCode
- [ ] MCP server connects
- [ ] Session persistence works
- [ ] IPC follow-up messages work
- [ ] Skills load from `.opencode/skills/`
- [ ] AGENTS.md is read

---

## Upstream Security Fixes (Incorporated)

The following security fixes from upstream v1.1.4-1.1.6 are incorporated into this conversion:

| Fix                    | Commit  | Description                                                                            |
| ---------------------- | ------- | -------------------------------------------------------------------------------------- |
| Command Injection      | 7702316 | PID validation in `setup/verify.ts` uses `process.kill()` instead of `execSync()`      |
| Shadow .env            | bae8538 | Mount `/dev/null` over `/workspace/project/.env` to prevent agent from reading secrets |
| WhatsApp Normalization | 16ab463 | Use `normalizeMessageContent()` for wrapped message types                              |
| Skills Auto-Init       | 5c58ea0 | Auto-initialize skills system on first apply                                           |

See `docs/oc-conversion-changesync.md` for full details on upstream changes.

---

## Commit Plan (25 commits on `feature/opencode-conversion`)

| #   | Phase | Description                                  | Key Files                                             |
| --- | ----- | -------------------------------------------- | ----------------------------------------------------- |
| 1   | 1     | Add OpenCode SDK dependency                  | `container/agent-runner/package.json`                 |
| 2   | 1     | Create opencode-runner.ts                    | `container/agent-runner/src/opencode-runner.ts`       |
| 3   | 1     | Replace index.ts with OpenCode dispatch      | `container/agent-runner/src/index.ts`                 |
| 4   | 1     | Update Dockerfile for OpenCode               | `container/Dockerfile`                                |
| 5   | 1     | Update types.ts with OpenCode config         | `src/types.ts`                                        |
| 6   | 1     | Update container-runner.ts + shadow .env fix | `src/container-runner.ts`                             |
| 7   | 1     | Fix WhatsApp message normalization           | `src/channels/whatsapp.ts`                            |
| 8   | 2     | Rename CLAUDE.md to AGENTS.md                | 3 memory files                                        |
| 9   | 2     | Move .claude/ to .opencode/                  | skills/, CODEOWNERS, etc. (~50 files)                 |
| 10  | 2     | Update hardcoded skill paths + auto-init fix | `src/*.ts`, `skills-engine/*.ts`, `scripts/*.ts`      |
| 11  | 2     | Update .gitignore and GitHub workflows       | `.gitignore`, `.github/workflows/*.yml`               |
| 12  | 3     | Update setup skill for OpenCode              | `.opencode/skills/setup/`                             |
| 13  | 3     | Update debug skill for OpenCode              | `.opencode/skills/debug/`                             |
| 14  | 3     | Update remaining skills                      | `.opencode/skills/*/`                                 |
| 15  | 4     | Update setup scripts + command injection fix | `setup/verify.ts`, `setup/register.ts`                |
| 16  | 4     | Populate `.env.example` with OpenCode vars   | `.env.example`                                        |
| 17  | 5     | Replace SDK documentation                    | Delete `docs/SDK_DEEP_DIVE.md`, add OpenCode SDK docs |
| 18  | 5     | Update README.md                             | `README.md`                                           |
| 19  | 5     | Update SPEC.md and REQUIREMENTS.md           | `docs/SPEC.md`, `docs/REQUIREMENTS.md`                |
| 20  | 5     | Update SECURITY.md                           | `docs/SECURITY.md`                                    |
| 21  | 6     | Update AGENTS.md with project context        | `AGENTS.md`                                           |
| 22  | 6     | Update test assertions for new paths         | `setup/*.test.ts`, `skills-engine/__tests__/*.ts`     |
| 23  | 6     | Update WhatsApp tests for normalization      | `src/channels/whatsapp.test.ts`                       |
| 24  | 6     | Final verification and cleanup               | Run tests, rebuild container                          |
| 25  | 6     | Create branch and initial commit             | `git checkout -b feature/opencode-conversion`         |

---

## File Change Summary

| Category                  | Files Changed        | Est. Lines |
| ------------------------- | -------------------- | ---------- |
| Core infrastructure       | 8                    | ~600       |
| Security fixes (upstream) | 4                    | ~50        |
| Skills (path updates)     | 15 skills × ~3 files | ~200       |
| Skills (major rewrites)   | 4 skills             | ~300       |
| Documentation             | 7 files              | ~400       |
| Tests                     | 5 files              | ~70        |
| Config/GitHub             | 5 files              | ~30        |
| **Total**                 | ~55 files            | ~1,650     |

---

## Reference: PR #9 from aoberoi/nanoclaw

This plan is inspired by https://github.com/aoberoi/nanoclaw/pull/9 which implemented OpenCode as an alternative runtime. Key differences in our approach:

1. **Full conversion** (not hybrid) - no Claude SDK remaining
2. **Default model** - OpenCode Zen free tier instead of Anthropic
3. **File renames** - AGENTS.md and .opencode/skills/ instead of keeping Claude names
4. **Simplified config** - no runtime selection in database, always OpenCode
