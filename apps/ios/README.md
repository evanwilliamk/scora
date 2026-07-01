# SCORA iOS App

SwiftUI app for SCORA fitness coaching platform.

## Setup

1. **Xcode installed?** (See parent README)
2. **Create project in Xcode:**
   - File → New → Project
   - Choose "App" template
   - Name: `SCORA`
   - Team: (leave blank for now)
   - Organization: (leave blank)
   - Language: Swift
   - Interface: SwiftUI
   - Save to: `apps/ios/SCORA/`

3. **Copy these files into Xcode project** (once created):
   - `App.swift` → `SCORA/SCORAApp.swift`
   - `ContentView.swift` → `SCORA/ContentView.swift`
   - `StravaAuthView.swift` → `SCORA/StravaAuthView.swift`
   - `DeepLinkHandler.swift` → `SCORA/DeepLinkHandler.swift`

## Build & Run

```bash
xcode-build -scheme SCORA -configuration Debug
```

Or just use Xcode UI: Product → Build & Run

## Deep Links

App handles deep links from `scora://auth/success?athlete_id=...&name=...`

See `DeepLinkHandler.swift` for implementation.

## Architecture

- `SCORAApp.swift` - App entry point, scene config
- `ContentView.swift` - Main landing screen
- `StravaAuthView.swift` - Strava OAuth button + redirect handler
- `DeepLinkHandler.swift` - Process incoming deep links
- `Models/` - Data structures (Athlete, etc.)

## Next

Once running on simulator:
1. Tap "Connect Strava"
2. Sign in to Strava (using real account)
3. Approve access
4. Get redirected back to app
5. Success screen shows athlete name

Test with live API: https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava
