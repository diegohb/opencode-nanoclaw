# Branch & Fork Maintenance Guidelines

This document is the practical maintenance guide for the current fork model.

The authoritative policy lives in `FORK-MAPPING.md`. If this document and `FORK-MAPPING.md` disagree, follow `FORK-MAPPING.md` and update this file.

## Current Model

- `upstream` is `qwibitai/nanoclaw`.
- `origin` is the fork repository.
- `main` must remain upstream-clean and track `upstream/main`.
- `custom/main` is the long-lived branch for fork-only divergence.
- `contrib/<topic>` branches are for upstream-safe work.
- `custom/<topic>` branches are for fork-only work.

The older channel-forks strategy is retired for this repository. Do not maintain separate long-lived per-channel forks from this checkout.

## Branch Roles

### `main`

- Fast-forward only from `upstream/main`.
- No fork-only files, policies, or local tooling.
- Base branch for `contrib/<topic>` work.

### `custom/main`

- Long-lived integration branch for approved fork-only behavior.
- Base branch for `custom/<topic>` work.
- Receives merge commits from validated fork-only topic branches.

### `contrib/<topic>`

- Branch from `main`.
- Use only for changes that could be proposed upstream.
- Must not include fork-only docs, OpenCode-specific behavior, or MS Teams sidecar work.

### `custom/<topic>`

- Branch from `custom/main`.
- Use for OpenCode integration, fork governance, MS Teams work, local tooling, and other approved divergence.

## Daily Workflow

### Create a branch

- Upstream-safe work: branch from `main` into `contrib/<topic>`.
- Fork-only work: branch from `custom/main` into `custom/<topic>`.

Use `scripts/new-fork-branch.ps1` when practical.

### Sync from upstream

1. Ensure the working tree is clean.
2. Fetch all remotes.
3. Fast-forward `main` to `upstream/main`.
4. Review upstream changes for any impact on fork-only behavior.
5. Replay or merge approved updates into `custom/main` through targeted `custom/<topic>` branches.
6. Validate before merging back to `custom/main`.

Use `scripts/fork-sync.ps1` for the safe portion of this workflow.

## Merge Strategy

- Merge fork-only topic branches into `custom/main` with explicit merge commits.
- Do not merge fork-only work into `main`.
- Keep mixed requests split across `contrib/<topic>` and `custom/<topic>` branches.
- Prefer small, concern-scoped branches over broad integration batches.

## Conflict Hotspots

These files are likely to need manual review during replay or upstream sync:

| File or Area | Typical issue |
| --- | --- |
| `package.json` | Upstream dependency churn versus fork-only additions |
| `package-lock.json` | Lockfile conflicts after upstream dependency updates |
| `AGENTS.md` | Fork policy and local workflow guidance drift |
| `README.md` and docs | Divergence between upstream documentation and fork behavior |
| `src/index.ts` and container runtime files | OpenCode and sidecar integration overlap with upstream runtime changes |

Auto-merges are not enough here. Always run validation after conflict resolution.

## Replay Guidance

When rebuilding divergence from a fresh upstream base:

1. Preserve current state with safety branches.
2. Reset `main` to `upstream/main`.
3. Create `custom/main` from the same clean base.
4. Reapply approved fork-only work in isolated `custom/<topic>` branches.
5. Test after each replay batch.
6. Merge validated branches into `custom/main`.

If historical topic branches no longer reflect isolated concerns, treat them as references and recreate fresh branches from `custom/main`.

## Operator Rules

- Do not rewrite published history unless explicitly approved.
- Do not use destructive git commands to force a clean state unless explicitly approved.
- Preserve safety and archive branches before branch reclassification.
- If a change cannot live cleanly on `main`, it belongs on `custom/*`.
- If a request mixes upstream-safe and fork-only work, split it before implementation.

## Verification Checklist

Before considering the fork state healthy, verify:

- `main` matches `upstream/main`.
- `custom/main` contains only approved fork divergence.
- Active work is happening on `contrib/<topic>` or `custom/<topic>` branches, not directly on long-lived branches.
- Helper scripts still match the branch model.
- Build and test pass after replaying or merging fork-only changes.
