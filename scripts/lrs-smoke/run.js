#!/usr/bin/env node
/**
 * LRS-1 Phase 1 — minor-gate + resolver smoke suite.
 *
 * Runs against a DISPOSABLE Supabase dev branch (never prod) after:
 *   1. REG Migrations A–E (feature/reg-2-family-ux) — profiles.account_type,
 *      is_minor_profile(), the team_members roster gate.
 *   2. LRS Migrations H + I (this branch).
 *
 *   SMOKE_SUPABASE_URL=https://<branch-ref>.supabase.co \
 *   SMOKE_ANON_KEY=<branch anon key> \
 *   SMOKE_SERVICE_ROLE_KEY=<branch service role key> \
 *   node scripts/lrs-smoke/run.js
 *
 * Covers (LINEUP_ROSTER_SUBS brief §5 cautions + §6 P1 verification):
 *   minor-bind gate on game_lineups (insert blocked without a consented
 *   roster anchor, allowed with one, tournament source fails closed,
 *   update-repoint blocked, editing an existing legit minor row allowed,
 *   adults unaffected), the PARTICIPATION check (a minor can't be attached
 *   to a game their team doesn't play — game_source/team_id spoofing),
 *   set_lineup atomicity (a failed replace rolls back, the saved lineup
 *   survives), GS-5 resolver (user_id copy, jersey-match of ghost rows,
 *   COLLISION stays unresolved, inactive roster rows ignored), line check
 *   constraint, player_id in all four stat RPCs (non-vacuous: real league +
 *   tournament fixtures), and the anon minor shield.
 *
 * Phase 2 (Migration J — §6 P2 verification): GS-2 suspension filing RLS
 *   (assigned scorekeeper allowed, random authed blocked, foreign team
 *   blocked, non-pending insert blocked), serve/overturn counting (decrement
 *   → served at exactly 0, no third serve, indefinite unserveable,
 *   director-only, no direct UPDATE path), CHECK invariants bind service
 *   role too, the team-level-only public flags RPC (anon sees counts, never
 *   rows/names), and GS-5 verify_game_rosters (clean verify by scorer,
 *   conflict requires a director, non-staff blocked).
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_ANON_KEY;
const SERVICE = process.env.SMOKE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Set SMOKE_SUPABASE_URL, SMOKE_ANON_KEY, SMOKE_SERVICE_ROLE_KEY (dev-branch values).');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
let failed = 0;

function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// The gate raises 42501; PostgREST surfaces it as a 403 with the message.
const isGateError = (error) =>
  !!error && /consented roster spot|42501/i.test(`${error.code} ${error.message}`);

async function makeAuthedUser(label) {
  const email = `${label}-${Date.now()}@lrs1smoke.test`;
  const password = 'Smoke-test-pass-1!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from('profiles').insert({
    id, auth_user_id: id, account_type: 'adult', email,
    name: label, handle: `${label}-${id.slice(0, 8)}`, avatar_initials: label.slice(0, 2).toUpperCase(),
  });
  if (pErr) throw new Error(`profile(${label}): ${pErr.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn(${label}): ${sErr.message}`);
  return { id, email, client };
}

// Managed minor: a profile with NO auth user (REG decouples profiles from
// auth.users — this is exactly the shape the gate exists to protect).
async function makeMinor(label) {
  const { data, error } = await admin.from('profiles')
    .insert({
      account_type: 'minor', name: label,
      handle: `${label}-${Date.now()}`, avatar_initials: label.slice(0, 2).toUpperCase(),
    })
    .select('id').single();
  if (error) throw new Error(`minor(${label}): ${error.message}`);
  return data.id;
}

(async () => {
  console.log(`LRS-1 smoke vs ${URL}\n`);

  // ── fixtures ───────────────────────────────────────────────────────────
  const manager = await makeAuthedUser('lrsmgr');
  const adultPlayer = await makeAuthedUser('lrsadult');
  const minorAnchored = await makeMinor('lrsminor-anchored');
  const minorLoose = await makeMinor('lrsminor-loose');

  // Real team + league wrapper + one league game. Service role: fixture
  // setup mirrors what consented flows produce, not the open RLS paths.
  const { data: team, error: teamErr } = await admin.from('teams')
    .insert({ name: `LRS Smoke Team ${Date.now()}`, manager_id: manager.id })
    .select('id').single();
  if (teamErr) throw new Error(`team: ${teamErr.message}`);
  const { data: oppTeam } = await admin.from('teams')
    .insert({ name: `LRS Smoke Opp ${Date.now()}`, manager_id: manager.id })
    .select('id').single();

  const { data: league, error: lgErr } = await admin.from('leagues')
    .insert({ name: `LRS Smoke League ${Date.now()}`, commissioner_id: manager.id, is_activated: true })
    .select('id').single();
  if (lgErr) throw new Error(`league: ${lgErr.message}`);
  const { data: lt } = await admin.from('league_teams')
    .insert({ league_id: league.id, team_id: team.id, team_name: 'LRS Smoke LT' })
    .select('id').single();
  const { data: ltOpp } = await admin.from('league_teams')
    .insert({ league_id: league.id, team_id: oppTeam.id, team_name: 'LRS Smoke LT Opp' })
    .select('id').single();
  const { data: game, error: gErr } = await admin.from('league_games')
    .insert({
      league_id: league.id, home_team_id: lt.id, away_team_id: ltOpp.id,
      start_time: new Date(Date.now() + 86400000).toISOString(), status: 'scheduled',
    })
    .select('id').single();
  if (gErr) throw new Error(`league_game: ${gErr.message}`);

  // Roster: manager + adult (#9), anchored minor (#17), ghost rows for the
  // resolver (#42 unique, #13 collision pair, #7 inactive). The minor bind is
  // service-role on purpose — the consented REG flow is a definer RPC that
  // bypasses the open policies, and Migration E guarantees no other path
  // can create this row.
  const tmRows = [
    { team_id: team.id, user_id: manager.id, role: 'manager', jersey_number: 2, status: 'active' },
    { team_id: team.id, user_id: adultPlayer.id, role: 'player', jersey_number: 9, status: 'active' },
    { team_id: team.id, user_id: minorAnchored, role: 'player', jersey_number: 17, status: 'active' },
  ];
  const { error: tmErr } = await admin.from('team_members').insert(tmRows);
  if (tmErr) throw new Error(`team_members: ${tmErr.message}`);

  const ghostResolved = await makeAuthedUser('lrsghost42');
  const coll1 = await makeAuthedUser('lrscoll13a');
  const coll2 = await makeAuthedUser('lrscoll13b');
  const inactive7 = await makeAuthedUser('lrsgone7');
  await admin.from('team_members').insert([
    { team_id: team.id, user_id: ghostResolved.id, role: 'player', jersey_number: 42, status: 'active' },
    { team_id: team.id, user_id: coll1.id, role: 'player', jersey_number: 13, status: 'active' },
    { team_id: team.id, user_id: coll2.id, role: 'player', jersey_number: 13, status: 'active' },
    { team_id: team.id, user_id: inactive7.id, role: 'player', jersey_number: 7, status: 'removed' },
  ]);

  const lineupRow = (over) => ({
    game_id: game.id, game_source: 'league', team_id: lt.id, is_starter: true, ...over,
  });

  // ── 1. minor-bind gate ─────────────────────────────────────────────────
  {
    const { error } = await manager.client.from('game_lineups')
      .insert(lineupRow({ user_id: minorAnchored, player_id: minorAnchored, jersey_number: 17 }));
    check('anchored minor CAN be put on the lineup', !error, error?.message);
  }
  {
    const { error } = await manager.client.from('game_lineups')
      .insert(lineupRow({ user_id: minorLoose, jersey_number: 99 }));
    check('UNanchored minor insert is BLOCKED (42501)', isGateError(error), error?.message || 'insert was allowed!');
  }
  {
    // Tournament-source rows have no backing teams.id → fail closed for minors.
    const { error } = await manager.client.from('game_lineups')
      .insert({ game_id: game.id, game_source: 'tournament', team_id: lt.id, user_id: minorAnchored, jersey_number: 17, is_starter: true });
    check('minor on a tournament-source row is BLOCKED (no backing roster)', isGateError(error), error?.message || 'insert was allowed!');
  }
  {
    // Repoint an existing row's player_id onto an unanchored minor → blocked.
    const { data: row } = await admin.from('game_lineups')
      .insert(lineupRow({ jersey_number: 55, invite_name: 'Ghost 55' })).select('id').single();
    const { error } = await manager.client.from('game_lineups')
      .update({ player_id: minorLoose }).eq('id', row.id);
    check('repointing player_id onto an unanchored minor is BLOCKED', isGateError(error), error?.message || 'update was allowed!');
  }
  {
    // Editing a legit minor row WITHOUT touching identity must keep working.
    const { error } = await manager.client.from('game_lineups')
      .update({ line: 2, jersey_number: 18 })
      .eq('game_id', game.id).eq('team_id', lt.id).eq('user_id', minorAnchored);
    check('editing line/jersey on an existing minor row still works', !error, error?.message);
  }
  {
    const { error } = await manager.client.from('game_lineups')
      .insert(lineupRow({ user_id: adultPlayer.id, player_id: adultPlayer.id, jersey_number: 9, line: 1 }));
    check('adults are unaffected by the gate', !error, error?.message);
  }
  {
    // PARTICIPATION spoof #1: minor IS anchored on teams.id, but
    // game_source='team' against a game that isn't that team's
    // (no team_games row) — must be blocked.
    const { error } = await manager.client.from('game_lineups')
      .insert({ game_id: game.id, game_source: 'team', team_id: team.id, user_id: minorAnchored, jersey_number: 88, is_starter: true });
    check('spoof: minor + team-source onto a foreign game is BLOCKED', isGateError(error), error?.message || 'insert was allowed!');
  }
  {
    // PARTICIPATION spoof #2: a league game the minor's league_team does
    // not play in.
    const { data: ltC } = await admin.from('league_teams')
      .insert({ league_id: league.id, team_id: null, team_name: 'LRS Smoke LT C' }).select('id').single();
    const { data: gameC } = await admin.from('league_games')
      .insert({
        league_id: league.id, home_team_id: ltC.id, away_team_id: ltOpp.id,
        start_time: new Date(Date.now() + 2 * 86400000).toISOString(), status: 'scheduled',
      }).select('id').single();
    const { error } = await manager.client.from('game_lineups')
      .insert({ game_id: gameC.id, game_source: 'league', team_id: lt.id, user_id: minorAnchored, jersey_number: 88, is_starter: true });
    check('spoof: minor onto a league game their team does not play is BLOCKED', isGateError(error), error?.message || 'insert was allowed!');
  }

  // ── 2. line check constraint ───────────────────────────────────────────
  {
    const { error } = await admin.from('game_lineups')
      .insert(lineupRow({ jersey_number: 61, invite_name: 'Bad Line', line: 5 }));
    check('line=5 violates the check constraint', !!error && /check|line/i.test(error.message), error?.message || 'insert was allowed!');
  }

  // ── 3. GS-5 resolver ───────────────────────────────────────────────────
  // Ghost rows: #42 resolves, #13 is a collision, #7 only matches a removed
  // roster row. Inserted service-role with no identity at all.
  await admin.from('game_lineups').insert([
    lineupRow({ jersey_number: 42, invite_name: 'Ghost FortyTwo' }),
    lineupRow({ jersey_number: 13, invite_name: 'Ghost Thirteen' }),
    lineupRow({ jersey_number: 7, invite_name: 'Ghost Seven' }),
  ]);
  {
    const { data, error } = await manager.client.rpc('resolve_lineup_players', { p_game_id: game.id });
    check('resolve_lineup_players runs as an authed user', !error, error?.message);
    check('resolver reports resolved rows', (data ?? 0) >= 1, `returned ${data}`);
  }
  {
    const { data: rows } = await admin.from('game_lineups')
      .select('jersey_number, user_id, player_id, invite_name')
      .eq('game_id', game.id).eq('team_id', lt.id);
    const byJersey = Object.fromEntries((rows || []).map(r => [r.jersey_number, r]));
    check('#42 ghost resolved to the rostered profile', byJersey[42]?.player_id === ghostResolved.id,
      `player_id=${byJersey[42]?.player_id}`);
    check('#13 collision stays UNRESOLVED (two rostered identities)', byJersey[13]?.player_id == null,
      `player_id=${byJersey[13]?.player_id}`);
    check('#7 ignores removed roster rows', byJersey[7]?.player_id == null,
      `player_id=${byJersey[7]?.player_id}`);
    check('adult save-time identity copied to player_id', byJersey[9]?.player_id === adultPlayer.id,
      `player_id=${byJersey[9]?.player_id}`);
    check('line assignment persisted', byJersey[9]?.line === 1 || byJersey[18]?.line === 2,
      JSON.stringify({ nine: byJersey[9]?.line, eighteen: byJersey[18]?.line }));
  }

  // ── 4. set_lineup atomicity ────────────────────────────────────────────
  const { data: gameB } = await admin.from('league_games')
    .insert({
      league_id: league.id, home_team_id: lt.id, away_team_id: ltOpp.id,
      start_time: new Date(Date.now() + 3 * 86400000).toISOString(), status: 'scheduled',
    }).select('id').single();
  {
    const { data, error } = await manager.client.rpc('set_lineup', {
      p_game_id: gameB.id, p_game_source: 'league', p_team_id: lt.id,
      p_players: [
        { user_id: adultPlayer.id, player_id: adultPlayer.id, jersey_number: 9, line: 1, is_starter: true },
        { user_id: minorAnchored, player_id: minorAnchored, jersey_number: 17, line: 2, is_starter: true },
      ],
    });
    check('set_lineup saves a valid lineup (incl. anchored minor)', !error && data?.length === 2, error?.message || `rows=${data?.length}`);
  }
  {
    const { error } = await manager.client.rpc('set_lineup', {
      p_game_id: gameB.id, p_game_source: 'league', p_team_id: lt.id,
      p_players: [
        { invite_name: 'Dup A', jersey_number: 21, is_starter: true },
        { invite_name: 'Dup B', jersey_number: 21, is_starter: true },
      ],
    });
    check('set_lineup rejects duplicate jerseys', !!error, error?.message || 'save was allowed!');
    const { count } = await admin.from('game_lineups')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', gameB.id).eq('team_id', lt.id);
    check('…and the failed replace rolled back (old lineup intact)', count === 2, `count=${count}`);
  }

  // ── 5. stat RPCs expose player_id (non-vacuous fixtures) ──────────────
  // Tournament fixture: a FINAL game with an adult lineup row + a goalie
  // ghost, so both tournament boards return real rows.
  const { data: tourn } = await admin.from('tournaments')
    .insert({
      name: `LRS Smoke Tournament ${Date.now()}`, director_id: manager.id, is_activated: true,
      start_date: new Date().toISOString().slice(0, 10), end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    }).select('id').single();
  const { data: tt1 } = await admin.from('tournament_teams')
    .insert({ tournament_id: tourn.id, team_name: 'LRS Smoke TT1' }).select('id').single();
  const { data: tt2 } = await admin.from('tournament_teams')
    .insert({ tournament_id: tourn.id, team_name: 'LRS Smoke TT2' }).select('id').single();
  const { data: tgame } = await admin.from('games')
    .insert({
      tournament_id: tourn.id, home_team_id: tt1.id, away_team_id: tt2.id,
      start_time: new Date().toISOString(), status: 'final', home_score: 1, away_score: 0,
    }).select('id').single();
  await admin.from('game_lineups').insert([
    { game_id: tgame.id, game_source: 'tournament', team_id: tt1.id, user_id: adultPlayer.id, player_id: adultPlayer.id, jersey_number: 9, is_starter: true },
    { game_id: tgame.id, game_source: 'tournament', team_id: tt1.id, invite_name: 'T Goalie', jersey_number: 31, is_goalie: true, is_starter: true },
  ]);

  for (const [fn, args, expectRows] of [
    ['get_league_skater_stats', { p_league_id: league.id }, true],
    ['get_league_goalie_stats', { p_league_id: league.id }, false],
    ['get_tournament_skater_stats', { p_tournament_id: tourn.id }, true],
    ['get_tournament_goalie_stats', { p_tournament_id: tourn.id }, true],
  ]) {
    const { data, error } = await manager.client.rpc(fn, args);
    const ok = !error && (!expectRows || data?.length > 0) && (!data?.length || 'player_id' in data[0]);
    check(`${fn} returns rows with player_id`, ok, error?.message || `rows=${data?.length}`);
  }
  {
    // Identity actually flows: the adult resolves on both board families.
    const { data: tsk } = await manager.client.rpc('get_tournament_skater_stats', { p_tournament_id: tourn.id });
    const nine = (tsk || []).find(r => r.jersey_number === 9);
    check('tournament board attributes #9 to the adult profile', nine?.player_id === adultPlayer.id, `player_id=${nine?.player_id}`);
    const { data: lsk } = await manager.client.rpc('get_league_skater_stats', { p_league_id: league.id });
    const minorRow = (lsk || []).find(r => r.player_id === minorAnchored);
    check('league board exposes the minor to a SIGNED-IN viewer', !!minorRow, 'minor row missing');
  }

  // ── 6. anon minor shield ───────────────────────────────────────────────
  {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: shieldedAnon, error: e1 } = await anon.rpc('shield_minor_player_id', { p_player_id: minorAnchored });
    check('anon: minor player_id is shielded to null', !e1 && shieldedAnon == null, e1?.message || `got ${shieldedAnon}`);
    const { data: shieldedAuthed, error: e2 } = await manager.client.rpc('shield_minor_player_id', { p_player_id: minorAnchored });
    check('authed: minor player_id passes through', !e2 && shieldedAuthed === minorAnchored, e2?.message || `got ${shieldedAuthed}`);
    const { data: adultAnon, error: e3 } = await anon.rpc('shield_minor_player_id', { p_player_id: adultPlayer.id });
    check('anon: adult player_id passes through', !e3 && adultAnon === adultPlayer.id, e3?.message || `got ${adultAnon}`);
  }

  // ── 7. GS-2 suspensions — filing RLS ───────────────────────────────────
  // Fixtures: `manager` is the tournament director (§5); `scorer` is the
  // assigned scorekeeper of a fresh scheduled game. adultPlayer is a plain
  // authed user with no tournament role.
  const scorer = await makeAuthedUser('lrsscorer');
  const { data: tgame2 } = await admin.from('games')
    .insert({
      tournament_id: tourn.id, home_team_id: tt1.id, away_team_id: tt2.id,
      start_time: new Date(Date.now() + 86400000).toISOString(), status: 'scheduled',
      scorekeeper_id: scorer.id,
    }).select('id').single();

  const suspRow = (over) => ({
    tournament_id: tourn.id, game_id: tgame2.id, team_id: tt1.id,
    player_name: 'Smoke Goon', jersey_number: 4,
    suspension_type: 'suspension_2', games_remaining: 2, ...over,
  });

  let susp2Id = null;
  {
    const { data, error } = await scorer.client.from('game_suspensions')
      .insert(suspRow({})).select('id, status, games_remaining').single();
    susp2Id = data?.id;
    check('assigned scorekeeper CAN file a suspension', !error && data?.status === 'pending', error?.message);
  }
  {
    const { error } = await adultPlayer.client.from('game_suspensions').insert(suspRow({ jersey_number: 5 }));
    check('random authed user CANNOT file (RLS)', !!error, error?.message || 'insert was allowed!');
  }
  {
    // team_id from a different tournament team not in this game
    const { data: tt3 } = await admin.from('tournament_teams')
      .insert({ tournament_id: tourn.id, team_name: 'LRS Smoke TT3' }).select('id').single();
    const { error } = await scorer.client.from('game_suspensions')
      .insert(suspRow({ team_id: tt3.id }));
    check('filing against a team not in the game is BLOCKED', !!error, error?.message || 'insert was allowed!');
  }
  {
    const { error } = await scorer.client.from('game_suspensions')
      .insert(suspRow({ status: 'served', games_remaining: 0, resolved_at: new Date().toISOString() }));
    check('filing a non-pending row is BLOCKED', !!error, error?.message || 'insert was allowed!');
  }
  {
    // One ACTIVE filing per penalty + penalty-must-belong-to-game integrity.
    const { data: pen } = await admin.from('game_penalties')
      .insert({ game_id: tgame2.id, team_id: tt1.id, game_source: 'tournament', penalty_type: 'Game Misconduct', severity: 'Game Misconduct', duration_minutes: 5, period: 3 })
      .select('id').single();
    const { error: e1 } = await scorer.client.from('game_suspensions')
      .insert(suspRow({ penalty_id: pen.id, jersey_number: 21, player_name: 'Dup Test' }));
    check('filing linked to a penalty succeeds', !e1, e1?.message);
    const { error: e2 } = await scorer.client.from('game_suspensions')
      .insert(suspRow({ penalty_id: pen.id, jersey_number: 21, player_name: 'Dup Test 2' }));
    check('second ACTIVE filing for the same penalty is BLOCKED (23505)', e2?.code === '23505', e2?.message || 'insert was allowed!');
    const { data: penB } = await admin.from('game_penalties')
      .insert({ game_id: tgame.id, team_id: tt1.id, game_source: 'tournament', penalty_type: 'Match Penalty', severity: 'Match Penalty', duration_minutes: 5, period: 3 })
      .select('id').single();
    const { error: e3 } = await scorer.client.from('game_suspensions')
      .insert(suspRow({ penalty_id: penB.id, jersey_number: 22 }));
    check('filing linked to ANOTHER game\'s penalty is BLOCKED (RLS integrity)', !!e3, e3?.message || 'insert was allowed!');
  }

  // ── 8. GS-2 counting — serve / overturn lifecycle ──────────────────────
  {
    const { error } = await scorer.client.rpc('serve_suspension', { p_suspension_id: susp2Id });
    check('non-director CANNOT serve (42501)', !!error && /director|42501/i.test(`${error.code} ${error.message}`), error?.message || 'serve was allowed!');
  }
  {
    const { data, error } = await manager.client.rpc('serve_suspension', { p_suspension_id: susp2Id });
    check('serve #1: 2-game → pending with 1 left', !error && data?.status === 'pending' && data?.games_remaining === 1 && data?.resolved_at == null,
      error?.message || JSON.stringify({ status: data?.status, left: data?.games_remaining }));
  }
  {
    const { data, error } = await manager.client.rpc('serve_suspension', { p_suspension_id: susp2Id });
    check('serve #2: hits 0 → served + resolved_at', !error && data?.status === 'served' && data?.games_remaining === 0 && data?.resolved_at != null,
      error?.message || JSON.stringify({ status: data?.status, left: data?.games_remaining }));
  }
  {
    const { error } = await manager.client.rpc('serve_suspension', { p_suspension_id: susp2Id });
    check('serve #3 on a served row FAILS (no over-serving)', !!error, error?.message || 'serve was allowed!');
  }
  {
    // Overturn from served — the mis-tap recovery path.
    const { data, error } = await manager.client.rpc('overturn_suspension', { p_suspension_id: susp2Id, p_note: 'video review' });
    check('overturn from served works + appends note', !error && data?.status === 'overturned' && /Overturned: video review/.test(data?.notes || ''),
      error?.message || JSON.stringify({ status: data?.status, notes: data?.notes }));
  }
  {
    const { error } = await manager.client.rpc('overturn_suspension', { p_suspension_id: susp2Id });
    check('overturning an overturned row FAILS', !!error, error?.message || 'overturn was allowed!');
  }
  let suspIndefId = null;
  {
    const { data, error } = await scorer.client.from('game_suspensions')
      .insert(suspRow({ suspension_type: 'indefinite', games_remaining: 0, jersey_number: 13, player_name: 'Smoke Indef' }))
      .select('id').single();
    suspIndefId = data?.id;
    check('indefinite files with games_remaining=0', !error && !!data?.id, error?.message);
  }
  {
    const { error } = await manager.client.rpc('serve_suspension', { p_suspension_id: suspIndefId });
    check('indefinite CANNOT be served (overturn only)', !!error, error?.message || 'serve was allowed!');
  }
  {
    // No direct UPDATE path exists — even the director must use the RPCs.
    const { data, error } = await manager.client.from('game_suspensions')
      .update({ games_remaining: 0, status: 'served' }).eq('id', suspIndefId).select('id');
    check('direct UPDATE is dead (RPC-only transitions)', !error && (data || []).length === 0, error?.message || `updated ${data?.length} rows!`);
  }
  {
    // CHECK constraints bind the service role too.
    const { error } = await admin.from('game_suspensions')
      .insert(suspRow({ suspension_type: 'indefinite', games_remaining: 2, jersey_number: 99 }));
    check('CHECK: indefinite with games_remaining>0 rejected (service role)', !!error, error?.message || 'insert was allowed!');
  }
  {
    const { error } = await admin.from('game_suspensions')
      .update({ games_remaining: -1 }).eq('id', suspIndefId);
    check('CHECK: negative games_remaining rejected (service role)', !!error, error?.message || 'update was allowed!');
  }

  // ── 9. team-level public surface ───────────────────────────────────────
  {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: flags, error } = await anon.rpc('get_tournament_suspension_flags', { p_tournament_id: tourn.id });
    const tt1Flag = (flags || []).find(f => f.team_id === tt1.id);
    // susp2 is overturned; still pending: the indefinite (#13) + the
    // penalty-linked filing (#21) → count 2.
    check('anon flags RPC returns team-level pending count', !error && tt1Flag?.pending_count === 2,
      error?.message || JSON.stringify(flags));
    const keys = tt1Flag ? Object.keys(tt1Flag).sort() : [];
    check('flags expose ONLY team_id + pending_count (no names/jerseys)',
      keys.length === 2 && keys.includes('team_id') && keys.includes('pending_count'), keys.join(','));
    const { data: rawRows } = await anon.from('game_suspensions').select('id').eq('tournament_id', tourn.id);
    check('anon raw-table read returns nothing', (rawRows || []).length === 0, `got ${rawRows?.length} rows`);
    const { data: playerRows } = await adultPlayer.client.from('game_suspensions').select('id').eq('tournament_id', tourn.id);
    check('non-staff authed raw-table read returns nothing', (playerRows || []).length === 0, `got ${playerRows?.length} rows`);
  }

  // ── 10. GS-5 verify_game_rosters ───────────────────────────────────────
  {
    const { error } = await adultPlayer.client.rpc('verify_game_rosters', { p_game_id: tgame2.id });
    check('non-staff CANNOT verify rosters (42501)', !!error && /staff|42501/i.test(`${error.code} ${error.message}`), error?.message || 'verify was allowed!');
  }
  {
    // No lineup set yet → indefinite #13 is pending but not DRESSED → no
    // conflict → the assigned scorekeeper may verify.
    const { data, error } = await scorer.client.rpc('verify_game_rosters', { p_game_id: tgame2.id });
    check('scorer verifies a clean game (no conflicts)', !error && data?.verified === true && data?.conflicts === 0,
      error?.message || JSON.stringify(data));
    const { data: g } = await admin.from('games').select('rosters_verified_at, rosters_verified_by').eq('id', tgame2.id).single();
    check('rosters_verified_at/by stamped on games', !!g?.rosters_verified_at && g?.rosters_verified_by === scorer.id,
      JSON.stringify(g));
  }
  {
    // The guard trigger: staff can update games (scores) but cannot stamp the
    // verification columns directly — verify_game_rosters is the only path.
    const { error } = await scorer.client.from('games')
      .update({ rosters_verified_at: new Date().toISOString() }).eq('id', tgame2.id);
    check('direct stamp of rosters_verified_at is BLOCKED (trigger)', !!error && /verify_game_rosters|42501/i.test(`${error.code} ${error.message}`),
      error?.message || 'update was allowed!');
  }
  {
    // Dress the suspended jersey (#13, indefinite, pending) on a NEW game →
    // conflict → scorer blocked, director acknowledges.
    const { data: tgame3 } = await admin.from('games')
      .insert({
        tournament_id: tourn.id, home_team_id: tt1.id, away_team_id: tt2.id,
        start_time: new Date(Date.now() + 2 * 86400000).toISOString(), status: 'scheduled',
        scorekeeper_id: scorer.id,
      }).select('id').single();
    // Re-point the indefinite suspension's game reference is NOT needed —
    // conflicts key on (tournament, team, jersey), not the filing game.
    await admin.from('game_lineups').insert({
      game_id: tgame3.id, game_source: 'tournament', team_id: tt1.id,
      invite_name: 'Smoke Indef', jersey_number: 13, is_starter: true,
    });
    const { error: scorerErr } = await scorer.client.rpc('verify_game_rosters', { p_game_id: tgame3.id });
    check('suspended jersey on lineup: scorer verify BLOCKED', !!scorerErr && /director/i.test(scorerErr.message || ''), scorerErr?.message || 'verify was allowed!');
    const { data: dirRes, error: dirErr } = await manager.client.rpc('verify_game_rosters', { p_game_id: tgame3.id });
    check('…and the DIRECTOR can acknowledge & verify', !dirErr && dirRes?.verified === true && dirRes?.conflicts === 1,
      dirErr?.message || JSON.stringify(dirRes));
  }

  // ── 11. P3 subs pools (Migration K) ────────────────────────────────────
  // `manager` is the league commissioner (§ fixtures); lt/ltOpp are its
  // playing teams.
  {
    const { error } = await adultPlayer.client.rpc('create_league_sub_pools', { p_league_id: league.id });
    check('non-commissioner cannot create sub pools (42501)', !!error && /commissioner|42501/i.test(`${error.code} ${error.message}`),
      error?.message || 'create was allowed!');
  }
  let pools = [];
  {
    const { data, error } = await manager.client.rpc('create_league_sub_pools', { p_league_id: league.id });
    pools = data || [];
    check('commissioner creates skaters + goalies pools', !error && pools.length === 2 && pools.every(p => p.is_sub_pool),
      error?.message || JSON.stringify(pools.map(p => p.sub_pool_kind)));
    const { data: again } = await manager.client.rpc('create_league_sub_pools', { p_league_id: league.id });
    check('pool creation is idempotent', (again || []).length === 0, `created ${(again || []).length}`);
  }
  const skatersPool = pools.find(p => p.sub_pool_kind === 'skaters');
  {
    // The trigger binds even the service role — pools are unschedulable, period.
    const { error } = await admin.from('league_games').insert({
      league_id: league.id, home_team_id: skatersPool.id, away_team_id: ltOpp.id,
      start_time: new Date(Date.now() + 4 * 86400000).toISOString(), status: 'scheduled',
    });
    check('a pool cannot be scheduled (service role, trigger)', !!error && /cannot be scheduled/i.test(error.message),
      error?.message || 'insert was allowed!');
  }

  {
    // The flag guard: league_teams INSERT is any-authed (pre-existing loose
    // policy), so without the trigger anyone could mint a fake "pool".
    const { error } = await adultPlayer.client.from('league_teams').insert({
      league_id: league.id, team_id: oppTeam.id, team_name: 'Fake Pool',
      is_sub_pool: true, sub_pool_kind: 'goalies',
    });
    check('non-commissioner cannot insert a pool-flagged league_team (trigger)',
      !!error && /commissioner|42501/i.test(`${error.code} ${error.message}`),
      error?.message || 'insert was allowed!');
  }

  // Day-of pull through the consent gate + identity-keyed stats.
  const subAdult = await makeAuthedUser('lrssub');
  await admin.from('team_members').insert(
    { team_id: skatersPool.team_id, user_id: subAdult.id, role: 'player', jersey_number: 77, status: 'active' });
  const { data: gameD } = await admin.from('league_games')
    .insert({
      league_id: league.id, home_team_id: lt.id, away_team_id: ltOpp.id,
      start_time: new Date(Date.now() + 5 * 86400000).toISOString(), status: 'final',
      home_score: 1, away_score: 0,
    }).select('id').single();
  {
    const { data, error } = await manager.client.rpc('set_lineup', {
      p_game_id: gameD.id, p_game_source: 'league', p_team_id: lt.id,
      p_players: [
        { user_id: adultPlayer.id, player_id: adultPlayer.id, jersey_number: 9, is_starter: true },
        { user_id: subAdult.id, player_id: subAdult.id, invite_name: 'Pool Sub', jersey_number: 77, is_starter: true },
      ],
    });
    check('day-of pull: ADULT pool sub saves through set_lineup', !error && data?.length === 2, error?.message || `rows=${data?.length}`);
  }
  {
    // A minor anchored ONLY to the pool must not be pullable onto another
    // team's lineup (the brief's consent non-negotiable).
    const minorPool = await makeMinor('lrsminor-pool');
    await admin.from('team_members').insert(
      { team_id: skatersPool.team_id, user_id: minorPool, role: 'player', jersey_number: 8, status: 'active' });
    const { error } = await manager.client.rpc('set_lineup', {
      p_game_id: gameD.id, p_game_source: 'league', p_team_id: lt.id,
      p_players: [{ user_id: minorPool, player_id: minorPool, jersey_number: 8, is_starter: true }],
    });
    check('day-of pull: MINOR pool sub is BLOCKED by the consent gate', isGateError(error), error?.message || 'save was allowed!');
  }
  {
    await admin.from('game_goals').insert(
      { game_id: gameD.id, team_id: lt.id, scorer_number: 77, game_source: 'league' });
    const { data: board, error } = await manager.client.rpc('get_league_skater_stats', { p_league_id: league.id });
    const subRow = (board || []).find(r => r.player_id === subAdult.id);
    check('sub stats key on IDENTITY (goal attributed to the pool sub, gp=1)',
      !error && subRow?.goals === 1 && subRow?.gp === 1 && subRow?.team_id === lt.id,
      error?.message || JSON.stringify(subRow || {}));
    check('sub pools never seed board rows', !(board || []).some(r => r.team_id === skatersPool.id), '');
  }

  console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('\n💥 harness error:', e.message); process.exit(2); });
