@echo off
title 浩泽的橘子窝 - 本地预览
cd /d "%~dp0"
echo.
echo 正在预览构建好的站点...
echo 请在浏览器打开 http://localhost:4321
echo 关闭本窗口或按 Ctrl+C 退出预览
echo.
call npm run preview
echo.
echo 预览已结束。
pause
