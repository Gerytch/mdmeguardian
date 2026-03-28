@echo off
setlocal

set JAVA_HOME=C:\Users\elias.filho\scoop\apps\android-studio\current\jbr
set ANDROID_HOME=C:\Users\elias.filho\scoop\apps\android-clt\current
set PATH=%JAVA_HOME%\bin;%PATH%

cd /d "%~dp0..\android"

echo === Building MDM Android app (debug) ===
call gradlew.bat assembleDebug

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo BUILD FAILED. Check errors above.
    exit /b 1
)

echo.
echo === Build successful! ===
echo APK: android\app\build\outputs\apk\debug\app-debug.apk
