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
