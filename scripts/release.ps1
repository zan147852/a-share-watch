[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Bump = 'patch',
  [string]$Message = '维护更新'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$packagePath = Join-Path $repo 'package.json'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$parts = $package.version.Split('.') | ForEach-Object { [int]$_ }
if ($parts.Count -ne 3) { throw "package.json 版本号不是 x.y.z：$($package.version)" }
switch ($Bump) {
  'major' { $parts[0]++; $parts[1] = 0; $parts[2] = 0 }
  'minor' { $parts[1]++; $parts[2] = 0 }
  'patch' { $parts[2]++ }
}
$version = ($parts -join '.')
$tag = "v$version"
$today = Get-Date -Format 'yyyy-MM-dd'
$package.version = $version
$package | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $packagePath -Encoding utf8NoBOM

$changelogPath = Join-Path $repo 'CHANGELOG.md'
$changelog = if (Test-Path -LiteralPath $changelogPath) { Get-Content -LiteralPath $changelogPath -Raw } else { "# 更新记录`n`n" }
$entry = "## $version — $today`n`n- $Message`n`n"
if ($changelog -match '^# 更新记录\s*') {
  $changelog = [regex]::Replace($changelog, '^(# 更新记录\s*)', ('$1' + "`n" + $entry), 1)
} else {
  $changelog = "# 更新记录`n`n$entry$changelog"
}
Set-Content -LiteralPath $changelogPath -Value $changelog -Encoding utf8NoBOM

node build-bundle.js
node --test test/*.test.js
git diff --check
git add -A
git commit -m "Release $tag"
git tag -a $tag -m "Release $tag"
git push origin main
git push origin $tag
Write-Host "Released $tag"
