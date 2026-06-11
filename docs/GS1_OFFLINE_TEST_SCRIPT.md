# GS-1 Offline Mode — Real-Device Test Script

**Status:** REQUIRED before merge (verification gate per `OFFLINE_MODE_GS1_FABLE_BRIEF.md` §5).
**Run on:** a real phone AND a real iPad — not desktop devtools. Sync races and
partition edge cases only show up on real radios. Desktop devtools offline mode is fine
for a first smoke pass, but every test below must go green on hardware before merge.

## Setup (once)

1. Deploy the `sync-scorekeeper-queue` edge function (it is NOT deployed automatically with this branch).
2. Use a **test tournament** (activated) with two teams and an assigned scorekeeper account. Never run this against a real event.
3. Two devices for the dual-scorer test (Test 3): scorekeeper on device A, director on device B.
4. Airplane mode is the network kill switch. On iPhone/iPad also toggle WiFi off inside Control Center (airplane mode alone can leave WiFi up).
5. Open the browser console / Eruda where possible; otherwise verify via the DB after each test:
   ```sql
   select id, team_id, period, time_in_period, created_at from game_goals where game_id = '<GAME>' order by created_at;
   select home_score, away_score, period, status from games where id = '<GAME>';
   ```

## Test 1 — Core loop: score offline → reconnect → zero lost, zero doubled, correct order

1. Open ScorerView online. Confirm no banner.
2. Kill the network. **Expect:** amber "Offline" banner within ~2s.
3. Log, in this order: goal HOME #17 → goal AWAY #9 → penalty HOME #4 (Hooking) → goal HOME #17 → delete the AWAY goal → shots HOME +5 → period → 2.
4. **Expect:** every action lands instantly in the UI; banner counter climbs ("N writes pending"); score reads 2–0.
5. Restore the network. **Expect:** "Syncing…" then green "Synced" banner within ~10s, counter to 0.
6. Verify in DB: exactly 2 home goals, 0 away goals (inserted then deleted, or never inserted — either is correct), 1 penalty, shots row count = 5, game row 2–0 / period 2 / status live. `created_at` of the goals reflects entry order.
7. **FAIL if:** any goal doubled, the deleted goal survives, order in the log is scrambled, or the score ≠ 2–0.

## Test 2 — App killed mid-game: queue survives process death

1. Online, open ScorerView. Kill network. Log 2 goals + 1 penalty (counter = pending ≥ 3).
2. Kill the tab/app completely (swipe away from the app switcher).
3. Still offline, reopen the app and navigate to the same game. **Expect:** ScorerView boots from device cache (amber banner notes "running from device cache"), goal log shows both goals + penalty, counter still shows pending writes.
4. Restore network with the app OPEN. **Expect:** drain + green Synced; DB matches.
5. Repeat steps 1–2, then restore network with the app CLOSED, wait ~1 min, reopen. On Android/Chrome the queue may already be drained (Background Sync); on iOS it drains on open. **Expect either way:** DB correct, nothing lost or doubled.

## Test 3 — Two scorekeepers, one offline: no double-count

1. Device A (scorekeeper) and device B (director) both open the same game, online. Score 1 goal from B; confirm A sees it via realtime.
2. Kill network on A only. On A log goal HOME #17. On B log goal AWAY #9 and bump shots.
3. Restore network on A. **Expect:** A drains, then both devices converge to the same goal log (3 goals) and score derived from the goal log (2–1).
4. **FAIL if:** any goal appears twice, or A's reconnect overwrote B's goal/score, or the displayed score disagrees between devices after both refresh.

## Test 4 — Finalize gating

1. Offline with pending writes. **Expect:** Finalize button disabled, label "📡 Offline — Finalize locked until synced". Tapping the period selector's "Final" shows the explanatory error, game does NOT finalize.
2. Reconnect, wait for green Synced. **Expect:** Finalize re-enables and works; recap post + push fire once; standings update once.
3. Reopen (director) while offline → **Expect:** refused with "Reconnect and finish syncing…".

## Test 5 — Retry / max-attempts / error banner

Simulate a server-side failure (easiest: temporarily rename the deployed edge function, or revoke the scorekeeper's role on the game between enqueue and drain to force `rejected`).
1. Queue 2 writes offline, restore network.
2. `rejected` path: **Expect:** the writes dead-letter immediately — red banner "N writes failed to sync" + Retry button. They do NOT retry forever.
3. Transient-failure path (function unreachable): **Expect:** queue stays pending; after 5 failed drain attempts the rows dead-letter into the red banner.
4. Fix the server side, tap **Retry Sync**. **Expect:** drain completes, green Synced, DB correct.

## Test 6 — Offline open + cache TTL

1. Open the game online (cache warms). Go offline. Force-reload the page (or reopen the PWA). **Expect:** scorer boots from cache, fully usable, queue-only mode.
2. Sign out, sign in as a DIFFERENT user (online), then go offline and open the same game URL. **Expect:** cached scorer is REFUSED (different account) — "couldn't load" screen, not someone else's scorer.
3. TTL: set device clock forward 25h (or edit `savedAt` in IndexedDB devtools) while offline. Reopen. **Expect:** cache treated as expired → "couldn't load" screen, NOT a stale scorer.
4. Finalize a game online. Confirm the game's cache entry is gone (devtools → IndexedDB → `rinkd-offline` → `gameCache`).

## Test 7 — Regression: PWA + push unaffected

1. With the new SW active: app installs/updates normally, "tap to reload" update banner still appears on deploy, push notifications still arrive and click through.
2. Hard-check: no SW errors in `chrome://serviceworker-internals` / Safari Web Inspector after a full session.

## Sign-off checklist

- [ ] Test 1 green on iPhone (Safari PWA)
- [ ] Test 1 green on iPad
- [ ] Test 1 green on Android/Chrome
- [ ] Tests 2–7 green on at least one real device each
- [ ] Adversarial review pass on sync correctness + edge-fn auth (see PR)
- [ ] `npm run build` green, app boots, existing push/PWA unaffected
