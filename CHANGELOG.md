# E.Guardian MDM — Changelog

All notable changes to this project are documented here.

---

## [0.2.0] — 2026-03-29

### Summary
Added concurrent session exclusivity for device users (same user cannot be active on two devices simultaneously) and fixed four bugs: double-poll coroutine leak, API 25 crash on USB policy, device-users listing 500 error, and git repository initialized.

### Changes
- **android/services/CommandPollingService.kt**: added `pollingJob: Job?` — cancels previous polling+watchdog coroutines on each `onStartCommand`, preventing duplicate poll threads on re-enroll
- **android/services/CommandPollingService.kt**: added session validation per poll cycle — calls `GET device/user-auth/session/:id/validate`, forces re-login with toast on HTTP 410
- **android/services/MdmPolicyService.kt**: guarded `setUsbDataSignalingEnabled()` with `Build.VERSION.SDK_INT >= S` (API 31) to prevent `NoSuchMethodError` crash on API 25
- **android/ui/DeviceLoginActivity.kt**: added `EXTRA_REASON` extra + Toast display on `onCreate` to show "Sessão encerrada" message when kicked by another device
- **android/api/MdmApiClient.kt**: added `validateSession` Retrofit endpoint (`GET device/user-auth/session/{sessionId}/validate`)
- **backend/device-sessions/device-sessions.service.ts**: added `closeActiveForUser()` — closes all active sessions for a user across all devices on new login
- **backend/device-sessions/device-sessions.service.ts**: added `findById()` helper
- **backend/device-user-auth/device-user-auth.service.ts**: added `validateSession()` — returns 410 Gone when session is no longer ACTIVE
- **backend/device-user-auth/device-user-auth.controller.ts**: added `GET device/user-auth/session/:sessionId/validate` route
- **backend/device-users/device-users.service.ts**: fixed `findAll` — changed `??` to `||` for page/limit defaults to handle NaN from ValidationPipe

### Fixes
- **Double-poll bug**: `onStartCommand` launched new coroutines without canceling previous ones → each re-enroll added 2 more polling loops. Fix: `pollingJob?.cancel()` + watchdog as child job.
- **API 25 USB crash**: `setUsbDataSignalingEnabled()` is API 31+ and throws `NoSuchMethodError` (a `Throwable`, not `Exception` — not caught by existing try-catch). Fix: SDK version guard.
- **Device-users 500**: `ValidationPipe` with `enableImplicitConversion: true` converts absent `@Query('page')` to `NaN`. `NaN ?? 1` returns `NaN` (nullish coalescing doesn't catch NaN). Fix: `||` operator.
- **Concurrent sessions**: `closeActiveForDevice` only closed sessions for the same device, allowing the same user to stay logged in on multiple devices. Fix: `closeActiveForUser` called on every login.

### Decisions
- Session exclusivity enforced server-side (close on login) + client-side (poll-based 410 check every 5s) for fast feedback without WebSockets
- `validateSession` is a `@Public()` endpoint — authenticated only by `X-Device-Token` header, no JWT needed
- Toast message "Sessão encerrada: login realizado em outro dispositivo" shown via `EXTRA_REASON` intent extra

---
