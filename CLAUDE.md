# Rinkd — Claude Code Context

Read this before touching anything. These rules apply to every task, every file, every PR.

---

## What Rinkd Is

A social and community layer built on top of hockey operations — live scoring, player stats, team feeds, game recaps. Think Instagram + ESPN had a baby that only cared about hockey. It syncs with HockeyShift and GameSheet. The consumer experience is a React PWA. Backend is Supabase (PostgreSQL + RLS + Edge Functions + Realtime).

The design system lives in `DESIGN_MANIFESTO.md`. Read it. It's the law.

---

## Enterprise Quality Standards

You are an elite staff software engineer. When building features, do not just write the happy-path code. Every component must meet enterprise-level production standards:

<enterprise_quality_standards>

### 1. State Resilience
Account for loading, empty, and error states natively in every UI component.
- Use geometric skeleton screens (matching exact layout) instead of generic spinners — see `Skeletons.js`
- Loading copy: "Getting the ice ready." / "Warming up." / "Dropping the puck." — never "Loading..."
- Empty states must be invitations, not dead ends
- Error states must tell the user exactly what to do next

### 2. Defensive UI (The Stress Test)
Use strict CSS layout boundaries. The UI must never break under real-world data.
- Long text: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on all constrained text
- Images: always `object-fit: cover` or `contain` — never unconstrained
- Flex/grid children: `min-width: 0` so they can shrink
- Reserve space with aspect ratios or skeleton dimensions — no layout shift on load
- Before shipping any component, test with: a 60-char player name, a 5-sentence description, a 14–0 score, no image, no data

### 3. Snappy Feedback
- Optimistic updates for all lightweight actions (likes, reactions, chirps) — update client immediately, reconcile with server after
- Every interactive element needs 4 explicit states: resting, hover/active, loading, success/error
- No button sits in a "disabled" state without visual indication of why

### 4. Accessibility Minimum
- All tap targets minimum 44×44px
- Color is never the only indicator of state (icons + labels too)
- `prefers-reduced-motion` disables all animations

</enterprise_quality_standards>

---

## Built for Scale — Architecture Rules

Rinkd's ceiling is not a single rink. A single large operator (Black Bear: 50 rinks, 1,000+ teams) plus 2 more at that scale = tens of thousands of concurrent users on a Saturday night. Every decision must hold at that load.

**Hard rules:**

- **No polling for real-time data.** Use Supabase Realtime subscriptions. Unsubscribe on component unmount.
- **No blocking renders.** All data fetches async. Show skeleton, load data, hydrate. Never make the user stare at a blank screen.
- **Cursor-based pagination on every list.** Never fetch all games, all chirps, all stats in one query.
- **Lazy load below the fold.** Images, comment threads, secondary stats — none of it loads until needed.
- **Edge Functions for hot paths.** Score updates, live game state — these run at the edge. Not cold-start.
- **Image optimization mandatory.** Compress and resize before serving. Raw uploads never hit the feed.
- **Cache aggressively.** Static data (team names, rosters, league config) belongs in a cache layer, not re-fetched on every render.

The Saturday Night Test: *Would this feature still feel snappy if 10,000 people were using it at the same moment?* If the answer requires an unoptimized server call — fix the architecture before writing the UI.

---

## Stack Reference

- **Frontend:** React (Create React App), inline styles, no Tailwind/CSS modules
- **Backend:** Supabase — PostgreSQL, RLS, Edge Functions (Deno), Realtime
- **Auth:** Supabase Auth
- **Payments:** Stripe
- **Hosting:** Vercel
- **Design tokens:** See `DESIGN_MANIFESTO.md` — colors, spacing, typography, motion

---

## Stupid-Proof Simple — Non-Negotiable

Every live surface must work for a volunteer scorekeeper, a teenage player, and a hockey grandparent on the first try without a tutorial. Big buttons. One primary action per screen. If the flow requires reading instructions, the flow is wrong. This extends to admin flows, scoring flows, and registration — not just the consumer feed.

---

## What NOT to Do

- Don't add a generic spinner anywhere
- Don't write happy-path-only code and call it done
- Don't fetch full lists — paginate
- Don't poll — subscribe
- Don't write a feature without its loading, empty, and error states
- Don't ship a component without stress-testing it against extreme data
- Don't use `px` for font sizes that should scale
- Don't add animations that don't communicate meaning
