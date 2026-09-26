$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell 7+ required'}
$claude=Get-Command claude -ErrorAction Stop
$root=(Resolve-Path(Join-Path $PSScriptRoot '..')).Path
$node=(Get-Command node -ErrorAction Stop).Source
$index=Join-Path $root 'dist\index.js'
# Claude Code keeps user-scoped MCP servers in ~/.claude.json.
$config=Join-Path $HOME '.claude.json'
function Entry{if(Test-Path $config){(Get-Content $config -Raw|ConvertFrom-Json -AsHashtable).mcpServers?['chrome-ops']}}
function Matches($e){$e -and ($null -eq $e.type -or $e.type -eq 'stdio') -and $e.command -eq $node -and @($e.args).Count -eq 1 -and @($e.args)[0] -eq $index}
$existing=Entry
if($existing){if(-not(Matches $existing)){throw 'Claude Code has a different chrome-ops server; no configuration was changed'};[pscustomobject]@{ok=$true;client='claude';changed=$false;server='chrome-ops'}|ConvertTo-Json -Compress;exit 0}
$backup=$null;if(Test-Path $config){$backup="$config.chrome-ops.bak";Copy-Item $config $backup -Force}
$json=[pscustomobject]@{type='stdio';command=$node;args=@($index)}|ConvertTo-Json -Compress
& $claude.Source mcp add-json --scope user chrome-ops $json
if($LASTEXITCODE -ne 0){throw "claude mcp add-json failed: $LASTEXITCODE"}
if(-not(Matches (Entry))){throw 'Claude Code registration readback differs from the requested stdio command'}
[pscustomobject]@{ok=$true;client='claude';changed=$true;server='chrome-ops';config=$config;backup=$backup}|ConvertTo-Json -Compress
