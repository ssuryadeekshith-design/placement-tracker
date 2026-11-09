# Signed APK download and WhatsApp sharing

The Android workflow builds version 1.10 (build 11), tests it, restores the existing owner key from GitHub Actions secrets and checks its certificate against the pinned public SHA-256. Only a successful, signed `main` build can publish a release. The publication job checks the downloaded artifact's signature, package and version again. It uploads the complete installer and public metadata to a draft release before making the release visible. Re-running a published release preserves its files; an incomplete draft can be recovered.

The stable link, once a signed release has published, is:

`https://github.com/ssuryadeekshith-design/placement-tracker/releases/latest/download/attendance.apk`

Share this link in WhatsApp so everyone gets the current release. Employees download the single `.apk`, open it in Android Downloads and choose Install or Update. No GitHub account or ZIP extraction is needed for public release downloads. Another option is WhatsApp's Attach → Document → `attendance.apk`; that shares a fixed copy, which remains that version when a later release is published.

The release also provides `SHA256SUMS`, the public signing certificate and build information. Only the signed installer is distributed. Signing keys/passwords never go into a release, source files, chat or employee shares. Existing signing identity, backend association, authentication and attendance rules remain unchanged. Employees still use their own approved account. APKs require Android 9 or later; computer users use the web portal.

The private signing configuration uses the four repository Actions secrets documented in [Android signing setup](android-signing-setup.md). A missing or partial configuration, wrong key, failed check or unsigned candidate cannot produce an installable release link. GitHub Releases handles file hosting; it does not automatically install future updates on phones.
