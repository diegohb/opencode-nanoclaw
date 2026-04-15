[CmdletBinding()]
param(
    [switch]$UpdateCustomMain
)

$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$originalBranch = (& git branch --show-current).Trim()
$status = (& git status --porcelain)

if ($status) {
    throw 'Working tree is not clean. Commit, stash, or discard changes before syncing.'
}

Invoke-Git -Arguments @('fetch', '--all', '--prune')
Invoke-Git -Arguments @('switch', 'main')
Invoke-Git -Arguments @('merge', '--ff-only', 'upstream/main')

if ($UpdateCustomMain) {
    Invoke-Git -Arguments @('switch', 'custom/main')
    Invoke-Git -Arguments @('merge', '--no-edit', 'main')
}

if ($originalBranch -and $originalBranch -ne (& git branch --show-current).Trim()) {
    Invoke-Git -Arguments @('switch', $originalBranch)
}

Write-Host 'Fork sync complete.'
if (-not $UpdateCustomMain) {
    Write-Host 'Next step: merge or replay approved changes into custom/main via custom/<topic> branches.'
}