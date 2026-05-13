@echo off
title Capital Gains Tool
echo ============================================
echo   Capital Gains Tool - Starting...
echo ============================================
echo.

:: Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Please run Install.bat first.
    pause
    exit /b 1
)

:: Check if server is already running on port 5000
netstat -ano | find "LISTENING" | find ":5000" >nul 2>&1
if not errorlevel 1 (
    echo Server is already running. Opening tool...
    timeout /t 1 /nobreak >nul
    start "" "%~dp0capital_gains_portal.html"
    exit /b 0
)

:: Start the server in background, log to file
echo Starting server...
start /b python "%~dp0server.py" > "%~dp0server_log.txt" 2>&1

:: Wait for server to be ready
echo Waiting for server to start...
timeout /t 4 /nobreak >nul

:: Verify it started
netstat -ano | find "LISTENING" | find ":5000" >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Server failed to start. Check server_log.txt for details.
    echo Common fix: run Install.bat to install missing packages.
    pause
    exit /b 1
)

:: Open the tool in the default browser
echo Opening tool in browser...
start "" "%~dp0capital_gains_portal.html"

echo.
echo ============================================
echo   Tool is running!
echo ============================================
echo.
echo All processing happens on THIS computer.
echo No data is sent to any external server.
echo.
echo To stop the tool, run "Stop Capital Gains Tool.bat"
echo You can close this window - the server will keep running.
echo.
pause
