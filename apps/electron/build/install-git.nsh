!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\installers\windows\install-git-if-needed.ps1" -InstallerPath "$INSTDIR\resources\installers\windows\Git-2.55.0-64-bit.exe" -BundledVersion "2.55.0"'
!macroend
