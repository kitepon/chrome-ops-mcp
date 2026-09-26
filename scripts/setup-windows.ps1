param([switch]$Uninstall)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell 7+ (pwsh) is required'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskName='Chrome Ops Host'
if($Uninstall){
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  [pscustomobject]@{ok=$true;removedTask=$taskName}|ConvertTo-Json -Compress;exit 0
}
Push-Location $root
try{npm install --silent;npm run build --silent}finally{Pop-Location}
$node=(Get-Command node).Source
$hostJs=Join-Path $root 'dist\host.js'
$action=New-ScheduledTaskAction -Execute $node -Argument ('"'+$hostJs+'"') -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Persistent local host for Chrome Ops MCP' -Force | Out-Null
# Restart so the Host runs the build that was just made, then bring an already connected Bridge up to date.
$wasConnected=(node (Join-Path $root 'scripts\windows-bridge.mjs') --connected) -eq 'true'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$deadline=(Get-Date).AddSeconds(15)
while(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 32145,32146 -State Listen -ErrorAction SilentlyContinue){
  if((Get-Date) -gt $deadline){throw 'Chrome Ops ports 32145/32146 are still in use after stopping the Host task'}
  Start-Sleep -Milliseconds 250
}
Start-ScheduledTask -TaskName $taskName
$bridge=node (Join-Path $root 'scripts\windows-bridge.mjs') $(if($wasConnected){'--wait-connected'})|ConvertFrom-Json
if(-not $bridge.ok){throw "Chrome Ops Bridge update failed: $($bridge.error)"}
[pscustomobject]@{ok=$true;task=$taskName;root=$root;node=$node;host=$hostJs;extension=(Join-Path $root 'extension');connected=$bridge.connected;bridgeUpdated=$bridge.bridgeUpdated}|ConvertTo-Json -Compress
