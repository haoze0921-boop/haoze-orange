@echo off
title 浩泽的橘子窝 - 启动开发服务器
cd /d "%~dp0"
echo.
echo ============================================
echo   正在启动博客开发服务器...
echo   请稍候，在浏览器打开 http://localhost:4321/haoze-orange/
echo   关闭本窗口或按 Ctrl+C 即停止服务器
echo ============================================
echo.
call npm run dev
echo.
echo 服务器已停止。
pause
