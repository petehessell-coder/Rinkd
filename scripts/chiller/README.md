# ChillerStats Scraper

Pulls every team + schedule from chillerstats.com (Columbus, OH adult hockey
league platform) into Rinkd as "ghost teams" — pre-populated team records
that a new Rinkd user can claim when they sign up.

**Why this exists:** when Buckeye_Randy's captain looks at rinkd.app, his
team should already be there with schedule. Zero setup. Pure WOW moment.

---

## How it works

Three sequential scripts. Each writes a JSON artifact the next reads.

| Step | Script | Reads | Writes |
|---|---|---|---|
| 1 | `discover.js` | `data/seed-leagues.json` | `data/teams.json` |
| 2 | `scrape.js` | `data/teams.json` | `data/schedules.json` |
| 3 | `load.js` | `data/schedules.json` | Supabase (`teams`, `team_games`) |

All HTML responses are cached in `data/cache/` — safe to re-run any step.

---

## Run it

```bash
# Step 1 — discover team IDs from known leagues
cd ~/Downloads/rinkd_live
node scripts/chiller/discover.js

# Output: data/teams.json with [{ teamId, teamName, leagueId, ... }]
```

Inspect `data/teams.json` and `data/seed-leagues.json`. If `teams.json`
looks thin (e.g. only 8 teams), open chillerstats.com in a browser, find
more LeagueID values in dashboard URLs, and add them to
`data/seed-leagues.json`. Re-run.

```bash
# Step 2 — scrape each team's schedule
node scripts/chiller/scrape.js
```

Inspect `data/schedules.json`. Each team should have a `games` array. If
games are missing or look wrong, open `data/cache/<url>.html` to see the
raw HTML and adjust the regexes in `scrape.js`.

```bash
# Step 3 — load into Supabase (REQUIRES service role key)
SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/chiller/load.js
```

Grab the service role key from:
**Supabase dashboard → Settings → API → service_role**

Then verify in SQL:
```sql
SELECT name, division, source FROM teams
WHERE source='external:chillerstats'
ORDER BY name LIMIT 20;
```

---

## Politeness

- 600ms sleep between requests
- HTML cached locally (re-runs = zero network)
- User-Agent identifies Rinkd by name with contact email
- No login, no cookies, public pages only
- Re-runnable: unique index on `(source, external_id)` makes upserts idempotent

---

## When to re-run

- **Weekly** during the season to pull in score updates and new game weeks
- After **discovering new LeagueIDs** (add to `seed-leagues.json`, re-run)
- After **changes to ChillerStats HTML** (clear `data/cache/`, re-run scrape)

---

## Known limitations

1. **LeagueID seed list is manual today.** Add new LeagueIDs to
   `seed-leagues.json` as you find them in chillerstats.com URLs. Once we
   know the URL pattern of the platform's master league index, we can
   auto-discover them.

2. **Opponent names are free text.** Two teams can have the same name
   across leagues. The dedup happens on `external_id` (the GUID), not
   the name, so this is safe — but the `team_games.opponent` field stores
   the display name and may need cleanup later.

3. **Score parsing is heuristic.** ChillerStats column order varies by
   season. If a game shows up with `homeScore: null` but the team played
   it, open the cached HTML and inspect the table format.

4. **All teams are tagged location='Columbus, OH'** for the MVP. When
   we extend to other markets, source can branch (`external:chillerstats-dayton`
   etc.) or location can be parsed from rink data.

---

## Architecture rationale

- **Local Node script, not a Supabase Edge Function.** Edge Functions have
  a 50-second timeout; a full league sweep can take 5-10 minutes. Once the
  scraper is stable, we can move to a daily cron via GitHub Actions or a
  long-running Edge Function with chunked work.

- **Zero dependencies.** Native `fetch` (Node 18+), no cheerio or axios.
  Easy to maintain and audit. Regex parsing is brittle but transparent.

- **Cache everything.** Re-runs cost zero requests. Iteration is fast.

- **Unique index on (source, external_id)** does dedup automatically. No
  application-layer state machine needed.
