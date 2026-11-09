#!/usr/bin/env bash
# Read-only diagnostics. Does not install/uninstall an app or read employee data.
set -euo pipefail
adb_bin="${ADB_BIN:-}"
if [ -z "$adb_bin" ]; then
  if command -v adb >/dev/null 2>&1; then adb_bin="$(command -v adb)"
  elif [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]; then adb_bin="$HOME/Library/Android/sdk/platform-tools/adb"
  else echo 'ADB was not found. Install Android SDK Platform-Tools and set ADB_BIN.' >&2; exit 1
  fi
fi
connected_count="$("$adb_bin" devices | awk 'NR>1 && $2=="device" {n++} END {print n+0}')"
if [ "$connected_count" -ne 1 ]; then
  echo 'Connect exactly one test phone by USB, allow USB debugging on that phone, and retry.' >&2
  exit 1
fi
printf 'Phone model: '; "$adb_bin" shell getprop ro.product.model
printf 'Android version: '; "$adb_bin" shell getprop ro.build.version.release
printf 'Android API level: '; "$adb_bin" shell getprop ro.build.version.sdk
package='in.shikshavertex.attendance'
if ! "$adb_bin" shell pm path "$package" | awk '/^package:/ {found=1} END {exit !found}'; then
  echo 'The attendance package is not installed on this phone.' >&2
  exit 1
fi
"$adb_bin" shell dumpsys package "$package" | awk '/versionCode=|versionName=|android.permission.ACCESS_FINE_LOCATION:|android.permission.POST_NOTIFICATIONS:/ {print}'
echo 'Read-only package checks completed. Fingerprint, GPS, Wi-Fi, sharing/stop and report correctness still need the manual phone tests.'
