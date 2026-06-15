@echo off
chcp 65001 >nul
title 基金收益管理系统

echo.
echo ═══════════════════════════════════════════════════════
echo.
echo    基金收益管理系统 启动中...
echo.
echo ═══════════════════════════════════════════════════════
echo.

cd /d "%~dp0"

echo [1/3] 检查 Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未安装 Node.js，请先安装: https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js 已安装

echo.
echo [2/3] 安装依赖...
call npm install

if errorlevel 1 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

echo ✅ 依赖安装完成

echo.
echo [3/3] 创建数据库...
if not exist "database" mkdir "database"

echo.
echo ═══════════════════════════════════════════════════════
echo.
echo    🎉 启动完成！
echo.
echo    📍 打开浏览器访问: http://localhost:3000
echo.
echo    按 Ctrl+C 停止服务
echo.
echo ═══════════════════════════════════════════════════════
echo.

npm start
