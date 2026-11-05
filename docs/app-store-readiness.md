# App Store readiness

Checked 2026-11-05 at `50b42ff` (`origin/claude/integration-2026-10-28`). Report only: no app code, settings, entitlements or privacy text changed. Not legal advice.

**Count: 8 blockers, 12 risks.**

"Memory" means the Apple rule is stated from memory, not checked against the current text. Confirm it before acting. "Agent after go" means an agent can do it once Evan says so. New questions (P1 to P6) are at the end. They are proposals only, not yet in questions.md.

How it was checked: code reading, Release and Debug simulator builds (Xcode 16.2, unsigned), the built Info.plist, imported symbols in the Release binary, and 6 demo-flag launches on spare iPhone 16 and iPad Pro 11 simulators. No crash on any launch and no crash reports.

## Blockers

**B1. Sign in with Apple is not built (4.8, memory).** Strava is the only sign-in (`ContentView.swift:26-30`), no SIWA code, no `com.apple.developer.applesignin` in `Scora.entitlements`. This rating is a judgment call: 4.8 exempts clients of a specific third-party service, but SCORA also holds Oura, Health and plan data, so that argument is weak. CLAUDE.md 5.1 requires SIWA anyway, and Q27, Q41, Q45 wait on it. Act: Evan, `PLAN.md:64` (no Q of its own), then an agent.

**B2. No account deletion (5.1.1(v), memory).** No delete control in the app (`SettingsView.swift:186-190`), no delete route in `apps/api/src/index.ts`. The policy offers email only (`index.ts:80`), which from memory does not satisfy the rule. SIWA also needs its token revoked on delete (memory). Act: Evan, Q27. Inventory is in `docs/account-deletion-inventory.md`.

**B3. Health data goes to OpenAI with no disclosure or consent (5.1.2(i), 5.1.3, memory).** HealthKit sleep, HRV and resting HR leave the phone in `/api/read` (`DashboardView.swift:889-893`), become drivers (`index.ts:652-676`), and go to gpt-4o in the prompt (`index.ts:834-842`, `voice.ts:49`). No screen says so. Onboarding says only that SCORA "reads" them (`OnboardingView.swift:172`). From memory, the late 2025 guideline update requires naming third-party AI sharing and getting explicit permission. Act: Evan, P1.

**B4. Privacy policy is not linked and too thin (5.1.1(i), 5.1.3, memory).** No privacy link anywhere in the Swift code. `/privacy` (`index.ts:79-81`) is three sentences: no OpenAI, no retention, no list of data or uses. Its "industry-standard encryption" line sits badly with Q26 and Q28. Act: Evan, P2. Evan writes the text.

**B5. No privacy manifest.** No `PrivacyInfo.xcprivacy` in the repo. The app uses a required-reason API, UserDefaults (`TokenManager.swift:17-46`, `PushManager.swift:69`, `OnboardingView.swift:32`, `PlanView.swift:359`, `SettingsView.swift:73`, `WatchReconcile.swift:80`), likely reason CA92.1 (memory). From memory, uploads without it are refused since May 2024. Contents are in the tables below. Act: agent after go, P2.

**B6. No app icon.** `AppIcon.appiconset` holds only `Contents.json`, with a 1024x1024 slot and no image. The built app has no `Assets.car` and no `CFBundleIconName`, so upload validation should fail (memory). Act: Evan supplies a 1024 PNG with no alpha, P3.

**B7. Push cannot work on a device.** `aps-environment` is missing (`Scora.entitlements:5-8`). Registration fails and only prints (`PushManager.swift:215`). Push is the Free tier's only delivery. The server also needs `APNS_ENV=production` and `APNS_BUNDLE_ID=com.evankosowski.Scora`; the comment at `push.ts:11` gives a different example. Act: Evan, Q37.

**B8. This Mac cannot build for upload.** Xcode 16.2, iOS 18.2 SDK (`DTSDKName` in the built plist), macOS 14.6.1. From memory, uploads need the iOS 26 SDK since April 2026, and Xcode 26 needs macOS 15.6 or later. Another Mac may be fine, and the app has never been built or run against that SDK here. Act: Evan, P4.

## Risks

**R1. Stripe on the web for Plan tier (3.1.1, 3.1.3(b), memory).** Fine today: the app has no purchase UI, price or link (only a comment at `OnboardingView.swift:6`). The plan is Stripe only (`PLAN.md:142`, CLAUDE.md 8.3). Digital subscriptions unlocked in the app generally need in-app purchase too, and US link-out rules have been changing. Coach tier may not fit the one-to-one real-time exception in 3.1.3(d). Act: Evan, P5.

**R2. Sign-in leaves the app for Safari (4.0, memory).** `ContentView.swift:27` and `DashboardView.swift:574,585`, `OnboardingView.swift:291` open the system browser, not `ASWebAuthenticationSession`. Reviewers have rejected this. Act: fold into SIWA work, agent after go.

**R3. Health screen offers only "Allow Apple Health" (5.1.1(iv), memory).** No skip (`OnboardingView.swift:173-174`, seen on the simulator). Denying at the system sheet still continues (`:278-281`), so it does not really force consent, but reviewers object to "Allow" on a pre-prompt. Act: Evan picks the copy, agent after go.

**R4. Health usage string omits the server and the LLM.** Accurate on the three types (`Info.plist:35` matches `HealthManager.swift:195-197`) but says nothing about data leaving the phone. Act: Evan, with P1.

**R5. Reviewer access (2.1, memory).** Review needs a Strava account with real runs, or the read has no drivers (`index.ts:769`). Strava apps can have a low athlete capacity until Strava approves more (memory; `docs/vendor-budget.md` notes it was not checked). If the cap is reached, the reviewer cannot sign in. Act: Evan, P6.

**R6. Strava's own terms (not Apple, memory).** Strava data goes to OpenAI, and the recent API agreement restricts AI use. The button is custom, "Sign in with Strava" (`ContentView.swift:30`), not Strava's brand asset. Losing API access would stop the app. Act: Evan, read the agreement, P6.

**R7. Medical claims (1.4.1, memory).** Swift copy has no medical terms, and the validator blocks clinical claims (`validator.ts:61-65`). Still, reads interpret HRV and plan changes cite it, and neither the app nor `/terms` says it is not medical advice. Act: Evan, Q47 covers only the doctor line.

**R8. Data exposure against a health-data promise.** Not visible to a reviewer, but it undercuts the policy: routes trust `athleteId` (Q45), open CORS and `/api/push/test` (Q56), token in deep link (Q16, Q41, `index.ts:169`), plain-text tokens (Q26), RLS (Q28), athlete crossover (Q46). The app token is also in UserDefaults (`TokenManager.swift:44`), although `docs/account-deletion-inventory.md` says keychain. Act: Evan, those IDs.

**R9. Hardcoded API base.** `zonal-prosperity-production-3965.up.railway.app` at 10 sites (`ContentView.swift:26`, `DashboardView.swift:392`, `ChatView.swift:410`, `PlanView.swift:812`, `WeeklyView.swift:61`, `SettingsView.swift:101`, `PushManager.swift:64`, `OnboardingView.swift:122,357,419`). Not a rule breach, and HTTPS. Debug and Release share production, the host shows in Safari at sign-in, and a move needs an app update. Act: agent after go for one constant, Evan for the domain.

**R10. Chart WebView loads four CDN scripts.** vega, vega-lite, vega-interpreter, vega-embed from jsDelivr (`ChatView.swift:235-238`), pinned versions, no integrity hashes. CSP blocks fetches (`:213-218`), so athlete values stay on the phone, but jsDelivr sees IP and user agent. No failure path (`:256`), so offline gives an empty chart. Remote code is a low 2.5.2 risk in WebKit (memory). Act: agent after go to bundle the files.

**R11. Send to Watch is untested on hardware.** Only run on the simulator (`WorkoutExport.swift:12-14`). I believe WorkoutKit needs no extra entitlement (memory), but whether it needs a further usage string is unconfirmed, and so is the Settings path at `WorkoutExport.swift:295`. Act: Evan, paired-device test.

**R12. Denied permissions dead-end, without crashing (code reading only).** Notifications are asked at launch before sign-in or any explanation (`PushManager.swift:198`). If denied, nothing says so, while onboarding promises a notification (`OnboardingView.swift:189`); no `getNotificationSettings` or `openSettingsURLString` in the app. If Health is denied, the card says "Connect Oura or Apple Health" (`metrics.ts:136`) but its action only handles Oura (`DashboardView.swift:80`). Demo mode skips these prompts, so a simulator cannot show the denied paths. Act: Evan picks copy, agent after go. No ID.

## Fine

- **Health write string:** not needed. `toShare: []` (`HealthManager.swift:207`).
- **Notification string:** iOS has none to declare.
- **URL scheme:** `scora` only (`Info.plist:19-31`). The token in it is R8.
- **ATS:** no exceptions, every URL is HTTPS.
- **Background modes:** none, right for alert pushes. Q38 A would add HealthKit background delivery.
- **Orientation:** iPhone portrait, iPad all four, satisfying multitasking rules (memory). `INFOPLIST_KEY_*` at `project.pbxproj:500-504` are ignored because `GENERATE_INFOPLIST_FILE = NO`. Harmless, but they mislead.
- **Launch screen:** empty `UILaunchScreen` is valid (`Info.plist:36-37`).
- **HealthKit entitlement:** present, empty access list is right (`Scora.entitlements:5-8`).
- **Health not used for ads (5.1.3):** no ad or analytics SDK, no third-party binaries (`otool -L`). PostHog and Sentry, when added, must exclude Health values.
- **No health data in iCloud (5.1.3):** cached read is excluded from backup (`DashboardView.swift:248-252`), no CloudKit.
- **Demo mode out of Release:** no `demo-` strings in the Release binary, all 58 references inside `#if DEBUG`.
- **Debug strings and placeholders:** one harmless `print` (`PushManager.swift:215`). No TODO, Lorem or "coming soon" in Swift.
- **Minimum iOS:** 17.5 (`project.pbxproj:420,477`). CLAUDE.md says 17+, and this drops 17.0 to 17.4. Evan's choice.
- **Device families:** iPhone and iPad (`project.pbxproj:514,545`). iPad portrait renders fine. iPad screenshots are required, landscape not checked. Dropping iPad is Evan's call.
- **Version numbers:** literal `1.0` and `1` in `Info.plist:18,33`, and `MARKETING_VERSION` is ignored. Bump by hand.
- **Export compliance:** `ITSAppUsesNonExemptEncryption` absent, so App Store Connect asks each build. HTTPS and hashing only (`WorkoutExport.swift:139`) should be exempt (memory).

## What the manifest and App Privacy form would need

Required-reason APIs, from source and the Release binary's imports:

| API | Used? | Where |
|---|---|---|
| UserDefaults | Yes | B5 |
| File timestamps | No | `FileManager` only makes paths, directories and removes (`DashboardView.swift:235-268`) |
| Disk space | No | |
| Boot time | No | |
| Active keyboards | No | |

Data collected, from what the code sends. Tracking: none found. Mapping to Apple's categories is my reading, so confirm it.

| Data | Source | Goes to | Purpose |
|---|---|---|---|
| Sleep, HRV, resting HR, 28 nights | HealthKit, Oura | API; latest values and trends to OpenAI. Not stored by the live API (`docs/account-deletion-inventory.md`), held in process memory (`index.ts:712`) | App functionality |
| Runs and fitness | Strava, scope `read,activity:read_all` | API, OpenAI | App functionality |
| First name, Strava athlete id | Strava | API, database | App functionality |
| Chat questions | User | API, OpenAI (`index.ts:455,485`) | App functionality |
| Pasted plan text, calendar feeds | User | API, database; pasted text to OpenAI (`plan-parse.ts:253`) | App functionality |
| Time zone, delivery time | Device, user | API, database | App functionality |
| APNs device token | Device | API, database, Apple | App functionality |
| Push opens | Device (`PushManager.swift:135-143`) | API | Analytics |

`users.email` exists in the schema, but nothing I read in the live sign-in path collects it. WhatsApp numbers (Q29) would add a row.

## Not checked

- Real device, signed build, archive, upload, App Store Connect.
- Whether the Railway host or `hello@scora.app` are live (no network calls).
- Current guideline text (no browsing).
- `-demo-chat` was not run, because it loads the CDN scripts (`DemoMode.swift:67-68`). So demo mode is not fully network-free, and the chart findings are from code only.
- iPad landscape, and the real sign-in or permission prompts, since no run without a demo flag.

## Proposed questions (no existing ID)

- **P1. How do athletes agree to health data going to OpenAI?** A: a consent screen before the first read, naming OpenAI, with a no-Health path. B: keep Health values out of the LLM, numbers only for those athletes. C: on-device or other processing. Recommend A, Evan writes the copy.
- **P2. Who does the privacy package?** A: Evan writes the policy, an agent adds the Settings link and manifest. B: lawyer review first, same split. Recommend B for health data, and the manifest can go ahead now.
- **P3. App icon.** A: Evan supplies final art. B: an interim plain wordmark for TestFlight only. Recommend A.
- **P4. Which Mac and Xcode will submit?** A: update this Mac to macOS 15.6 or later and Xcode 26, which affects every worker here. B: archive from another Mac. Recommend B if one is ready, after a full test run on that SDK.
- **P5. How does Plan tier get paid for in the app?** A: first submission is Free tier only, no paywall. B: add StoreKit in-app purchase beside Stripe, with Apple's cut. C: Stripe only and accept rejection risk. Recommend A now, then B.
- **P6. Strava readiness for review.** A: Evan checks athlete capacity and the API agreement on AI use, and sets up a seeded demo account, before SIWA work starts. B: after SIWA. Recommend A, since it could change the product.
