@echo off
cd /d "%~dp0"
echo ============================================
echo  Delta Ammo Collector (85 bullets, every 10min)
echo  Keep this window open. Ctrl+C to stop.
echo ============================================
"D:\node.exe" collector.js
pause
