# Fork Mapping

This repository is maintained as a long-lived fork with a strict separation between upstream-safe work and fork-only divergence.

This file is the authoritative fork strategy for future maintenance work. It supersedes older fork-divergence notes that may still exist on historical branches.

## Objective

Keep upstream sync simple and predictable while preserving fork-only behavior.

The target model is:

- `origin` points to the user fork.
- `upstream` points to `qwibitai/nanoclaw`.
- `main` tracks `upstream/main` and remains upstream-clean.
- `custom/main` is the long-lived branch for fork-only divergence.
- `contrib/<topic>` branches are for upstream PR work.
- `custom/<topic>` branches are for fork-only work.

## Non-Negotiable Constraints

- Do not lose, reset, overwrite, or silently discard existing work.
- Do not use destructive git commands unless explicitly approved.
- Preserve messy or mixed historical state first, then reorganize around it.
- Prefer the smallest viable restructuring that creates a clean operating model.
- Keep fork policy in tracked files, not only in chat history.

## Remote Mapping

- `origin` = `diegohb/opencode-nanoclaw`
- `upstream` = `qwibitai/nanoclaw`

## Branch Roles

- `main`
  - Must stay upstream-clean.
  - Should fast-forward to `upstream/main`.
  - Must not contain fork-only files, policies, or experiments.
- `custom/main`
  - Long-lived fork branch.
  - Receives approved fork-only divergence.
  - Used as the base for `custom/<topic>` branches.
- `contrib/<topic>`
  - Branch from `main`.
  - Used only for upstream-safe work intended for PRs.
  - Must not contain fork-only files or organization-specific behavior.
- `custom/<topic>`
  - Branch from `custom/main`.
  - Used for fork-only work such as OpenCode adaptation, custom channels, or repo-specific tooling.

## Approved Divergence Scope

The current fork plan keeps these customization areas:

- Claude-to-OpenCode conversion and repo layout changes.
- OpenCode runtime integration and CLI wiring.
- MS Teams channel integration.
- Generic sidecar channel infrastructure required by MS Teams.
- MS Teams sidecar container and related docs.
- Fork governance, mapping, and maintenance docs.
- Selected fork-only skills and local tooling.
- Setup and platform adjustments aligned to the Node/npm baseline.
- Removal of obsolete Claude-only artifacts where needed.

The current fork plan intentionally avoids or defers these areas:

- Replay or preservation of Bun-specific divergence.
- Bun-native SQLite migration.
- Bun-specific runtime or test rewrites except where removing stale drift.
- The current container-skills remap approach.
  - Re-implement skills under the new approach later instead of replaying the old path remap strategy.

## Fork-Only Files And Directories

Treat these as fork-only by default:

- `FORK-MAPPING.md`
- Fork policy additions in `AGENTS.md`
- `.opencode/`
- `.grepai/`
- `.serena/`
- `container/agent-runner/src/opencode-runner.ts`
- OpenCode-specific host and container wiring
- `src/sidecar-channel.ts`
- `src/channels/msteams.ts`
- `container/teams-sidecar/`
- `docs/MS_TEAMS.md`
- Other OpenCode- or MS Teams-specific assets added on `custom/*` branches

When in doubt, classify local deployment files, local prompts, environment-specific tooling, and organization-specific automation as fork-only.

## Upstream-Safe vs Fork-Only Rules

Upstream-safe work belongs on `main` or `contrib/<topic>` only if all of the following are true:

- It does not depend on OpenCode-only behavior.
- It does not add fork-only files or repo policy.
- It does not mention or require MS Teams sidecar behavior.
- It does not require `.opencode/`, local-only tooling, or organization-specific setup.

Fork-only work belongs on `custom/main` or `custom/<topic>` if any of the following are true:

- It changes OpenCode runtime behavior.
- It changes fork governance or branch policy.
- It adds or changes MS Teams integration.
- It adds local tooling or search/indexing configuration.
- It updates files intended only for this fork.

If a request mixes upstream-safe and fork-only work, split it into separate branches.

## Daily Workflow

### Create a branch

- Upstream PR work: branch from `main` into `contrib/<topic>`.
- Fork-only work: branch from `custom/main` into `custom/<topic>`.

Use `scripts/new-fork-branch.ps1` when practical.

### Sync from upstream

1. Fetch all remotes.
2. Fast-forward `main` to `upstream/main`.
3. Review upstream changes for conflicts with fork-only behavior.
4. Merge or replay approved changes into `custom/main` via targeted `custom/<topic>` branches.
5. Run validation before merging back to `custom/main`.

Use `scripts/fork-sync.ps1` to handle the safe portion of this workflow.

## Re-Fork And Replay Workflow

When replaying the fork from a fresh upstream base:

1. Preserve existing state with safety branches.
2. Recreate `main` from `upstream/main`.
3. Create `custom/main` from the same clean base.
4. Reapply approved divergence in isolated branches.
   - `custom/opencode-core`
   - `custom/msteams`
   - `custom/fork-governance`
   - `custom/setup-platform`
5. Test after each replay batch.
6. Merge validated topic branches into `custom/main`.

## Existing Non-Conforming State

Historical branches may contain mixed work, documentation drift, Bun-specific changes, or old sync experiments. Preserve that state before cleanup.

Current preservation policy:

- Keep safety branches before repointing or reclassifying branches.
- Keep archive branches for previously divergent `main` states.
- Do not rewrite published history unless explicitly approved.

## Verification Checklist

Before considering the fork workflow stable, verify:

- `origin` and `upstream` are mapped correctly.
- `main` tracks `upstream/main` and stays upstream-clean.
- `custom/main` contains only approved fork divergence.
- New work uses `contrib/<topic>` or `custom/<topic>` appropriately.
- Fork-only files are documented here and not smuggled into upstream PR branches.
- Helper scripts are syntactically valid.
- Validation runs after replaying OpenCode or MS Teams changes.

## Operator Notes

- Prefer additive migration over history surgery.
- Prefer small replay batches with tests after each batch.
- If a destructive step becomes necessary, stop and get explicit approval.