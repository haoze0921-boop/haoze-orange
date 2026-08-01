@echo off
title 浩泽的橘子窝 - 编辑后台
cd /d "%~dp0"

echo.
echo ============================================
echo   正在启动编辑后台...
echo   将自动打开浏览器 http://localhost:4322
echo   关闭本窗口或按 Ctrl+C 即关闭后台
echo ============================================
echo.

rem 检查网站开发服务器(4321)是否在运行，没运行则新开窗口启动
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4321 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo 网站开发服务器未运行，正在另外的窗口启动...
  start "haoze-blog-dev" cmd /k "cd /d %~dp0 && npm run dev"
)

node admin/server.js
pause
