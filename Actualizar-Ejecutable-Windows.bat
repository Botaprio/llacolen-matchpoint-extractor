@echo off
setlocal
title Actualizar ejecutable - Llacolen MatchPoint Estadisticas
cd /d "%~dp0"

echo.
echo ====================================================
echo   Llacolen MatchPoint - Actualizar ejecutable Windows
echo ====================================================
echo.
echo Las dependencias ya instaladas se reutilizaran.
echo.

call "%~dp0Crear-Ejecutable-Windows.bat"
exit /b %ERRORLEVEL%
