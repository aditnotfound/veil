; Tauri's generated uninstaller presents an unchecked "Delete app data"
; checkbox during an interactive uninstall. This flag exposes the same choice
; to a deliberate silent uninstall for release tests and managed deployments.
; The generated template still owns the bundle-specific paths and skips data
; deletion during updates.
!macro NSIS_HOOK_PREUNINSTALL
  ${GetOptions} $CMDLINE "/DELETEAPPDATA" $R0
  ${IfNot} ${Errors}
    StrCpy $DeleteAppDataCheckboxState 1
  ${EndIf}
!macroend

; Provider selections are stored outside AppData in Windows Credential Manager.
; Delete only Veil's three bundle-scoped targets when the same data-removal choice
; is selected, and never during an updater-driven uninstall.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; CRED_TYPE_GENERIC = 1. Missing entries are harmless and leave the
    ; uninstaller free to continue.
    System::Call 'advapi32::CredDeleteW(w "selected-ai-provider.${BUNDLEID}.provider", i 1, i 0) i .r0'
    System::Call 'advapi32::CredDeleteW(w "selected-stt-provider.${BUNDLEID}.provider", i 1, i 0) i .r0'
    System::Call 'advapi32::CredDeleteW(w "selected-jev-provider.${BUNDLEID}.provider", i 1, i 0) i .r0'
  ${EndIf}
!macroend
