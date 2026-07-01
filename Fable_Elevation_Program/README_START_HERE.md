# Rinkd Elevation Program — START HERE

This folder turns your coding agent (Fable 5) into **Rinkd's permanent Executive
Product Council** — not a one-off code generator. It takes Rinkd from "polished
generic app" to "the most premium, engaging hockey platform in the world," **without
rebuilding anything.** Every prompt cites your real screens, files, and tokens.

## What's in here
```
Fable_Elevation_Program/
├── README_START_HERE.md          ← you are here (the execution guide)
├── 00_MASTER_PROMPT.md           ← paste at the top of EVERY session
├── constitution/                 ← the permanent "knowledge base" (upload once)
│   ├── 01_VISION.md
│   ├── 02_PRODUCT_PRINCIPLES.md  (points at DESIGN_MANIFESTO.md + CLAUDE.md)
│   ├── 03_DECISION_LOG.md        (real decisions already made — honor them)
│   ├── 04_NEVER_DO.md
│   └── 05_WHAT_WINNING_LOOKS_LIKE.md
├── sprints/                      ← the 10 core elevation prompts, run in order
│   ├── S01_mission_and_audit_setup.md
│   ├── S02_full_screen_audit.md
│   ├── S03_first_impression.md
│   ├── S04_navigation.md
│   ├── S05_association_experience.md
│   ├── S06_fan_obsession.md
│   ├── S07_social_instagram.md
│   ├── S08_espn_live_game.md
│   ├── S09_micro_interactions.md
│   └── S10_enterprise_polish.md
├── collections/                  ← 12 deeper sprint briefs (run as needed)
│   ├── C01_design_system.md            C07_information_architecture.md
│   ├── C02_motion_language.md          C08_performance_engineering.md
│   ├── C03_growth_retention.md         C09_accessibility.md
│   ├── C04_association_operations.md   C10_visual_design_system.md
│   ├── C05_social_network_effects.md   C11_executive_product_review.md
│   └── C06_game_day_experience.md      C12_operator_front_door.md
└── audits/                       ← Fable writes its audit outputs here (empty for now)
```

## The golden rule
**Elevate, never rebuild.** Everything already works. Fable's job is to make every
screen feel like Apple designed it, ESPN produced it, and Instagram optimized the
engagement — using only the design system and architecture that already exist.

---

## HOW TO EXECUTE — step by step (simple)

### Step 1 — One-time setup (do this once, ~10 min)
1. Open your project in Fable 5, pointed at the `rinkd_live` repo.
2. Make sure Fable can see these files (they're already in the repo): `CLAUDE.md`,
   `DESIGN_MANIFESTO.md`, `BUILD_PRIORITY.md`, `src/lib/tokens.js`,
   `src/components/ui/`, and this whole `Fable_Elevation_Program/` folder.
3. Read `00_MASTER_PROMPT.md` once yourself so you know the rules you're holding
   Fable to.

### Step 2 — Wait for the pilot-gating work first (sequencing)
This elevation program runs **after** the P0 pilot work in `BUILD_PRIORITY.md`
(Pilot Analytics before Oakland Jul 24, youth-PII leaderboard fix before Little
Caesars). Don't start S03+ code changes until those ship — they protect your pilot
and investor commitments. You CAN run the audit-only sprints (S01, S02) anytime,
because they change no code.

### Step 3 — Run a sprint (repeat for each)
For **every** sprint, do exactly this:
1. **Start a fresh chat** in the Fable project (keeps context clean).
2. **Paste `00_MASTER_PROMPT.md`** at the top.
3. **Paste the sprint file** below it (e.g. `sprints/S01_...md`).
4. Let Fable work. It will read the ground-truth files, then produce an **audit doc**
   (into `audits/`) and, for the build sprints, a **scoped PR**.
5. **Review the audit doc first.** If you agree, tell Fable "proceed with the ranked
   wins." If not, push back — the council is supposed to argue with you.

### Step 4 — Run them in this order
- **First (no code, do now):** S01 → S02. These produce the map (screen inventory +
  A+→D audit + ranked worklist) the whole program executes against.
- **Then, after pilot-gating ships, the polish arc:** S03 (first impression) → S04
  (navigation) → S05 (association) → S06 (fan) → S07 (social) → S08 (live game) →
  S09 (micro-interactions) → S10 (enterprise polish).
- **Then deeper, as needed:** the C-collections. Highest leverage for your stage:
  **C01 (design-system adoption)** and **C12 (operator front door)** first — both are
  confirmed-open, high-visibility, and directly tied to closing operator deals. Then
  C08 (performance) and C06 (game day). The rest as capacity allows.

### Step 5 — Keep the constitution alive (important)
Whenever a real decision is made, tell Fable to **append it to
`03_DECISION_LOG.md`** with the date and reason. That's what stops the council from
proposing contradictory ideas three sprints later. Same for the Never-Do list.

---

## One-line summary
Paste the master prompt, then a sprint, in a fresh chat — audit first, then ship the
ranked wins — starting after your pilot-gating work lands. That's the whole loop.
