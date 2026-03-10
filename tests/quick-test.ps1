<#
.SYNOPSIS
    Quick smoke test for NanoClaw Docker container.

.DESCRIPTION
    Minimal test that verifies the container can start and complete a simple task.
    Use this for rapid iteration during development.

    NOTE: The OpenCode SDK currently has issues with tool-execution prompts.
    For tool tasks, use the CLI directly: opencode run "prompt"

.EXAMPLE
    .\tests\quick-test.ps1
    .\tests\quick-test.ps1 -TestCLI  # Test opencode CLI directly
#>

param(
    [switch]$TestCLI,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Get-Item $PSScriptRoot).Parent.FullName

Write-Host "=== Quick Docker Test ===" -ForegroundColor Cyan

# Build
Write-Host "`n[1/3] Building container..." -ForegroundColor Yellow
docker build -t nanoclaw-agent:test "$ProjectRoot/container" --quiet
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Write-Host "  Done" -ForegroundColor Green

# Setup test directory
$testDir = Join-Path $PSScriptRoot "quick-output"
$ipcDir = Join-Path $testDir "ipc" "input"
New-Item -ItemType Directory -Force -Path $testDir | Out-Null
Remove-Item "$testDir/*" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $ipcDir | Out-Null

# Check for API key
$envFile = Join-Path $ProjectRoot ".env"
if (!(Test-Path $envFile)) {
    $envFile = Join-Path (Split-Path $ProjectRoot -Parent) ".env"
}
if (!(Test-Path $envFile)) {
    Write-Host "  No .env found - skipping live test" -ForegroundColor Yellow
    Write-Host "  Container builds OK" -ForegroundColor Green
    exit 0
}

# Parse .env for API keys
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
    Write-Host "  No API key found in .env - skipping live test" -ForegroundColor Yellow
    Write-Host "  Container builds OK" -ForegroundColor Green
    exit 0
}

# Build config
if ($openRouterKey) {
    $envVar = "OPENROUTER_API_KEY=$openRouterKey"
    $model = "openrouter/google/gemini-2.0-flash-001"
    $provider = "openrouter"
    Write-Host "  Using OpenRouter (gemini-2.0-flash-001)" -ForegroundColor Gray
} else {
    $envVar = "ANTHROPIC_API_KEY=$anthropicKey"
    $model = "anthropic/claude-sonnet-4-20250514"
    $provider = "anthropic"
    Write-Host "  Using Anthropic (claude-sonnet-4)" -ForegroundColor Gray
}

$testConfig = @{
    model = $model
    permission = @{ edit = "allow"; bash = "allow"; webfetch = "allow" }
} | ConvertTo-Json

$testConfig | Out-File -FilePath (Join-Path $testDir "opencode.json") -Encoding utf8

docker rm -f nanoclaw-quick 2>$null

if ($TestCLI) {
    # ========================================================================
    # Test via CLI (tool execution works)
    # ========================================================================
    Write-Host "`n[2/3] Testing OpenCode CLI (tool execution)..." -ForegroundColor Yellow
    
    $output = docker run --rm `
        -e $envVar `
        -v "${testDir}:/workspace/group" `
        --entrypoint sh `
        nanoclaw-agent:test `
        -c "cd /workspace/group && opencode run 'Create file test.txt with content CLI_OK' 2>&1" 
    
    if (Test-Path "$testDir/test.txt") {
        $content = Get-Content "$testDir/test.txt" -Raw
        Write-Host "  SUCCESS: CLI executed task" -ForegroundColor Green
        Write-Host "  File content: $($content.Trim())" -ForegroundColor Gray
    } else {
        Write-Host "  FAILED: File not created" -ForegroundColor Red
        Write-Host $output
        exit 1
    }
} else {
    # ========================================================================
    # Test via SDK (text response only - tool execution has known issues)
    # ========================================================================
    Write-Host "`n[2/3] Testing OpenCode SDK (text response)..." -ForegroundColor Yellow
    Write-Host "  NOTE: SDK tool execution has known issues. Use -TestCLI for tool tests." -ForegroundColor DarkGray
    
    $secrets = @{}
    if ($openRouterKey) {
        $secrets["OPENROUTER_API_KEY"] = $openRouterKey
    } else {
        $secrets["ANTHROPIC_API_KEY"] = $anthropicKey
    }
    
    $input = @{
        prompt = "Say hello in one word"
        groupFolder = "quick"
        chatJid = "q@g.us"
        isMain = $false
        secrets = $secrets
        opencodeConfig = @{
            provider = $provider
            model = $model
        }
    } | ConvertTo-Json -Depth 3
    
    $job = Start-Job -ScriptBlock {
        param($inputJson, $testDir)
        $inputJson | docker run -i --rm --name "nanoclaw-quick" -v "${testDir}:/workspace/group" nanoclaw-agent:test 2>&1
    } -ArgumentList $input, $testDir
    
    # Wait with timeout
    $elapsed = 0
    $pollInterval = 3
    $gotResponse = $false
    
    while ($elapsed -lt $TimeoutSeconds) {
        Start-Sleep -Seconds $pollInterval
        $elapsed += $pollInterval
        
        if ($job.State -eq "Completed") {
            $gotResponse = $true
            break
        }
        
        if ($elapsed % 15 -eq 0) {
            Write-Host "  Waiting... (${elapsed}s)" -ForegroundColor DarkGray
        }
    }
    
    if (!$gotResponse) {
        Write-Host "  TIMEOUT after ${TimeoutSeconds}s" -ForegroundColor Red
        Stop-Job $job -ErrorAction SilentlyContinue
        docker stop nanoclaw-quick 2>$null
    }
    
    $output = Receive-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    
    # Check for success marker in output
    if ($output -match "NANOCLAW_OUTPUT_START.*?`"status`":\s*`"success`"") {
        Write-Host "  SUCCESS: SDK responded" -ForegroundColor Green
        if ($output -match "`"result`":\s*`"([^`"]+)`"") {
            Write-Host "  Response: $($matches[1])" -ForegroundColor Gray
        }
    } else {
        Write-Host "  FAILED: No response received" -ForegroundColor Red
        $output | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        exit 1
    }
}

# ========================================================================
# Verify container tools
# ========================================================================
Write-Host "`n[3/3] Verifying container tools..." -ForegroundColor Yellow

$tools = docker run --rm nanoclaw-agent:test sh -c "which chromium && which node && which opencode" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  SUCCESS: All tools present" -ForegroundColor Green
} else {
    Write-Host "  FAILED: Missing tools" -ForegroundColor Red
    Write-Host $tools
    exit 1
}

Write-Host "`n=== All tests passed ===" -ForegroundColor Green
exit 0
