# Android wake alarm

The **Wake Alarm** tab in Sleep & Wake uses native `AlarmManager` on Android so the alarm can fire when the app is backgrounded or swiped away. Web and desktop keep the existing JS interval timer in `sleepTimer.ts`.

## Architecture

| Layer | Role |
| --- | --- |
| `src/sleepTimer.ts` | Persists wake schedule + track; on Android delegates scheduling to `nativeWakeAlarm.ts` |
| `src/nativeWakeAlarm.ts` | Capacitor bridge: `schedule`, `cancel`, `isScheduled`, `consumePending`, `wakeAlarmFired` listener |
| `WakeAlarmPlugin.java` | Plugin API + emits fired events to the WebView |
| `WakeAlarmScheduler.java` | SharedPreferences + `AlarmManager.setAlarmClock()` |
| `WakeAlarmReceiver.java` | Alarm delivery: notification, launch `MainActivity`, stash pending track for JS |
| `WakeAlarmBootReceiver.java` | Re-schedules after `BOOT_COMPLETED`, app update, time/timezone changes |

Playback still runs in the WebView audio engine when the app opens — same path as the in-app JS wake callback.

## Permissions

Declared in `AndroidManifest.xml`:

- `RECEIVE_BOOT_COMPLETED` — restore alarm after reboot
- `POST_NOTIFICATIONS` — wake notification (runtime on Android 13+)
- `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` — declared for compatibility; scheduling uses `setAlarmClock()` which is intended for user-visible wake alarms

## Build & test

```bash
npm run build:android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

1. Open **Sleep & Wake** (alarm icon in the player bar).
2. Switch to **Wake Alarm**, pick a locker/recent track, set a time 1–2 minutes ahead, tap **Arm Wake Alarm**.
3. Press Home or swipe the app away from recents.
4. At the scheduled time: notification appears, app opens (or comes to foreground), selected track starts playing.
5. **Cancel** clears both JS state and the native alarm.
6. Reboot the device with an alarm still armed — it should survive reboot (may fire immediately if the time passed during boot).

### Catalog vs locker tracks

- **Locker tracks** (`local-vault`) are the recommended wake alarm source — full-length files with reliable offline playback on Android.
- **Catalog search** returns iTunes 30-second preview URLs (`catalog-*` envelope IDs, `https` provider). These work for in-app JS wake alarms but may stop after ~30s and depend on network at fire time.
- When a catalog preview is selected, the UI shows an acquire-to-locker hint. If the same title exists in your locker, catalog search auto-prefers the locker copy (`wakeAlarmSuggestions.ts`).

### Exact alarm / Doze notes (API 31+)

- Scheduling uses **`AlarmManager.setAlarmClock()`**, which is the recommended API for wake alarms and shows the alarm icon in the status bar.
- On Android 12+ (API 31), third-party apps that call `setExact()` need `SCHEDULE_EXACT_ALARM`; this implementation avoids that by using `setAlarmClock()`.
- Aggressive OEM battery savers can still delay delivery until the user opens the app — same class of limitation as background WebView playback (see `docs/android-playback.md`).

### Typecheck

```bash
npm run lint
```

## Plugin API (JS)

- `WakeAlarm.schedule({ fireAtMs, track })`
- `WakeAlarm.cancel()`
- `WakeAlarm.isScheduled()`
- `WakeAlarm.consumePending()` — drain a fired alarm on cold start
- `WakeAlarm.addListener('wakeAlarmFired', …)`

Wired from `sandboxLayer3.tsx` via `initNativeWakeAlarm()` and `handleNativeWakeAlarmFired()` in `sleepTimer.ts`.
