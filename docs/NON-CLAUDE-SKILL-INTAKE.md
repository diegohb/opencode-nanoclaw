# Non-Claude Skill Intake Workflow

This guide defines how to consume skills from GitHub without relying on the Claude marketplace UX.

It is aligned with this repository's branch policy in `docs/BRANCH-FORK-MAINTENANCE.md`:
- `main` remains upstream-clean.
- `custom/main` is the long-lived branch for fork-only divergence.
- All intake work happens on `custom/<topic>` branches.

## Intent

Use this repository for base/shared customizations only.

If a skill is specific to your work context or home/personal context, do not merge it into this fork. Route it to a dedicated context fork/deployment.

## Source Types

### 1. Branch-based skill (preferred)

The source repo exposes a branch like `skill/<name>`.

Use git merge from a vendor remote.

### 2. Repo or PR without `skill/*` branch

The source is a feature branch or PR commits.

Use cherry-pick or manual porting on a `custom/<topic>` branch.

### 3. Marketplace-style skill folder only

The source provides SKILL.md and files but no branch payload for your runtime.

Treat SKILL.md as a runbook and port the underlying code changes manually.

## Standard Intake Procedure

### Step 1: Create a topic branch from `custom/main`

```bash
git checkout custom/main
git checkout -b custom/intake-<skill-name>
```

### Step 2: Add and fetch vendor source

```bash
git remote add vendor-<owner> https://github.com/<owner>/<repo>.git
git fetch vendor-<owner>
```

### Step 3A: Merge branch-based skill

```bash
git merge --no-ff vendor-<owner>/skill/<skill-name>
```

### Step 3B: Or cherry-pick from source branch/PR

```bash
git cherry-pick <commit-sha>
```

### Step 4: Resolve conflicts and validate

- Resolve merge/cherry-pick conflicts.
- Run project validation (build/tests/smoke checks).
- Record conflict notes and final outcome.

### Step 5: Decide destination

- If shared-safe: merge to `custom/main`.
- If context-specific: reject in this fork and port to context fork.

### Step 6: Record provenance

Update `docs/SKILLS-REGISTRY.md` with:
- source repo and ref
- intake branch
- decision
- merge commit or rejection reason

## Decision Gate: Shared vs Contextual

Accept into this fork only if all are true:
- Useful across both work and home contexts.
- No context-bound secrets, policies, or mounts.
- No org-specific workflow assumptions.
- Maintains clean separation from `main` and upstream-safe branches.

Otherwise classify as `reject-contextual` and route to a dedicated context fork.

## Suggested Naming Conventions

- Vendor remotes: `vendor-<owner>`
- Intake branches: `custom/intake-<skill-name>`
- Context routing branches in other forks:
  - `custom/work-<skill-name>`
  - `custom/home-<skill-name>`

## Update Procedure for Previously Imported Skills

```bash
git checkout custom/main
git checkout -b custom/update-<skill-name>
git fetch vendor-<owner>
git merge --no-ff vendor-<owner>/skill/<skill-name>
```

Then validate and merge if still shared-safe.

## Safety Rules

- Do not merge fork-only intake work into `main`.
- Do not use destructive history rewrites unless explicitly approved.
- Keep each intake branch narrow in scope.
- Prefer explicit merge commits for traceability.
