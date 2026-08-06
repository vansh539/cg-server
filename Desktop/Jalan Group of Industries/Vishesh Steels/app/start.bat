@echo off
title Vishesh Steels — Billing Tool
cd /d "%~dp0"
echo Starting Vishesh Steels billing tool...
echo.
echo Once you see "Open in browser", open your browser and go to:
echo   http://localhost:3500
echo.
echo Do NOT close this window while using the system.
echo To stop the server, press Ctrl+C or close this window.
echo.
node server.js
pause
