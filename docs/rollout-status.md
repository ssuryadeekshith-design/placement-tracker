# Rollout preparation — 9 November 2026

**Later signing decision:** The owner approved a fresh-install migration to a new key after the old file was not recognized. Use [the Android 1.7 local signing setup](android-signing-setup.md). Earlier references to unsigned 1.6 and original-key recovery below describe the previous state.

The owner has authorized APK building and deployment. The existing review work is being published to main to trigger the linked Render service's automatic deploy. An actual deploy must be verified using the live commit metadata; a Git push alone is not proof of deployment.

## Deployment repairs

The previously live web bundle had no public Firebase config and contained the “Registration is not available” fallback. The portal now defaults to the public project/API configuration supplied in the Android `google-services.json`, for `placementtracker-a1a87`. These public client identifiers are not Admin credentials and grant no employee or HR permissions. Complete `REACT_APP_FIREBASE_*` overrides still work; partial overrides fail closed rather than mixing projects. Auth providers, API-key application restrictions and authorized domains remain Firebase project settings that need a real account test.

Render's existing `server` / `npm ci` setup now runs a Render-only install hook that installs and builds the React frontend too. Ordinary local/CI server installs do not start web builds. Node 22 is pinned for either repository-root or server-root Render configuration. A web build failure stops deployment before publishing the new bundle. Existing server runtime credentials, cookie secret, policy and passkey origins are preserved.

The public `/api/health` response now includes `deploymentCommit`, from Render's `RENDER_GIT_COMMIT`; `client/build/build-info.json` identifies the compiled web commit. Both must match the deployed source. If Render auto-deploy is disabled, open the Placement Tracker service → Manual Deploy → Deploy latest commit. The agent has GitHub push access, but no Render management credential or authenticated Render desktop session to press that control or change service settings.

## APK candidate

The Android 1.6 / versionCode 7 **unsigned release candidate** compiled successfully, including APK packaging, 50 release unit tests and release lint (zero errors, 13 warnings). Minimum Android is API 28 / Android 9, target API 35. SHA-256 of that unsigned candidate: `ccd09a8423bc4e477cf72edb9a5bc5821bed3a9913522d3168a8d80767867c5a`.

It is deliberately not distributed as an installable update: signature verification correctly reports that it is unsigned. The required original version 1.2 certificate begins `D72678D6`; the available local development keystore begins `D7651EEA`, and the live association last advertised `49CA27EB`. None is interchangeable. No new signing identity was adopted, signing guard removed, old app uninstalled or server fingerprint changed. Restore the installed app's matching private keystore or explicitly plan a new stable signing/reinstallation migration. Certificate files/APKs cannot reconstruct a private signing key.

## Validation scope

After these deployment changes, 116 frontend tests and 82 backend tests passed, a clean Render-style dependency install and production web build passed, and the full browser integration journey passed again. Public build inspection confirms the supplied Firebase project is included. Release Android tests and lint passed as above. No live employee records, real emails, physical Wi-Fi/GPS readings or passkey ceremonies were used by these automated checks.

No physical handset/USB bus is exposed to this cloud workspace. A phone plugged into the owner's laptop is not automatically connected here. ADB on the test laptop is only a way to verify installation and hardware behavior; employees do not need Android Studio. See [physical validation steps and the read-only phone checker](phone-validation.md).

This is not an all-device guarantee: the APK is for Android 9+, not iOS. Computers use the HTTPS web portal; browser reports/check-ins do not provide Android Wi-Fi observation or background sharing. Real Firebase email/authentication, a matching signed phone build and the physical acceptance tests remain necessary before company-wide rollout. A sleeping Render Free instance is not an always-on service; upgrading a paid service requires the owner's Render/billing action and was not performed.
