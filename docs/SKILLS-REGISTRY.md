# Skills Registry

This file tracks skill sources and intake status for this fork.

Scope for this repository:
- This fork is for base/shared customizations only.
- Work-specific or home-specific implementations should be consumed in separate forks/deployments, not merged into this repository.

Last refreshed: 2026-04-16
Source snapshot: `git branch -r` after `git fetch upstream`

## Upstream Skill Branches (Currently Available)

| Skill Branch | Source Remote | Status | Notes |
| --- | --- | --- | --- |
| `upstream/skill/channel-formatting` | `upstream` (`qwibitai/nanoclaw`) | discovered | Evaluate if channel formatting belongs in shared base |
| `upstream/skill/compact` | `upstream` (`qwibitai/nanoclaw`) | discovered | Operational quality of life; likely shared-safe |
| `upstream/skill/migrate-from-openclaw` | `upstream` (`qwibitai/nanoclaw`) | discovered | Migration utility; usually one-time |
| `upstream/skill/migrate-nanoclaw` | `upstream` (`qwibitai/nanoclaw`) | discovered | Migration utility; usually one-time |
| `upstream/skill/native-credential-proxy` | `upstream` (`qwibitai/nanoclaw`) | discovered | Security/runtime behavior; evaluate carefully |
| `upstream/skill/ollama-tool` | `upstream` (`qwibitai/nanoclaw`) | discovered | Model tooling; shared if broadly useful |
| `upstream/skill/qmd` | `upstream` (`qwibitai/nanoclaw`) | discovered | Niche; verify compatibility and value |
| `upstream/skill/wiki` | `upstream` (`qwibitai/nanoclaw`) | discovered | Niche; verify compatibility and value |

## Official Marketplace Catalog (Non-Blocking Reference)

Even without Claude marketplace usage, these GitHub sources are useful for discovery:
- Official marketplace repo: `qwibitai/nanoclaw-skills`
- Catalog file: `.claude-plugin/marketplace.json`
- Bundled skills directory: `plugins/nanoclaw-skills/skills/`

This is a discovery layer. The actual payload should be consumed via git refs, vendored files, or manual porting.

## Third-Party Sources

Use this table as a running intake queue for other repos.

| Candidate Skill | Source Repo | Source Ref | Intake Branch | Status | Decision |
| --- | --- | --- | --- | --- | --- |
| example-community-skill | owner/repo | `skill/example` or PR ref | `custom/intake-example-community-skill` | backlog | pending |

Decision values:
- `accept-shared`: merge into `custom/main`
- `reject-contextual`: keep for work/home forks only
- `reject-risk`: not suitable
- `parked`: revisit later

## Intake Checklist (Per Skill)

- Confirm source provenance (repo, owner, commit/ref).
- Classify as shared-safe vs context-specific.
- Import on a dedicated `custom/<topic>` branch.
- Resolve conflicts with explicit notes.
- Run validation and smoke tests.
- Record decision in this registry.
- Merge only approved shared-safe changes to `custom/main`.
