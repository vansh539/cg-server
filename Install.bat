@echo off
cd /d "%~dp0"
title Capital Gains Tool - First Time Setup
echo ============================================
echo   Capital Gains Tool - First Time Setup
echo ============================================
echo.

:: Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed.
    echo.
    echo Please download and install Python 3.10 or later from:
    echo   https://www.python.org/downloads/
    echo.
    echo IMPORTANT: During installation, check the box that says
    echo "Add Python to PATH" before clicking Install Now.
    echo.
    pause
    exit /b 1
)

python --version
echo.
echo Installing required packages...
echo This may take a few minutes on first run.
echo.

pip install -r "%~dp0requirements.txt"
if errorlevel 1 (
    echo.
    echo ERROR: Package installation failed.
    echo Try running this file as Administrator (right-click - Run as administrator).
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Setup complete!
echo ============================================
echo.
echo Run "Start Capital Gains Tool.bat" to launch the tool.
echo.
pause
