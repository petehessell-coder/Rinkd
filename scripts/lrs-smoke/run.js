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

  console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('\n💥 harness error:', e.message); process.exit(2); });
