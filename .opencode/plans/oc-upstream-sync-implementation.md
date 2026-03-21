# Upstream Sync Implementation Plan: Port to OpenCode Architecture

**Created:** 2026-03-21  
**Purpose:** Port merged upstream changes to this fork's OpenCode SDK architecture  
**Estimated Time:** 2-3 hours  
**Agent Strategy:** Use subagents for parallel execution, surgical fixes on failures

---

## Executive Summary

After merging upstream commits to `main`, three files require porting to match this fork's OpenCode SDK architecture:

| File                                     | Priority   | Issue                                                         |
| ---------------------------------------- | ---------- | ------------------------------------------------------------- |
| `src/remote-control.ts`                  | **HIGH**   | Spawns `claude` CLI instead of `opencode`                     |
| `container/skills/capabilities/SKILL.md` | **MEDIUM** | References `.claude/skills/` instead of `.opencode/skills/`   |
| `container/skills/status/SKILL.md`       | **LOW**    | References `claude --version` instead of `opencode --version` |

---

## Background Research (from DeepWiki)

### OpenCode Remote Control Architecture

Based on DeepWiki query to `anomalyco/opencode`:

| Aspect             | Claude (Upstream)                                | OpenCode (Fork)                                       |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| **Command**        | `claude remote-control --name 'NanoClaw Remote'` | `opencode serve --hostname 0.0.0.0 --port <random>`   |
| **URL Pattern**    | `https://claude.ai/code...`                      | `http://<hostname>:<port>`                            |
| **Output Format**  | Single URL on stdout                             | Multi-line output with Local + Network URLs           |
| **Authentication** | OAuth-based                                      | `OPENCODE_SERVER_PASSWORD` env var                    |
| **URL Selection**  | N/A                                              | Use **Network access URL** for Docker/WSL consistency |

### Key OpenCode CLI Options

```
opencode serve --hostname 0.0.0.0 --port <port>
  --port <number>      Server port (default: 4096)
  --hostname <string>  Bind address (default: 127.0.0.1)
  --mdns               Enable mDNS discovery
  --mdns-domain <name> Custom mDNS domain
  --cors <origin>      Additional CORS origins
```

### Output Parsing

OpenCode outputs URLs in this format:

```
  Local access:       http://localhost:4096
  Network access:     http://192.168.1.100:4096
```

**Decision:** Use the **Network access URL** for consistency across Docker/WSL environments. OpenCode specifically filters out Docker bridge networks (172.x.x.x) when identifying network IPs.

---

## Implementation Tasks

### Task 1: Port `src/remote-control.ts` (HIGH PRIORITY)

**Subagent:** `general`  
**Timeout:** 30 minutes  
**Parallel:** No (critical path)

#### Changes Required

##### 1.1 Update Interface (Line 8-14)

Add `port` and `password` to session tracking:

```typescript
interface RemoteControlSession {
  pid: number;
  url: string;
  port: number;
  password: string;
  startedBy: string;
  startedInChat: string;
  startedAt: string;
}
```

##### 1.2 Add Password Generation Function (New, after line 45)

```typescript
function generatePassword(): string {
  const words = [
    'apple',
    'apricot',
    'avocado',
    'banana',
    'blackberry',
    'blueberry',
    'bread',
    'butter',
    'cantaloupe',
    'cherry',
    'chocolate',
    'cinnamon',
    'coconut',
    'cookie',
    'cracker',
    'cranberry',
    'cream',
    'croissant',
    'dragonfruit',
    'durian',
    'fig',
    'ginger',
    'grape',
    'grapefruit',
    'guava',
    'honey',
    'honeydew',
    'jam',
    'kiwi',
    'lemon',
    'lime',
    'mango',
    'maple',
    'melon',
    'milk',
    'nectarine',
    'nut',
    'oatmeal',
    'olive',
    'orange',
    'papaya',
    'peach',
    'peanut',
    'pear',
    'pecan',
    'pepper',
    'pickle',
    'pie',
    'pineapple',
    'plum',
    'pomegranate',
    'popcorn',
    'pumpkin',
    'radish',
    'raisin',
    'raspberry',
    'rice',
    'salt',
    'sandwich',
    'sauce',
    'smoothie',
    'spinach',
    'squash',
    'steak',
    'strawberry',
    'sugar',
    'toast',
    'tomato',
    'turkey',
    'vanilla',
    'waffle',
    'walnut',
    'watermelon',
    'wheat',
    'yogurt',
  ];

  const pick = () => words[Math.floor(Math.random() * words.length)];
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return `${capitalize(pick())}-${capitalize(pick())}-${capitalize(pick())}`;
}
```

##### 1.3 Add Port Generation Function (New, after generatePassword)

```typescript
function generateRandomPort(): number {
  // Use port range 49152-65535 (ephemeral port range)
  // Avoid common ports and start above 49152
  const MIN_PORT = 49152;
  const MAX_PORT = 65535;
  return Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
}
```

##### 1.4 Update URL Regex (Line 18)

```typescript
// OLD:
const URL_REGEX = /https:\/\/claude\.ai\/code\S+/;

// NEW: Match "Network access:" URL specifically
const NETWORK_URL_REGEX = /Network access:\s*(http:\/\/[\d.]+:\d+)/;
```

##### 1.5 Update Spawn Command (Line 110-116)

```typescript
// OLD:
proc = spawn('claude', ['remote-control', '--name', 'NanoClaw Remote'], {

// NEW:
const port = generateRandomPort();
const password = generatePassword();

proc = spawn('opencode', ['serve', '--hostname', '0.0.0.0', '--port', String(port)], {
  cwd,
  stdio: ['ignore', stdoutFd, stderrFd],
  detached: true,
  env: {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: password,
  },
});
```

##### 1.6 Update Session Object (Line 156-162)

```typescript
const session: RemoteControlSession = {
  pid,
  url: match[1], // Extract URL from regex group
  port,
  password,
  startedBy: sender,
  startedInChat: chatJid,
  startedAt: new Date().toISOString(),
};
```

##### 1.7 Update Return Value (Line 170)

The URL should include credentials for basic auth:

```typescript
// Parse URL and inject credentials
const urlObj = new URL(match[1]);
urlObj.username = 'opencode';
urlObj.password = password;

resolve({ ok: true, url: urlObj.toString() });
```

#### Test Updates Required

Update `src/remote-control.test.ts`:

1. **Line 78-98:** Update test to expect `opencode serve` command
2. **Line 84:** Update stdout content to OpenCode format
3. **Line 91:** Update expected URL pattern
4. **Line 94-96:** Update spawn expectations

```typescript
// Example test update:
it('spawns opencode serve and returns the network URL', async () => {
  const proc = createMockProcess();
  spawnMock.mockReturnValue(proc);

  stdoutFileContent = `
  Local access:       http://localhost:49152
  Network access:     http://192.168.1.100:49152
`;
  vi.spyOn(process, 'kill').mockImplementation((() => true) as any);

  const result = await startRemoteControl('user1', 'tg:123', '/project');

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.url).toContain('http://192.168.1.100:49152');
  }
  expect(spawnMock).toHaveBeenCalledWith(
    'opencode',
    expect.arrayContaining(['serve', '--hostname', '0.0.0.0']),
    expect.objectContaining({ cwd: '/project', detached: true }),
  );
});
```

#### Validation

```bash
npm run test -- src/remote-control.test.ts
npm run build
```

---

### Task 2: Port `container/skills/capabilities/SKILL.md` (MEDIUM PRIORITY)

**Subagent:** `general`  
**Timeout:** 15 minutes  
**Parallel:** Yes (independent of Task 1)

#### Changes Required

##### 2.1 Line 30 - Skills Path

```diff
- ls -1 /home/node/.claude/skills/ 2>/dev/null || echo "No skills found"
+ ls -1 /home/node/.opencode/skills/ 2>/dev/null || echo "No skills found"
```

##### 2.2 Line 67 - Group Memory Check

```diff
- ls /workspace/group/CLAUDE.md 2>/dev/null && echo "Group memory: yes" || echo "Group memory: no"
+ ls /workspace/group/AGENTS.md 2>/dev/null && echo "Group memory: yes" || echo "Group memory: no"
```

#### Validation

Manual verification - file is documentation only, no tests needed.

---

### Task 3: Port `container/skills/status/SKILL.md` (LOW PRIORITY)

**Subagent:** `general`  
**Timeout:** 10 minutes  
**Parallel:** Yes (independent of Tasks 1-2)

#### Changes Required

##### 3.1 Line 60 - Version Check

```diff
- claude --version 2>/dev/null
+ opencode --version 2>/dev/null
```

##### 3.2 Line 96 - Report Format

```diff
- • Claude Code: vX.X.X
+ • OpenCode: vX.X.X
```

#### Validation

Manual verification - file is documentation only, no tests needed.

---

## Execution Strategy

### Phase 1: Critical Path (Sequential)

```
┌─────────────────────────────────────────────────────────────┐
│ Task 1: src/remote-control.ts                                │
│ ├── Subagent: Port implementation                            │
│ ├── Run: npm run test -- src/remote-control.test.ts         │
│ ├── If FAIL: Surgical fix subagent                           │
│ └── Run: npm run build                                       │
└─────────────────────────────────────────────────────────────┘
```

### Phase 2: Documentation Updates (Parallel)

```
┌─────────────────────┐  ┌─────────────────────┐
│ Task 2: capabilities │  │ Task 3: status       │
│ Subagent: Edit file │  │ Subagent: Edit file  │
│ (no tests needed)   │  │ (no tests needed)    │
└─────────────────────┘  └─────────────────────┘
```

### Phase 3: Final Validation

```bash
npm run test
npm run build
npm run typecheck
```

---

## Subagent Instructions

### For Task 1 Subagent

```
You are porting src/remote-control.ts from Claude CLI to OpenCode CLI.

CONTEXT:
- This fork uses OpenCode SDK instead of Claude Agent SDK
- The remote-control feature spawns a headless server for remote access
- OpenCode uses `opencode serve` instead of `claude remote-control`

REQUIREMENTS:
1. Read the current src/remote-control.ts
2. Read the current src/remote-control.test.ts
3. Implement ALL changes from the implementation plan above
4. Ensure tests pass: npm run test -- src/remote-control.test.ts
5. Ensure build passes: npm run build

KEY CHANGES:
- Command: `claude remote-control` → `opencode serve --hostname 0.0.0.0 --port <random>`
- URL regex: Match "Network access: http://..." line
- Add password generation (3-word phrase, capitalized, hyphenated)
- Add random port generation (49152-65535 range)
- Inject password via OPENCODE_SERVER_PASSWORD env var
- Include credentials in returned URL

DO NOT:
- Modify any other files
- Skip the test updates
- Leave TODOs or placeholders

REPORT BACK:
- Summary of changes made
- Test results
- Any issues encountered
```

### For Task 2 Subagent

```
You are updating container/skills/capabilities/SKILL.md for OpenCode compatibility.

REQUIREMENTS:
1. Replace /home/node/.claude/skills/ with /home/node/.opencode/skills/
2. Replace CLAUDE.md with AGENTS.md in group memory check
3. No tests needed (documentation only)

REPORT BACK:
- Confirmation of changes
```

### For Task 3 Subagent

```
You are updating container/skills/status/SKILL.md for OpenCode compatibility.

REQUIREMENTS:
1. Replace `claude --version` with `opencode --version`
2. Replace "Claude Code: vX.X.X" with "OpenCode: vX.X.X" in report format
3. No tests needed (documentation only)

REPORT BACK:
- Confirmation of changes
```

---

## Rollback Plan

If any task fails beyond repair:

```bash
# Restore specific file from pre-sync commit
git checkout 3c5965f -- src/remote-control.ts
git checkout 3c5965f -- container/skills/capabilities/SKILL.md
git checkout 3c5965f -- container/skills/status/SKILL.md
```

---

## Success Criteria

- [ ] `src/remote-control.ts` spawns `opencode serve` with random port and password
- [ ] `src/remote-control.test.ts` tests pass (updated for OpenCode)
- [ ] `container/skills/capabilities/SKILL.md` references `.opencode/skills/` and `AGENTS.md`
- [ ] `container/skills/status/SKILL.md` references `opencode --version`
- [ ] `npm run test` passes (204+ tests)
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes

---

## Post-Implementation

After all tasks complete:

1. **Commit Changes:**

   ```bash
   git add src/remote-control.ts src/remote-control.test.ts
   git add container/skills/capabilities/SKILL.md container/skills/status/SKILL.md
   git commit -m "port: adapt upstream remote-control and container skills to OpenCode architecture"
   ```

2. **Update fork-divergence.md:**
   Add note about these ports in the "Maintenance Guidelines" section.

3. **Test Manually (Optional):**
   ```bash
   # Test remote-control manually
   npm run dev
   # Send /remote-control command via messaging channel
   # Verify OpenCode server starts with random port and password
   ```

---

## References

- DeepWiki query results: `anomalyco/opencode` remote-control documentation
- Existing fork docs: `docs/fork-divergence.md`, `docs/oc-conversion.md`
- Upstream source: `qwibitai/nanoclaw` commits 5ca0633, 8cbd715
