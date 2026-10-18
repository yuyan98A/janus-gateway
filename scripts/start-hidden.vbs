' Silent background script runner for Windows
' Hides console window completely during execution to prevent any window flash
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = fso.BuildPath(scriptDir, "service-start.ps1")

cmd = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -NoProfile -File """ & psScript & """"
WshShell.Run cmd, 0, False
