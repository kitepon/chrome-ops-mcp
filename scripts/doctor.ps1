$ErrorActionPreference='SilentlyContinue'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Cmd($n){$x=Get-Command $n -ErrorAction SilentlyContinue;if($x){$x.Source}else{$null}}
$listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 32145,32146 | Select-Object LocalPort,OwningProcess)
$cursor=Join-Path $HOME '.cursor\mcp.json';$codex=Join-Path $HOME '.codex\config.toml';$claude=Join-Path $HOME '.claude.json'
$result=[ordered]@{
  powershell=[ordered]@{ok=$PSVersionTable.PSVersion.Major -ge 7;version=$PSVersionTable.PSVersion.ToString();path=(Cmd 'pwsh')}
  node=[ordered]@{ok=[bool](Cmd 'node');path=(Cmd 'node')}
  host=[ordered]@{ok=(@($listeners|Where-Object LocalPort -eq 32146).Count -gt 0);ports=$listeners}
  scheduledTask=[ordered]@{ok=[bool](Get-ScheduledTask -TaskName 'Chrome Ops Host');name='Chrome Ops Host'}
  clients=[ordered]@{
    codex=[ordered]@{detected=[bool](Cmd 'codex');configExists=(Test-Path $codex);config=$codex}
    cursor=[ordered]@{detected=([bool](Cmd 'cursor') -or [bool](Cmd 'agent') -or (Test-Path $cursor));configExists=(Test-Path $cursor);config=$cursor}
    grok=[ordered]@{detected=[bool](Cmd 'grok');mode='local-stdio';config=(Join-Path $HOME '.grok\config.toml')}
    claude=[ordered]@{detected=[bool](Cmd 'claude');registered=((Test-Path $claude) -and [bool]((Get-Content $claude -Raw|ConvertFrom-Json -AsHashtable).mcpServers?['chrome-ops']));config=$claude}
  }
}
$result|ConvertTo-Json -Depth 8
