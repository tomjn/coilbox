; Coilbox NSIS installer hooks. Wired via bundle.windows.nsis.installerHooks.
;
; Backstop for the Windows update file-lock: a sidecar process left running holds
; its own .exe open, so the installer fails with "Error opening file for writing"
; when it tries to overwrite it. The primary guard is app-side (a Job Object ties
; sidecars to coilbox.exe's lifetime — see src/win_job.rs); this kills any that
; survive, before the installer copies files.
;
; Only the uniquely-named sidecars are killed here: a global taskkill by image name
; is safe for these because no other application ships them. pr-downloader.exe is
; deliberately omitted — that name is shared with other Spring/Recoil lobbies, so
; blanket-killing it could disrupt an unrelated app; the Job Object covers it
; without collateral.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM coilbox-unitsync-worker.exe'
  nsExec::Exec 'taskkill /F /IM uberstress.exe'
!macroend

; Tuck the sidecars into a `.coilbox` subfolder so the install root shows little
; more than coilbox.exe. Tauri's bundler always emits externalBin next to the exe
; and resource folders in the install root, so we relocate them here, after the
; files are copied. Each resource folder moves whole, keeping its sibling DLLs/libs
; beside the binary. The Rust sidecar resolvers look in `.coilbox` first and fall
; back to the install root, so a skipped move degrades to "not tucked away", never
; a broken sidecar. On update the old `.coilbox` copies are cleared first so the
; freshly-extracted ones move in cleanly.
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\.coilbox"

  Delete "$INSTDIR\.coilbox\coilbox-unitsync-worker.exe"
  Rename "$INSTDIR\coilbox-unitsync-worker.exe" "$INSTDIR\.coilbox\coilbox-unitsync-worker.exe"

  Delete "$INSTDIR\.coilbox\uberstress.exe"
  Rename "$INSTDIR\uberstress.exe" "$INSTDIR\.coilbox\uberstress.exe"

  RMDir /r "$INSTDIR\.coilbox\prdownloader"
  Rename "$INSTDIR\prdownloader" "$INSTDIR\.coilbox\prdownloader"

  RMDir /r "$INSTDIR\.coilbox\mapconv"
  Rename "$INSTDIR\mapconv" "$INSTDIR\.coilbox\mapconv"
!macroend

; Remove exactly what POSTINSTALL tucked away (the sidecars), then the `.coilbox`
; folder only if it's now empty — so a user who turned this install portable by
; adding `.coilbox\profile.json` (and data/cache) doesn't lose it on uninstall.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM coilbox-unitsync-worker.exe'
  nsExec::Exec 'taskkill /F /IM uberstress.exe'
  Delete "$INSTDIR\.coilbox\coilbox-unitsync-worker.exe"
  Delete "$INSTDIR\.coilbox\uberstress.exe"
  RMDir /r "$INSTDIR\.coilbox\prdownloader"
  RMDir /r "$INSTDIR\.coilbox\mapconv"
  RMDir "$INSTDIR\.coilbox"
!macroend
