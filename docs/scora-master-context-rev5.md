# SCORA · Master Context & Positioning

> **Canonical source of truth.** Load fully at session start. Replaces the placeholder `~/scora/CONTEXT.md`. Any assistant or teammate working on Scora should treat this file as the definitive statement of what the product is, who it serves, and why it wins. Rev 5, July 2026.
>
> **Reconciliation note (added July 2026):** This Master Context ENRICHES the existing PRD / `CLAUDE.md`; it is not a rewrite and does not scrap the current build. Where it introduces new material (the forecaster loop, feel-before-reveal, the third witness, data-source expansion), those are adopted deliberately. Evan's standing clarifications: keep the free tier for now (adaptable); "paid-only" is not treated as a settled override yet; the market is not road-only (road is the bulk, ultra is not primary but not excluded); Strava stays integrated (its API restricts *training* AI and cross-user *display*, not inference-for-the-user — Standard API access needs a per-developer $11.99/mo sub, ~10-athlete cap, Extended Access by application for scale).

---

## 0. Identity in one paragraph

Scora is a native iOS app for goal-race road runners that fuses Garmin, Oura, WHOOP, and TrainingPeaks data into one calibrated readiness verdict each morning, makes falsifiable numeric predictions about the athlete's training, verifies those predictions against what actually happened, and keeps a visible accuracy record. It is a **forecaster with receipts, not an adaptive coach**. North star outcome: acquisition by Strava as the physiological readiness organ their coaching stack is missing.

---

## 1. Product thesis (core, do not dilute)

### 1.1 The category's lie

- Adaptive AI coaches (AthleteData and its imitators) sell an ever-changing plan as intelligence. An always-adapting plan is **unfalsifiable**: it never commits to anything that can be judged, so it can never be wrong, so it can never earn trust. It generates the feeling of being coached while structurally avoiding accountability. A horoscope with an API connection.
- Daily reactivity is also bad physiology. Single-day HRV is noise. Credible HRV-guided training operates on rolling ~7-day baselines and acts only when a meaningful-change threshold is crossed. A system that reacts to every overnight dip is chasing noise and trains the athlete to distrust their own resilience. Real coaches hold the line through week three of a build precisely when the metrics look ugly.
- Standing prediction: chat-first adaptive coaches face a churn wave as the novelty fades and the 12-week attribution gap ("did any of this matter?") goes unanswered. Scora is positioned as **what skeptics graduate to**.

### 1.2 The four mechanics (non-negotiable product requirements)

1. **Prediction.** Falsifiable claims with numbers attached. "Hold 6:52 for tomorrow's four at threshold." "Current trajectory: 3:04, plus or minus three minutes." Claims that can be wrong.
2. **Verification.** After every keyed session: predicted versus actual, surfaced plainly. Pace at heart rate, aerobic decoupling, perceived effort. Verification closes three loops, not one: the model against reality, the devices against reality, and the athlete's felt state against reality. The loop closes in front of the user.
3. **Calibration.** A running, user-visible accuracy record. "Scora has called your long-run pace within 2% for eight straight weeks." No horoscope keeps score; this sentence is the placebo-killer and the retention engine.
4. **Restraint.** Interventions are rare, thresholded, and explained. The default morning verdict is "hold: this is expected fatigue, here's why." The product that mostly says *nothing changed* is the one believed when it says something did. Scarcity of adjustment is the credibility feature; constant intervention is the competitor's engagement model and their fatal flaw.
   - *Evan's clarification (July 2026):* "hold" is not prescriptive and not a pivot. A bad score doesn't mean change the plan — it means *speak to it*: surface the score, ask how they feel, perform if the body's willing, ease off if it isn't. **Open design question:** the exact intervention threshold when fusing felt-state + device scores (how bad, and how much witness agreement, before the voice moves from "hold/speak to it" to flagging a change).

### 1.3 Delivery surface: the Daily Call

- One push, early morning. The push asks one question: how do you feel? One tap answers it, and the tap reveals the verdict plus today's exact session. The check-in is the unlock. Five seconds total, glanceable as a watch complication.
- **Feel before reveal is an ordering law, not a UX preference.** Showing any score or verdict before capturing felt state contaminates the self-report through anchoring and invites nocebo (sleep-score priming research shows people feel and perform according to the number they're shown). Raw device scores are demoted everywhere in the product: Scora surfaces the verdict and its reasoning, never leads with a ring or watch score.
- Beneath the push: the forecast, the receipts, one trend line. No dashboard sprawl at v1. The decision is the product.

### 1.4 Felt state is data: the third witness

- Three witnesses testify every morning: the fused devices, the model's forecast, and the athlete's felt state. Subjective self-report is not a soft input; the sport-science literature (Saw et al., 2016, BJSM systematic review) found subjective measures reflect training-load changes more sensitively and consistently than objective markers.
- **Divergence is signal, not noise.** When the witnesses split (Oura says wrecked, athlete says great), Scora does not average into mush. It arbitrates, states the disagreement explicitly, and says what it is weighting and why. Divergence mornings are the most informative data points the system collects.
- **Per-athlete witness reliability is learned.** Scora tracks which witness has been right, for this athlete, in which situations, and weights accordingly. Signature receipt: "When you and your ring disagree, your feel has been the better predictor 7 of the last 9 times." No competitor can print this sentence.
- **Interoception is trainable and Scora trains it.** Showing the athlete their felt-sense accuracy record turns body awareness into a measurable, improvable skill. This is the Diaz/flow connection made concrete: Scora is the instrument that verifies the body-awareness dialogue, not a replacement for it.
- **Feel is data, not veto.** Felt state has known failure modes: race-week adrenaline masking fatigue, stoic under-reporting, early overreaching eroding mood before awareness catches it. Ambiguous mornings resolve through the restraint doctrine: verdict holds, mismatch logged, watching.

### 1.5 Philosophy layer: flow (not messaging, model)

- Flow's structural preconditions (clear goals, immediate unambiguous feedback, challenge matched to capacity) map one-to-one onto Scora's mechanics: prediction is the clear goal, verification is the immediate feedback, the morning verdict is challenge-capacity arbitration. Scora engineers the conditions for flow and proves it did; it never promises the state. The word "flow" stays out of category messaging (strip-mined by wellness marketing, unfalsifiable as a promise); it lives here, in the design rationale, and in secondary brand narrative at most. Internal line: Scora manages the conditions, the athlete finds the state.

### 1.6 The score

- Named, proprietary, published methodology (the Firstbeat precedent: Garmin bought the engine, not an app). The Scora score is **the thing that gets scored**: its own calibration record is simultaneously the moat, the marketing, and the acquisition asset.

### 1.7 Switzerland fusion

- The first-session demo is arbitration of device disagreement: Garmin says recovered, Oura says rest, WHOOP says strain 14. Scora rules, with reasoning. No single-source app can perform this.
- Garmin-primary depth, plus Oura, WHOOP, and TrainingPeaks. **Official APIs only. No scrapers, ever.** Scraped access is revocable overnight and is a deal-killer in acquisition diligence.

---

## 2. Market and segment

- **Core market: goal-race road runners.** 5K, 10K, half, marathon. *Evan's clarification: not road-exclusive — road is the bulk of the audience; expansion to cycling etc. comes later.* Ultra/trail is the founder's personal sport and a credible distribution channel, not the market definition (those athletes are seasoned and not app-centric).
- **Bullseye customer: the multi-device athlete**, especially WHOOP or Oura worn alongside a Garmin. Revealed preference, not hypothesis: these athletes already pay recurring software fees (WHOOP ~$199-359/yr, Oura membership) on top of premium hardware, and they live the data-fragmentation pain every morning. Pre-trained to pay for interpretation.
- **Purchase trigger:** a race on the calendar. Payment attaches to a goal, not a feature list.
- **Distribution:** race-calendar SEO and partnerships, run clubs, a referral lane for human coaches, and build-in-public through the Skeptical Practitioner platform. Not App Store browse.

---

## 3. Positioning and messaging

- **Category frame:** Runna plans your season. Scora arbitrates your morning.
- **Trust frame:** The coach that shows its receipts.
- **Neutrality frame:** Loyal to the athlete, not the platform.
- **Skeptic frame:** Built for athletes who have seen through placating AI coaches.
- **Anti-positioning (what Scora is not):** not a chat coach (AthleteData), not a dashboard archive (Baseline), not a plan generator (Runna), not single-silo insights (Garmin Connect+).
- **Voice:** calm, precise, accountable. States uncertainty with error bars. Never cheerleads, never placates. Says "hold" most mornings and means it.

---

## 4. Business model

> *Evan's standing note (July 2026): the free tier is kept for now and is adaptable; the "paid-only" stance below is retained as analysis, not a locked decision.*

- **Model (as-analyzed): paid-only.** The forecaster thesis collapsed the freemium logic: the verdict is the atomic unit of value, so any free version either includes the verdict (giving away the product) or withholds it (recreating Baseline: visualization without a verdict, proven purposeless).
- **Category evidence.** Runna, the exit comp, grew to ~$40M ARR on trial-then-paid with no meaningful free tier and was priced on subscriber and revenue velocity. AthleteData hit 500+ paying users in six weeks, paid-only. The one free-tier player (Baseline) is the quiet one.
- **Reversibility.** The additive-forever rule (nothing free ever moves behind a paywall, the Strava 2020 lesson) means launching paid preserves the option to add free later; launching free forecloses retreat.
- **The trial is load-bearing.** Receipts take weeks to accumulate: a 7-day trial cannot show a calibration record, and the calibration record is the sales pitch. Open design decision: 30-day full trial vs. 14 days plus a $1 first month vs. "your first training block."
- **Free artifacts, not free tiers.** A shareable Race Readiness card timed to major race weeks; the published methodology white paper. Artifacts advertise; tiers cost.
- **Pricing:** $19-24/mo or ~$180/yr at launch. **Never undercut AthleteData's $39.** Beta validation at $8-12/mo or $99/yr is fine as a founding rate that grandfathers.
- **Durable-value test for every feature:** it must be state, methodology, cohort, or native delivery. Raw data access and LLM reasoning are commoditizing to free; anything built on them alone is rented land.

---

## 5. Exit thesis (north star)

- **Primary: Strava.** Their acquisition pattern is organ collection: Recover Athletics (injury, 2022), FatMap (maps, 2023), Runna (run training, 2025, est. $100M+ on ~$40M ARR with only £8M raised), The Breakaway (cycling, 2025). The missing organ is physiological readiness: no HRV, no sleep, no recovery signal, and the owners of those signals are Strava's rivals. Their ban on third-party AI over the Strava API forces buy-over-build. Critically, **Strava buying Runna locked the readiness gap open**: the device OEMs now treat Runna as Strava and will not share, so Runna can reshuffle the calendar forever but increasingly cannot know the body.
- **Secondary bidder: Oura** (actively acquisitive, wellness-first, missing the athletic performance story). **Tertiary: Garmin** via the Firstbeat precedent (buys methodology and engines, not interfaces). **Dark horse:** assistant platforms wanting a canonical athlete-state endpoint.
- **MCP both directions:** Scora consumes official APIs and ships as an MCP server exposing interpreted athlete state to AI assistants. When assistants are the interface, be the source of truth they query.
- **Financing:** small targeted raise, not bootstrapping purity and not venture scale. Sized so a $30-50M exit is life-changing for the founder; timed to an 18-36 month consolidation window; spent almost entirely on shipping velocity.
- **Discipline:** every buyer-shaped choice must pass the standalone test. Acquirers pay premiums for companies that do not need them.

---

## 6. Competitive map (kill notes)

- **AthleteData ($39/mo, raised from $25):** chat coach, placating adaptive plan, no native app, no calibration record. Churn candidate. Its price umbrella is a gift.
- **Baseline ($0/$12/mo/$249 lifetime):** beautiful archive with no verdict. Living proof that visualization without interpretation reads as purposeless.
- **Runna (Strava):** plans the season, blind to the morning. The acquisition made OEM physiological data structurally unreachable for it.
- **Garmin Connect+ ($6.99/mo):** single-silo, weak AI reputation, but could ship a Daily Call clone any quarter. This is why single-source strategies die and why fusion plus a calibration record is the answer.
- **OEM coaches (WHOOP, Oura, Apple):** single-silo by structure. None can arbitrate its rivals' data. Switzerland stays open.

---

## 7. Execution guardrails, current

- iOS-native only. Brutal scope: the Daily Call loop (fuse, predict, verify, calibrate) end to end before anything else exists.
- File Garmin and Oura partner-program applications this quarter: official data access now, deal origination later. (Strava: Standard API needs a per-developer sub + ~10-athlete cap; apply for Extended Access before scaling.)
- Name the score. Publish the methodology as a white paper.
- Cohort benchmark schema in the first commit.
- Open small-raise conversations.
- Companion documents: `scora-business-model-lenses.html` (four-lens business model analysis); `scora-flow-doctrine.md` (Training Canon & Doctrine — two-wing canon blending flow/perception philosophy with proven structural methodology).

---

*Changelog. Rev 5 (July 2026): felt state promoted to first-class input (the third witness): feel-before-reveal ordering law, divergence-as-signal arbitration, per-athlete witness reliability weighting, interoception calibration record; flow added as philosophy layer; verification expanded to three loops. Rev 4: removed the free tier following the forecaster-thesis collapse of freemium (later softened by Evan to "keep for now, adaptable"); trial length promoted to central monetization question. Rev 3: integrated the calibrated-forecaster product thesis (four mechanics, Daily Call, restraint doctrine); corrected segment to goal-race road runners with multi-device bullseye; consolidated exit thesis, business model, and positioning into the single canonical context file.*
