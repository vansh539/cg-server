@echo off
title Capital Gains Tool - Stopping
echo Stopping Capital Gains Tool server...

:: Find and kill the process listening on port 5000
for /f "tokens=5" %%a in ('netstat -ano ^| find "LISTENING" ^| find ":5000"') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo Server stopped.
timeout /t 2 /nobreak >nul
