@echo off
setlocal

set SDK=C:\Users\elias.filho\scoop\apps\android-clt\current
set JAVA_HOME=C:\Users\elias.filho\scoop\apps\android-studio\current\jbr
set PATH=%SDK%\cmdline-tools\latest\bin;%SDK%\platform-tools;%SDK%\emulator;%JAVA_HOME%\bin;%PATH%

echo === Creating AVD: MDM_Test ===
echo no | avdmanager create avd ^
  --name "MDM_Test" ^
  --package "system-images;android-34;google_apis;x86_64" ^
  --device "pixel_4" ^
  --sdcard 512M ^
  --force

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create AVD
    exit /b 1
)

echo.
echo === AVD created! Starting emulator ===
start "" emulator -avd MDM_Test -memory 2048 -cores 2 -gpu auto -no-snapshot-load

echo.
echo Waiting for emulator to boot...
:wait_boot
adb wait-for-device
adb shell getprop sys.boot_completed 2>nul | findstr "1" >nul
if %ERRORLEVEL% NEQ 0 (
    timeout /t 3 /nobreak >nul
    goto wait_boot
)

echo Emulator booted!
echo.
echo === Installing MDM APK ===
adb install -r "..\android\app\build\outputs\apk\debug\app-debug.apk"

echo.
echo === Done! MDM app installed on emulator ===
echo Open the app and tap "Configure Server URL (Dev)" to set: http://10.0.2.2:3002
