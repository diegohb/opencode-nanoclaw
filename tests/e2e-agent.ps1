<#
.SYNOPSIS
    End-to-end test for the NanoClaw OpenCode agent container.

.DESCRIPTION
    Builds the container and tests it using the real NanoClaw JSON stdin protocol:
      1. Simple text response (verifies SDK connectivity and auth)
      2. File creation task (verifies tool execution end-to-end)

    The test mounts an IPC directory and writes the _close sentinel when the
    agent has finished processing, matching how the production host operates.

.EXAMPLE
    .\tests\e2e-agent.ps1
    .\tests\e2e-agent.ps1 -SkipBuild
    .\tests\e2e-agent.ps1 -TimeoutSeconds 180
#>
param(
    [switch]$SkipBuild,
    [int]$TimeoutSeconds = 180,
    [string]$ContainerTag = "nanoclaw-agent:e2e"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Phase  { param($msg) Write-Host "`n$msg" -ForegroundColor Cyan }
function Write-OK     { param($msg) Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Fail   { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Info   { param($msg) Write-Host "  ->     $msg" -ForegroundColor Gray }

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Get-Item $ScriptDir).Parent.FullName
$OutputDir   = Join-Path $ScriptDir "e2e-output"
$PassCount   = 0
$FailCount   = 0

# ---------------------------------------------------------------------------
# Parse nanoclaw output markers from mixed stdout+stderr lines
# ---------------------------------------------------------------------------
function Parse-NanoClawOutput {
    param([string[]]$Lines)
    $inBlock  = $false
    $jsonLine = ""
    foreach ($line in $Lines) {
        if ($line -match '---NANOCLAW_OUTPUT_START---') { $inBlock = $true; continue }
        if ($line -match '---NANOCLAW_OUTPUT_END---')   { break }
        if ($inBlock -and $line.TrimStart().StartsWith('{')) { $jsonLine = $line }
    }
    if (!$jsonLine) { return $null }
    try { $jsonLine | ConvertFrom-Json } catch { $null }
}

# ---------------------------------------------------------------------------
# Run a single container test.
# Mounts the IPC input dir so we can write _close after output is produced.
# ---------------------------------------------------------------------------
function Run-ContainerTest {
    param(
        [string]$Label,
        [hashtable]$Payload,
        [string]$EnvVar,
        [string]$BaseDir,
        [string]$OcGlobalConfigPath = "",
        [int]$Timeout = $TimeoutSeconds
    )

    $groupDir      = Join-Path $BaseDir "group"
    $ipcDir        = Join-Path (Join-Path $BaseDir "ipc") "input"
    New-Item -ItemType Directory -Force -Path $groupDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ipcDir   | Out-Null

    $containerName = "nanoclaw-e2e-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
    $inputJson     = $Payload | ConvertTo-Json -Depth 5

    # Start the container. Combined stdout+stderr so we see log lines.
    $containerJob = Start-Job -ScriptBlock {
        param($json, $envVar, $groupDir, $ipcDir, $tag, $name, $ocCfg)
        $dockerArgs = @('run', '-i', '--rm', '--name', $name,
                  '-e', $envVar,
                  '-v', "${groupDir}:/workspace/group",
                  '-v', "${ipcDir}:/workspace/ipc/input")
        if ($ocCfg -and (Test-Path $ocCfg)) {
            $dockerArgs += '-v', "$($ocCfg):/home/node/.config/opencode/opencode.json:ro"
        }
        $dockerArgs += $tag
        $json | docker @dockerArgs 2>&1
    } -ArgumentList $inputJson, $EnvVar, $groupDir, $ipcDir, $ContainerTag, $containerName, $OcGlobalConfigPath

    # Watcher: polls docker logs; when OUTPUT_END seen, drops _close sentinel.
    $watcherJob = Start-Job -ScriptBlock {
        param($cname, $cIpcDir, $pollMs, $timeoutMs)
        $elapsed = 0
        while ($elapsed -lt $timeoutMs) {
            Start-Sleep -Milliseconds $pollMs
            $elapsed += $pollMs
            $alive = docker ps --filter "name=^/${cname}$" --format '{{.ID}}' 2>$null
            if (!$alive) { break }
            $logs = docker logs $cname 2>&1 | Out-String
            if ($logs -match '---NANOCLAW_OUTPUT_END---') {
                [System.IO.File]::WriteAllText((Join-Path $cIpcDir '_close'), '')
                break
            }
        }
    } -ArgumentList $containerName, $ipcDir, 1000, ($Timeout * 1000)

    # Wait for container job to finish (it will once _close is detected).
    $elapsed   = 0
    $pollSec   = 5
    $completed = $false
    while ($elapsed -lt $Timeout) {
        $done = Wait-Job $containerJob -Timeout $pollSec
        if ($done) { $completed = $true; break }
        $elapsed += $pollSec
        Write-Info "  ${Label}: still running... (${elapsed}s / ${Timeout}s)"
    }

    if (!$completed) {
        Write-Fail "${Label}: timed out after ${Timeout}s"
        docker stop $containerName 2>$null
    }

    Stop-Job  $watcherJob  -ErrorAction SilentlyContinue
    Remove-Job $watcherJob -Force -ErrorAction SilentlyContinue

    $output = Receive-Job $containerJob -ErrorAction SilentlyContinue
    Remove-Job $containerJob -Force -ErrorAction SilentlyContinue
    return ,$output   # comma forces array return
}

# ---------------------------------------------------------------------------
# Locate .env (project root, ancestor, or sibling worktree)
# ---------------------------------------------------------------------------
$envFile = $null
$searchDir = $ProjectRoot
for ($i = 0; $i -lt 4; $i++) {
    $c = Join-Path $searchDir ".env"
    if (Test-Path $c) { $envFile = $c; break }
    $searchDir = Split-Path $searchDir -Parent
}
if (!$envFile) {
    Get-ChildItem (Split-Path $ProjectRoot -Parent) -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        if (!$envFile) {
            $c = Join-Path $_.FullName ".env"
            if (Test-Path $c) { $envFile = $c }
        }
    }
}
if (!$envFile) { Write-Fail ".env not found near $ProjectRoot"; exit 1 }
Write-Info ".env: $envFile"

$envContent = Get-Content $envFile -Raw
$openRouter = if ($envContent -match 'OPENROUTER_API_KEY\s*=\s*([^\s#\r\n]+)') { $matches[1].Trim() } else { '' }
$anthropic  = if ($envContent -match 'ANTHROPIC_API_KEY\s*=\s*([^\s#\r\n]+)')   { $matches[1].Trim() } else { '' }
if (!$openRouter -and !$anthropic) { Write-Fail "No OPENROUTER_API_KEY or ANTHROPIC_API_KEY in .env"; exit 1 }

if ($openRouter) {
    $EnvVar   = "OPENROUTER_API_KEY=$openRouter"
    Write-Info "Using OpenRouter key (model from global opencode config)"
} else {
    $EnvVar   = "ANTHROPIC_API_KEY=$anthropic"
    Write-Info "Using Anthropic key (model from global opencode config)"
}

# No model override — let OpenCode pick up the global ~/.config/opencode/config.json
$Secrets  = @{}
if ($openRouter) { $Secrets['OPENROUTER_API_KEY'] = $openRouter }
if ($anthropic)  { $Secrets['ANTHROPIC_API_KEY']  = $anthropic  }

# Select model and provider for the test container.
# Prefer the global opencode config (model/small_model only).
# Falls back to claude-3-haiku via OpenRouter — a reliable tool-use model.
$TestModel    = $null
$TestProvider = $null
$TestApiKeyName = $null

$globalOcJson = "$env:USERPROFILE\.config\opencode\opencode.json"
if (Test-Path $globalOcJson) {
    try {
        # Strip JSONC line comments (handle comments after commas in arrays)
        $raw     = Get-Content $globalOcJson -Raw
        $stripped = [regex]::Replace($raw, '(?m)//.*$', '')
        $parsed  = $stripped | ConvertFrom-Json
        if ($parsed.model) { $TestModel = $parsed.model }
    } catch { }
}

if (!$TestModel -or $TestModel -match '^zai-|^custom/') {
    # If no model is set, or the user's model requires a non-portable custom
    # auth plugin, fall back to a portable OpenRouter model.
    if ($openRouter) {
        $TestModel      = "openrouter/anthropic/claude-3.5-haiku"
        $TestProvider   = "openrouter"
        $TestApiKeyName = "OPENROUTER_API_KEY"
        Write-Info "Using test model: $TestModel (OpenRouter fallback)"
    } elseif ($anthropic) {
        $TestModel      = "openrouter/anthropic/claude-3.5-haiku"
        $TestProvider   = "anthropic"
        $TestApiKeyName = "ANTHROPIC_API_KEY"
        Write-Info "Using test model: $TestModel (Anthropic)"
    }
} else {
    Write-Info "Using model from global config: $TestModel"
}

$OcConfig = @{}
if ($TestModel)      { $OcConfig['model']    = $TestModel }
if ($TestProvider)   { $OcConfig['provider'] = $TestProvider }
if ($TestApiKeyName) { $OcConfig['apiKey']   = $TestApiKeyName }

# No global config file mount — use the explicit OcConfig above to avoid
# loading plugin/provider settings that aren't available in the container.
$OcGlobalConfigPath = ""

# ---------------------------------------------------------------------------
# Phase 1: Container Build
# ---------------------------------------------------------------------------
Write-Phase "=== Phase 1: Container Build ==="

if ($SkipBuild) {
    if (!(docker images --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -eq $ContainerTag })) {
        Write-Fail "Image $ContainerTag not found. Run without -SkipBuild first."
        exit 1
    }
    Write-OK "Using cached image $ContainerTag"
} else {
    Write-Info "Building $ContainerTag ..."
    docker build --no-cache -t $ContainerTag "$ProjectRoot\container" --quiet 2>&1 |
        Where-Object { $_ -match 'error' -and $_ -notmatch '^#' } |
        ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    if ($LASTEXITCODE -ne 0) { Write-Fail "Build failed"; exit 1 }
    Write-OK "Image built"
}
$PassCount++

Write-Info "Verifying container toolchain..."
$null = docker run --rm --entrypoint sh $ContainerTag -c 'which opencode && which node' 2>&1
if ($LASTEXITCODE -ne 0) { Write-Fail "Required tools missing in container"; $FailCount++; exit 1 }
Write-OK "Container toolchain OK"

# ---------------------------------------------------------------------------
# Phase 2: Text smoke test — no tools, just LLM connectivity
# ---------------------------------------------------------------------------
Write-Phase "=== Phase 2: Text Response Smoke Test ==="

$smokePayload = @{
    prompt         = "Reply with exactly one word: ALIVE"
    groupFolder    = "test-smoke"
    chatJid        = "test@g.us"
    isMain         = $false
    secrets        = $Secrets
    opencodeConfig = $OcConfig
}

Write-Info "Running (timeout: ${TimeoutSeconds}s)..."
$raw = Run-ContainerTest -Label "smoke" -Payload $smokePayload -EnvVar $EnvVar `
    -BaseDir (Join-Path $OutputDir "text-smoke") -OcGlobalConfigPath $OcGlobalConfigPath

$parsed = Parse-NanoClawOutput $raw
if ($parsed -and $parsed.status -eq "success") {
    Write-OK "Text smoke test passed"
    Write-Info "LLM response: $($parsed.result)"
    $PassCount++
} else {
    Write-Fail "Text smoke test failed"
    $raw | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $FailCount++
    exit 1
}

# ---------------------------------------------------------------------------
# Phase 3: File creation task — tests tool execution end-to-end
# ---------------------------------------------------------------------------
Write-Phase "=== Phase 3: File Creation Task (Tool Execution) ==="

$filePayload = @{
    prompt         = "Create a file named e2e-result.txt in the current directory with content: E2E_PASS"
    groupFolder    = "test-file"
    chatJid        = "test@g.us"
    isMain         = $false
    secrets        = $Secrets
    opencodeConfig = $OcConfig
}

$fileBaseDir = Join-Path $OutputDir "file-task"
Write-Info "Running (timeout: ${TimeoutSeconds}s)..."
$raw = Run-ContainerTest -Label "file-task" -Payload $filePayload -EnvVar $EnvVar `
    -BaseDir $fileBaseDir -OcGlobalConfigPath $OcGlobalConfigPath

$resultFile = Join-Path (Join-Path $fileBaseDir "group") "e2e-result.txt"
if (Test-Path $resultFile) {
    $content = (Get-Content $resultFile -Raw).Trim()
    Write-OK "File created by agent: $content"
    if ($content -match "E2E_PASS") {
        Write-OK "Content correct"
        $PassCount++
    } else {
        Write-Fail "Content mismatch. Expected E2E_PASS, got: '$content'"
        $FailCount++
    }
} else {
    Write-Fail "e2e-result.txt not created by agent"
    $parsed = Parse-NanoClawOutput $raw
    if ($parsed) { Write-Info "Agent response: $($parsed.result)" }
    $raw | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $FailCount++
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Phase "=== Summary ==="
Write-Host "  Passed: $PassCount" -ForegroundColor Green
if ($FailCount -gt 0) {
    Write-Host "  Failed: $FailCount" -ForegroundColor Red
    exit 1
} else {
    Write-Host "  All tests passed" -ForegroundColor Green
    exit 0
}
