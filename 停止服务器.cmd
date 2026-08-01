@echo off
title 浩泽的橘子窝 - 停止服务器
cd /d "%~dp0"
echo.
echo 正在停止开发服务器...
echo.
call npx astro dev stop
echo.
echo 若上面提示 pid 已停止，说明服务器已关闭。
echo 若没有提示，说明本来就没在运行。
pause
