# Use the existing Android signing file privately

The owner confirmed they have a signing file. That resolves availability only after its public certificate is checked; it does not yet prove that it matches the installed app. The workflow will not generate a new identity or fall back to a cached debug key.

## 1. Check the file on your own computer

Keep `.jks`/`.keystore` files and all passwords private. Do not send them in chat or add them to repository files. On the computer holding the file, run:

```sh
keytool -list -v -keystore "/full/path/to/your-signing-file.jks"
```

Enter the keystore password only at the terminal prompt. Find **Alias name** and **SHA256** in the result. The certificate fingerprint is public and safe to share; the password and signing file are not.

The preserved version 1.2 update certificate is:

```text
D7:26:78:D6:99:2A:09:AC:54:99:83:C3:70:85:1F:CA:B3:F6:63:5B:B3:BB:72:7F:C6:F7:DD:AD:FF:43:3D:25
```

If the fingerprint differs, stop before replacing the installed app or changing Render. Check the installed APK's public certificate and agree on a migration if necessary. Having another signing file does not make it an in-place update key.

## 2. Add four private repository secrets

Open GitHub → `ssuryadeekshith-design/placement-tracker` → **Settings → Secrets and variables → Actions → New repository secret**. These must be Secrets, not ordinary Variables or source files.

| Secret name | Value entered privately in GitHub |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the existing keystore file |
| `ANDROID_STORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Alias printed by keytool |
| `ANDROID_KEY_PASSWORD` | Private-key entry password; often the same as the store password |

On the Mac shown in earlier screenshots, copy the file's base64 directly to the clipboard without printing it:

```sh
base64 < "/full/path/to/your-signing-file.jks" | tr -d '\r\n' | pbcopy
```

Paste that only into the `ANDROID_KEYSTORE_BASE64` Secret value. After saving it, clear the clipboard (`printf '' | pbcopy`). Enter the remaining three values privately. Keep a secure backup of the original keystore; GitHub Secrets are not a replacement for your backup.

The agent does not have a repository-secret management connection in this session and cannot populate those secret values for you. Once they exist, the workflow handles the build, signing, certificate check and artifact creation without exposing the key in the APK artifact.

## 3. Run the build

Open **Actions → Build attendance APK → Run workflow**, choose `main`, then **Run workflow**. The job restores the secret key into a temporary file, checks its public certificate, assembles/tests/lints the release, signs it, verifies the output and removes temporary signing files. Only the APK and public certificate/build metadata are uploaded.

From the successful run, download the `attendance-android` artifact. It contains `attendance-1.6.apk`, `certificate.txt`, `render-passkeys.env` and `build-info.txt`. The old `app-debug.apk` name no longer identifies the new signed release. Do not install an unsigned candidate or uninstall the old app to force an update.

## 4. Match the server before phone validation

After confirming the correct public certificate, Render's `ANDROID_SHA256_CERT_FINGERPRINTS` must allow that installed APK certificate and its associated WebAuthn origin. The last observed live association advertised a different `49:CA:27:EB…` certificate, so this must be reconciled. Do not remove other approved installed-app certificates casually; the environment supports comma-separated fingerprints. The expected RP is `placement-tracker-lyjf.onrender.com`, and its public `/.well-known/assetlinks.json` must include the package and installed certificate.

Only after the key, signed artifact and server association agree should the owner test the update on the Samsung phone, preserve existing app data, and perform [the physical-phone acceptance checks](phone-validation.md). A successful build is not evidence that a handset or a real passkey was tested.
