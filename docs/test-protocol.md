# Comprehensive Agent Testing & Validation Guide

## Quick Reference

**Run all tests:** `bun test`  
**Build & typecheck:** `bun run build && bun run typecheck`  
**Format code:** `bun run format:fix`  
**Build container:** `./container/build.sh`

## 1. Pre-Implementation Validation Checklist

### Code Quality Gates

- [ ] **TypeScript compilation:** `bun run build` (no errors)
- [ ] **Type checking:** `bun run typecheck` (no errors)
- [ ] **Code formatting:** `bun run format:check` (passes)
- [ ] **Unit tests:** `bun test` (all pass)
- [ ] **Test coverage:** `bun test --coverage` (if configured)

### Container Validation

- [ ] **Container builds:** `./container/build.sh` (no errors)
- [ ] **Container image exists:** `docker images | grep nanoclaw-agent`
- [ ] **Container runs:** `echo '{}' | docker run -i nanoclaw-agent:latest` (no crash)

### Integration Testing

- [ ] **Skills mount correctly:** Container has access to `container/skills/`
- [ ] **Environment variables:** Required vars are set in container
- [ ] **IPC mechanisms:** `/workspace/ipc/` directories are writable

## 2. Testing Framework Overview

### Test Structure

```
src/
├── *.test.ts          # Unit tests for source files
├── channels/
│   └── *.test.ts      # Channel-specific tests
setup/
├── *.test.ts          # Setup/validation tests
skills-engine/
└── __tests__/
    └── *.test.ts      # Skills engine tests
```

### Test Runner

- **Framework:** Vitest (via Bun)
- **Location:** `package.json` scripts
- **Coverage:** `@vitest/coverage-v8`

### Available Scripts

```json
{
  "test": "bun test src/ skills-engine/ setup/",
  "test:watch": "bun test src/ skills-engine/ setup/ --watch",
  "typecheck": "tsc --noEmit",
  "format": "prettier --write \"src/**/*.ts\"",
  "format:fix": "prettier --write \"src/**/*.ts\"",
  "format:check": "prettier --check \"src/**/*.ts\"",
  "build": "tsc"
}
```

## 3. Validation Checklists by Change Type

### For Source Code Changes

- [ ] Run full test suite: `bun test`
- [ ] TypeScript compilation: `bun run build`
- [ ] Code formatting: `bun run format:check`
- [ ] Container rebuild: `./container/build.sh`
- [ ] Test container functionality

### For Skills (`.claude/skills/`)

- [ ] Test on fresh clone (PR template requirement)
- [ ] No source code changes (skills contain instructions only)
- [ ] Instructions are for Claude to follow (not pre-built code)
- [ ] Channel merge conflicts resolved (if applicable)

### For Container Skills (`container/skills/`)

- [ ] Skills mount correctly in container
- [ ] Main channel check logic works
- [ ] Error handling for non-main channels
- [ ] Commands gather correct information

### For Channel Installations

- [ ] Git merge succeeds without conflicts
- [ ] Package-lock.json auto-resolution works
- [ ] Channel-specific tests pass
- [ ] Container rebuild succeeds

## 4. Runtime Validation & Debugging

### Service Status Checks

```bash
# Is service running?
launchctl list | grep nanoclaw

# Any running containers?
docker ps --format '{{.Names}} {{.Status}}' | grep nanoclaw

# Recent errors?
grep -E 'ERROR|WARN' logs/nanoclaw.log | tail -20
```

### WhatsApp Connection Check

```bash
# Connection status
grep -E 'Connected to WhatsApp|Connection closed' logs/nanoclaw.log | tail -5

# QR code requests (means auth expired)
grep 'QR\|authentication required' logs/nanoclaw.log | tail -5
```

### Container Health

```bash
# Recent timeouts
grep -E 'Container timeout|timed out' logs/nanoclaw.log | tail -10

# Mount validation
grep -E 'Mount validated|Mount.*REJECTED' logs/nanoclaw.log | tail -10

# Test mounts
docker run -i --rm nanoclaw-agent:latest ls /workspace/extra/
```

### Task System

```bash
# Active tasks
grep -E 'Starting container|Container active' logs/nanoclaw.log | tail -10

# Task scheduling
grep -E 'Scheduling retry|retry|Max retries' logs/nanoclaw.log | tail -10
```

## 5. Common Validation Scenarios

### After Code Changes

1. `bun test` - All tests pass
2. `bun run build` - TypeScript compiles
3. `bun run typecheck` - No type errors
4. `./container/build.sh` - Container builds
5. Test functionality manually

### After Adding Channels

1. Check for merge conflicts in `package-lock.json`
2. Run channel-specific tests
3. Verify authentication works
4. Test message routing

### After Skills Installation

1. Skills appear in `ls /home/node/.claude/skills/`
2. Container skills mount at `/workspace/container/skills/`
3. Skills execute without errors
4. Test on fresh clone (for new skills)

### Before Deployment

1. Clean working tree: `git status`
2. All tests pass: `bun test`
3. Container builds: `./container/build.sh`
4. No linting errors: `bun run format:check`
5. TypeScript clean: `bun run typecheck`

## 6. Troubleshooting Failed Tests

### Test Failures

- Check test output for specific errors
- Run individual test: `bun test <file>`
- Debug with `--reporter=verbose`
- Check for missing dependencies

### Build Failures

- `bun run typecheck` for type errors
- Check `src/**/*.ts` for syntax issues
- Verify dependencies: `bun install`

### Container Issues

- Rebuild with `--no-cache`: `docker build --no-cache`
- Check Docker daemon: `docker info`
- Verify base image: `docker pull node:22-slim`

### Runtime Issues

- Check logs: `tail -f logs/nanoclaw.log`
- Debug checklist in `docs/DEBUG_CHECKLIST.md`
- Service restart: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

## 7. CI/CD Integration

### Pull Request Validation

- Type checked and builds
- All tests pass
- Code formatted
- Skills tested on fresh clone
- No source code changes in skills

### Pre-commit Hooks

- Format checking via Husky
- Type checking
- Test running

## 8. Performance & Security Validation

### Security Checks

- Mount validation passes
- No secrets in logs
- IPC authorization works
- Container isolation maintained

### Performance

- Container startup time < 5s
- Message processing < 2s
- Memory usage reasonable
- No resource leaks

---

This guide consolidates testing and validation practices from across the NanoClaw documentation. Use it as a checklist for ensuring changes are properly tested and validated before deployment.
