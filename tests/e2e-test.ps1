<#
.SYNOPSIS
    End-to-end Docker test for OpenCode agent in NanoClaw container.

.DESCRIPTION
    Uses the OpenCode CLI to verify the container can complete real tasks.

.PREREQUISITES
    - Docker Desktop running
    - OPENROUTER_API_KEY or ANTHROPIC_API_KEY in .env file

.EXAMPLE
    .\tests\e2e-test.ps1
    .\tests\e2e-test.ps1 -SkipBuild
    .\tests\e2e-test.ps1 -TimeoutMinutes 15
#>

param(
    [switch]$SkipBuild,
    [int]$TimeoutMinutes = 10,
    [string]$TestOutputDir = "tests/output",
    [string]$ContainerTag = "nanoclaw-agent:test"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Phase { param($msg) Write-Host "`n$msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "  -> $msg" -ForegroundColor Gray }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Get-Item $ScriptDir).Parent.FullName
$OutputDir = Join-Path $ProjectRoot $TestOutputDir
$StartTime = Get-Date
$TestsPassed = 0
$TestsFailed = 0

function Cleanup {
    docker rm -f nanoclaw-e2e-test 2>$null
}

trap {
    Write-Fail "Test aborted: $_"
    Cleanup
    exit 1
}

# ============================================================================
# PHASE 1: Build Container
# ============================================================================

Write-Phase "=== Phase 1: Build Container ==="

if ($SkipBuild) {
    $imageExists = docker images --format "{{.Repository}}:{{.Tag}}" | Where-Object { $_ -eq $ContainerTag }
    if (!$imageExists) {
        Write-Fail "Image $ContainerTag not found"
        exit 1
    }
    Write-Success "Using existing image: $ContainerTag"
} else {
    Write-Info "Building container image..."
    docker build -t $ContainerTag "$ProjectRoot/container" --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Container build failed"
        $TestsFailed++
        exit 1
    }
    Write-Success "Container image built"
}
$TestsPassed++

# ============================================================================
# PHASE 2: Check API Key
# ============================================================================

Write-Phase "=== Phase 2: Check API Key ==="

$envFile = Join-Path $ProjectRoot ".env"
if (!(Test-Path $envFile)) {
    $envFile = Join-Path (Split-Path $ProjectRoot -Parent) ".env"
}

if (!(Test-Path $envFile)) {
    Write-Fail ".env file not found"
    Write-Info "Create .env with OPENROUTER_API_KEY or ANTHROPIC_API_KEY"
    $TestsFailed++
    exit 1
}

$envContent = Get-Content $envFile -Raw
$openRouterKey = ""
$anthropicKey = ""

if ($envContent -match "OPENROUTER_API_KEY\s*=\s*([^\s#]+)") {
    $openRouterKey = $matches[1].Trim()
}
if ($envContent -match "ANTHROPIC_API_KEY\s*=\s*([^\s#]+)") {
    $anthropicKey = $matches[1].Trim()
}

if (!$openRouterKey -and !$anthropicKey) {
    Write-Fail "No API key found in .env"
    $TestsFailed++
    exit 1
}

if ($openRouterKey) {
    $envVar = "OPENROUTER_API_KEY=$openRouterKey"
    $model = "openrouter/google/gemini-2.0-flash-001"
    Write-Success "Found OpenRouter API key"
} else {
    $envVar = "ANTHROPIC_API_KEY=$anthropicKey"
    $model = "anthropic/claude-sonnet-4-20250514"
    Write-Success "Found Anthropic API key"
}
$TestsPassed++

# ============================================================================
# PHASE 3: Smoke Test
# ============================================================================

Write-Phase "=== Phase 3: Smoke Test (File Creation) ==="

$smokeDir = Join-Path $OutputDir "smoke-test"
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
Remove-Item "$smokeDir/*" -Recurse -Force -ErrorAction SilentlyContinue

$smokeConfig = @{
    model = $model
    permission = @{ edit = "allow"; bash = "allow" }
} | ConvertTo-Json

$smokeConfig | Out-File -FilePath (Join-Path $smokeDir "opencode.json") -Encoding utf8

Write-Info "Running smoke test (60s timeout)..."
$smokeOutput = docker run --rm -e $envVar -v "${smokeDir}:/workspace/group" --entrypoint sh $ContainerTag -c "cd /workspace/group && timeout 60 opencode run 'Create file test.txt with content SMOKE_OK' 2>&1"

if (Test-Path "$smokeDir/test.txt") {
    $content = Get-Content "$smokeDir/test.txt" -Raw
    Write-Success "Smoke test passed - file created"
    Write-Info "Content: $($content.Trim())"
    $TestsPassed++
} else {
    Write-Fail "Smoke test failed - file not created"
    Write-Host $smokeOutput
    $TestsFailed++
    Cleanup
    exit 1
}

# ============================================================================
# PHASE 4: SPA Task
# ============================================================================

Write-Phase "=== Phase 4: SPA Task (Aurelia 2 + Vite + Tailwind) ==="

$spaDir = Join-Path $OutputDir "spa-test"
$projectDir = Join-Path $spaDir "agent-instruction-optimizer"
New-Item -ItemType Directory -Force -Path $spaDir | Out-Null
Remove-Item "$spaDir/*" -Recurse -Force -ErrorAction SilentlyContinue

$spaConfig = @{
    model = $model
    permission = @{ edit = "allow"; bash = "allow"; webfetch = "allow" }
} | ConvertTo-Json

$spaConfig | Out-File -FilePath (Join-Path $spaDir "opencode.json") -Encoding utf8

$spaPrompt = @"
Create a minimal SPA in directory 'agent-instruction-optimizer' with:
- package.json (with vite and a simple dev script)
- index.html (with a heading 'Agent Instruction Optimizer')
- src/main.ts (that logs 'Hello from agent-instruction-optimizer')

Keep it minimal - just enough to verify the structure is correct.
Reply 'DONE' when finished.
"@

$spaTimeout = $TimeoutMinutes * 60

Write-Info "Running SPA task ($($TimeoutMinutes)min timeout)..."
Write-Info "Output dir: $spaDir"

$spaJob = Start-Job -ScriptBlock {
    param($envVar, $dir, $tag, $prompt)
    docker run --rm -e $envVar -v "${dir}:/workspace/group" --entrypoint sh $tag -c "cd /workspace/group && opencode run `"$prompt`" 2>&1"
} -ArgumentList $envVar, $spaDir, $ContainerTag, $spaPrompt

$elapsed = 0
$pollInterval = 10
while ($elapsed -lt $spaTimeout) {
    $completed = Wait-Job $spaJob -Timeout $pollInterval
    if ($completed) { break }
    $elapsed += $pollInterval
    $remaining = $spaTimeout - $elapsed
    Write-Info "Still working... (${elapsed}s elapsed, ${remaining}s remaining)"
}

if ($elapsed -ge $spaTimeout) {
    Write-Fail "SPA task timed out after $TimeoutMinutes minutes"
    Stop-Job $spaJob
    Remove-Job $spaJob -Force
    $TestsFailed++
    Cleanup
    exit 1
}

$spaOutput = Receive-Job $spaJob
Remove-Job $spaJob
Write-Success "Container completed"

# ============================================================================
# PHASE 5: Verification
# ============================================================================

Write-Phase "=== Phase 5: Verification ==="

$verificationPassed = $true

$requiredFiles = @("package.json", "index.html", "src/main.ts")

foreach ($file in $requiredFiles) {
    $filePath = Join-Path $projectDir $file
    if (Test-Path $filePath) {
        Write-Success "Found: $file"
    } else {
        Write-Fail "Missing: $file"
        $verificationPassed = $false
    }
}

if ($verificationPassed) {
    $TestsPassed++
    Write-Success "SPA verification PASSED"
} else {
    $TestsFailed++
    Write-Fail "SPA verification FAILED"
}

# ============================================================================
# Summary
# ============================================================================

$EndTime = Get-Date
$Duration = $EndTime - $StartTime

Write-Phase "=== Test Summary ==="
Write-Host ""
Write-Host "  Duration: $($Duration.ToString('mm\:ss'))"
Write-Host "  Passed:   $TestsPassed" -ForegroundColor Green
Write-Host "  Failed:   $TestsFailed" -ForegroundColor $(if ($TestsFailed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($TestsFailed -eq 0) {
    Write-Host "  ALL TESTS PASSED" -ForegroundColor Green
    Write-Host ""
    Write-Info "SPA available at: $projectDir"
    Cleanup
    exit 0
} else {
    Write-Host "  SOME TESTS FAILED" -ForegroundColor Red
    Write-Host ""
    Write-Info "Logs available at: $OutputDir"
    Cleanup
    exit 1
}
