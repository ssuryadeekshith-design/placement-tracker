# Android 1.8 signing and installation

The owner explicitly approved a new signing identity and reinstalling phones that have the old identity. The previous signing-file recovery procedure is superseded. Reinstalling does not delete server attendance records, but local sign-in/binding/passkey state can need setup again. Do not uninstall anything until the new certificate is allowed by the hosted server and the test APK is ready.

## 1. Download the setup bundle

Open GitHub → `ssuryadeekshith-design/placement-tracker` → **Actions → Build attendance APK**. Use the latest successful `main` run after this migration change, or use **Run workflow → main**. From its Artifacts section download **attendance-new-install-setup** on the computer, then extract the full ZIP into Downloads.

This artifact intentionally contains an unsigned 1.8 candidate, a portable AOSP signing tool with its notice, and the local signing script. It is not an employee installer. No keystore/password is included. Unlike the previous workflow, a missing CI signing secret does not prevent building this local-signing setup bundle.

## 2. Create the key and sign locally on the owner's Mac

Java 21 was already installed successfully. Run:

```sh
bash "$HOME/Downloads/attendance-new-install-setup/sign-fresh-attendance.sh"
```

If the extracted folder was renamed by the browser, use its actual folder name. The script uses the unsigned APK beside it; no old signing file or file-picker search is required.

For the current pinned release, restore/reuse `~/ShikshavertexSigning/attendance-release.p12` and enter its existing password. Do not generate a replacement key. The earlier owner-approved initial-key creation allowed a new password only before a certificate was pinned. Terminal hides typed characters. The script verifies the candidate's checksum, creates the encrypted key locally, signs the candidate and checks the APK signature. It never prints or records the password in a plaintext file. It does not connect to or uninstall a phone.

- **Private key:** `~/ShikshavertexSigning/attendance-release.p12`
- **Alias:** `shikshavertex-attendance-release`
- **Signed installer:** `~/Desktop/Shikshavertex Attendance/attendance-1.8.apk`
- **Public certificate:** `certificate.txt` and `render-passkeys.env` beside the signed installer

Back up the encrypted `.p12` file privately and keep its password separately. Do not upload that folder to a public repository, chat or an employee Drive share. Re-running the script reuses the same key. Once its public certificate has been pinned, a missing/different private key blocks signing instead of silently generating a replacement.

## 3. Send only the public SHA256 line

Copy the script's **Public SHA256** line to the assistant. No private signing file/password is needed in chat. The administrator can then pin that certificate in `mobile/android/signing-certificate.sha256` and reconcile the server's accepted certificates.

`UNCONFIGURED` in that public file permits only the already-approved first local key creation. CI never accepts an unpinned secret key or generates a production key in a disposable runner. Do not replace the marker with a guessed fingerprint.

## 4. Match the hosted certificate before installing

On Render → Placement Tracker → Environment, the existing `ANDROID_SHA256_CERT_FINGERPRINTS` needs to include the new confirmed fingerprint. It supports a comma-separated list, so preserve other approved certificates during the migration. Downloading `render-passkeys.env` or changing code alone does not change an existing Render environment override.

The expected RP is `placement-tracker-lyjf.onrender.com`; its HTTPS `/.well-known/assetlinks.json` must list package `in.shikshavertex.attendance` and the new certificate, and the backend derives the matching Android WebAuthn origin. The agent can verify the public association after the owner updates Render, but this session has no Render management credential.

The owner certificate beginning `6F:6B:40:7C` is already pinned; preserve it. An app already signed by that key can be updated in place without uninstalling. An older installation with a different signing identity needs the previously approved fresh install. Only after that association matches should the owner install on ONE test Samsung phone, sign in using the existing Firebase account, and validate real phone verification, attendance and sharing/stop. Follow [physical-phone validation](phone-validation.md). Employee rollout follows those checks; it is not established by an APK build. Android 9+ is required; iPhones cannot install this APK. Desktop users use the web portal.

## Optional: automate later signed builds with the same private key

For later CI builds, add four **repository Secrets**, not Variables/source files, under GitHub → Settings → Secrets and variables → Actions:

| Secret | Value entered privately |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the new `attendance-release.p12` backup |
| `ANDROID_STORE_PASSWORD` | New password chosen locally |
| `ANDROID_KEY_ALIAS` | `shikshavertex-attendance-release` |
| `ANDROID_KEY_PASSWORD` | Same password for this PKCS12 key |

On the Mac, copy base64 directly to the clipboard without printing it:

```sh
base64 < "$HOME/ShikshavertexSigning/attendance-release.p12" | tr -d '\r\n' | pbcopy
```

Paste that only into `ANDROID_KEYSTORE_BASE64` and clear the clipboard afterward (`printf '' | pbcopy`). The pinned public certificate must already match. With all four secrets present the job signs and verifies the APK, uploads **attendance-android** containing `attendance-1.8.apk` and public metadata, and always removes temporary private files. No cached debug-key fallback is used. A partial secret configuration or mismatched key stops signed publication.

Without these secrets, the successful setup artifact still lets the owner sign privately on their own computer. This avoids depending on a temporary cloud workspace to hold the only copy of a production key.
