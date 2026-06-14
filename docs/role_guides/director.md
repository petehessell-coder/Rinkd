# Rinkd Director Guide

**As a director, you run the whole tournament on Rinkd — from creating it and building the schedule, all the way through generating the championship bracket and closing it out at the end of the day.**

This is the longest guide because you touch every part of the system. Read through it once before your first tournament. On game day itself, jump to the **Day-of checklists** section.

---

## Part 1 — Build your tournament from scratch

### Step 1: Create the tournament

1. Sign in to Rinkd at **rinkd.app**.
2. Tap **Tournaments** in the bottom navigation.
3. Tap **+ Create** in the top-right corner.
4. You'll see a 4-step wizard. Step 1 asks for the basics.

Fill in:
- **Tournament Name** — e.g., "BLPA Cleveland Bash 2026"
- **Division** — e.g., "Adult Rec" or "12U AAA"
- **Start Date** and **End Date**
- **Venue / Facility** — the name of the rink
- **Address** — the street address of the facility

5. Tap **Next — Format & Rules →**

[screenshot: tournament create form — Step 1 Basics]

---

### Step 2: Pick your format

Step 2 sets the rules of the tournament — period lengths, points, tiebreakers, and more.

1. If you are running a BLPA Bash tournament, tap the **BLPA Bash** preset button. It fills in all the right settings automatically (3×12 minute stop-time periods, 6-goal mercy rule, 1 team advances per pool, BLPA tiebreaker order).
2. If you're using a different format, fill in the fields manually:
   - **Period length** — how many minutes per period
   - **Number of periods** — usually 3
   - **Points for a win / tie / loss** — usually 2 / 1 / 0
   - **Max goal differential (mercy rule)** — e.g., 6
   - **Shootout in pool play** — on or off
   - **Shootout in bracket play** — on or off (BLPA Bash uses shootout in bracket play)
   - **Teams that advance per pool** — usually 1 or 2
3. Tap **Next — Teams →**

[screenshot: Format & Rules step with BLPA Bash preset button]

---

### Step 3: Add your teams

1. In the **Team Name** field, type your first team name.
2. In the **Pool** field, type the pool letter — e.g., **Pool A** or **Pool B**.
3. Tap **Add Team**.
4. Repeat for each team.

> **Using placeholder names?** That's fine. You can type "A1," "A2," "B1," "B2," etc. and replace them with real team names later (see "Replace placeholder team names" below).

5. When all your teams are added, tap **Next — Scorers →**

[screenshot: Add Teams step with team name and pool fields]

---

### Step 4: Add scorers (and other directors)

1. In the **Add Scorer** field, type the @handle or email address of each person who will be running live scores at the event.
2. Tap **Add**.
3. Repeat for each scorer.
4. To add another director (someone who will have full management access — not just scoring), look for the **Add Director** section on the same screen and follow the same process.
5. Tap **Create Tournament**.

Your tournament is created. Its status starts as **Draft** — it is not publicly visible yet.

[screenshot: Add Scorers step with handle/email input]

---

### Step 5: Upload a tournament logo

1. From the tournament management screen, tap the **Settings** tab.
2. Scroll down to **Branding**.
3. Tap **Upload Logo**.
4. Choose a photo from your camera roll. Keep it under 5 MB.
5. Tap **Save Settings**.

The logo appears on the public tournament page and in recap posts.

[screenshot: Settings tab → Branding with logo upload button]

---

### Step 6: Generate the pool schedule

1. From the tournament management screen, tap the **Schedule** tab.
2. Tap **⚡ Generate Pool Schedule**.
3. A dialog opens. Fill in:
   - **Game length (minutes)** — how long each game slot is, including ice change time
   - **Start time** — the time of the first game
   - **Gap between games for the same team (hours)** — how long a team must rest between games
4. Tap **Generate**.

Rinkd builds a round-robin schedule for each pool and creates all the games.

> **Want to edit a game?** Tap any game in the Schedule tab to change its time, rink, or teams.

> **Want to build the schedule manually instead?** Tap **Add Game** in the Schedule tab and fill in the details one game at a time.

[screenshot: Generate Pool Schedule dialog]

---

### Step 7: Replace placeholder team names

If you used placeholders (A1, A2, etc.) and now have real team names:

1. Tap the **Teams** tab in the tournament management screen.
2. Find the placeholder team.
3. Tap the **pencil** (edit) icon next to its name.
4. Type the real team name.
5. Tap **Save**.

Standings, brackets, and recap posts all use the real name from this point forward. Renaming is safe at any time — even mid-tournament.

[screenshot: Teams tab with edit icon next to each team]

---

### Step 8: Go live — flip the tournament from Draft to Active

When you're ready for the public to see your tournament:

1. Tap the **Settings** tab in the tournament management screen.
2. Tap the **Status** dropdown.
3. Select **Active**.
4. Tap **Save Settings**.

The tournament is now publicly visible. Anyone can find it by going to **rinkd.app/tournaments**. You can share the direct link (see "Send the public URL to captains" below).

> **Need to hide it again?** Change the status back to **Draft** at any time.

[screenshot: Settings tab with Status dropdown showing Active]

---

## Part 2 — Day-of operations

### Morning checklist (before games start)

- Confirm status is **Active**.
- Confirm all team names are correct (not still "A1," "A2," etc.).
- Make sure each scorer has signed in to Rinkd and can open the Scorer View for their first game.
- Have a backup paper scoresheet at each rink in case of wifi issues.

---

### During pool play — monitoring the tournament

1. Tap **Tournaments** and open your tournament.
2. Tap the **Standings** tab to see the live rankings as scorers finalize games.
3. Tap the **Feed** tab to see game recaps as they post automatically.
4. Tap the **Schedule** tab to track which games are done and which are upcoming.

Standings update the moment a scorer finalizes a game. You do not need to do anything.

[screenshot: Standings tab updating in real time]

---

### If a scorer made a mistake on a finalized game

Only a director can reopen a finalized game.

1. Tap the **Schedule** tab and find the game.
2. Tap **Open Scorer View**.
3. You'll see a **🔓 Reopen Game** button at the top (scorers do not see this button — only directors do).
4. Tap **Reopen Game** and confirm.
5. Tell the scorer the game is open. They can now fix the goal log or score.
6. The scorer taps **Finalize** again when the corrections are done. Standings update automatically.

[screenshot: finalized game in Scorer View with Reopen Game button]

---

### After pool play — generate the championship bracket

Once all pool games are complete and standings are final:

1. Open the tournament management screen.
2. Tap the **Bracket** tab.
3. Tap **🏆 Generate Bracket**.
4. A dialog opens. Fill in:
   - **First game start time** — when the first semifinal begins on Sunday
   - **Game length (minutes)** — how long each championship game slot is
   - **Rink** — which sheet the bracket games will be played on
5. Tap **Generate**.

Rinkd creates the championship games automatically — two semifinals per pool (seed 2 vs seed 3 and seed 1 vs seed 4), plus a bronze game and a gold game with placeholder teams (TBD). As each semifinal finalizes, the bracket fills in the correct teams for the gold and bronze games automatically.

[screenshot: Bracket tab with Generate Bracket button and dialog]

---

### During the championship — what happens automatically

- When a semifinal finalizes, the bracket auto-fills: the winner advances to the gold game, the loser goes to the bronze game.
- For any bracket game that ends in a tie, the scorer will see a **Shootout Winner** prompt before they can finalize. They pick the winning team. The bracket resolves correctly from there.
- After the gold-medal game finalizes, a **Champion** banner appears on the Bracket tab.

You don't have to do anything for any of this — just make sure your scorers know about the Shootout Winner prompt (see the Scorer Guide).

[screenshot: Bracket tab with Champion banner after gold game finalizes]

---

### End of tournament — flip to Complete

When the last game of the day is done and the champion is crowned:

1. Tap the **Settings** tab in the tournament management screen.
2. Tap the **Status** dropdown.
3. Select **Complete**.
4. Tap **Save Settings**.

The tournament stays publicly visible, but it is now marked as finished. Standings and bracket are locked in for the record.

[screenshot: Settings tab with Status set to Complete]

---

## Part 3 — Standalone how-tos

### Send the public tournament URL to captains

1. Open your tournament.
2. Copy the URL from your browser's address bar — it looks like `rinkd.app/tournament/[tournament-id]`.
3. Paste it into your group chat, email, or wherever you communicate with captains.

Captains can open that link without a Rinkd account and see the tournament info. They'll need to sign up to view live standings and follow for push notifications.

---

### Add a scorer after the tournament is already created

1. Open the tournament management screen.
2. Tap the **Scorers** tab.
3. Type the scorer's @handle or email in the **Add Scorer** field.
4. Tap **Add**.

They now have scorer access immediately.

---

### Add an additional director after the tournament is already created

1. Open the tournament management screen.
2. Tap the **Scorers** tab.
3. Scroll down to the **Directors** section.
4. Type the person's @handle or email in the **Add Director** field.
5. Tap **Add**.

They now have full management access — same as you. They can reopen games, generate brackets, edit settings, and everything else in this guide.

[screenshot: Scorers tab showing both Scorers section and Directors section]

---

## Tournament lifecycle at a glance

| Stage | Status | What you do |
|---|---|---|
| Building | Draft | Create tournament, add teams, generate schedule, add scorers |
| Event is public | Active | Share the URL, scorers run live scoring |
| Pool play done | Active | Click Generate Bracket on the Bracket tab |
| Championship done | Complete | Flip status to Complete |

---

## Quick reference

| What to do | Where to find it |
|---|---|
| Create a tournament | Tournaments → + Create |
| Upload a logo | Manage Tournament → Settings → Branding |
| Edit team names | Manage Tournament → Teams → pencil icon |
| Generate pool schedule | Manage Tournament → Schedule → ⚡ Generate |
| Add a scorer | Manage Tournament → Scorers tab → Add Scorer |
| Add a director | Manage Tournament → Scorers tab → Directors section → Add Director |
| Make tournament public | Manage Tournament → Settings → Status → Active |
| Reopen a finalized game | Manage Tournament → Schedule → tap game → 🔓 Reopen Game |
| Generate championship bracket | Manage Tournament → Bracket → 🏆 Generate Bracket |
| Close out the tournament | Manage Tournament → Settings → Status → Complete |
