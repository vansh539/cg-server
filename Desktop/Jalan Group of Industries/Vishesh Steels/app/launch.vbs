' Hidden launcher: starts the billing tool server with no visible console
' window, waits for it to come up, then opens the browser automatically.
' This is the intended shortcut target for daily use — start.bat (visible
' console) stays available for debugging if something goes wrong.
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
objShell.CurrentDirectory = objFSO.GetParentFolderName(WScript.ScriptFullName)

' 0 = hidden window, False = don't wait for it to exit (server runs forever)
objShell.Run "node server.js", 0, False

' Give the server a couple seconds to start listening before opening it
WScript.Sleep 2000

objShell.Run "http://localhost:3500/final-invoice-VS.html", 1, False
