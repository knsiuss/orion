@echo off
cd /d "C:\Users\test\OneDrive\Desktop\EDITH"

echo === EDITH — Push All Changes ===
echo.

echo [1/4] Checking git status...
git status

echo.
echo [2/4] Staging all changes...
git add -A

echo.
echo [3/4] Committing...
git commit -m "chore: push all Claude Code changes — Phase 28-45 implementations"

echo.
echo [4/4] Pushing to main...
git push origin main

echo.
echo === Done! ===
pause
