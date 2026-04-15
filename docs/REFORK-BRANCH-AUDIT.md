# Refork Branch Audit

Audit date: 2026-04-15

This audit covers the current refork topic branches against `custom/main` and is intended to support replay planning without modifying `main`.

## Summary

- `custom/main` is the only active tip for the approved fork-only work.
- The named replay branches are not ahead of `custom/main`; they are stale ancestors.
- Because they are behind `custom/main`, they should not be merged directly into `custom/main` as replay branches.
- The immediate cleanup work belongs on a new branch from `custom/main`, not on the historical topic branches.

## Divergence From `custom/main`

Measured with `git rev-list --left-right --count custom/main...<branch>`:

| Branch | `custom/main` only | Branch only | Interpretation |
| --- | ---: | ---: | --- |
| `custom/fork-governance` | 12 | 0 | Stale ancestor of `custom/main` |
| `custom/opencode-core` | 7 | 0 | Stale ancestor of `custom/main` |
| `custom/setup-platform` | 14 | 0 | Stale ancestor of `custom/main` |
| `custom/msteams` | 5 | 0 | Stale ancestor of `custom/main` |

## Scope Audit

The branch names no longer match isolated concerns when compared with `custom/main`:

- `custom/fork-governance`
  - Diff touches governance files, OpenCode/Claude skill layout, Teams files, container runtime files, docs, and setup files.
  - This is not governance-only and should be treated as an older mixed branch.
- `custom/opencode-core`
  - Diff touches governance files, Teams sidecar files, helper scripts, sidecar runtime files, and tests.
  - This is not OpenCode-core-only and should be treated as an older mixed branch.
- `custom/setup-platform`
  - Diff touches governance files, OpenCode/Claude skill layout, docs, setup files, runtime files, and Teams-related files.
  - This is not setup-platform-only and should be treated as an older mixed branch.
- `custom/msteams`
  - Diff touches governance files, helper scripts, container runtime files, and tests in addition to Teams-related changes.
  - This is not Teams-only and should be treated as an older mixed branch.

## Operational Conclusion

- `custom/main` currently contains the effective integrated state for the approved fork-only work.
- The historical topic branches are useful as references, not as merge inputs.
- If replay needs to continue cleanly, recreate fresh `custom/<topic>` branches from the current `custom/main` baseline and restage changes by concern.
- Until that restaging happens, use dedicated working branches from `custom/main` for cleanup tasks such as governance conflict resolution and policy stabilization.