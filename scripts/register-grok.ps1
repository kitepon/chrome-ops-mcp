$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell 7+ required'}
$grok=Get-Command grok -ErrorAction Stop
$root=(Resolve-Path(Join-Path $PSScriptRoot '..')).Path
$node=(Get-Command node -ErrorAction Stop).Source
$index=Join-Path $root 'dist\index.js'
$existing=& $grok.Source mcp list --json | ConvertFrom-Json
if($existing|Where-Object{$_.name -eq 'chrome-ops'}){[pscustomobject]@{ok=$true;client='grok-build';changed=$false;server='chrome-ops'}|ConvertTo-Json -Compress;exit 0}
& $grok.Source mcp add chrome-ops -- $node $index
if($LASTEXITCODE -ne 0){throw "grok mcp add failed: $LASTEXITCODE"}
& $grok.Source mcp doctor chrome-ops
if($LASTEXITCODE -ne 0){throw "grok mcp doctor failed: $LASTEXITCODE"}
[pscustomobject]@{ok=$true;client='grok-build';changed=$true;server='chrome-ops';grok=$grok.Source}|ConvertTo-Json -Compress
