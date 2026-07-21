# Android install rules (agents & scripts)

## User physical device

Default serial: **`46349770`** (override with env `SANDBOX_USER_DEVICE`).

This phone holds real downloaded tracks in app storage. **Uninstalling the app or running `pm clear` wipes those downloads.**

## NEVER without explicit user OK

On `46349770` / `SANDBOX_USER_DEVICE`:

- `adb uninstall …`
- `adb shell pm clear …`
- `adb shell pm uninstall …`

## Safe upgrade path

Always use reinstall-over-existing:

```powershell
adb -s 46349770 install -r path\to\app-arm64-v8a-debug.apk
```

Scripts enforce this via `Assert-NotUserDeviceDestructiveAdb` in `_adb-user-device-guard.ps1` (loaded from `set-android-env.ps1`).

## Emulator-only E2E

Scripts named `android-*-e2e.ps1` with `$ForbiddenSerial` install **only** to `emulator-5554` even when the phone is connected. Do not retarget those scripts at the user device.

## Locker delete code

Do not use `adb uninstall` / `pm clear` as a substitute for in-app locker management — that is separate application logic.
