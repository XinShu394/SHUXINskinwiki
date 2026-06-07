@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo.
echo  ████████████████████████████████████████
echo   砖皮图鉴  ·  本地开发服务
echo   http://localhost:8765/site/index.html
echo  ████████████████████████████████████████
echo.
python scripts\dev_server.py
pause
