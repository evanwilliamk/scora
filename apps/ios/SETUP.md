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

## Next Steps

Once auth flow works end-to-end:
- [ ] Add Dashboard view (shows athlete info)
- [ ] Add CDV endpoint integration
- [ ] Add chart rendering (SwiftUI Charts)
- [ ] Add weekly read display
- [ ] Deploy to TestFlight

Happy coding! 🚀
