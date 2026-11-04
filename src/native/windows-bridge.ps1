param([string]$EncodedArgs, [string]$SimulatorPath)
$ErrorActionPreference = 'Stop'
$a = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedArgs)) | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, Accessibility
Add-Type -ReferencedAssemblies ([Accessibility.IAccessible].Assembly.Location) -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GarminWin {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
 [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint message, UIntPtr w, IntPtr l, uint flags, uint timeout, out UIntPtr result);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
 [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr h, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible accessible);
 public static void InvokeDefaultAction(IntPtr h) {
   var iid = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
   Accessibility.IAccessible accessible;
   int hr = AccessibleObjectFromWindow(h, 0xfffffffc, ref iid, out accessible);
   if (hr != 0) Marshal.ThrowExceptionForHR(hr);
   try {
     if (String.IsNullOrEmpty(accessible.get_accDefaultAction(0))) throw new InvalidOperationException("Element has no native default action");
     accessible.accDoDefaultAction(0);
   } finally { Marshal.ReleaseComObject(accessible); }
 }
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
 [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr h, int index);
 [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr h, uint item, System.Text.StringBuilder value, int max, uint flags);
 [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr h, int index);
 [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr h, uint item, uint flags);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, UIntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);
}
'@
if (![GarminWin]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [void][GarminWin]::SetProcessDPIAware() }
function output($v) { $v | ConvertTo-Json -Depth 30 -Compress }
function opt($name, $default) { $i = [array]::IndexOf($a, $name); if ($i -ge 0 -and $i + 1 -lt $a.Count) { return $a[$i+1] }; return $default }
function simulator {
  if (!$SimulatorPath) { throw 'Missing Garmin simulator executable path' }
  $candidates = @(Get-Process simulator -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.Path -and [string]::Equals([IO.Path]::GetFullPath($_.Path), $SimulatorPath, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($candidates.Count -gt 1) { throw 'Multiple Garmin simulators match the SDK executable; close the extra instances' }
  if ($candidates.Count -eq 1) { return $candidates[0] }
}
function win { $p = simulator; if (!$p) { throw 'Connect IQ simulator window is not running' }; return $p }
function focusWindow($process) {
  $handle=$process.MainWindowHandle
  if ([GarminWin]::IsIconic($handle)) { [void][GarminWin]::ShowWindow($handle,9) }
  for ($i=0; $i -lt 2; $i++) {
    if ([GarminWin]::GetForegroundWindow() -eq $handle) { break }
    [void][GarminWin]::SetForegroundWindow($handle)
    # Cross-process activation is asynchronous; wait for the target to process it.
    $result=[UIntPtr]::Zero
    if ([GarminWin]::SendMessageTimeout($handle,0,[UIntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$result) -eq [IntPtr]::Zero) { throw 'Simulator window did not respond while waiting for focus' }
    if ([GarminWin]::GetForegroundWindow() -eq $handle) { break }
    if ($i -eq 0) { Start-Sleep -Milliseconds 100 }
  }
  $foreground=[GarminWin]::GetForegroundWindow()
  $response=@{ok=($foreground -eq $handle); foregroundWindowId=$foreground.ToInt64()}
  if (!$response.ok) { $response.error='Windows did not focus the simulator. Bring its main window to the foreground and retry.' }
  return $response
}
function inputWindow {
  $process=win
  if ([GarminWin]::GetForegroundWindow() -ne $process.MainWindowHandle) { throw 'Simulator is not the foreground window; no input was sent. Bring its main window to the foreground and retry.' }
  return $process
}
function root($p) { [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle) }
function children($el) { $w=[System.Windows.Automation.TreeWalker]::ControlViewWalker; $r=@(); $c=$w.GetFirstChild($el); while ($null -ne $c) { $r += $c; $c=$w.GetNextSibling($c) }; return ,$r }
function invokeElement($el) {
  $process = win
  if ($el.Current.ProcessId -ne $process.Id -or !$el.Current.IsEnabled) { throw 'Element is disabled or belongs to another process' }
  $pattern=$null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $pattern.Invoke(); return }
  $handle=[IntPtr]$el.Current.NativeWindowHandle; $owner=[uint32]0
  if ($handle -eq [IntPtr]::Zero) { throw 'Element has no native window or invocation pattern' }
  [void][GarminWin]::GetWindowThreadProcessId($handle,[ref]$owner)
  if ($owner -ne $process.Id) { throw 'Native control belongs to another process' }
  # wxWidgets buttons expose MSAA default actions instead of UI Automation InvokePattern.
  [GarminWin]::InvokeDefaultAction($handle)
}
function storageEditor($process) {
  $name = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty),'Modify Object Store'
  $owner = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty),$process.Id
  $condition = New-Object System.Windows.Automation.AndCondition $name,$owner
  return (root $process).FindFirst([System.Windows.Automation.TreeScope]::Subtree,$condition)
}
function awaitWinRT($operation, $type) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $task = $method.MakeGenericMethod($type).Invoke($null, @($operation)); $task.GetAwaiter().GetResult()
}
function tree($el,$route,$depth,$max) {
  $script:count++; $kids=children $el
  $node=@{path=@($route); AXRole=$el.Current.ControlType.ProgrammaticName; AXTitle=$el.Current.Name; AXIdentifier=$el.Current.AutomationId; AXEnabled=$el.Current.IsEnabled; childCount=$kids.Count}
  if ($depth -lt $max -and $script:count -lt 5000) { $nodes=@(); for ($i=0; $i -lt $kids.Count -and $script:count -lt 5000; $i++) { $nodes += (tree $kids[$i] ($route + $i) ($depth+1) $max) }; $node.children=$nodes } elseif ($kids.Count) { $node.truncated=$true }; return $node
}
try {
 switch ($a[0]) {
 'window-info' {
  $p=simulator; $permissions=@{screenRecording=$true; accessibility=$true}
  if (!$p) { output @{running=$false; permissions=$permissions; error='Connect IQ simulator is not running'}; break }
  $r=New-Object GarminWin+RECT; [void][GarminWin]::GetWindowRect($p.MainWindowHandle,[ref]$r); $pt=New-Object GarminWin+POINT; [void][GarminWin]::ClientToScreen($p.MainWindowHandle,[ref]$pt)
  $dpiX=[uint32]0; $dpiY=[uint32]0; if ([GarminWin]::GetDpiForMonitor([GarminWin]::MonitorFromWindow($p.MainWindowHandle,2),0,[ref]$dpiX,[ref]$dpiY) -ne 0 -or $dpiX -eq 0) { throw 'Unable to determine simulator monitor DPI' }
  output @{running=$true; pid=$p.Id; windowId=$p.MainWindowHandle.ToInt64(); bounds=@{x=$r.Left; y=$r.Top; width=($r.Right-$r.Left); height=($r.Bottom-$r.Top)}; contentOffset=@{x=($pt.X-$r.Left); y=($pt.Y-$r.Top)}; scale=($dpiX/96.0); permissions=$permissions}
 }
 { $_ -in 'activate','raise' } { output (focusWindow (win)) }
 'capture' { $p=win; if ($p.MainWindowHandle.ToInt64() -ne [long]$a[1]) { throw 'Simulator window changed' }; $r=New-Object GarminWin+RECT; [void][GarminWin]::GetWindowRect($p.MainWindowHandle,[ref]$r); $s=[double]::Parse($a[3],[System.Globalization.CultureInfo]::InvariantCulture); $b=New-Object System.Drawing.Bitmap ([int](($r.Right-$r.Left)/$s)),([int](($r.Bottom-$r.Top)/$s)); $g=[System.Drawing.Graphics]::FromImage($b); try { $dc=$g.GetHdc(); try { if (![GarminWin]::PrintWindow($p.MainWindowHandle,$dc,2)) { throw 'Unable to capture simulator window' } } finally { $g.ReleaseHdc($dc) }; $b.Save([string]$a[2],[System.Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose(); $b.Dispose() }; output @{ok=$true} }
 'click' { [void](inputWindow); [void][GarminWin]::SetCursorPos([int](opt '--x' 0),[int](opt '--y' 0)); [GarminWin]::mouse_event(2,0,0,0,[UIntPtr]::Zero); try { Start-Sleep -Milliseconds ([int](opt '--hold-ms' 80)) } finally { [GarminWin]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }; output @{ok=$true} }
 'drag' { [void](inputWindow); $x1=[int](opt '--x1' 0); $y1=[int](opt '--y1' 0); $x2=[int](opt '--x2' 0); $y2=[int](opt '--y2' 0); $duration=[Math]::Max(20,[int](opt '--duration-ms' 400)); [void][GarminWin]::SetCursorPos($x1,$y1); [GarminWin]::mouse_event(2,0,0,0,[UIntPtr]::Zero); try { for ($i=1;$i -le 20;$i++) { [void][GarminWin]::SetCursorPos([int]($x1+($x2-$x1)*$i/20),[int]($y1+($y2-$y1)*$i/20)); Start-Sleep -Milliseconds ([int]($duration/20)) } } finally { [GarminWin]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }; output @{ok=$true} }
 'key' { [void](inputWindow); $v=[byte](opt '--code' 0); [GarminWin]::keybd_event($v,0,0,[UIntPtr]::Zero); try { Start-Sleep -Milliseconds ([int](opt '--hold-ms' 80)) } finally { [GarminWin]::keybd_event($v,0,2,[UIntPtr]::Zero) }; output @{ok=$true} }
 'menu' { $p=win; $menu=[GarminWin]::GetMenu($p.MainWindowHandle); $parts=@($a[2..($a.Count-1)]); for ($j=0;$j -lt $parts.Count;$j++) { $found=-1; for ($i=0;$i -lt [GarminWin]::GetMenuItemCount($menu);$i++) { $label=New-Object System.Text.StringBuilder 512; [void][GarminWin]::GetMenuString($menu,$i,$label,512,1024); if (($label.ToString().Split("`t")[0] -replace '&','').Trim() -eq $parts[$j]) { $found=$i; break } }; if ($found -lt 0) { throw "Menu item not found: $($parts[$j])" }; if (([GarminWin]::GetMenuState($menu,$found,1024) -band 3) -ne 0) { throw "Menu item is disabled: $($parts[$j])" }; if ($j -eq $parts.Count-1) { $id=[GarminWin]::GetMenuItemID($menu,$found); if ($id -eq [uint32]::MaxValue -or ![GarminWin]::PostMessage($p.MainWindowHandle,273,[UIntPtr]$id,[IntPtr]::Zero)) { throw 'Unable to invoke menu item' } } else { $menu=[GarminWin]::GetSubMenu($menu,$found); if ($menu -eq [IntPtr]::Zero) { throw 'Menu has no submenu' } } }; output @{ok=$true; path=$parts} }
 'ui-tree' { $p=win; $script:count=0; output @{ok=$true; pid=$p.Id; tree=(tree (root $p) @() 0 ([Math]::Min(14,[Math]::Max(1,[int]$a[1]))))} }
 'ui-action' { $el=root (win); foreach ($part in $a[1].Split('.')) { $kids=children $el; $i=0; if (![int]::TryParse($part,[ref]$i) -or $i -lt 0 -or $i -ge $kids.Count) { throw 'Invalid or stale element path' }; $el=$kids[$i] }; switch ($a[2]) { 'focus' { $el.SetFocus() } 'select' { $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() } 'set' { $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue([string]$a[3]) } { $_ -in 'AXPress','AXConfirm' } { invokeElement $el } { $_ -in 'AXIncrement','AXDecrement' } { $p=$el.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern); $delta=$p.Current.SmallChange; if ($_ -eq 'AXDecrement') { $delta=-$delta }; $p.SetValue([Math]::Max($p.Current.Minimum,[Math]::Min($p.Current.Maximum,$p.Current.Value+$delta))) } default { throw 'Unsupported UI action' } }; output @{ok=$true} }
 'storage-close' {
  $p=win; $dialog=storageEditor $p
  if (!$dialog) { output @{ok=$true; alreadyClosed=$true}; break }
  $condition=New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty),'Cancel'
  $button=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
  if (!$button) { throw 'Cancel button not found' }
  invokeElement $button
  for ($i=0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 100
    if (!(storageEditor $p)) { output @{ok=$true; closed=$true}; break }
  }
  if ($i -eq 20) { throw 'Storage editor remained open after cancellation' }
 }
 'ocr' {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]; [void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]; [void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
  $file=awaitWinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync([IO.Path]::GetFullPath($a[1]))) ([Windows.Storage.StorageFile])
  $stream=awaitWinRT ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  try {
    $decoder=awaitWinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap=awaitWinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
      $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); if (!$engine) { throw 'Windows OCR language pack is unavailable' }
      $recognized=awaitWinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]); $lines=@()
      foreach ($line in $recognized.Lines) { if (!$line.Words.Count) { continue }; $left=($line.Words | ForEach-Object {$_.BoundingRect.X} | Measure-Object -Minimum).Minimum; $top=($line.Words | ForEach-Object {$_.BoundingRect.Y} | Measure-Object -Minimum).Minimum; $right=($line.Words | ForEach-Object {$_.BoundingRect.X+$_.BoundingRect.Width} | Measure-Object -Maximum).Maximum; $bottom=($line.Words | ForEach-Object {$_.BoundingRect.Y+$_.BoundingRect.Height} | Measure-Object -Maximum).Maximum; $lines += @{text=$line.Text; bounds=@{x=$left/$bitmap.PixelWidth; y=1-$bottom/$bitmap.PixelHeight; width=($right-$left)/$bitmap.PixelWidth; height=($bottom-$top)/$bitmap.PixelHeight}} }
      output @{ok=$true; lines=$lines}
    } finally { $bitmap.Dispose() }
  } finally { $stream.Dispose() }
 }
 'terminate' { $p=simulator; if (!$p) { output @{ok=$true; alreadyStopped=$true}; break }; if ($a -contains '--force') { $p.Kill() } else { [void]$p.CloseMainWindow() }; $stopped=$p.WaitForExit(2000); output @{ok=$stopped; terminated=$stopped; pid=$p.Id} }
 default { throw "Unsupported Windows bridge command: $($a[0])" }
 }
} catch { output @{ok=$false; error=$_.Exception.Message} }
