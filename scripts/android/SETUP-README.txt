Shikshavertex 1.9: owner-approved fresh-install migration

The unsigned APK in this ZIP cannot be installed directly.
Reuse the release key already created on the owner's Mac. Do not create a replacement identity.
No private signing key is included in this ZIP.

On the owner's Mac (Java 21 is already installed):
1. Extract the complete ZIP into Downloads.
2. Open Terminal and run:
   bash "$HOME/Downloads/attendance-new-install-setup/sign-fresh-attendance.sh"
   If the extracted folder has a different name, use its actual location.
3. Enter the EXISTING signing password when prompted.
   Terminal does not show the characters you type.
4. The existing encrypted release key must be at:
   ~/ShikshavertexSigning/attendance-release.p12
   Back up that file privately. Keep its password separately.
   Re-running the script reuses that key; it does not replace it.
5. The SIGNED APK is saved separately at:
   ~/Desktop/Shikshavertex Attendance/attendance-1.9.apk
6. Send ONLY the printed Public SHA256 line to the administrator/assistant.
   Do not send the private key or password in chat, Drive shares or GitHub files.
7. Wait until the server's Android association includes that certificate.
   Only then install on a test phone and sign in/perform phone verification.
   If the installed app uses this same key, choose Update and keep its app data.
   Existing Firebase attendance records are not deleted by reinstalling the app.

Do not distribute this unsigned setup ZIP to employees as an app installer.
Only the final signed APK is an installer, and it needs the matching server association.
Android 9+ is required. Computer users use the HTTPS web portal; this APK is not for iPhones.
The included AOSP apksigner.jar comes from SDK Build-Tools 35.0.0; its notice is included.
