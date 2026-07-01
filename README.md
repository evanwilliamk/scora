# SCORA — Fitness App Platform

**Status:** Day 1 complete. Monorepo scaffold + API + Supabase migrations shipped.

## What's Built

### ✅ Infrastructure
- **Monorepo:** Turborepo + pnpm workspaces
- **API:** Fastify (TypeScript, hot reload)
- **Database:** Supabase PostgreSQL + migrations (5 tables)
- **Auth:** Sign in with Apple (skeleton)

### ✅ Tables
- `users` — athlete accounts
- `athletes` — linked to users (Strava ID, Oura ID)
- `activities` — from Strava
- `workouts` — SCORA-generated training plans
- `health_data` — Oura + Apple Health (sleep, HRV, RHR, temperature)

### ✅ Endpoints
- `GET /health` — server status (verified working)

---

## Quick Start

### 1. Setup Environment
```bash
cp .env.example .env
# Edit .env with your Supabase credentials + OpenAI API key
```

### 2. Install Dependencies
```bash
npm install  # or pnpm install
```

### 3. Run API
```bash
cd apps/api
npm run dev
# API listens on http://localhost:3000
```

### 4. Verify
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","timestamp":"..."}
```

---

## Folder Structure

```
scora/
├── apps/
│   ├── api/                    # Fastify backend
│   │   ├── src/
│   │   │   └── index.ts        # Main server
│   │   ├── supabase/
│   │   │   └── migrations/     # Database schemas
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── ios/                    # (placeholder) SwiftUI app
├── packages/
│   ├── voice/                  # (placeholder) LLM prompts + pattern library
│   ├── validator/              # (placeholder) posture engine, banned phrases
│   ├── plan-engine/            # (placeholder) template adapter
│   └── shared/                 # (placeholder) types, utils
├── package.json                # Root scripts
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

---

## Next: Phase 0 (Days 2–14)

### Day 2–3: OAuth Skeleton
- [ ] Strava OAuth flow (POST `/api/auth/strava/callback`)
- [ ] Oura OAuth flow (POST `/api/auth/oura/callback`)
- [ ] Database upsert for athlete linked accounts

### Day 4–7: Posture Engine
- [ ] Pattern library (20 entries ported)
- [ ] Validator (posture enum, banned phrases, data-backing)
- [ ] LLM pipeline (gpt-4o voice reads)

### Day 8–14: Dashboard + Voice
- [ ] iOS home screen skeleton (SwiftUI)
- [ ] Daily voice read (CDV)
- [ ] Push notifications (APNS)

**Exit gates:** 12 of 14 mornings opened, 0 banned-phrase hits, ≥1 "wow" moment.

---

## API Credentials Needed

Before Phase 1 (Day 15), grab:
1. **OpenAI API key** — for gpt-4o + gpt-4o-mini
2. **Strava OAuth credentials** — from Strava API dashboard
3. **Oura OAuth credentials** — from Oura developer portal
4. **Apple Sign In credentials** — for iOS auth

---

## Deploy

### Railway Setup
1. Go to https://railway.app
2. Connect GitHub repo `evanwilliamk/scora`
3. Set environment variables (copy from `.env`)
4. Deploy

The API will auto-deploy on every push to `main`.

---

## Development Notes

- **Hot reload:** `npm run dev` in `apps/api` watches for changes
- **Build:** `npm run build` (Turbo parallelizes across workspaces)
- **Lint:** `npm run lint`
- **Database:** Supabase console at https://supabase.com/dashboard

---

## Contact

Built by Aira for Evan. Questions? See CLAUDE.md for spec details.
