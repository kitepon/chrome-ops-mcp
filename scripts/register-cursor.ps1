$ErrorActionPreference='Stop';if($PSVersionTable.PSVersion.Major-lt 7){throw 'PowerShell 7+ required'}
$root=(Resolve-Path(Join-Path $PSScriptRoot '..')).Path;$path=Join-Path $HOME '.cursor\mcp.json';New-Item -ItemType Directory -Force (Split-Path $path)|Out-Null
$obj=if(Test-Path $path){Get-Content $path -Raw|ConvertFrom-Json}else{[pscustomobject]@{mcpServers=[pscustomobject]@{}}};if(-not$obj.mcpServers){$obj|Add-Member mcpServers ([pscustomobject]@{})}
if(Test-Path $path){Copy-Item $path "$path.chrome-ops.bak" -Force}
$entry=[pscustomobject]@{command=(Get-Command node).Source;args=@((Join-Path $root 'dist\index.js'))};$obj.mcpServers|Add-Member -NotePropertyName 'chrome-ops' -NotePropertyValue $entry -Force
$obj|ConvertTo-Json -Depth 20|Set-Content -Encoding utf8NoBOM $path;[pscustomobject]@{ok=$true;client='cursor';config=$path;backup="$path.chrome-ops.bak"}|ConvertTo-Json -Compress
