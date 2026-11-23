@echo off
chcp 65001 >nul
rem ---- Rebuild Codex-skinned.exe ----
rem Requires: Python 3.9+ with PyInstaller  (python -m pip install pyinstaller)
rem The exe is written to the project root (one level up).
rem Note: %~dp0 ends with a backslash, which would escape the closing quote
rem in "C:\path\" -- so normalise both paths first.
for %%I in ("%~dp0.") do set HERE=%%~fI
for %%I in ("%~dp0..") do set ROOT=%%~fI

python -m PyInstaller --noconfirm --clean --onefile --noconsole --name Codex-skinned --icon "%ROOT%\Codex-skinned_icon.ico" --version-file "%HERE%\version.txt" --distpath "%ROOT%" --workpath "%HERE%\build" --specpath "%HERE%" "%HERE%\launcher.py"
if errorlevel 1 goto failed
echo.
for %%F in ("%ROOT%\Codex-skinned.exe") do echo [ok] %%~fF  %%~zF bytes
exit /b 0
:failed
echo.
echo [x] build failed
exit /b 1
