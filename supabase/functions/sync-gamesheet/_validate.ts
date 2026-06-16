// One-off validation harness (NOT deployed). Run: node _validate.ts
// Exercises the REAL fetchSeasonScores against live GameSheet seasons and replays
// the poller's downstream consumption (scorer tally + standings) to prove the
// adapter output matches the contract and the published GameSheet numbers.
import { fetchSeasonScores } from './gamesheet-source.ts';

// Verbatim copies of index.ts's downstream consumers, to prove they read the
// adapter's shape correctly (scorerSummary mirrors index.ts exactly).
function titleCase(s: string): string {
  return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function scorerSummary(g: any): string {
  const names: string[] = [];
  for (const team of [g?.homeTeam, g?.visitorTeam]) {
    for (const p of (team?.recap ?? [])) for (const e of (p?.events ?? [])) {
      if (e?.playerName) names.push(titleCase(e.playerName));
    }
  }
  if (!names.length) return '';
  const counts = new Map<string, number>(); const order: string[] = [];
  for (const n of names) { if (!counts.has(n)) order.push(n); counts.set(n, (counts.get(n) || 0) + 1); }
  return 'Goals: ' + order.map((n) => counts.get(n)! > 1 ? `${n} ×${counts.get(n)}` : n).join(', ');
}

const norm = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function standings(finals: any[]) {
  const W: Record<string, any> = {};
  const bump = (t: string, k: string, v = 1) => { (W[t] ||= { w: 0, l: 0, d: 0, gf: 0, ga: 0 })[k] += v; };
  for (const e of finals) {
    const g = e.game; const ht = g.homeTeam.name, vt = g.visitorTeam.name;
    if (/^tbd/i.test(ht) || /^tbd/i.test(vt)) continue;
    const hs = g.finalScore.homeGoals, vs = g.finalScore.visitorGoals;
    bump(ht, 'gf', hs); bump(ht, 'ga', vs); bump(vt, 'gf', vs); bump(vt, 'ga', hs);
    if (hs > vs) { bump(ht, 'w'); bump(vt, 'l'); } else if (vs > hs) { bump(vt, 'w'); bump(ht, 'l'); } else { bump(ht, 'd'); bump(vt, 'd'); }
  }
  return Object.entries(W).map(([name, s]: any) => ({ name, ...s, diff: s.gf - s.ga }))
    .sort((a, b) => b.w - a.w || b.diff - a.diff);
}

async function run(seasonId: string, opts: { expectTeams?: number; expectFinals?: number } = {}) {
  console.log(`\n=================== SEASON ${seasonId} ===================`);
  const games = await fetchSeasonScores(seasonId);
  const finals = games.filter((e) => e.game.finalScore);
  const teams = new Set<string>();
  for (const e of finals) { for (const n of [e.game.homeTeam.name, e.game.visitorTeam.name]) if (n && !/^tbd/i.test(n)) teams.add(norm(n)); }
  console.log(`fetched ${games.length} games · ${finals.length} final · ${teams.size} teams`);

  console.log('\nFINAL GAMES:');
  for (const e of finals.sort((a, b) => Number(a.game.number) - Number(b.game.number))) {
    const g = e.game;
    console.log(`  #${String(g.number).padStart(2)} [${g.type}] ${g.date?.slice(0, 10)}  ${g.visitorTeam.name} ${g.finalScore.visitorGoals} @ ${g.homeTeam.name} ${g.finalScore.homeGoals}`);
  }

  console.log('\nSTANDINGS (computed from adapter output):');
  for (const s of standings(finals)) console.log(`  ${s.name.padEnd(20)} ${s.w}-${s.l}-${s.d}  +/- ${s.diff >= 0 ? '+' : ''}${s.diff}`);

  // Show a recap line built exactly as the poller would (scorerSummary).
  const sample = finals.find((e) => norm(e.game.homeTeam.name).includes('venom') || norm(e.game.visitorTeam.name).includes('venom')) || finals[0];
  if (sample) {
    const g = sample.game;
    console.log(`\nSAMPLE RECAP (game #${g.number}):`);
    console.log(`  🏒 FINAL · ${g.homeTeam.name} ${g.finalScore.homeGoals}, ${g.visitorTeam.name} ${g.finalScore.visitorGoals}`);
    console.log(`  ${scorerSummary(g) || '(no scorer data)'}`);
  }

  if (opts.expectTeams != null) console.log(`\nASSERT teams=${teams.size} expected=${opts.expectTeams} → ${teams.size === opts.expectTeams ? 'PASS' : 'FAIL'}`);
  if (opts.expectFinals != null) console.log(`ASSERT finals=${finals.length} expected=${opts.expectFinals} → ${finals.length === opts.expectFinals ? 'PASS' : 'FAIL'}`);
}

await run('15073', { expectTeams: 6, expectFinals: 11 });  // Cleveland BLPA Bash
await run('8553');                                          // 2025 Greenville BLPA Bash
await run('1543');                                          // 2022 Columbus (older)
