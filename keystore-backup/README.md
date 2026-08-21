# Play Store Upload Keystore — BACKUP

Backup of the Google Play **upload keystore** for HireOrbit AI (`com.hireorbitai.app`).

- **File:** `upload-keystore.jks`
- **Alias:** `hireorbitai-upload`
- **Key:** RSA 2048, valid until 2053
- **SHA-1:** `FE:30:6D:67:50:A4:00:00:68:E8:5D:54:C5:A8:1C:4B:E8:97:25:D1`

## ⚠️ The password is NOT stored here — on purpose

The keystore is encrypted with a password. That password is **deliberately kept out of
this repo** so a repository leak can never produce a usable signing key. **Save the
store/key password in a password manager** (Bitwarden, 1Password, Google Password
Manager). Without it, this file is useless.

## Restore / sign a future release

1. Copy `upload-keystore.jks` → `mobile/android/app/upload-keystore.jks`
2. Create `mobile/android/keystore.properties`:
   ```
   storeFile=upload-keystore.jks
   storePassword=<your saved password>
   keyAlias=hireorbitai-upload
   keyPassword=<your saved password>
   ```
3. Build: `cd mobile/android && ./gradlew bundleRelease`

## If the upload key is ever lost

Google **Play App Signing** is enrolled, so a lost upload key is recoverable via an
upload-key reset in Play Console. Keep this backup + the password regardless.
