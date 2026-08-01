@echo off
title 浩泽的橘子窝 - 构建站点
cd /d "%~dp0"
echo.
echo 正在构建站点，生成静态文件到 dist 文件夹...
echo.
call npm run build
echo.
echo 构建完成！可用「本地预览.cmd」查看效果。
pause
