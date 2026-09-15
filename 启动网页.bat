@echo off
echo ============================================
echo  Starting dashboard... browser opens in 2s
echo  Close this window to stop the dashboard
echo ============================================
start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8765/index.html"
"D:\python.exe" -m http.server 8765 --directory "%~dp0web"
pause
