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
[pscustomobject]@{ok=$true;task=$taskName;root=$root;node=$node;host=$hostJs;extension=(Join-Path $root 'extension')}|ConvertTo-Json -Compress
