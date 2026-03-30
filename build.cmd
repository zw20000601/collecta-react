@echo off
set NODE_HOME=F:\tools\node-v20.19.5-win-x64
set PATH=%NODE_HOME%;%PATH%
cd /d %~dp0
npm run build
