# COLLECTION C04 — Association Operations (deep dive)

**Objective:** Make commissioner, registrar, and tournament-director work effortless
and premium. Extends S05 into the full operational depth. Operators are how Rinkd
scales — this surface must be demo-ready for FWHL / Black Bear / a GameSheet operator.

**Real surfaces & files:** `LeagueManage.js`, `TournamentManage.js`, `LeagueCreate.js`,
`TournamentCreate.js`, `League.js`, `Tournament.js`; staff/roles
(`LeagueStaffManager.js`, `lib/leagueCommissioners.js`, `leagueManagers.js`,
`leagueScorers.js`, `tournamentDirectors.js`, `tournamentScorers.js`); scheduling
(`ScheduleBuilderModal.js`, `lib/leagueScheduleGenerator.js`, `leaguePlayoffGenerator.js`);
divisions (`DivisionPicker.js`, `lib/leagueDivisions.js`, `tournamentDivisions.js`);
rosters (`RosterUpload.js`, `lib/roster.js`, `tournamentRoster.js`); volunteers
(`VolunteerCoordinator.js`, `TeamVolunteer.js`, `lib/volunteers.js`); dues
(`/dues-tracker`); sponsors (`SponsorsManager.js`); registration
(`lib/registrations.js`, `stripeConnect.js`, `subPools.js`).

**Scope:**
- Time-audit each core task (create league, build schedule, import roster, approve
  registrations, assign scorers, publish standings). Target: **hours → minutes.**
- Bulk actions, sane defaults, no re-entry of known data, clear multi-step progress,
  undo on destructive actions.
- Operator "first impression": is the manage view premium enough to demo cold?
- Respect the Decision Log: USAH#/payment-plans/waivers/registry-export remain
  deferred until an operator needs them — polish what exists; don't build ahead.

**Deliverable:** `audits/C04_association_ops.md` — per-task time audit + friction
fixes + a "demo-readiness" grade for the manage surfaces. Ship the clear wins.
