# SPRINT S01 — Establish the Mission & Set Up the Audit

> Prereq: paste `00_MASTER_PROMPT.md` first (or have it pinned). This is a
> THINKING/AUDIT sprint — **no code changes.** Output is a document, not a PR.

---

You are continuing the evolution of Rinkd as its Executive Product Council. Do not
redesign the product. Do not remove functionality. Your role is to refine, simplify,
and elevate every interaction until Rinkd feels like the most premium, intuitive,
and engaging hockey platform in the world.

**Before you write anything, read:** `CLAUDE.md`, `DESIGN_MANIFESTO.md`,
`src/lib/tokens.js`, `src/components/ui/index.js`, `BUILD_PRIORITY.md`, and every
file in `Fable_Elevation_Program/constitution/`.

### Task
1. In one page, restate the Rinkd mission (the Platform Layer Play), the 5 North
   Stars, and the live roadmap status — in your own words — to prove you've absorbed
   the ground truth. Flag anything in the ChatGPT-era plan that is already shipped so
   we don't repeat it.
2. Produce the **screen inventory** we will audit. The app has ~47 screens in
   `src/pages/` and ~54 routes in `src/App.js`. Group them into the surfaces that
   matter:
   - **First impression:** `Landing.js`, `Home.js` (Home Ice), `Auth.js`,
     `OnboardingModal`.
   - **Fan / social:** `Feed.js`, `Discover.js`, `Profile.js`, `Team.js`,
     `Notifications.js`, `Messages.js`, `Store.js`, `Crease.js`, `Rinkside.js`.
   - **Game day:** `GameDetail.js`, `PublicGame.js`, `ScorerView.js`,
     live/league-scorer routes, galleries, stream links.
   - **Association / ops:** `Leagues.js`, `League.js`, `LeagueManage.js`,
     `LeagueCreate.js`, `LeagueRegister.js`, `Tournaments.js`, `Tournament.js`,
     `TournamentManage.js`, `TournamentCreate.js`, `TournamentRegister.js`,
     `Teams.js`, `TeamManage.js`, registration flows.
   - **Admin / operator:** `AdminPanel.js`, `AdminAnalytics.js`, `AdminModeration.js`,
     `VolunteerCoordinator.js`, dues tracker.
3. Define the **audit rubric** we'll use in S02 for every screen. Score A+ / A / B /
   C / D. A screen earns A+ only if it: is obvious on first try (Grandparent Test);
   uses only `tokens.js` + `components/ui`; has real loading/empty/error states;
   survives the CLAUDE.md stress data (60-char name, 5-sentence text, 14–0 score, no
   image, no data); reinforces the brand; passes the Saturday Night Test; and would
   pass an Apple design review.

### Deliverable
A markdown document `Fable_Elevation_Program/audits/S01_inventory_and_rubric.md`
containing the mission restatement, the grouped screen inventory, and the rubric.
**No source changes in this sprint.**
