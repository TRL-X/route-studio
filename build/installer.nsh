; Register secondary handlers only. Never write extension defaults or UserChoice.
; SHCTX follows the installer's selected scope (HKCU for per-user installs).
!macro RegisterRouteFile EXT LABEL
  WriteRegStr SHCTX "Software\Classes\RouteStudio.${EXT}" "" "${LABEL}"
  WriteRegStr SHCTX "Software\Classes\RouteStudio.${EXT}" "RouteStudioOwner" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr SHCTX "Software\Classes\RouteStudio.${EXT}\Application" "ApplicationName" "Route Studio"
  WriteRegStr SHCTX "Software\Classes\RouteStudio.${EXT}\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\RouteStudio.${EXT}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; REG_NONE: exclude this ProgID from automatic default-handler selection.
  Push $0
  Push $1
  Push $2
  StrCpy $0 0x80000001
  ${If} $installMode == "all"
    StrCpy $0 0x80000002
  ${EndIf}
  System::Call 'advapi32::RegOpenKeyExW(p r0, w "Software\Classes\RouteStudio.${EXT}", i 0, i 0x0102, *p .r1) i.r2'
  ${If} $2 == 0
    System::Call 'advapi32::RegSetValueExW(p r1, w "AllowSilentDefaultTakeOver", i 0, i 0, p 0, i 0)'
    System::Call 'advapi32::RegCloseKey(p r1)'
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0

  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "RouteStudio.${EXT}" ""
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\RouteStudio.Open" "" "Open with Route Studio"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\RouteStudio.Open" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\RouteStudio.Open" "MultiSelectModel" "Document"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\RouteStudio.Open" "RouteStudioOwner" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\RouteStudio.Open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro UnregisterRouteFile EXT
  ; An older uninstaller must not remove a newer installation's registration.
  ; Keep shared parent keys: the bundled NSIS 3.0.4 /ifempty ignores values.
  Push $0
  ReadRegStr $0 SHCTX "Software\Classes\RouteStudio.${EXT}" "RouteStudioOwner"
  ${If} $0 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "RouteStudio.${EXT}"
    DeleteRegKey SHCTX "Software\Classes\RouteStudio.${EXT}"
  ${EndIf}
  ReadRegStr $0 SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\RouteStudio.Open" "RouteStudioOwner"
  ${If} $0 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\RouteStudio.Open"
  ${EndIf}
  Pop $0
!macroend

!macro customInstall
  !insertmacro RegisterRouteFile "gpx" "GPX route"
  !insertmacro RegisterRouteFile "kml" "KML route"
  !insertmacro RegisterRouteFile "fit" "FIT route"
  !insertmacro RegisterRouteFile "rte" "TRL-X route"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro UnregisterRouteFile "gpx"
  !insertmacro UnregisterRouteFile "kml"
  !insertmacro UnregisterRouteFile "fit"
  !insertmacro UnregisterRouteFile "rte"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
