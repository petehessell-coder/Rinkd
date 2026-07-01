# SPRINT S05 — Association Experience (where the money is)

> Prereq: master prompt + S02 audit. The operator/commissioner surfaces are the GTM
> engine — this is high-leverage. Audit-first, then targeted friction removal.

---

Become the commissioner of the largest youth hockey organization in North America.
Walk through every association workflow in the real app and remove friction — without
adding unnecessary features. **Goal: a commissioner saves hours every week and every
task takes fewer clicks.**

### Real workflows & files to walk
- **League setup/manage:** `src/pages/LeagueCreate.js`, `src/pages/LeagueManage.js`,
  `src/pages/League.js`; staff/roles via `src/components/LeagueStaffManager.js`,
  `src/lib/leagueCommissioners.js`, `leagueManagers.js`, `leagueScorers.js`.
- **Tournament setup/manage:** `src/pages/TournamentCreate.js`,
  `src/pages/TournamentManage.js`, `src/pages/Tournament.js`; divisions via
  `DivisionPicker.js` + `lib/leagueDivisions.js` / `tournamentDivisions.js`.
- **Scheduling:** `src/components/ScheduleBuilderModal.js`,
  `lib/leagueScheduleGenerator.js`, `lib/leaguePlayoffGenerator.js`,
  `lib/scheduleBuilder.js`. (Winning bar: publish a season schedule in minutes.)
- **Rosters:** `src/components/RosterUpload.js`, `lib/roster.js`,
  `lib/tournamentRoster.js`.
- **Registration & payments:** `src/pages/LeagueRegister.js`,
  `TournamentRegister.js`, `lib/registrations.js`, `lib/stripeConnect.js`.
  (Remember: USAH#, payment plans, waivers are deferred until an operator needs them
  — Decision Log. Don't build them speculatively; DO make what exists effortless.)
- **Game management & scorekeeping:** `src/pages/ScorerView.js` +
  league-scorer routes, `EditGameModal.js`, `Scoresheet.js`, `lib/gameday.js`.
- **Communication:** league/tournament feeds, announcements, `SponsorsManager.js`.
- **Standings & stats:** `lib/standings.js`, `lib/stats.js`, `StatLeaderboards.js`.

### For each workflow
Identify every point of friction (extra taps, ambiguous labels, missing bulk
actions, no undo, unclear states, re-entry of data the system already knows). Then:
- Recommend the smallest change that removes the friction.
- Confirm loading/empty/error states exist (a commissioner mid-task must never hit a
  dead spinner).
- Confirm it scales (bulk roster upload, large schedules, many teams) — no full-list
  fetch, cursor-paginate.

### Special attention
- **Scorekeeping at the table:** the winning bar is *record a goal in under 5
  seconds, one-handed.* Audit `ScorerView.js` against that literally — count the
  taps, check tap-target size, check mis-tap recovery.
- **The operator first-impression:** does `LeagueManage`/`TournamentManage` feel
  premium enough to demo to an FWHL / Black Bear / GameSheet operator?

### Deliverable
`Fable_Elevation_Program/audits/S05_association.md` (friction map + prioritized
fixes) and, for the clear wins, a scoped PR. Log any workflow change.
