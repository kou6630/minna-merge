@echo off
chcp 65001 > nul
cd /d "%~dp0"
title みんなでマージ サーバー
node apps\server\src\main.ts --tunnel
pause
