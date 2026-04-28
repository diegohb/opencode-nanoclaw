# Skills Registry

This file tracks skill sources and intake status for this fork.

Scope for this repository:
- This fork is for base/shared customizations only.
- Work-specific or home-specific implementations should be consumed in separate forks/deployments, not merged into this repository.

Last refreshed: 2026-04-27
Source snapshot: `git branch -r` after `git fetch upstream`

## Upstream Skills Inventory (Combined)

Source snapshots:
- `git branch -r --list "upstream/skill/*"`
- `git ls-tree -d --name-only upstream/main:.claude/skills`

| Skill | Source | Status | Notes |
| --- | --- | --- | --- |
| `apple-container` | `upstream/skill/apple-container` | reject-risk | Platform-specific; likely reject for this Docker-focused fork base |
| `channel-formatting` | `upstream/skill/channel-formatting` | accept-shared | Evaluate if channel formatting belongs in shared base |
| `compact` | `upstream/skill/compact` | accept-shared | Operational quality of life; likely shared-safe |
| `emacs` | `upstream/skill/emacs` | reject-risk | Editor-specific; likely reject for this fork base |
| `migrate-from-openclaw` | `upstream/skill/migrate-from-openclaw`; `upstream/main/.claude/skills/migrate-from-openclaw` | discovered | Migration utility; usually one-time |
| `migrate-nanoclaw` | `upstream/skill/migrate-nanoclaw`; `upstream/main/.claude/skills/migrate-nanoclaw` | accept-shared | Migration utility; usually one-time |
| `native-credential-proxy` | `upstream/skill/native-credential-proxy` | reject-risk | Security/runtime behavior; evaluate carefully |
| `ollama-tool` | `upstream/skill/ollama-tool` | accept-shared | Model tooling; shared if broadly useful |
| `qmd` | `upstream/skill/qmd` | accept-shared | Niche; verify compatibility and value |
| `setup-dynamic-context` | `upstream/skill/setup-dynamic-context` | discovered | Setup workflow enhancement; evaluate for shared-safe adoption |
| `wiki` | `upstream/skill/wiki` | discovered | Niche; verify compatibility and value |
| `add-atomic-chat-tool` | `upstream/main/.claude/skills/add-atomic-chat-tool` | discovered |  |
| `add-codex` | `upstream/main/.claude/skills/add-codex` | discovered |  |
| `add-dashboard` | `upstream/main/.claude/skills/add-dashboard` | discovered |  |
| `add-discord` | `upstream/main/.claude/skills/add-discord` | discovered |  |
| `add-emacs` | `upstream/main/.claude/skills/add-emacs` | discovered |  |
| `add-gcal-tool` | `upstream/main/.claude/skills/add-gcal-tool` | discovered |  |
| `add-gchat` | `upstream/main/.claude/skills/add-gchat` | discovered |  |
| `add-github` | `upstream/main/.claude/skills/add-github` | discovered |  |
| `add-gmail-tool` | `upstream/main/.claude/skills/add-gmail-tool` | discovered |  |
| `add-imessage` | `upstream/main/.claude/skills/add-imessage` | discovered |  |
| `add-karpathy-llm-wiki` | `upstream/main/.claude/skills/add-karpathy-llm-wiki` | discovered |  |
| `add-linear` | `upstream/main/.claude/skills/add-linear` | discovered |  |
| `add-macos-statusbar` | `upstream/main/.claude/skills/add-macos-statusbar` | discovered |  |
| `add-matrix` | `upstream/main/.claude/skills/add-matrix` | discovered |  |
| `add-ollama-provider` | `upstream/main/.claude/skills/add-ollama-provider` | discovered |  |
| `add-ollama-tool` | `upstream/main/.claude/skills/add-ollama-tool` | discovered |  |
| `add-opencode` | `upstream/main/.claude/skills/add-opencode` | discovered |  |
| `add-parallel` | `upstream/main/.claude/skills/add-parallel` | discovered |  |
| `add-resend` | `upstream/main/.claude/skills/add-resend` | discovered |  |
| `add-signal` | `upstream/main/.claude/skills/add-signal` | discovered |  |
| `add-slack` | `upstream/main/.claude/skills/add-slack` | discovered |  |
| `add-teams` | `upstream/main/.claude/skills/add-teams` | discovered |  |
| `add-telegram` | `upstream/main/.claude/skills/add-telegram` | discovered |  |
| `add-vercel` | `upstream/main/.claude/skills/add-vercel` | discovered |  |
| `add-webex` | `upstream/main/.claude/skills/add-webex` | discovered |  |
| `add-wechat` | `upstream/main/.claude/skills/add-wechat` | discovered |  |
| `add-whatsapp-cloud` | `upstream/main/.claude/skills/add-whatsapp-cloud` | discovered |  |
| `add-whatsapp` | `upstream/main/.claude/skills/add-whatsapp` | discovered |  |
| `claw` | `upstream/main/.claude/skills/claw` | discovered |  |
| `convert-to-apple-container` | `upstream/main/.claude/skills/convert-to-apple-container` | discovered |  |
| `customize` | `upstream/main/.claude/skills/customize` | discovered |  |
| `debug` | `upstream/main/.claude/skills/debug` | discovered |  |
| `get-qodo-rules` | `upstream/main/.claude/skills/get-qodo-rules` | discovered |  |
| `init-first-agent` | `upstream/main/.claude/skills/init-first-agent` | discovered |  |
| `init-onecli` | `upstream/main/.claude/skills/init-onecli` | discovered |  |
| `manage-channels` | `upstream/main/.claude/skills/manage-channels` | discovered |  |
| `manage-mounts` | `upstream/main/.claude/skills/manage-mounts` | discovered |  |
| `qodo-pr-resolver` | `upstream/main/.claude/skills/qodo-pr-resolver` | discovered |  |
| `setup` | `upstream/main/.claude/skills/setup` | discovered |  |
| `update-nanoclaw` | `upstream/main/.claude/skills/update-nanoclaw` | discovered |  |
| `update-skills` | `upstream/main/.claude/skills/update-skills` | discovered |  |
| `use-native-credential-proxy` | `upstream/main/.claude/skills/use-native-credential-proxy` | discovered |  |
| `x-integration` | `upstream/main/.claude/skills/x-integration` | discovered |  |

## Official Marketplace Catalog (Non-Blocking Reference)

Even without Claude marketplace usage, these GitHub sources are useful for discovery:
- Official marketplace repo: `qwibitai/nanoclaw-skills`
- Catalog file: `.claude-plugin/marketplace.json`
- Bundled skills directory: `plugins/nanoclaw-skills/skills/`

This is a discovery layer. The actual payload should be consumed via git refs, vendored files, or manual porting.

## Third-Party Sources

Primary third-party source for skills that are available and later added to the official list:
- `https://github.com/qwibitai/nanoclaw-skills/tree/main/plugins/nanoclaw-skills/skills`

Use this table as a running intake queue for third-party repositories (including official marketplace source repos).

| Candidate Skill | Source Repo | Source Ref | Intake Branch | Status | Decision |
| --- | --- | --- | --- | --- | --- |
| add-compact | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-compact` | `custom/intake-add-compact` | backlog | pending |
| add-discord | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-discord` | `custom/intake-add-discord` | backlog | pending |
| add-emacs | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-emacs` | `custom/intake-add-emacs` | backlog | pending |
| add-gmail | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-gmail` | `custom/intake-add-gmail` | backlog | pending |
| add-image-vision | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-image-vision` | `custom/intake-add-image-vision` | backlog | pending |
| add-macos-statusbar | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-macos-statusbar` | `custom/intake-add-macos-statusbar` | backlog | pending |
| add-ollama-tool | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-ollama-tool` | `custom/intake-add-ollama-tool` | backlog | pending |
| add-parallel | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-parallel` | `custom/intake-add-parallel` | backlog | pending |
| add-pdf-reader | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-pdf-reader` | `custom/intake-add-pdf-reader` | backlog | pending |
| add-reactions | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-reactions` | `custom/intake-add-reactions` | backlog | pending |
| add-slack | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-slack` | `custom/intake-add-slack` | backlog | pending |
| add-telegram-swarm | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-telegram-swarm` | `custom/intake-add-telegram-swarm` | backlog | pending |
| add-telegram | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-telegram` | `custom/intake-add-telegram` | backlog | pending |
| add-voice-transcription | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-voice-transcription` | `custom/intake-add-voice-transcription` | backlog | pending |
| add-whatsapp | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/add-whatsapp` | `custom/intake-add-whatsapp` | backlog | pending |
| channel-formatting | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/channel-formatting` | `custom/intake-channel-formatting` | backlog | pending |
| claw | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/claw` | `custom/intake-claw` | backlog | pending |
| convert-to-apple-container | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/convert-to-apple-container` | `custom/intake-convert-to-apple-container` | backlog | pending |
| get-qodo-rules | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/get-qodo-rules` | `custom/intake-get-qodo-rules` | backlog | pending |
| init-onecli | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/init-onecli` | `custom/intake-init-onecli` | backlog | pending |
| qodo-pr-resolver | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/qodo-pr-resolver` | `custom/intake-qodo-pr-resolver` | backlog | pending |
| use-local-whisper | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/use-local-whisper` | `custom/intake-use-local-whisper` | backlog | pending |
| use-native-credential-proxy | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/use-native-credential-proxy` | `custom/intake-use-native-credential-proxy` | backlog | pending |
| x-integration | `qwibitai/nanoclaw-skills` | `main/plugins/nanoclaw-skills/skills/x-integration` | `custom/intake-x-integration` | backlog | pending |

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
