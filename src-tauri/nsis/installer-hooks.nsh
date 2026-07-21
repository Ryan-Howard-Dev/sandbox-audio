; Sandbox Music - NSIS installer hooks (included BEFORE MUI2.nsh, before page macros)
;
; Palette (dark void + burnt-orange accent — matches icon-desktop.svg / index.css):
;   void #0C040E  accent #D8590A  accent-deep #B84708  text #E6E8EE

!define SANDBOX_BG_VOID "0C040E"
!define SANDBOX_ACCENT "D8590A"
!define SANDBOX_ACCENT_DEEP "B84708"
!define SANDBOX_TEXT "E6E8EE"
!define SANDBOX_TEXT_DIM "888888"
; Slightly lighter panel for finish-page checkboxes (SetCtlColors cannot always
; recolor checkbox label text on themed Windows; classic controls + contrast bg).
!define SANDBOX_CHECKBOX_BG "181008"

; Force classic checkbox/radio rendering so MUI SetCtlColors + our finish-page
; repaints apply label text on dark Windows themes (not only high-contrast mode).
!define MUI_FORCECLASSICCONTROLS

; Progress bar colors (BGR for PBM_SETBARCOLOR=0x0409 / PBM_SETBKCOLOR=0x2001)
!define SANDBOX_PROGRESS_FILL "0A59D8"
!define SANDBOX_PROGRESS_BG "0E040C"

!define MUI_BGCOLOR "${SANDBOX_BG_VOID}"
!define MUI_TEXTCOLOR "${SANDBOX_TEXT}"
!define MUI_LICENSEPAGE_BGCOLOR "${SANDBOX_BG_VOID}"
!define MUI_DIRECTORYPAGE_BGCOLOR "${SANDBOX_BG_VOID}"
!define MUI_INSTFILESPAGE_COLORS "${SANDBOX_TEXT} ${SANDBOX_BG_VOID}"
!define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
!define MUI_INSTALLCOLORS "${SANDBOX_ACCENT} ${SANDBOX_BG_VOID}"

; Custom welcome/finish copy (English.nsh LangStrings)
!define MUI_WELCOMEPAGE_TITLE "$(welcomePageTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(welcomePageBody)"
!define MUI_FINISHPAGE_TITLE "$(finishPageTitle)"
!define MUI_FINISHPAGE_TEXT "$(finishPageBody)"
!define MUI_FINISHPAGE_RUN_TEXT "$(runApp)"

; MUI2: use Interface.nsh + global page hooks (not MUI_WELCOMEPAGE_CUSTOM_FUNCTION_* - invalid in MUI2)
!define MUI_CUSTOMFUNCTION_GUIINIT DarkInstallerGuiInit
!define MUI_PAGE_CUSTOMFUNCTION_SHOW DarkInstallerPageShow

; Copy HWND to $7 before System::Call (p r$mui.* is invalid and can AV with 0xC0000005).
!macro DarkInstallerDisableControlTheme CONTROL
  StrCpy $7 ${CONTROL}
  StrCmp $7 "" +6
  StrCmp $7 "0" +5
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +2
  System::Call 'user32::SetWindowTheme(p r7, w " ", w " ")'
!macroend

!macro DarkInstallerPaintButton CONTROL TEXT_BG
  StrCpy $7 ${CONTROL}
  StrCmp $7 "" +7
  StrCmp $7 "0" +6
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +3
  SetCtlColors $7 ${TEXT_BG} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerDisableControlTheme ${CONTROL}
!macroend

!macro DarkInstallerPaintStatic CONTROL TEXT BG
  StrCpy $7 ${CONTROL}
  StrCmp $7 "" +7
  StrCmp $7 "0" +6
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +3
  !insertmacro DarkInstallerDisableControlTheme ${CONTROL}
  SetCtlColors $7 ${TEXT} ${BG}
!macroend

!macro DarkInstallerSetCtlColorsSafe3 CONTROL TEXT BG
  StrCpy $7 ${CONTROL}
  StrCmp $7 "" +7
  StrCmp $7 "0" +6
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +3
  !insertmacro DarkInstallerDisableControlTheme ${CONTROL}
  SetCtlColors $7 ${TEXT} ${BG}
!macroend

; Finish-page checkboxes: disable visual styles, then set light text on a
; slightly lifted void panel (NSIS bug #443 — label text ignores SetCtlColors
; while themed on Windows 10/11 dark mode).
!macro DarkInstallerPaintFinishCheckbox CONTROL
  StrCpy $7 ${CONTROL}
  StrCmp $7 "" +8
  StrCmp $7 "0" +7
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +4
  System::Call 'user32::SetWindowTheme(p r7, w " ", w " ")'
  SetCtlColors $7 ${SANDBOX_TEXT} ${SANDBOX_CHECKBOX_BG}
!macroend

!macro DarkInstallerShowWindowSafe CONTROL CMD
  StrCpy $7 ${CONTROL}
  StrCmp $7 "" +7
  StrCmp $7 "0" +6
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +3
  ShowWindow $7 ${CMD}
!macroend

!macro DarkInstallerPaintProgress CONTROL
  StrCpy $7 ${CONTROL}
  StrCmp $7 "" +9
  StrCmp $7 "0" +8
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +5
  !insertmacro DarkInstallerDisableControlTheme ${CONTROL}
  SendMessage $7 0x0409 0 ${SANDBOX_PROGRESS_FILL}
  SendMessage $7 0x2001 0 ${SANDBOX_PROGRESS_BG}
!macroend

; Safe during .onGUIInit: only parent + standard dialog button IDs (no $mui.* yet).
!macro DarkInstallerPaintChromeEarly
  !insertmacro DarkInstallerSetCtlColorsSafe3 $HWNDPARENT ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  GetDlgItem $0 $HWNDPARENT 1
  !insertmacro DarkInstallerPaintButton $0 ${SANDBOX_ACCENT}
  GetDlgItem $0 $HWNDPARENT 2
  !insertmacro DarkInstallerPaintButton $0 ${SANDBOX_TEXT}
  GetDlgItem $0 $HWNDPARENT 3
  !insertmacro DarkInstallerPaintButton $0 ${SANDBOX_TEXT}
!macroend

; Full chrome once MUI controls exist (page show).
!macro DarkInstallerPaintChromeBody
  !insertmacro DarkInstallerSetCtlColorsSafe3 $HWNDPARENT ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}

  !insertmacro DarkInstallerSetCtlColorsSafe3 $mui.Header.Background ${SANDBOX_BG_VOID} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerPaintStatic $mui.Header.Text ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerPaintStatic $mui.Header.SubText ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}

  !insertmacro DarkInstallerPaintButton $mui.Button.Next ${SANDBOX_ACCENT}
  !insertmacro DarkInstallerPaintButton $mui.Button.Back ${SANDBOX_TEXT}
  !insertmacro DarkInstallerPaintButton $mui.Button.Cancel ${SANDBOX_TEXT}

  !insertmacro DarkInstallerSetCtlColorsSafe3 $mui.Branding.Background ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerSetCtlColorsSafe3 $mui.Branding.Text ${SANDBOX_TEXT_DIM} ${SANDBOX_BG_VOID}

  !insertmacro DarkInstallerSetCtlColorsSafe3 $mui.Line.Standard ${SANDBOX_BG_VOID} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerShowWindowSafe $mui.Line.Standard 0
  !insertmacro DarkInstallerSetCtlColorsSafe3 $mui.Line.FullWindow ${SANDBOX_BG_VOID} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerShowWindowSafe $mui.Line.FullWindow 0

  GetDlgItem $0 $HWNDPARENT 1
  !insertmacro DarkInstallerPaintButton $0 ${SANDBOX_ACCENT}
  GetDlgItem $0 $HWNDPARENT 2
  !insertmacro DarkInstallerPaintButton $0 ${SANDBOX_TEXT}
  GetDlgItem $0 $HWNDPARENT 3
  !insertmacro DarkInstallerPaintButton $0 ${SANDBOX_TEXT}
!macroend

Function DarkInstallerPaintChrome
  !insertmacro DarkInstallerPaintChromeBody
FunctionEnd

Function DarkInstallerPaintInnerDialog
  FindWindow $0 "#32770" "" $HWNDPARENT
  StrCmp $0 "" done
  System::Call 'user32::IsWindow(p r0) i .r8'
  IntCmp $8 0 done
  System::Call 'user32::SetWindowTheme(p r0, w " ", w " ")'
  SetCtlColors $0 ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}

  ; InstFiles inner controls (grey panel + details log when "Show details" is on)
  GetDlgItem $1 $0 1004
  StrCpy $7 $1
  StrCmp $7 "" +9
  StrCmp $7 "0" +8
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +5
  System::Call 'user32::SetWindowTheme(p r7, w " ", w " ")'
  SendMessage $7 0x0409 0 ${SANDBOX_PROGRESS_FILL}
  SendMessage $7 0x2001 0 ${SANDBOX_PROGRESS_BG}

  GetDlgItem $1 $0 1016
  StrCpy $7 $1
  StrCmp $7 "" +6
  StrCmp $7 "0" +5
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +3
  System::Call 'user32::SetWindowTheme(p r7, w " ", w " ")'
  SetCtlColors $7 ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}

  GetDlgItem $1 $0 1003
  StrCpy $7 $1
  StrCmp $7 "" +6
  StrCmp $7 "0" +5
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +3
  System::Call 'user32::SetWindowTheme(p r7, w " ", w " ")'
  SetCtlColors $7 ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}

  GetDlgItem $1 $0 1006
  StrCpy $7 $1
  StrCmp $7 "" +6
  StrCmp $7 "0" +5
  System::Call 'user32::IsWindow(p r7) i .r8'
  IntCmp $8 0 +3
  System::Call 'user32::SetWindowTheme(p r7, w " ", w " ")'
  SetCtlColors $7 ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  done:
FunctionEnd

Function DarkInstallerGuiInit
  !insertmacro DarkInstallerPaintChromeEarly
FunctionEnd

Function DarkInstallerPageShow
  Call DarkInstallerPaintInnerDialog

  ; Welcome page — orange accent title, light body on void
  !insertmacro DarkInstallerPaintStatic $mui.WelcomePage.Title ${SANDBOX_ACCENT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerPaintStatic $mui.WelcomePage.Text ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}

  ; Installing page — void panel, orange progress bar
  !insertmacro DarkInstallerPaintStatic $mui.InstFilesPage.Text ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerPaintStatic $mui.InstFilesPage.Status ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerPaintProgress $mui.InstFilesPage.Progress

  ; Finish page — orange title; classic checkboxes with visible labels
  !insertmacro DarkInstallerPaintStatic $mui.FinishPage.Title ${SANDBOX_ACCENT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerPaintStatic $mui.FinishPage.Text ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerPaintFinishCheckbox $mui.FinishPage.Run
  !insertmacro DarkInstallerPaintFinishCheckbox $mui.FinishPage.ShowReadme

  ; Directory page (skipped in flow but themed if shown)
  !insertmacro DarkInstallerPaintStatic $mui.DirectoryPage.Text ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}
  !insertmacro DarkInstallerSetCtlColorsSafe3 $mui.DirectoryPage.Directory ${SANDBOX_TEXT} ${SANDBOX_BG_VOID}

  Call DarkInstallerPaintChrome
FunctionEnd

; Verify bundled Sandbox Server + Node runtime after install (warn only — app still launches).
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\_up_\dist\tier34-server.mjs" tier34_ok tier34_missing
  tier34_missing:
  MessageBox MB_ICONEXCLAMATION|MB_OK "Sandbox Server (tier34-server.mjs) is missing from this install.$\n$\nRe-run the installer or rebuild with npm run build:desktop."
  Goto postinstall_done
  tier34_ok:
  IfFileExists "$INSTDIR\_up_\resources\node\node.exe" postinstall_done 0
  IfFileExists "$INSTDIR\resources\node\node.exe" postinstall_done 0
  MessageBox MB_ICONEXCLAMATION|MB_OK "Sandbox Server is installed but bundled Node.js was not found.$\n$\nThe app will try system Node.js on PATH. Install Node.js LTS if the server fails to start."
  postinstall_done:
!macroend
