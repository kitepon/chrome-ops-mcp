$ErrorActionPreference='Stop';if($PSVersionTable.PSVersion.Major-lt 7){throw 'PowerShell 7+ required'}
$root=(Resolve-Path(Join-Path $PSScriptRoot '..')).Path;$path=Join-Path $HOME '.codex\config.toml';if(-not(Test-Path $path)){throw "Codex config not found: $path"};$text=Get-Content $path -Raw
if($text -match '(?m)^\[mcp_servers\.chrome-ops\]'){[pscustomobject]@{ok=$true;client='codex';config=$path;changed=$false}|ConvertTo-Json -Compress;exit 0}
Copy-Item $path "$path.chrome-ops.bak" -Force;$node=(Get-Command node).Source.Replace("'","''");$index=(Join-Path $root 'dist\index.js').Replace("'","''");Add-Content -Encoding utf8NoBOM $path "`n[mcp_servers.chrome-ops]`ncommand = '$node'`nargs = ['$index']`n"
[pscustomobject]@{ok=$true;client='codex';config=$path;backup="$path.chrome-ops.bak";changed=$true}|ConvertTo-Json -Compress
