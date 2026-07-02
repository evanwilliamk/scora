# iOS Setup Guide (Step-by-Step)

## Step 1: Wait for Xcode Install

While Xcode downloads (20-30 min), read through these files:
- `SCORAApp.swift` - Entry point
- `ContentView.swift` - Main UI
- `StravaAuthView.swift` - Auth button
- `DeepLinkHandler.swift` - Deep link processor

## Step 2: Create Xcode Project

Once Xcode is installed:

1. **Open Xcode**
2. **File → New → Project**
3. **Choose: iOS → App**
4. **Configure:**
   - Product Name: `SCORA`
   - Team: (leave blank)
   - Organization: (leave blank)
   - Language: **Swift**
   - Interface: **SwiftUI**
   - Use Core Data: **No**
   - Include Tests: **No**

5. **Save to:** `~/.openclaw/workspace/apps/ios/SCORA/`

## Step 3: Configure URL Scheme (Deep Links)

1. In Xcode, select **SCORA** project (left sidebar)
2. Select **SCORA** target
3. Go to **Info** tab
4. Scroll to **URL Types**
5. Click **+** to add URL type
6. **Set:**
   - Identifier: `scora`
   - URL Schemes: `scora`

## Step 4: Add Swift Files

In Xcode:
1. **File → Add Files to "SCORA"**
2. Select these files from `apps/ios/`:
   - `SCORAApp.swift`
   - `ContentView.swift`
   - `StravaAuthView.swift`
   - `DeepLinkHandler.swift`
   - `TokenStore.swift`
   - `ChatMessage.swift`
   - `CDVService.swift`
   - `ChatViewModel.swift`
   - `ChatView.swift`

3. Make sure "Copy items if needed" is **checked**

4. Make sure **SCORA** target is selected

## Step 5: Replace App Entry Point

1. Delete the auto-generated `SCORAApp.swift` (or rename to `_OLD.swift`)
2. Keep our `SCORAApp.swift`
3. Delete the auto-generated `ContentView.swift`
4. Keep our `ContentView.swift`

## Step 6: Build & Run

1. **Product → Build** (Cmd+B)
2. **Product → Run** (Cmd+R)
3. Choose **iPhone 15 Pro** simulator
4. Wait for build to complete

## Step 7: Test Strava Auth

1. On simulator, tap **"Connect Strava"**
2. Safari opens with Strava login
3. Sign in with your Strava account
4. Approve access for SCORA
5. Safari closes, you're redirected to deep link
6. App shows success screen with your name!

## Troubleshooting

**"Module not found"?**
- Clean build: Cmd+Shift+K
- Build again: Cmd+B

**Deep link not working?**
- Check URL Schemes are set correctly
- Check `scora://` not `scora://auth` in Safari test

**Strava button doesn't open Safari?**
- Make sure you're running on simulator, not preview

## Step 8: Test Chat + CDV

1. After Strava auth succeeds, the app now shows `ChatView` instead of the static success screen.
2. Type a message (e.g. "How am I doing?") and tap send.
3. The app calls `POST /api/cdv` with the token/athleteId `TokenStore` persisted in UserDefaults during the OAuth deep link callback (`scora://auth/success?...&token=...`).
4. Response renders as a voice line + numeric driver rows (metric, value, trend), matching the numeric-first design principle.

**Verified against live backend (2026-07-01, this session):**
- `POST /api/cdv` with missing fields → `400 {"error":"Missing: message, stravaToken, athleteId"}` ✅
- `POST /api/cdv` with an invalid/fake Strava token → `401 {"error":"Strava token invalid or expired"}` ✅ (`CDVService` now surfaces this as "reconnect Strava" in the chat UI)
- Full success path (valid Strava token → Strava fetch → OpenAI voice + drivers) requires a real, currently-valid Strava OAuth access token, which can only be obtained by running the iOS app through the actual Strava login on-device/simulator. **This dev machine has Xcode Command Line Tools only — no Xcode.app, no iOS Simulator** — so the on-device leg of the test could not be executed in this session. Run this from a Mac with full Xcode installed (see Step 2), or on Evan's iPhone, to get a live token and confirm the full round trip.

## Next Steps

- [x] Add Dashboard/chat view (shows athlete info + chat) — `ChatView.swift`
- [x] Add CDV endpoint integration — `CDVService.swift` + `ChatViewModel.swift`
- [x] Add token persistence (UserDefaults) — `TokenStore.swift`
- [ ] Add chart rendering (SwiftUI Charts) for tap-to-expand drivers
- [ ] Add weekly read display
- [ ] Move token storage from UserDefaults to Keychain (security hardening — UserDefaults is not encrypted at rest)
- [ ] Deploy to TestFlight

Happy coding! 🚀
