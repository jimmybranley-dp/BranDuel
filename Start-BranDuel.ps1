param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$availableNode = Get-Command node -ErrorAction SilentlyContinue
$candidates = @()
if ($availableNode) { $candidates += $availableNode.Source }
if (Test-Path -LiteralPath $bundledNode) { $candidates += $bundledNode }
$selectedNode = $null
foreach ($candidate in $candidates) {
  $version = [Version]((& $candidate --version).TrimStart('v'))
  if ($version -ge [Version]'24.19.0' -and $version.Major -eq 24) {
    $selectedNode = $candidate
    break
  }
}
if (-not $selectedNode) { throw 'Install Node 24.19.0 (see .nvmrc), then run this script again.' }
$previousPath = $env:PATH
$previousStatePath = $env:BRANDUEL_STATE_PATH
Push-Location -LiteralPath $PSScriptRoot
try {
  Remove-Item Env:BRANDUEL_STATE_PATH -ErrorAction SilentlyContinue
  $env:PATH = (Split-Path -Parent $selectedNode) + [IO.Path]::PathSeparator + $env:PATH
  $npmCommand = Get-Command npm.cmd -ErrorAction Stop
  $npmCli = Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm CLI was not found. Install Node with npm included.' }
  if (-not (Test-Path -LiteralPath 'node_modules')) { throw 'Run npm ci with Node 24.19.0 first.' }
  if (-not (Test-Path -LiteralPath '.dev.vars')) {
    & $selectedNode scripts/setup-passcodes.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Passcode setup failed.' }
  }
  & $selectedNode $npmCli run db:migrate:local
  if ($LASTEXITCODE -ne 0) { throw 'Local database migration failed.' }
  & $selectedNode $npmCli run dev -- --host 127.0.0.1 --port $Port --strictPort
} finally {
  $env:PATH = $previousPath
  $env:BRANDUEL_STATE_PATH = $previousStatePath
  Pop-Location
}
