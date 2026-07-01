# Design TODOs — Frontend & UX

## OAuth Post-Auth Flows

### Strava
- ✅ Success page (HTML) — DONE
- ✅ iOS deep link redirect — DONE
- [ ] Build actual landing page users redirect to after `scora://auth/success`
- [ ] Dashboard integration — show connected Strava data

### Oura
- [ ] Success page (HTML, same pattern as Strava)
- [ ] iOS deep link redirect
- [ ] Landing page after deep link fires
- [ ] Dashboard integration — show sleep/HRV/temperature data

---

## iOS App (Phase 1+)

### Deep Link Handlers
- `scora://auth/success?athlete_id=XXX&name=YYY` → Show onboarding or dashboard
- Redirect from `/api/auth/strava/callback` and `/api/auth/oura/callback`

### Core Screens
- [ ] Onboarding (user first time)
- [ ] Dashboard (home screen with voice read + CDV)
- [ ] Activity feed (recent workouts, activities)
- [ ] Settings (linked accounts, preferences)

---

## Web Frontend (Phase 2+)

### Landing Pages
- [x] `/` — Landing page with SCORA logo + features (✅ BUILT Phase 0)
- [x] `/privacy` — Privacy Policy placeholder (✅ BUILT Phase 0)
- [x] `/terms` — Terms of Service placeholder (✅ BUILT Phase 0)
- [ ] `/auth/success` — Success page after OAuth (currently just HTML, needs design refinement)
- [ ] `/dashboard` — Main athlete dashboard
- [ ] `/settings` — Account settings, linked integrations

### Dashboard Components
- [ ] Daily voice read card (posture + narrative)
- [ ] CDV (Coach's Daily View) — tap to expand drivers
- [ ] Weekly summary
- [ ] Activity history (Strava sync)
- [ ] Health metrics (Oura data)

---

## Design Notes

**Current approach:** HTML success pages are temporary. Once iOS app is built, it'll handle deep links natively. Web users get fallback pages for now.

**iOS-first:** Design for mobile-first experience. Web dashboard is Phase 2.

**Data visualization:** We'll use Vega-Lite charts (already in tech stack) for activity/health data in CDV tap-expand.

**Landing pages (Phase 0):** Currently served from Railway API as static HTML. When you build a real frontend (Next.js/React), migrate these to proper pages.

---

## Timeline

- **Phase 0 (Days 1–14):** 
  - ✅ HTML success pages for OAuth
  - ✅ Landing page + legal pages (placeholder)
- **Phase 1 (Days 15–35):** iOS app built, handles deep links
- **Phase 2 (Days 36–65):** 
  - Refine landing pages with real design
  - Build web dashboard
  - Web analytics/settings pages

## Refinements for Later

When you redesign the landing pages:
- [ ] Add hero section with better copy
- [ ] Add pricing tiers (Free, Plan, Coach)
- [ ] Add social proof / testimonials
- [ ] Better branding / visual hierarchy with logo
- [ ] Newsletter signup
- [ ] FAQ section
- [ ] Live demo video or walkthrough
