#!/usr/bin/env bash
# Deploy APK to emulator and restart MDM service
# Usage: ./deploy-emulator.sh

set -e

ADB="C:\Users\elias.filho\scoop\apps\android-clt\current\platform-tools\adb.exe"
APK="app/build/outputs/apk/debug/app-debug.apk"
PKG="com.mdm.enterprise.debug"
ACTIVITY="$PKG/com.mdm.enterprise.ui.MainActivity"

SERVER_URL="http://10.0.2.2:3002/api/v1"
DEVICE_TOKEN="9fda50d1272a93a7ff9c3ea92589998158f70b94c1b571743a33099c0da7539b6954de789cd1c4d9ef13376d18375103"
DEVICE_ID="fbcbdfbd-37c6-474b-8c87-63273c61bb5c"
TENANT_ID="fe06e19a-8bf5-490b-9075-b5880e49281f"

echo "==> Building APK..."
JAVA_HOME="C:\Program Files\Android\Android Studio\jbr" ./gradlew.bat assembleDebug

echo "==> Installing APK..."
"$ADB" install -r "$APK"

echo "==> Force-stopping old process..."
"$ADB" shell am force-stop "$PKG"
sleep 2

echo "==> Starting with enrollment..."
"$ADB" shell am start -n "$ACTIVITY" \
  --es dev_server_url "$SERVER_URL" \
  --es dev_device_token "$DEVICE_TOKEN" \
  --es dev_device_id "$DEVICE_ID" \
  --es dev_tenant_id "$TENANT_ID"

echo "==> Waiting for service..."
sleep 5
"$ADB" logcat -d | grep "CmdPollService" | tail -3
echo "==> Done!"
