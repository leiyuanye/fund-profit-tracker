@echo off
chcp 65001 >nul
title 推送代码到GitHub

echo.
echo ═══════════════════════════════════════════════
echo    推送代码到 GitHub
echo ═══════════════════════════════════════════════
echo.

cd /d "%~dp0"

REM 读取token
set /p TOKEN=<token.txt

REM 检查是否已有Git仓库
if exist ".git" (
    echo [1/2] 更新代码...
    git add .
    git commit -m "Update: %date% %time%"
    git remote set-url origin https://leiyuanye:%TOKEN%@github.com/leiyuanye/fund-profit-tracker.git
    echo [2/2] 推送到GitHub...
    git push origin main
) else (
    echo [1/4] 初始化Git仓库...
    git init
    git config user.name "leiyuanye"
    git config user.email "leiyuanye@users.noreply.github.com"

    echo [2/4] 设置远程仓库...
    git remote add origin https://leiyuanye:%TOKEN%@github.com/leiyuanye/fund-profit-tracker.git

    echo [3/4] 添加代码...
    git add .

    echo [4/4] 提交并推送...
    git commit -m "Update: %date% %time%"
    git branch -M main
    git push -u origin main
)

echo.
echo ═══════════════════════════════════════════════
echo    推送完成！
echo ═══════════════════════════════════════════════
echo.

REM 删除Git仓库，保持文件夹干净
rmdir /s /q .git 2>nul

pause
