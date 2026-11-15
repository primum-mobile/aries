; Copyright (C) 2026 Max Lange
; SPDX-License-Identifier: AGPL-3.0-or-later
;
; Aries NSIS hooks, included by Tauri's installer template
; (tauri.windows.conf.json > bundle > windows > nsis > installerHooks).
; Tauri includes this file before it defines PRODUCTNAME, MAINBINARYNAME and
; INSTALLMODE, so everything here is a macro, expanded later inside the
; install and uninstall sections.

; Charts, options, notes and packs live in %APPDATA%\Aries, outside Tauri's
; per-bundle data folder. Uninstall keeps them unless the user ticks Tauri's
; "Delete the application data" box; in-app updates never delete them.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\Aries"
  ${EndIf}
  ; A real uninstall (not the one an update runs first) drops the crash-dump
  ; settings; the dumps themselves stay with the other local data.
  ${If} $UpdateMode <> 1
    !insertmacro AriesRemoveCrashDumpSettings
  ${EndIf}
!macroend

; Windows Error Reporting keeps a small minidump of a crashed Aries.exe or
; aries-daemon.exe in %LOCALAPPDATA%\Aries\crashdumps, so a tester can send
; it with Help > Diagnostics. Per user (HKCU), so no administrator rights;
; at most five dumps per program, minidumps only (no full memory).
!define ARIES_WER_LOCALDUMPS "Software\Microsoft\Windows\Windows Error Reporting\LocalDumps"

!macro AriesWriteCrashDumpSettings EXE
  WriteRegExpandStr HKCU "${ARIES_WER_LOCALDUMPS}\${EXE}" "DumpFolder" "%LOCALAPPDATA%\Aries\crashdumps"
  WriteRegDWORD HKCU "${ARIES_WER_LOCALDUMPS}\${EXE}" "DumpCount" 5
  WriteRegDWORD HKCU "${ARIES_WER_LOCALDUMPS}\${EXE}" "DumpType" 1
!macroend

!macro AriesRemoveCrashDumpSettings
  DeleteRegKey HKCU "${ARIES_WER_LOCALDUMPS}\${MAINBINARYNAME}.exe"
  DeleteRegKey HKCU "${ARIES_WER_LOCALDUMPS}\aries-daemon.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetShellVarContext current
  CreateDirectory "$LOCALAPPDATA\Aries\crashdumps"
  !insertmacro AriesWriteCrashDumpSettings "${MAINBINARYNAME}.exe"
  !insertmacro AriesWriteCrashDumpSettings "aries-daemon.exe"
!macroend

; The Python sidecar binaries\aries-daemon\aries-daemon.exe keeps its own
; files open. Tauri's installer closes only Aries.exe, and only after the
; PRE hooks run; while Aries.exe is alive its supervisor restarts a stopped
; daemon within two seconds. So close Aries first, with Tauri's own prompt and
; strings, then end the daemon, and only then let files be replaced or removed.
; The in-app updater already stops the daemon before it starts the installer;
; this covers running the installer or uninstaller by hand.

!macro AriesCloseApp
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
  !else
    nsis_tauri_utils::FindProcess "${MAINBINARYNAME}.exe"
  !endif
  Pop $R0
  ${If} $R0 = 0
    nsis_tauri_utils::StrReplace "$(appRunning)" "{{product_name}}" "${PRODUCTNAME}"
    Pop $R1
    nsis_tauri_utils::StrReplace "$(appRunningOkKill)" "{{product_name}}" "${PRODUCTNAME}"
    Pop $R2
    IfSilent aries_close_app 0
    ${IfThen} $PassiveMode != 1 ${|} MessageBox MB_OKCANCEL $R2 IDOK aries_close_app IDCANCEL aries_close_cancel ${|}
    aries_close_app:
      !if "${INSTALLMODE}" == "currentUser"
        nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
      !else
        nsis_tauri_utils::KillProcess "${MAINBINARYNAME}.exe"
      !endif
      Pop $R0
      Sleep 500
      ; A failed close falls through to Tauri's own check, which reports it.
      Goto aries_close_done
    aries_close_cancel:
      Abort $R1
    aries_close_done:
  ${EndIf}
!macroend

!macro AriesStopDaemon
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "aries-daemon.exe"
  !else
    nsis_tauri_utils::KillProcess "aries-daemon.exe"
  !endif
  Pop $R0
  ; 0 = ended; otherwise none was running. Let Windows release its handles.
  ${If} $R0 = 0
    Sleep 1000
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AriesCloseApp
  !insertmacro AriesStopDaemon
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AriesCloseApp
  !insertmacro AriesStopDaemon
!macroend
