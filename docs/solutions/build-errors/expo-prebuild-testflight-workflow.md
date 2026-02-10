---
title: "Expo Prebuild to TestFlight Workflow"
category: build-errors
tags: [testflight, expo, xcode, ios, deployment]
module: ios-deployment
symptoms:
  - Need to deploy a new TestFlight build
  - Build number rejected by App Store Connect
  - Missing DEVELOPMENT_TEAM after prebuild
date_solved: "2026-02-10"
---

# Expo Prebuild to TestFlight Workflow

## Context

Jukesats uses Expo with a custom native iOS project. The `ios/` directory is gitignored and regenerated each time. This means every TestFlight build requires re-adding Xcode settings that Expo doesn't manage.

## Full Workflow

### 1. Prebuild

```bash
npx expo prebuild --clean
```

This regenerates `ios/` from `app.json`. It wipes all custom Xcode settings.

### 2. Fix project.pbxproj

After prebuild, manually patch `ios/Jukesats.xcodeproj/project.pbxproj`:

**Add DEVELOPMENT_TEAM** (both Debug and Release build configurations):
```
DEVELOPMENT_TEAM = 28TK9V7C2B;
```

**Bump CURRENT_PROJECT_VERSION** (must be higher than previous upload):
```
CURRENT_PROJECT_VERSION = N;  // increment each build
```

**Fix MARKETING_VERSION** if needed (should match app.json version):
```
MARKETING_VERSION = 1.0.0;  // prebuild may set "1.0" instead of "1.0.0"
```

### 3. Archive

```bash
xcodebuild -workspace ios/Jukesats.xcworkspace \
  -scheme Jukesats \
  -configuration Release \
  -sdk iphoneos \
  -destination generic/platform=iOS \
  -archivePath build/Jukesats.xcarchive \
  archive
```

### 4. Export IPA

```bash
xcodebuild -exportArchive \
  -archivePath build/Jukesats.xcarchive \
  -exportPath build/ipa \
  -exportOptionsPlist ExportOptions.plist
```

### 5. Upload

```bash
xcrun altool --upload-app \
  -f build/ipa/Jukesats.ipa \
  -t ios \
  -u mcozire@gmail.com \
  -p @keychain:AC_PASSWORD
```

macOS may prompt for keychain access on first run — click "Always Allow".

## Key Files

- `app.json` — version and bundleIdentifier
- `ExportOptions.plist` — export settings (team ID, signing style)
- `ios/Jukesats.xcodeproj/project.pbxproj` — Xcode build settings (regenerated, needs patching)
- `ios/Jukesats/Jukesats.entitlements` — Associated Domains (regenerated from app.json)

## Build Number History

| Version | Build | Features |
|---------|-------|----------|
| 1.0.0   | 1     | Initial NFC tap |
| 1.0.0   | 2     | NFC icon + early stamp card |
| 1.0.0   | 3     | NFC indicator + loyalty stamp card + send/receive |

## Prevention

- Always check `CURRENT_PROJECT_VERSION` before archiving — App Store Connect rejects duplicate build numbers
- Keep `ExportOptions.plist` in the repo root (it's not in `ios/` so prebuild doesn't touch it)
- The `DEVELOPMENT_TEAM` and `CURRENT_PROJECT_VERSION` patches could be automated with a post-prebuild script
