# S07 — Social Layer: Per-Interaction Audit + Ranked Upgrades

*July 2, 2026. Three parallel audits (feed mechanics · follows/identity/notifications
· sharing/deep links). Headline: the engineering discipline is Instagram-grade
where it exists (race-safe optimistic likes, honest ShareButton states, airtight
youth suppression on every composer, no dark patterns found anywhere) — the gaps
are FEEDBACK PHYSICS on the primary action, one strategic hole in the follow
graph, and share reach that stops one wire short of surfaces that already have
composers built.*

## The three headline findings
1. **The manifesto's most-specified interaction is unimplemented.** Like physics
   ("scale 1.0→1.3→1.0, 300ms, color fills during bounce, count slides up") exist
   nowhere — ironically the *secondary* emoji reaction bounces while the primary
   Like just swaps color. And likes/comments/reactions all fail SILENTLY
   (console-only rollback).
2. **Team follow doesn't exist.** A grandparent who wants their grandkid's team
   has exactly one option: request to JOIN THE ROSTER. Leagues and tournaments
   have follow; the most-shared object doesn't. The `team_followed` analytics
   event (pilot scorecard!) has been reserved-but-unwired since Pilot Analytics.
3. **The Profile season stat card begs to be shared** — the code comment literally
   says "screenshot it" — and `composeStatCard` already exists; it's just not
   wired. Same class: stat-card deep links land on the event page instead of the
   Stats tab (S04's ?tab= makes the fix one line).

## Bundle F — feedback physics + honest failures (Feed.js, PostReactions, CommentThread)
| # | Fix | States |
|---|---|---|
| F1 | Like gets manifesto bounce (1.0→1.3→1.0, 300ms, color fills during) + count translateY slide; reduced-motion gated | resting grey · active red-filled · success bounce+slide · error → F2 |
| F2 | Failure toasts on like/comment/reaction rollbacks ("That didn't send — try again.") — ToastProvider already mounted | closes 3 silent dead-ends |
| F3 | Reaction picker discoverability: "React" micro-label beside the bare ＋ when no reactions exist | Grandparent Test |
| F4 | Comment-thread empty state: "Be the first to chirp back 🏒" | invitation, not void |
| F5 | Post-create goes optimistic (prepend own chirp from the createPost row; reconcile after) — the ONE non-optimistic interaction is the author's own post | resting · posting (composer disabled) · success (card appears instantly) · error (restore text + toast) |

## Bundle G — follow graph + identity
| # | Fix |
|---|---|
| G1 | **Team spectator follow** — `team_subscriptions` table + RLS mirroring `league_subscriptions`, lib, Follow pill on Team.js (hidden for members/managers; renders only where the team itself is visible — youth stays RLS-shielded); wires the reserved `team_followed` event. **Decision D-S07-1: this is the sprint's one schema change.** |
| G2 | "My Teams" chips on Profile (getUserTeams exists, never called) — youth teams render on the OWNER's profile only |
| G3 | Notification actor-name clamp (60-char stress fail) |
| G4 | Follow buttons' loading state: bare '...' → disabled + opacity dip (Profile/League/Tournament) |
| G5 | ReciprocityNudges lands on /notifications?filter=unread (+ Notifications honors ?filter=) — keeps the nudge's promise honest. Verdict on the nudge itself: KEEP (authentic reciprocity, self-hides at zero) |

## Bundle H — share polish
| # | Fix |
|---|---|
| H1 | Profile season stat card gets ShareButton (composer exists) — **youth suppression mandatory** (minor's own card = jersey-only), same flag path as StatLeaderboards |
| H2 | Stat-card share deep link → `?tab=stats` (S04 synergy — one line per call site) |

## DEFERRED (real, logged, own follow-ups — new server surfaces)
- Per-object OG for event pages (middleware matcher + meta branches) — without it
  H1/H2 links still unfurl generic; worth its own careful pass on middleware.
- Public `/photo/:id` route + Gallery deep-link exactness (new public surface,
  youth review needed).
- Milestone share composer ("50th career goal" is the most viral hockey artifact
  and can't leave the app) — new composer, pairs with the deferred game_final push.
- Badges tab on Profile is placeholder (points-derived, not earned) — cut or
  rebuild on real milestones in a future identity pass.

## Product question for Pete — D-S07-2
❤️ Like and 🔥 emoji reactions are two overlapping approve-gestures with no
hierarchy. Options: keep both (status quo; reactions are the hockey-native
expressive layer, like is the cheap default) or collapse to one reaction row.
**Recommendation: keep both for now, revisit with pilot engagement data** (the
pilot analytics now track both separately — let Oakland decide).

## Already great (leave alone — explicit across all three audits)
Race-safe optimistic like engine; delete Undo; mention resolution (id-based,
debounced, block-filtered); bidirectional block filtering on all 5 feed queries;
keyset pagination; ShareButton's four honest states; the entire game-recap share
path (called "the gold standard"); notification read/unread reconciliation;
PushPrompt timing; non-optimistic follow discipline (correct for follows);
youth suppression at every composer boundary; no dark patterns anywhere.
