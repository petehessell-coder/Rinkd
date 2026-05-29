import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

// Phase-1 review-only stat leaderboards (skaters + goalies), jersey-keyed.
// Shared by the Tournament and League pages via the `source` prop:
//   - tournament: get_tournament_skater_stats / get_tournament_goalie_stats
//       names from game_lineups; goalie = per-goalie (lineup is_goalie).
//   - league:     get_league_skater_stats / get_league_goalie_stats
//       names from team_members; goalie board is per-team goaltending
//       (league games don't record who was in net), attributed to the roster
//       goalie when a team has exactly one.
// All backing RPCs are SECURITY INVOKER + anon-granted, reading public-select
// tables, so this renders for any signed-in viewer without special perms.
//
// `archived` (optional) holds a prior season's *pre-aggregated* totals imported
// from the league's old stats system (stored on leagues.settings.archived_stats).
// There's no game-by-game data behind it, so it's shown as a labeled read-only
// season — a [This Season] / [<label>] toggle. Skaters: G/A/PTS/PIM; goalies:
// GP/GA/GAA/SV%; plus a final Standings table. Tournament usage passes no
// `archived` prop, so its UI is unchanged.

const RPC = {
  tournament: { skater: 'get_tournament_skater_stats', goalie: 'get_tournament_goalie_stats', arg: 'p_tournament_id' },
  league: { skater: 'get_league_skater_stats', goalie: 'get_league_goalie_stats', arg: 'p_league_id' },
};

const C = {
  card: '#0f2847', cardHdr: '#152e54',
  text: '#F4F7FA', dim: 'rgba(244,247,250,0.5)', dim2: 'rgba(244,247,250,0.65)',
  faint: 'rgba(244,247,250,0.3)', line: 'rgba(244,247,250,0.06)',
};

function fmtPct(v) {
  if (v == null) return '—';
  // GameSheet style: 3 decimals, leading zero dropped for sub-1 values (.735).
  const s = Number(v).toFixed(3);
  return s.startsWith('0') ? s.slice(1) : s;
}
function fmtNum(v, dp) {
  if (v == null) return '—';
  return Number(v).toFixed(dp);
}

function StatTable({ rows, accent, idLabel, renderId, cols, rowKey, showRank = true }) {
  const midCellW = 40;
  return (
    <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ background: 'rgba(46,91,140,0.2)', fontSize: 10, fontWeight: 700, color: 'rgba(244,247,250,0.35)', textTransform: 'uppercase' }}>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: C.cardHdr, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)', textAlign: 'left', padding: '8px 10px', minWidth: 150, maxWidth: 190 }}>{idLabel}</th>
              {cols.map(c => (
                <th key={c.key} style={{ textAlign: 'center', padding: '8px 4px', width: midCellW, minWidth: midCellW }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey ? rowKey(row, i) : (row.team_id + ':' + row.jersey_number)} style={{ borderTop: '0.5px solid ' + C.line }}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: C.card, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)', padding: '9px 10px', minWidth: 150, maxWidth: 190 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {showRank && <span style={{ width: 18, height: 18, borderRadius: '50%', background: i === 0 ? accent : 'rgba(244,247,250,0.1)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>}
                    <div style={{ minWidth: 0 }}>{renderId(row)}</div>
                  </div>
                </td>
                {cols.map(c => (
                  <td key={c.key} style={{ fontSize: 11, textAlign: 'center', color: c.strong ? C.text : C.dim2, fontWeight: c.strong ? 700 : 400, padding: '9px 4px', width: midCellW, minWidth: midCellW }}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Toggle = ({ active, onClick, label, n, accent }) => (
  <button onClick={onClick}
    style={{
      flex: 1, padding: '8px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      fontFamily: 'Barlow, sans-serif', borderRadius: 9, border: 'none',
      background: active ? accent : 'rgba(46,91,140,0.18)',
      color: active ? '#fff' : 'rgba(244,247,250,0.6)',
    }}>
    {label}{typeof n === 'number' ? ` (${n})` : ''}
  </button>
);

// ── Archived (prior-season) board ─────────────────────────────────────────
function ArchivedStats({ archived, accent }) {
  const [view, setView] = useState('skaters');

  const skaters = useMemo(
    () => [...(archived.skaters || [])].sort((a, b) => (b.pts - a.pts) || (b.g - a.g)),
    [archived.skaters]);
  const goalies = useMemo(
    () => [...(archived.goalies || [])].sort((a, b) => (b.sv_pct ?? -1) - (a.sv_pct ?? -1)),
    [archived.goalies]);
  const standings = useMemo(
    () => [...(archived.standings || [])].sort((a, b) => (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga))),
    [archived.standings]);

  const renderPlayerId = (r) => (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
      <div style={{ fontSize: 10, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {r.number != null && r.number !== '' ? `#${r.number} · ${r.team}` : r.team}
      </div>
    </>
  );
  const renderTeamId = (r) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.team}</div>
  );

  const skaterCols = [
    { key: 'g', label: 'G', render: r => r.g },
    { key: 'a', label: 'A', render: r => r.a },
    { key: 'pts', label: 'PTS', render: r => r.pts, strong: true },
    { key: 'pim', label: 'PIM', render: r => r.pim },
  ];
  const goalieCols = [
    { key: 'gp', label: 'GP', render: r => r.gp },
    { key: 'ga', label: 'GA', render: r => r.ga },
    { key: 'gaa', label: 'GAA', render: r => fmtNum(r.gaa, 2), strong: true },
    { key: 'svp', label: 'SV%', render: r => fmtPct(r.sv_pct), strong: true },
  ];
  const standingsCols = [
    { key: 'gp', label: 'GP', render: r => r.w + r.l + r.t },
    { key: 'rec', label: 'W-L-T', render: r => `${r.w}-${r.l}-${r.t}` },
    { key: 'gf', label: 'GF', render: r => r.gf },
    { key: 'ga', label: 'GA', render: r => r.ga },
    { key: 'pim', label: 'PIM', render: r => r.pim },
    { key: 'pts', label: 'PTS', render: r => r.pts, strong: true },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Toggle active={view === 'skaters'} onClick={() => setView('skaters')} label="Skaters" n={skaters.length} accent={accent} />
        <Toggle active={view === 'goalies'} onClick={() => setView('goalies')} label="Goalies" n={goalies.length} accent={accent} />
        <Toggle active={view === 'standings'} onClick={() => setView('standings')} label="Standings" n={standings.length} accent={accent} />
      </div>

      {view === 'skaters' && (
        <StatTable rows={skaters} accent={accent} idLabel="Player" renderId={renderPlayerId} cols={skaterCols}
          rowKey={(r, i) => `${i}:${r.name}:${r.number}`} />
      )}
      {view === 'goalies' && (
        <StatTable rows={goalies} accent={accent} idLabel="Goalie" renderId={renderPlayerId} cols={goalieCols}
          rowKey={(r, i) => `${i}:${r.name}`} />
      )}
      {view === 'standings' && (
        <StatTable rows={standings} accent={accent} idLabel="Team" renderId={renderTeamId} cols={standingsCols}
          rowKey={(r) => r.team} />
      )}

      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
        Final {archived.label} season totals, imported from the league’s prior stats system{archived.source ? ` (${archived.source})` : ''}{archived.as_of ? `, as of ${archived.as_of}` : ''}.
      </div>
    </div>
  );
}

export default function StatLeaderboards({ source = 'tournament', id, accent = '#D72638', archived = null }) {
  const cfg = RPC[source] || RPC.tournament;
  const [view, setView] = useState('skaters');
  const [season, setSeason] = useState('current'); // 'current' | 'archive'
  const [seasonPicked, setSeasonPicked] = useState(false);
  const [skaters, setSkaters] = useState(null);
  const [goalies, setGoalies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const hasArchive = !!(archived && (
    (archived.skaters && archived.skaters.length) ||
    (archived.goalies && archived.goalies.length) ||
    (archived.standings && archived.standings.length)
  ));

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [sk, go] = await Promise.all([
      supabase.rpc(cfg.skater, { [cfg.arg]: id }),
      supabase.rpc(cfg.goalie, { [cfg.arg]: id }),
    ]);
    if (sk.error || go.error) {
      setError(true);
      setLoading(false);
      return;
    }
    // Goalies show on their own board; keep them out of the scoring leaders.
    setSkaters((sk.data || []).filter(r => !r.is_goalie));
    setGoalies(go.data || []);
    setLoading(false);
  }, [cfg.skater, cfg.goalie, cfg.arg, id]);

  useEffect(() => {
    let alive = true;
    load().catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [load]);

  const hasSkaters = skaters && skaters.length > 0;
  const hasGoalies = goalies && goalies.length > 0;
  const hasLive = hasSkaters || hasGoalies;

  // Once the live load settles, default to the archived season if there's
  // nothing live to show yet (e.g. a brand-new season). Only auto-pick once so
  // a deliberate toggle isn't overridden on re-render.
  useEffect(() => {
    if (loading || seasonPicked || !hasArchive) return;
    if (!hasLive) setSeason('archive');
    setSeasonPicked(true);
  }, [loading, seasonPicked, hasArchive, hasLive]);

  if (loading) {
    return <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 40 }}>Loading stats…</div>;
  }

  const SeasonBar = hasArchive ? (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      <Toggle active={season === 'current'} onClick={() => { setSeason('current'); if (view === 'standings') setView('skaters'); }} label="This Season" accent={accent} />
      <Toggle active={season === 'archive'} onClick={() => setSeason('archive')} label={`${archived.label} Season`} accent={accent} />
    </div>
  ) : null;

  // Archived season selected — render the imported board.
  if (season === 'archive' && hasArchive) {
    return (
      <div>
        {SeasonBar}
        <ArchivedStats archived={archived} accent={accent} />
      </div>
    );
  }

  // Live ("this season") board.
  if (error) {
    return (
      <div>
        {SeasonBar}
        <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 40 }}>
          Couldn't load stats.{' '}
          <button onClick={load} style={{ background: 'transparent', border: 'none', color: accent, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    );
  }

  if (!hasLive) {
    return (
      <div>
        {SeasonBar}
        <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 40 }}>Player and goalie stats appear here as games go final.</div>
      </div>
    );
  }

  const skaterCols = [
    { key: 'gp', label: 'GP', render: r => r.gp },
    { key: 'g', label: 'G', render: r => r.goals },
    { key: 'a', label: 'A', render: r => r.assists },
    { key: 'pts', label: 'PTS', render: r => r.points, strong: true },
    { key: 'pim', label: 'PIM', render: r => r.pim },
    { key: 'ppg', label: 'P/G', render: r => fmtNum(r.points_per_game, 2) },
  ];
  const goalieCols = [
    { key: 'gp', label: 'GP', render: r => r.gp },
    { key: 'rec', label: 'W-L-T', render: r => `${r.wins}-${r.losses}-${r.ties}` },
    { key: 'ga', label: 'GA', render: r => r.goals_against },
    { key: 'sa', label: 'SA', render: r => r.shots_against },
    { key: 'svp', label: 'SV%', render: r => fmtPct(r.save_pct), strong: true },
    { key: 'gaa', label: 'GAA', render: r => fmtNum(r.gaa, 2), strong: true },
    { key: 'so', label: 'SO', render: r => r.shutouts },
  ];

  // Identity cell: name (bold) + "#jersey · team" subline. League goaltending
  // rows can have a null jersey (per-team line) — show team only in that case.
  const renderRowId = (r) => (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.player_name || r.goalie_name}</div>
      <div style={{ fontSize: 10, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {r.jersey_number != null ? `#${r.jersey_number} · ${r.team_name}` : r.team_name}
      </div>
    </>
  );

  const goalieFootnote = source === 'league'
    ? 'League games don’t record which goalie was in net, so this is team goaltending — attributed to the roster goalie when a team has exactly one. SV% needs logged shots; GAA is per game played.'
    : 'SV% & GAA are computed from logged shots and goals. GAA is shown per game played. When goalies split a game, shots-against is attributed to the starter — exact for single-goalie games.';

  return (
    <div>
      {SeasonBar}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Toggle active={view === 'skaters'} onClick={() => setView('skaters')} label="Skaters" n={skaters ? skaters.length : 0} accent={accent} />
        <Toggle active={view === 'goalies'} onClick={() => setView('goalies')} label="Goalies" n={goalies ? goalies.length : 0} accent={accent} />
      </div>

      {view === 'skaters' && (
        hasSkaters
          ? <StatTable rows={skaters} accent={accent} idLabel="Player" renderId={renderRowId} cols={skaterCols} />
          : <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 30 }}>No skater scoring logged yet.</div>
      )}

      {view === 'goalies' && (
        hasGoalies
          ? <>
              <StatTable rows={goalies} accent={accent} idLabel="Goalie" renderId={renderRowId} cols={goalieCols} />
              <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>{goalieFootnote}</div>
            </>
          : <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, paddingTop: 30 }}>No goalie stats yet — needs a finalized game with a goalie on the roster.</div>
      )}
    </div>
  );
}
