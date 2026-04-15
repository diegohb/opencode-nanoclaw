[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('custom', 'contrib')]
    [string]$Type,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9._/-]+$')]
    [string]$Name
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

$status = (& git status --porcelain)
if ($status) {
    throw 'Working tree is not clean. Commit, stash, or discard changes before creating a new branch.'
}

$baseBranch = if ($Type -eq 'custom') { 'custom/main' } else { 'main' }
$branchName = "$Type/$Name"

$existingBranch = (& git rev-parse --verify --quiet $branchName)
if ($LASTEXITCODE -eq 0 -and $existingBranch) {
    throw "Branch '$branchName' already exists."
}

Invoke-Git -Arguments @('fetch', '--all', '--prune')
Invoke-Git -Arguments @('switch', $baseBranch)
Invoke-Git -Arguments @('switch', '-c', $branchName)

Write-Host "Created $branchName from $baseBranch"