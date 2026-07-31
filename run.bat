@echo off
title DocAgent AI - Policy & Handbook Assistant
echo ==========================================================
echo           DocAgent AI Launcher & Setup
echo ==========================================================
echo.

:: 1. Check Python Installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.9 or higher and try again.
    echo.
    pause
    exit /b 1
)

:: 2. Setup Virtual Environment
if not exist ".venv" (
    echo [INFO] Creating Python virtual environment in .venv...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [INFO] Virtual environment created successfully.
)

:: 3. Activate Virtual Environment
echo [INFO] Activating virtual environment...
call .venv\Scripts\activate

:: 4. Install Dependencies
echo [INFO] Upgrading pip...
.\.venv\Scripts\python.exe -m pip install --upgrade pip >nul 2>nul

echo [INFO] Installing required packages...
.\.venv\Scripts\pip.exe install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Package installation failed. Please check your internet connection.
    pause
    exit /b 1
)

:: 5. Initialize directories (handled by config.py on startup)
echo [INFO] Starting FastAPI application server...
echo.
echo ==========================================================
echo   DocAgent AI is running at: http://localhost:8000
echo   API documentation is at:    http://localhost:8000/docs
echo ==========================================================
echo.
.\.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000 --reload

pause
