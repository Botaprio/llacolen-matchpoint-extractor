@echo off
setlocal
title Crear ejecutable - Llacolen MatchPoint Estadisticas
cd /d "%~dp0"

echo.
echo ================================================
echo   Llacolen MatchPoint - Crear ejecutable Windows
echo ================================================
echo.

if exist "%~dp0VERSION.txt" (
  type "%~dp0VERSION.txt"
  echo.
)

where npm >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js ni npm en este equipo.
  echo Instala Node.js 24 LTS y vuelve a ejecutar este archivo.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
set "BUILD_RESULT=%ERRORLEVEL%"

echo.
if not "%BUILD_RESULT%"=="0" (
  echo La creacion no termino correctamente. Revisa el mensaje anterior.
  echo.
  pause
  exit /b %BUILD_RESULT%
)

echo Ejecutables creados en la carpeta dist.
echo.
pause
exit /b 0
