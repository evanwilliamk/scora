# iOS coverage pass, 2026-11-03

Branch: `claude/ios-coverage-1103` (from `claude/integration-2026-10-28`). Tests only; no app source changed.

## How it was measured

```
xcodebuild test -project apps/ios/Scora.xcodeproj -scheme Scora \
  -destination 'platform=iOS Simulator,id=1543A8FA-06CA-4DCD-BC5A-BADFB15F3A80' \
  -parallel-testing-enabled NO -only-testing:ScoraTests -enableCodeCoverage YES \
  -resultBundlePath <scratch>/cov.xcresult
xcrun xccov view --report --files-for-target Scora.app <scratch>/cov.xcresult
```

iPhone 16 simulator only, parallel testing off. SwiftUI view files were not targeted; the picks are the logic files with the most uncovered lines that can be reached without HealthKit, WorkoutKit or a real server.

## Files targeted (line coverage)

| File | Before | After |
|---|---|---|
| Scora/PushManager.swift | 46.3% (101/218) | 86.7% (189/218) |
| Scora/DemoMode.swift | 7.1% (10/140) | 62.1% (87/140) |
| Scora/WatchReconcile.swift | 82.2% (236/287) | 95.5% (274/287) |
| Scora/TokenManager.swift | 75.2% (91/121) | 100.0% (121/121) |
| Scora/Network.swift | 60.8% (31/51) | 100.0% (51/51) |
| Scora/WorkoutExport.swift | 85.2% (201/236) | 86.0% (203/236) |

Also covered in passing: `Driver` init and number decoding in ChatView.swift (24.0% to 24.9%).

Scora.app overall: 27.8% (1967/7086) before, 31.5% (2230/7086) after.

## What the new tests cover

All new classes are at the end of `apps/ios/ScoraTests/ScoraTests.swift` (no new files, so no new Xcode file IDs).

- `PushManagerFlowTests`: device token registration (before and after sign-in), the AppDelegate hex token, unregister, push-open reports (delivered, 400 dropped, 503 kept, waiting before sign-in, stale ones pruned), foreground presentation and route handoff. Requests go through `InterceptURLProtocol`, registered globally for the test, so `URLSession.shared` never reaches the API.
- `TokenSaveTests`: `saveToken` on a first sign-in (server says onboarded, and no answer), and signing in again while signed in. `OnboardingSync.transport` is stubbed.
- `WatchReconcileBranchTests`: older-build copy branches (changed on a busy day, row gone, day empty, moved earlier), a resend the Watch refuses because it is full, `reconcile` saving the ledger, `coveredThrough`, and the quiet early returns of the foreground `refresh` (its base URL uses a scheme no session loads).
- `DemoModeTests`: every flag off in a normal launch; the sample read's driver links and series; the sample week.
- `NetworkStatusTests`: the path monitor starting, came-back logic, the failure mapping for every screen's lines.
- `WorkoutExportStepTests`: intervals with no recovery, an unknown step type refused at its plan index.

## What stays uncovered, and why

- PushManager: `requestAuthorization` (system prompt) and the notification tap handler (`UNNotificationResponse` cannot be built in a test).
- DemoMode: the samples behind `-demo-*` launch flags; `ProcessInfo.arguments` cannot be set in-process.
- WatchReconcile: the success path of `refresh`, which fetches with `API.session` (a custom session a global URLProtocol does not reach).
- WorkoutExport: `AppleWatchScheduler`, a thin wrapper over WorkoutKit.

## Test counts

ScoraTests: 186 to 213 tests, all passing.

## Findings

None. Every new test passed against current behavior.
