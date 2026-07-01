# SPRINT S07 — The Social Layer (Instagram-grade interactions)

> Prereq: master prompt + S02 audit. Goal: increase DAU, weekly retention, sharing,
> comments, follows, and authentic UGC — with hockey-specific patterns, not copies.

---

Audit every social interaction in Rinkd. Study Instagram, TikTok, Reddit, Discord,
and X for *interaction mechanics only* — then recommend **hockey-specific** patterns
that strengthen communities. Never copy a UI; never introduce addictive dark
patterns.

### Real social surfaces & files
- **Feed/posts:** `src/pages/Feed.js`, `lib/posts.js`, `lib/blocks.js`,
  `PostActionMenu.js`.
- **Reactions & likes:** `src/components/PostReactions.js`, `lib/reactions.js`
  (optimistic updates required — update client immediately, reconcile after).
- **Comments:** `src/components/CommentThread.js`, `Mentions.js`, `lib/mentions.js`.
- **Follows / identity:** follow users/players/teams; `src/pages/Profile.js`,
  `src/pages/Team.js`, `lib/teams.js`, `lib/userRole.js`.
- **Sharing:** `src/components/ShareButton.js`, `lib/share.js`, `shareCard.js`,
  `recapShareV2.js`, `ogCard.js` (one-tap native share sheet; deep links must land
  on the exact object).
- **Notifications:** `src/pages/Notifications.js`, `NotificationBell.js`,
  `lib/notifications.js`, `PushPrompt.js`.
- **Reciprocity/growth nudges (already present):** `ReciprocityNudges.js`.

### Audit each interaction for
- **Speed & feedback:** is it optimistic and instant? Does it have all four states
  (resting / active / loading / success-or-error)?
- **Discoverability:** can a new user find how to like/comment/follow/share with no
  instruction?
- **Authenticity:** does it strengthen a real hockey community, or just juice a
  metric? Cut anything that's the latter.
- **Shareability:** is the output screenshot-worthy and deep-linked?

### Hockey-specific pattern ideas to evaluate (not mandates)
- Game Puck / POTG as the native "reaction of record" for a game.
- Team/league identity as the follow graph's backbone (you follow your rink, not
  just people).
- Chirps scoped to a game/team so they feel like a bench, not a global void.
- Milestone posts as auto-generated, share-first UGC.

### Guardrails
- Youth: no public minor PII in any social surface; parents JOIN kids' teams.
- No autoplay, no fake urgency, no infinite manipulative loops. (Never-Do.)

### Deliverable
`Fable_Elevation_Program/audits/S07_social.md` — per-interaction audit + a ranked
set of hockey-specific interaction upgrades, each mapped to a real file with the
four required states specified. Ship the optimistic-update + share-polish wins.
