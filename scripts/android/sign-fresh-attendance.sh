#!/usr/bin/env bash
# Owner-approved fresh-install migration. The private key stays on this computer.
set +x
set -euo pipefail
umask 077
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
apk="$script_dir/attendance-1.8-unsigned.apk"
store_dir="${SHIKSHAVERTEX_SIGNING_DIR:-$HOME/ShikshavertexSigning}"
apk_dir="${SHIKSHAVERTEX_APK_DIR:-$HOME/Desktop/Shikshavertex Attendance}"
store="$store_dir/attendance-release.p12"
alias_name='shikshavertex-attendance-release'
fail() { printf '%s\n' "$1" >&2; exit 1; }
command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1 || fail 'Install Temurin JDK 21, reopen Terminal, then retry.'
command -v keytool >/dev/null 2>&1 || fail 'The JDK keytool is unavailable. Install Temurin JDK 21 and retry.'
command -v shasum >/dev/null 2>&1 || fail 'The shasum utility is required.'
[ -f "$apk" ] && [ -f "$script_dir/apksigner.jar" ] && [ -f "$script_dir/unsigned.sha256" ] && [ -f "$script_dir/signing-certificate.sha256" ] || fail 'Extract the entire attendance-new-install-setup ZIP, then run its script.'
expected_hash="$(tr -d '[:space:]' < "$script_dir/unsigned.sha256" | tr '[:upper:]' '[:lower:]')"
[[ "$expected_hash" =~ ^[0-9a-f]{64}$ ]] || fail 'The bundle APK checksum is invalid.'
actual_hash="$(shasum -a 256 "$apk" | awk '{print $1}')"
[ "$actual_hash" = "$expected_hash" ] || fail 'APK checksum mismatch. Download a fresh setup ZIP from the successful GitHub build.'
pinned="$(tr -d '[:space:]:' < "$script_dir/signing-certificate.sha256" | tr '[:lower:]' '[:upper:]')"
if [ "$pinned" != 'UNCONFIGURED' ]; then [[ "$pinned" =~ ^[0-9A-F]{64}$ ]] || fail 'The pinned certificate is invalid.'; fi
if [ ! -f "$store" ] && [ "$pinned" != 'UNCONFIGURED' ]; then fail 'A release key has already been pinned. Restore its existing attendance-release.p12 backup; this script will not replace that identity.'; fi
printf '\nThis signs attendance with the existing release identity when available.\n'
printf 'Private signing folder: %s\n' "$store_dir"
if [ -f "$store" ]; then
  printf 'Reusing the existing release key; no replacement key will be generated.\n'
  read -r -s -p 'Enter its keystore password (hidden): ' signing_password; printf '\n'
else
  printf 'Choose a new password of at least 12 characters and save it in your password manager.\n'
  read -r -s -p 'New signing password (hidden): ' signing_password; printf '\n'
  read -r -s -p 'Repeat password (hidden): ' confirmation; printf '\n'
  [ "$signing_password" = "$confirmation" ] || fail 'Passwords did not match. No key was created.'
  [ "${#signing_password}" -ge 12 ] || fail 'Use at least 12 characters. No key was created.'
  unset confirmation
fi
export SHIKSHAVERTEX_SIGNING_PASSWORD="$signing_password"
unset signing_password
work="$(mktemp -d "${TMPDIR:-/tmp}/shikshavertex-sign.XXXXXX")"
cleanup() { unset SHIKSHAVERTEX_SIGNING_PASSWORD; rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$store_dir" "$apk_dir"
chmod 700 "$store_dir"
if [ ! -f "$store" ]; then
  keytool -genkeypair -alias "$alias_name" -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -storetype PKCS12 -dname 'CN=Shikshavertex Attendance, OU=Applications, O=Shikshavertex, L=Bengaluru, ST=Karnataka, C=IN' -keystore "$store" -storepass:env SHIKSHAVERTEX_SIGNING_PASSWORD -keypass:env SHIKSHAVERTEX_SIGNING_PASSWORD
  chmod 600 "$store"
fi
keytool -exportcert -keystore "$store" -alias "$alias_name" -storepass:env SHIKSHAVERTEX_SIGNING_PASSWORD -file "$work/certificate.der" >/dev/null
actual_cert="$(shasum -a 256 "$work/certificate.der" | awk '{print $1}' | tr '[:lower:]' '[:upper:]')"
if [ "$pinned" != 'UNCONFIGURED' ] && [ "$actual_cert" != "$pinned" ]; then fail 'This key does not match the pinned release certificate. No signed APK was published.'; fi
java -jar "$script_dir/apksigner.jar" sign --ks "$store" --ks-key-alias "$alias_name" --ks-pass env:SHIKSHAVERTEX_SIGNING_PASSWORD --key-pass env:SHIKSHAVERTEX_SIGNING_PASSWORD --out "$work/attendance-1.8.apk" "$apk"
java -jar "$script_dir/apksigner.jar" verify --print-certs "$work/attendance-1.8.apk" > "$work/certificate.txt"
verified_cert="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$work/certificate.txt" | tr '[:lower:]' '[:upper:]')"
[ "$verified_cert" = "$actual_cert" ] || fail 'APK certificate verification failed. No signed APK was published.'
cp "$work/attendance-1.8.apk" "$apk_dir/attendance-1.8.apk"
cp "$work/certificate.txt" "$apk_dir/certificate.txt"
printf 'ANDROID_SHA256_CERT_FINGERPRINTS=%s\n' "$actual_cert" > "$apk_dir/render-passkeys.env"
if [ -f "$script_dir/build-info.txt" ]; then cp "$script_dir/build-info.txt" "$apk_dir/build-info.txt"; fi
printf '\nSigned and verified APK: %s/attendance-1.8.apk\n' "$apk_dir"
printf 'Public SHA256: %s\n' "$actual_cert"
printf '\nBack up %s privately and keep its password in your password manager.\n' "$store"
printf 'Do not upload the signing folder or password to chat or GitHub files.\n'
printf 'Install only the signed APK listed above. Apps signed with this same release key can be updated in place.\n'
printf 'Confirm that the hosted Android association includes the Public SHA256 before distribution.\n'
