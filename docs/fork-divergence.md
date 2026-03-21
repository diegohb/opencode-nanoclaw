# Fork Divergence: Custom NanoClaw Implementation

## Overview

This fork (`diegohb/opencode-nanoclaw`) diverges from upstream (`qwibitai/nanoclaw`) in several key ways:

1. **SDK Migration**: Migrated from Claude Agent SDK to OpenCode SDK
2. **Skills Directory**: Moved from `.claude/skills/` to `.opencode/skills/`
3. **Custom Channels**: Added MS Teams integration
4. **Selective Upstream Sync**: Skip upstream skill updates to avoid conflicts

## SDK Migration: Claude → OpenCode

### What Changed

**File Structure Migration:**

- `.claude/` → `.opencode/` (skills, settings, workflows)
- `CLAUDE.md` → `AGENTS.md` (renamed and moved)
- `docs/SDK_DEEP_DIVE.md` → Removed (replaced with OpenCode docs)
- `src/container-runner.ts` → Updated for OpenCode SDK
- `src/index.ts` → Thin OpenCode dispatch shim
- Container build updated for OpenCode dependencies

**Key Migration Commits:**

- `55617ca`: Replace index.ts with thin OpenCode dispatch shim
- `44fd750`: Create opencode-runner.ts with OpenCode SDK integration
- `de7fdba`: Replace Claude Agent SDK with OpenCode SDK dependency
- `fd33c82`: MS Teams channel integration (custom)

### Why This Divergence

The fork migrated to OpenCode SDK for improved agent capabilities, better integration patterns, and enhanced tool calling. This represents a fundamental architectural shift that makes direct upstream merges of skill-related code incompatible.

## Skills Directory: .claude/ → .opencode/

### Migration Details

**Directory Structure:**

```
.claude/
├── settings.json
└── skills/
    ├── add-compact/
    ├── add-discord/
    ├── add-gmail/
    └── ...

.opencode/
├── settings.json
└── skills/
    ├── add-compact/
    ├── add-discord/
    ├── add-gmail/
    ├── add-ms-teams/     ← Custom addition
    └── ...
```

**Migration Commits:**

- `9cb2d6b`: Remove Claude OAuth references and update paths
- `3a149f3`: Rename CLAUDE.md to AGENTS.md and move skills to .opencode
- `7c97fa4`: Update hardcoded paths in workflows, tests, and docs
- `fd33c82`: Add MS Teams channel integration

### Conflict Avoidance Strategy

Upstream continues using `.claude/skills/` for the traditional Claude-based skills system. This fork uses `.opencode/skills/` for OpenCode-based skills. Merging upstream skill updates would create directory conflicts and incompatible skill implementations.

**Strategy:** Skip all upstream commits that modify `.claude/skills/*` directories.

## Custom Channels: MS Teams Integration

### Implementation

**Files Added/Modified:**

- `src/channels/msteams.ts` - MS Teams channel implementation
- `src/channels/msteams.test.ts` - Channel tests
- `src/sidecar-channel.ts` - Sidecar protocol for MS Teams
- `container/teams-sidecar/` - Containerized MS Teams bot
- `docs/MS_TEAMS.md` - Setup documentation
- `.opencode/skills/add-ms-teams/` - Skill definition

**Architecture:**

- Uses Microsoft Bot Framework SDK
- Containerized sidecar pattern for isolation
- WebSocket-based communication with main process
- OAuth integration for Teams authentication

### Branch: `add-ms-teams-integration`

Worktree: `C:/dev/projects/pscm-dslocal/NanoClaw/.codenomad/worktrees/add-ms-teams-integration`

**Key Changes:**

- MS Teams as a channel option alongside WhatsApp, Telegram, Discord
- Sidecar container for Bot Framework integration
- Extended sidecar protocol for Teams-specific events
- OAuth flow for Microsoft authentication

## Upstream Sync Strategy

### Selective Merging Approach

Given the architectural divergence, this fork employs selective upstream merging:

1. **Core Functionality**: Merge upstream core updates (src/, container/, docs/)
2. **Version Bumps**: Include dependency and version updates
3. **Bug Fixes**: Cherry-pick relevant bug fixes
4. **Skip Skills**: Avoid `.claude/skills/` directory changes
5. **Manual Review**: Evaluate each batch for compatibility

### Current Sync Status

**Last Upstream Sync:** March 21, 2026

- **Upstream HEAD:** `c71c7b7` (v1.2.17)
- **Local HEAD:** `main` (post-sync)
- **Diverged Commits:** ~24 local commits ahead
- **Skipped Commits:** All skill-related updates since migration

### Future Sync Process

1. **Monitor Upstream:** Track releases and critical fixes
2. **Batch Evaluation:** Group upstream commits by functionality
3. **Test Merges:** Run full test suite after each batch
4. **Conflict Resolution:** Use Claude for surgical fixes
5. **Documentation:** Update this document with sync decisions

### Selective Cherry-Pick Strategy

For future upstream features:

```bash
# Example: Cherry-pick a specific bug fix
git cherry-pick <commit-hash>

# Example: Skip skill-related commits
git log --oneline upstream/main..HEAD | grep -v "skills/"
```

### Worktree Protection

The `add-ms-teams-integration` worktree remains protected during syncs:

- Merges happen on `main` branch only
- Worktree points to separate branch
- No merge commits affect worktree state
- Changes isolated until ready for integration

## Migration from Skills-as-Branches

This fork diverges from the skills-as-branches architecture described in the original `docs/skills-as-branches.md` (now deleted). Key differences:

### Original Architecture (Upstream)

- Skills as git branches (`skill/discord`, `skill/telegram`)
- Marketplace-based skill discovery
- `.claude/skills/` with operational skills
- CI merge-forward of skills with main

### Fork Architecture

- Skills as directories in `.opencode/skills/`
- Direct skill integration (no marketplace)
- Custom skills developed in-worktree
- Manual upstream sync with selective merging

### Why the Divergence

1. **SDK Migration:** OpenCode requires different skill structure
2. **Development Workflow:** Worktree-based development for custom channels
3. **Simplified Deployment:** No marketplace complexity for single-user fork
4. **Architectural Control:** Direct integration vs. plugin-based approach

## Contributing Back

### Selective Contributions

This fork can contribute individual features back upstream:

1. **Core Improvements:** Bug fixes, performance enhancements
2. **Channel Implementations:** MS Teams as new channel type
3. **SDK Integrations:** OpenCode compatibility patterns
4. **Documentation:** Setup guides, troubleshooting

### Contribution Process

```bash
# Create feature branch from upstream main
git checkout -b feature/ms-teams upstream/main

# Implement changes
# ...

# Open PR to qwibitai/nanoclaw:main
```

## Maintenance Guidelines

### Regular Tasks

- Monitor upstream releases quarterly
- Test sync batches thoroughly
- Update documentation after syncs
- Validate MS Teams worktree after core changes

### Post-Sync Porting Notes

**March 21, 2026 Sync:**

- Ported `src/remote-control.ts` from Claude CLI to OpenCode CLI:
  - Changed from `claude remote-control` to `opencode serve --hostname 0.0.0.0 --port <random>`
  - Added random port generation (49152-65535 range)
  - Added 3-word password generation for authentication
  - Updated URL parsing to extract "Network access:" line from OpenCode output
  - Credentials injected into returned URL via basic auth
- Updated `container/skills/capabilities/SKILL.md`:
  - Changed path from `/home/node/.claude/skills/` to `/home/node/.opencode/skills/`
  - Changed group memory check from `CLAUDE.md` to `AGENTS.md`
- Updated `container/skills/status/SKILL.md`:
  - Changed `claude --version` to `opencode --version`
  - Updated report format from "Claude Code: vX.X.X" to "OpenCode: vX.X.X"

### Risk Assessment

- **High Risk:** Merging skill directory changes
- **Medium Risk:** Core src/ modifications
- **Low Risk:** Documentation and version bumps

### Rollback Strategy

- Maintain backup branches before syncs
- Use `git revert` for problematic merges
- Worktree isolation provides safety net

---

_Last Updated: March 21, 2026_
_Next Review: June 21, 2026_
