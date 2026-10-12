#requires -Version 7.0
[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Bump = 'patch',
  [ValidateNotNullOrEmpty()]
  [string]$Message = '维护更新'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command 失败（退出码 $LASTEXITCODE），发布已停止。" }
}

if ((Invoke-Checked git @('branch', '--show-current')) -ne 'main') { throw '请先在 main 分支整合并检查改动。' }
Invoke-Checked git @('fetch', 'origin', 'main', '--tags')
if ((Invoke-Checked git @('rev-parse', 'HEAD')) -ne (Invoke-Checked git @('rev-parse', 'origin/main'))) {
  throw '本地 HEAD 与 origin/main 不一致；先核对并整合提交，再发布。不会覆盖远程历史。'
}
$null = Invoke-Checked git @('config', 'user.name')
$null = Invoke-Checked git @('config', 'user.email')
$paths = Invoke-Checked git @('ls-files', '--cached', '--others', '--exclude-standard')
if ($paths | Where-Object { $_ -match '(^|/)(\.env(\..*)?|config\.local\.json)$|\.(pem|key|p12|pfx)$' }) {
  throw '发现未忽略或已跟踪的本地凭证文件；移出提交范围后重试。'
}

$packagePath = Join-Path $repo 'package.json'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'package.json 版本必须为 x.y.z。' }
$parts = $package.version.Split('.') | ForEach-Object { [int]$_ }
switch ($Bump) {
  'major' { $parts[0]++; $parts[1] = 0; $parts[2] = 0 }
  'minor' { $parts[1]++; $parts[2] = 0 }
  'patch' { $parts[2]++ }
}
$version = ($parts -join '.')
$tag = "v$version"
if (Invoke-Checked git @('tag', '--list', $tag)) { throw "标签 $tag 已存在，不能覆盖。" }
$today = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd')
$package.version = $version
$packageJson = (($package | ConvertTo-Json -Depth 10) -replace "`r`n", "`n").TrimEnd() + "`n"
[System.IO.File]::WriteAllText($packagePath, $packageJson, [System.Text.UTF8Encoding]::new($false))

$changelogPath = Join-Path $repo 'CHANGELOG.md'
$changelog = if (Test-Path -LiteralPath $changelogPath) { Get-Content -LiteralPath $changelogPath -Raw } else { '' }
$body = $changelog -replace '^# 更新记录\s*', ''
$changelog = "# 更新记录`n`n## $version — $today`n`n- $Message`n`n$body"
$changelog = ($changelog -replace "`r`n", "`n").TrimEnd() + "`n"
[System.IO.File]::WriteAllText($changelogPath, $changelog, [System.Text.UTF8Encoding]::new($false))

Invoke-Checked node @('build-bundle.js')
Invoke-Checked node @('--test', 'test/*.test.js')
Invoke-Checked git @('diff', '--check')
Invoke-Checked git @('add', '-A')
Invoke-Checked git @('diff', '--cached', '--check')
Invoke-Checked git @('commit', '-m', "Release $tag", '-m', $Message)
Invoke-Checked git @('tag', '-a', $tag, '-m', "Release $tag")
# Both refs must succeed together. A failure retains the local commit/tag for retry.
Invoke-Checked git @('push', '--atomic', 'origin', 'HEAD:refs/heads/main', "refs/tags/$tag")
$localCommit = Invoke-Checked git @('rev-parse', 'HEAD')
$remote = @(Invoke-Checked git @('ls-remote', 'origin', 'refs/heads/main', "refs/tags/$tag^{}"))
if ($remote.Count -ne 2 -or @($remote | Where-Object { -not $_.StartsWith("$localCommit`t") }).Count -gt 0) {
  throw '远程提交或标签核对失败，请检查 GitHub。'
}
Write-Host "已上传 $tag（$localCommit）。还需核对 GitHub Actions 测试与 Release 任务。"
