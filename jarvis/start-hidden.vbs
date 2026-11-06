' Starts Jarvis with no black window and opens it in its own app window.
' Used by the "JARVIS" shortcut in the Windows Startup folder
' (made by jarvis-autostart.bat). Output goes to jarvis-data\jarvis.log.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
If Not fso.FolderExists(root & "\jarvis-data") Then fso.CreateFolder(root & "\jarvis-data")
sh.Run "cmd /c node jarvis\server.js --open > ""jarvis-data\jarvis.log"" 2>&1", 0, False
