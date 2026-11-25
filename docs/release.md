# Release & Signing Guide

Token Island uses the same Apple Developer account (`Developer ID Application: Hanzhen Hong (7Z39KUX3QC)`, Team ID `7Z39KUX3QC`) and GitHub Actions secret names as [`Leonezz/quire`](https://github.com/Leonezz/quire).

## Required GitHub Actions Secrets

Configure these 5 repository secrets in `Settings → Secrets and variables → Actions` (identical to `Leonezz/quire`):

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12` certificate (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | Password for the `.p12` certificate |
| `APPLE_ID` | Apple Developer email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for `xcrun notarytool` |
| `APPLE_TEAM_ID` | `7Z39KUX3QC` |

> If `CSC_LINK` is omitted, `.github/workflows/release.yml` degrades cleanly with a warning and publishes ad-hoc signed Universal `.dmg` and `.zip` builds.

## Publishing a Release

1. Update `"version"` in `package.json` (e.g. `"0.4.0"`), commit, and push to `main`.
2. Either push a version tag:
   ```bash
   git tag v0.4.0
   git push origin v0.4.0
   ```
   Or trigger **Actions → Release → Run workflow** with `tag = v0.4.0`.
3. GitHub Actions builds a Universal (`arm64` + `x86_64`) `TokenIsland.app` (with `collector.mjs` bundled inside `Contents/Resources/`), signs with Hardened Runtime, notarizes & staples via `notarytool` + `stapler`, and publishes:
   - `TokenIsland-<version>-universal.dmg`
   - `TokenIsland-<version>-universal-mac.zip`
   - `SHA256SUMS.txt`
