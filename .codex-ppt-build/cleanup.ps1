$ErrorActionPreference = "Continue"
$b = "D:\Kelvoy\.codex-ppt-build"
$targets = @(
  "$b\xmlcheck",
  "D:\Kelvoy\.codex-finalizer",
  "$b\font-test.mjs",
  "$b\font-test2.mjs",
  "$b\font-test.pptx",
  "$b\font-test2.pptx",
  "$b\font-test.pptx.inspect.ndjson",
  "$b\font-test2.pptx.inspect.ndjson",
  "$b\check-xml.ps1"
)
foreach ($t in $targets) {
  $resolved = Resolve-Path -LiteralPath $t -ErrorAction SilentlyContinue
  if ($resolved -and $resolved.Path.StartsWith("D:\Kelvoy")) {
    Remove-Item -LiteralPath $t -Recurse -Force
  }
}
Get-Item "D:\Kelvoy\docs\demo\Kelvoy_DEMO.pptx" | Select-Object FullName, Length, LastWriteTime
