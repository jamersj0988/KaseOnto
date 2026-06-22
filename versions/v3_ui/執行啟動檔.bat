@echo off
setlocal

rem Rebuild embedded-data.js before opening the file-based v3 UI.
pushd "%~dp0"

if not exist "tools\build-embedded-data.mjs" (
  echo Cannot find tools\build-embedded-data.mjs.
  echo Please keep this launcher inside the v3_ui folder with app.js, index.html, data, corpus, entity_list, ontology, and tools.
  pause
  exit /b 1
)

if not exist "data\cases.json" (
  echo Cannot find data\cases.json.
  echo Please keep the data folder inside this v3_ui package.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  rem Recipients without Node.js can still open the app with the prebuilt embedded-data.js.
  echo Node.js was not found. Opening with the existing embedded-data.js snapshot.
) else (
  echo Rebuilding v3_ui embedded data...
  node "tools\build-embedded-data.mjs"
  if errorlevel 1 (
    echo Failed to rebuild embedded-data.js.
    echo Opening with the existing embedded-data.js snapshot instead.
    echo Current folder: %CD%
  )
)

echo Opening KaseOnto v3_ui...
start "" "%~dp0index.html"
popd
endlocal
