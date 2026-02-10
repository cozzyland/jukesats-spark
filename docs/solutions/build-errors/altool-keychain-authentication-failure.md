---
title: "altool Keychain Authentication Failure"
category: build-errors
tags: [testflight, keychain, altool, ios, deployment]
module: ios-deployment
symptoms:
  - "AuthenticationFailure: Failed to find item AC_PASSWORD for user"
  - altool hangs indefinitely with no output
  - altool appears stuck after "Running altool at path..."
date_solved: "2026-02-10"
---

# altool Keychain Authentication Failure

## Symptom

When running `xcrun altool --upload-app` with `@keychain:AC_PASSWORD`, the command either:
1. Fails instantly with `AuthenticationFailure("Failed to find item AC_PASSWORD...")`
2. Hangs indefinitely after printing "Running altool at path..." — this happens when macOS is waiting for a Keychain access approval dialog that may be hidden behind other windows

## Root Cause

The `-T` flag in `security add-generic-password` restricts which applications can access the keychain item. When used as `-T /usr/bin/security`, only the `security` CLI can read the password — `altool` is blocked and macOS shows a permission dialog that can be missed.

## Solution

Store the app-specific password **without** the `-T` flag:

```bash
# Delete existing (if any)
security delete-generic-password -a "mcozire@gmail.com" -s "AC_PASSWORD"

# Re-add without -T restriction
security add-generic-password -a "mcozire@gmail.com" -s "AC_PASSWORD" -w "YOUR-APP-SPECIFIC-PASSWORD"
```

On first use, macOS will prompt once for your login password to allow altool access. Click "Always Allow" to avoid future prompts.

Then upload:
```bash
xcrun altool --upload-app \
  -f build/ipa/Jukesats.ipa \
  -t ios \
  -u mcozire@gmail.com \
  -p @keychain:AC_PASSWORD
```

## Prevention

- Never use `-T` flag when storing passwords that multiple tools need to access
- If altool appears stuck, check for a macOS Keychain dialog hidden behind windows
- App-specific passwords are generated at https://appleid.apple.com/account/manage → Sign-In and Security → App-Specific Passwords

## Related

- Apple docs: [App-specific passwords](https://support.apple.com/en-us/102654)
- The `altool` command is deprecated in favor of `notarytool` for macOS, but remains the standard for iOS App Store uploads
