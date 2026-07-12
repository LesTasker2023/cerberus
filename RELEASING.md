# Releasing Cerberus

Releases are built **locally** (GitHub Actions is unavailable on this account) and
published to GitHub Releases. Installed apps auto-update by reading `latest.json`
from the newest release — so publishing a release *is* shipping the update.

## Prerequisites (one-time)

- **Updater private key**: `C:\Users\les-t\Documents\GitHub\cerberus-updater.key`
  (empty password). This signs every update. **Back it up.** If lost, no future
  update can be signed and the auto-update chain breaks for all users. The matching
  public key is baked into `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) —
  never change it, or existing installs can't verify updates.
- VS 2019 BuildTools (vcvars) — same MSVC env as `tauri dev`.
- `gh` authenticated.

## Cut a release

1. **Bump the version** in `src-tauri/tauri.conf.json` (`version`) and `package.json`.
   Use the same `vX.Y.Z` everywhere.

2. **Build the installer** from a VS-aware shell. Set the signing env in PowerShell
   first (this sets an *empty* password correctly — doing it via cmd `set VAR=`
   unsets it and the build hangs on a password prompt):

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\les-t\Documents\GitHub\cerberus-updater.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   cmd /c '... vcvars64.bat && cd /d <repo> && npm run tauri build'
   ```

   If it still hangs at "Decrypting updater signing key", Ctrl-C, then sign manually:

   ```bash
   npx tauri signer sign -f "C:\Users\les-t\Documents\GitHub\cerberus-updater.key" -p "" \
     src-tauri/target/release/bundle/nsis/Cerberus_<ver>_x64-setup.exe
   ```

3. **Publish** (signs if needed, writes `latest.json`, creates the release):

   ```bash
   node scripts/release.mjs
   ```

## Artifacts

- `src-tauri/target/release/bundle/nsis/Cerberus_<ver>_x64-setup.exe` — the installer.
- `...-setup.exe.sig` — updater signature (its contents go into `latest.json`).
- `latest.json` — the update manifest the app polls.

The installer is **unsigned by a Windows cert**, so SmartScreen warns on first run
("More info → Run anyway"). The updater signature is separate and always applied.
