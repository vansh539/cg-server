@echo off
title Capital Gains Tool - Update
echo ============================================
echo   Capital Gains Tool - Updating...
echo ============================================
echo.

:: Stop server if running
echo Stopping server if running...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| find "LISTENING" ^| find ":5000"') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Download updated files using PowerShell
echo Downloading latest files...

powershell -Command "& {
    $base = 'https://raw.githubusercontent.com/vansh539/cg-server/main'
    $files = @(
        'capital_gains_extractor.py',
        'capital_gains_portal.html',
        'server.py',
        'license_check.py',
        'requirements.txt'
    )
    $dest = Split-Path -Parent $MyInvocation.ScriptName
    if (-not $dest) { $dest = Get-Location }
    foreach ($f in $files) {
        try {
            $url = "$base/$f"
            $out = Join-Path $dest $f
            Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
            Write-Host ('  Updated: ' + $f)
        } catch {
            Write-Host ('  FAILED: ' + $f + ' - ' + $_.Exception.Message)
        }
    }
}"

if errorlevel 1 (
    echo.
    echo ERROR: Update failed. Check your internet connection and try again.
    pause
    exit /b 1
)

:: Install any new packages
echo.
echo Installing any new packages...
pip install -r requirements.txt --quiet

echo.
echo ============================================
echo   Update complete!
echo ============================================
echo.
echo Run "Start Capital Gains Tool.bat" to launch the updated tool.
echo Your license.lic file is unchanged.
echo.
pause
