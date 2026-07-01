# COLLECTION C03 — Growth & Retention

**Objective:** Improve activation, onboarding, DAU/WAU, re-engagement, and referrals
— authentically, against the pilot scorecard bars in `05_WHAT_WINNING_LOOKS_LIKE.md`
(activation ≥40% · 3+ sessions + 50% core action · retention ≥30%).

**Real surfaces & files:** `OnboardingModal.js`, `IOSInstallBanner.js`,
`InstallButton.js`, `DownloadCTA.js`, `PushPrompt.js`, `ReciprocityNudges.js`,
`ShareButton.js` + `lib/share.js`/`shareCard.js`/`recapShareV2.js`,
`lib/notifications.js`, `lib/milestones.js`, invites (`lib/invites.js`,
`AcceptTeamInvite.js`, `AcceptLeagueInvite.js`), `lib/analytics.js`.

**Prereq reality:** the Pilot Analytics instrumentation (P0, gating Oakland Jul 24)
must be live first — Game Puck votes, reactions, likes, comments, follows tracked
with per-pilot attribution. Don't design retention loops you can't measure.

**Scope:**
- **Activation:** define the single "first meaningful action" per persona (parent /
  player / commissioner / fan) and make the onboarding drive straight to it in the
  fewest taps. New-user Home must never be empty.
- **Re-engagement:** the legitimate return triggers — Game Puck result, milestone,
  recap, team announcement — as push/notification, never spam.
- **Referral / invite loops:** team/league invites and share cards as the growth
  engine; every shared object deep-links back and looks premium.
- **Instrument everything** through `lib/analytics.js` so each loop is measurable.

**Deliverable:** `audits/C03_growth.md` — the activation definition per persona, the
re-engagement trigger map, the referral loop diagram, and the events to instrument.
**Guardrail:** no dark patterns, no fake urgency, no autoplay (Never-Do).
