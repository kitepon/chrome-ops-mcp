param([Parameter(Mandatory=$true)][ValidateSet('load','reload','errors','remove','bootstrap')][string]$Operation,[string]$ExtensionId,[string]$Path,[string]$ActiveUrlHashes)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'Chrome Ops helper requires PowerShell 7+'}
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$JExt='拡張機能'; $JBack='戻る'; $JLoad='パッケージ化されていない拡張機能を読み込む'
$JFolder='フォルダー'; $JChoose='フォルダーの選択'; $JReload='再読み込み'; $JErrors='エラー'; $JRemove='削除'
function Result($ok,$data=$null,$error=$null){[pscustomobject]@{ok=$ok;operation="extension.dev.$Operation";data=$data;error=$error}|ConvertTo-Json -Depth 8 -Compress}
function Desc($r){$r.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)}
function ChromeWindow{$root=[System.Windows.Automation.AutomationElement]::RootElement;for($try=0;$try -lt 25;$try++){foreach($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)){if($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match "^($JExt|Extensions)"){return $w}};Start-Sleep -Milliseconds 200};throw 'chrome://extensions must be open in a Chrome window'}
# bootstrap: open chrome://extensions in the window that shows an active tab of the connected Bridge profile,
# then reload the Bridge by exact id. Only the fixed new-tab shortcut and the fixed URL are sent.
function Sha256([string]$v){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($v))).ToLowerInvariant()}
function Omnibox($w){foreach($e in (Desc $w)){if($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and ($e.Current.Name -eq 'アドレス検索バー' -or $e.Current.Name -eq 'Address and search bar')){return $e}};return $null}
function UrlForms([string]$shown){$forms=@($shown);if($shown -notmatch '^[a-z][a-z0-9+.-]*:'){$forms+=@("https://$shown","http://$shown")};$more=@();foreach($f in $forms){$more+=$f;if($f -notmatch '/$'){$more+="$f/"}};return $more}
function ProfileWindow([string[]]$hashes){
  # A window is safe when every window showing that URL is accounted for by the Bridge profile's own active tabs.
  $root=[System.Windows.Automation.AutomationElement]::RootElement;$byHash=@{}
  foreach($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)){
    if($w.Current.ClassName -ne 'Chrome_WidgetWin_1'){continue};$box=Omnibox $w;if(-not $box){continue}
    $shown=$box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value;if(-not $shown){continue}
    foreach($h in @((UrlForms $shown)|ForEach-Object{Sha256 $_}|Where-Object{$hashes -contains $_}|Select-Object -Unique)){if(-not $byHash[$h]){$byHash[$h]=@()};$byHash[$h]+=$w}
  }
  foreach($h in ($byHash.Keys|Sort-Object)){if($byHash[$h].Count -eq @($hashes|Where-Object{$_ -eq $h}).Count){return $byHash[$h][0]}}
  throw 'No Chrome window uniquely matches an active tab of the connected Bridge profile; no browser input was sent'
}
function ForegroundHandle([IntPtr]$handle){
  Add-Type -Namespace ChromeOps -Name Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);' -ErrorAction SilentlyContinue
  if([ChromeOps.Win32]::IsIconic($handle)){[void][ChromeOps.Win32]::ShowWindow($handle,9)}
  [void][ChromeOps.Win32]::SetForegroundWindow($handle);Start-Sleep -Milliseconds 200
}
function Foreground($w){ForegroundHandle ([IntPtr]$w.Current.NativeWindowHandle)}
# Chrome's native confirmation dialog is its own window. Its buttons act only while that dialog is in the
# foreground, and activating the browser window instead dismisses it.
function Confirm($button){
  $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker;$owner=$button
  while($owner -and -not $owner.Current.NativeWindowHandle){$owner=$walker.GetParent($owner)}
  if($owner){ForegroundHandle ([IntPtr]$owner.Current.NativeWindowHandle)}
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function OpenExtensionsPage([string[]]$hashes){
  Add-Type -AssemblyName System.Windows.Forms
  $w=ProfileWindow $hashes
  Foreground $w;(Omnibox $w).SetFocus();Start-Sleep -Milliseconds 300
  if([System.Windows.Automation.AutomationElement]::FocusedElement.Current.ProcessId -ne $w.Current.ProcessId){throw 'Cannot focus the verified Bridge-profile window; no keyboard input was sent'}
  [System.Windows.Forms.SendKeys]::SendWait('^t');Start-Sleep -Milliseconds 500
  $box=Omnibox $w;$focused=[System.Windows.Automation.AutomationElement]::FocusedElement
  if(-not $box -or -not [System.Windows.Automation.Automation]::Compare($box,$focused)){throw 'Chrome address bar did not take focus; no navigation key was sent'}
  $box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('chrome://extensions/')
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
function InvokeNamed($r,[string]$name){foreach($e in (Desc $r)){if($e.Current.Name -eq $name){try{$e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke();return $true}catch{}}};return $false}
try{
  if($Operation -eq 'bootstrap'){if(-not $ActiveUrlHashes){throw 'ActiveUrlHashes is required'};$hashes=@($ActiveUrlHashes|ConvertFrom-Json);if(-not $hashes.Count -or ($hashes|Where-Object{$_ -notmatch '^[0-9a-f]{64}$'})){throw 'Expected active-tab SHA-256 hashes from one Bridge profile'};OpenExtensionsPage $hashes;$Operation='reload'}
  $w=ChromeWindow
  if($Operation -eq 'load'){
    if(-not $Path){throw 'Path is required'};$resolved=(Resolve-Path -LiteralPath $Path).Path;if(-not(Test-Path -LiteralPath(Join-Path $resolved 'manifest.json') -PathType Leaf)){throw 'manifest.json not found'}
    $root=[System.Windows.Automation.AutomationElement]::RootElement;$before=@();foreach($x in $root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)){if($x.Current.Name -match 'directory' -or $x.Current.ClassName -eq '#32770'){$before+=$x.Current.NativeWindowHandle}}
    if(-not(InvokeNamed $w $JLoad)){if(-not(InvokeNamed $w 'Load unpacked')){throw 'Load unpacked control not found'}};Start-Sleep -Milliseconds 400
    $dialog=$null;foreach($x in $root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)){if(($x.Current.Name -match 'directory' -or $x.Current.ClassName -eq '#32770') -and $before -notcontains $x.Current.NativeWindowHandle){$dialog=$x;break}};if(-not$dialog){foreach($x in(Desc $w)){if(($x.Current.Name -match 'directory' -or $x.Current.ClassName -eq '#32770') -and $before -notcontains $x.Current.NativeWindowHandle){$dialog=$x;break}}}
    if(-not $dialog){throw 'Extension directory picker not found'};$edit=$null;$choose=$null;foreach($e in(Desc $dialog)){if($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $e.Current.Name -match "($JFolder|Folder)"){$edit=$e};if($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $e.Current.Name -match "($JChoose|Select Folder)"){$choose=$e}}
    if(-not$edit -or -not$choose){throw 'Folder picker controls not found'};$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($resolved);$choose.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke();Result $true @{path=$resolved};exit 0
  }
  if(-not$ExtensionId){throw 'ExtensionId is required'};$idText="ID: $ExtensionId";$anchor=$null;foreach($e in(Desc $w)){if($e.Current.Name -eq $idText){$anchor=$e;break}}
  if(-not$anchor){if(InvokeNamed $w $JBack){Start-Sleep -Milliseconds 300}elseif(InvokeNamed $w 'Back'){Start-Sleep -Milliseconds 300};foreach($e in(Desc $w)){if($e.Current.Name -eq $idText){$anchor=$e;break}}}
  if(-not$anchor){throw "Extension id not found: $ExtensionId"};$group=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($anchor);if(-not$group){throw 'Extensions group not found'};$siblings=@(Desc $group);$start=-1;for($i=0;$i -lt $siblings.Count;$i++){if($siblings[$i].Current.Name -eq $idText){$start=$i;break}};if($start -lt 0){throw 'Extension id sequence not found'};$extensionName=$null;for($i=$start-1;$i -ge 0;$i--){$candidate=$siblings[$i].Current.Name;if($candidate -match '^ID: [a-p]{32}$'){break};if($candidate -and $candidate -notmatch '^\d+\.\d+' -and $candidate -notmatch 'unpacked|package|詳細|削除|再読み込み|Errors|Remove|Reload'){$extensionName=$candidate;break}}
  if($Operation -eq 'remove' -and $extensionName){foreach($x in(Desc $w)){if($x.Current.Name -like "*$extensionName*" -and $x.Current.Name -match '(削除|Remove)'){$dialog=$x;for($d=0;$d -lt 4 -and $dialog;$d++){$buttons=@((Desc $dialog)|Where-Object{$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and ($_.Current.Name -eq $JRemove -or $_.Current.Name -eq 'Remove')});if($buttons.Count){Confirm $buttons[0];Result $true @{extensionId=$ExtensionId;name=$extensionName;removed=$true};exit 0};$dialog=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($dialog)}}}}
  $names=@{reload=@($JReload,'Reload');errors=@($JErrors,'Errors');remove=@($JRemove,'Remove')}[$Operation];for($i=$start+1;$i -lt $siblings.Count;$i++){ $e=$siblings[$i];if($e.Current.Name -match '^ID: [a-p]{32}$'){break};if($names -contains $e.Current.Name){try{$e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke();$n=$e.Current.Name
    if($Operation -eq 'errors'){Start-Sleep -Milliseconds 300;$items=@();foreach($e in(Desc $w)){if($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $e.Current.Name -match '(WebSocket|Error|failed|ERR_|TypeError|ReferenceError|SyntaxError)'){$items+= $e.Current.Name}};Result $true @{extensionId=$ExtensionId;control=$Operation;errors=@($items|Select-Object -Unique);hasErrorsView=$true};exit 0}
    if($Operation -eq 'remove'){$confirm=$null;for($wait=0;$wait -lt 15 -and -not $confirm;$wait++){Start-Sleep -Milliseconds 200;foreach($x in(Desc $w)){if($extensionName -and $x.Current.Name -like "*$extensionName*" -and $x.Current.Name -match '(削除|Remove)'){$confirm=$x;break}}};if(-not$confirm){throw 'Remove confirmation for target extension not found'};for($d=0;$d -lt 4 -and $confirm;$d++){foreach($x in(Desc $confirm)){if($x.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and ($x.Current.Name -eq $JRemove -or $x.Current.Name -eq 'Remove')){Confirm $x;Result $true @{extensionId=$ExtensionId;name=$extensionName;removed=$true};exit 0}};$confirm=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($confirm)};throw 'Remove confirmation button not found'}
    Result $true @{extensionId=$ExtensionId;control=$Operation};exit 0
  }catch{}}}
  # Chrome shows the Errors control only when the extension has errors, as on macOS.
  if($Operation -eq 'errors'){Result $true @{extensionId=$ExtensionId;control=$Operation;errors=@();hasErrorsView=$false};exit 0}
  throw "Control not found for $Operation"
}catch{Result $false $null $_.Exception.Message;exit 1}
