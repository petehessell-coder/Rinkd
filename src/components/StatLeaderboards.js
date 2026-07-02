import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import ShareButton from './ShareButton';
import { buildStatCardData } from '../lib/shareCard';
import { C } from '../lib/tokens';
import { cached } from '../lib/cache';

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

const localC = {
  cardHdr: '#152e54',
  dim: 'rgba(244,247,250,0.5)', dim2: 'rgba(244,247,250,0.65)',
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

function StatTable({ rows, accent, idLabel, renderId, cols, rowKey, showRank = true, action = null }) {
  const midCellW = 40;
  const idMin = action ? 178 : 150, idMax = action ? 224 : 190;
  return (
    <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ background: 'rgba(46,91,140,0.2)', fontSize: 10, fontWeight: 700, color: 'rgba(244,247,250,0.35)', textTransform: 'uppercase' }}>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: localC.cardHdr, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)', textAlign: 'left', padding: '8px 10px', minWidth: idMin, maxWidth: idMax }}>{idLabel}</th>
              {cols.map(c => (
                <th key={c.key} style={{ textAlign: 'center', padding: '8px 4px', width: midCellW, minWidth: midCellW }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey ? rowKey(row, i) : (row.team_id + ':' + row.jersey_number)} style={{ borderTop: '0.5px solid ' + localC.line }}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: C.card, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)', padding: '9px 10px', minWidth: idMin, maxWidth: idMax }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {showRank && <span style={{ width: 18, height: 18, borderRadius: '50%', background: i === 0 ? accent : 'rgba(244,247,250,0.1)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>}
                    <div style={{ minWidth: 0 }}>{renderId(row)}</div>
                    {action && <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{action(row, i)}</div>}
                  </div>
                </td>
                {cols.map(c => (
                  <td key={c.key} style={{ fontSize: 11, textAlign: 'center', color: c.strong ? C.ice : localC.dim2, fontWeight: c.strong ? 700 : 400, padding: '9px 4px', width: midCellW, minWidth: midCellW, fontVariantNumeric: 'tabular-nums' }}>
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
      <div style={{ fontSize: 12, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
      <div style={{ fontSize: 10, color: localC.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {r.number != null && r.number !== '' ? `#${r.number} · ${r.team}` : r.team}
      </div>
    </>
  );
  const renderTeamId = (r) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.team}</div>
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

      <div style={{ fontSize: 10.5, color: localC.faint, marginTop: 10, lineHeight: 1.5 }}>
        Final {archived.label} season totals, imported from the league’s prior stats system{archived.source ? ` (${archived.source})` : ''}{archived.as_of ? `, as of ${archived.as_of}` : ''}.
      </div>
    </div>
  );
}

// SOCIAL-2: GameSheet-synced tournaments don't have native goal/lineup rows, so
// the jersey-keyed RPC boards would be empty. Instead we embed GameSheet's own
// player/goalie stats widget, recolored + branding-stripped — accurate, zero
// ingestion. Fails soft to an external link if the frame doesn't load.
function GameSheetStatsEmbed({ seasonId, accent = C.red }) {
  const [view, setView] = useState('players');
  const hex = String(accent || C.red).replace('#', '');
  const base = `https://gamesheetstats.com/seasons/${encodeURIComponent(seasonId)}/${view}`;
  const src = `${base}?configuration[logo]=false&configuration[navigation]=false&configuration[primary-colour]=${hex}`;
  const Tab = ({ tid, label }) => (
    <button onClick={() => setView(tid)} style={{
      flex: 1, padding: '8px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      fontFamily: 'Barlow, sans-serif', borderRadius: 9, border: 'none',
      background: view === tid ? accent : 'rgba(46,91,140,0.18)',
      color: view === tid ? '#fff' : 'rgba(244,247,250,0.6)',
    }}>{label}</button>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Tab tid="players" label="Skaters" />
        <Tab tid="goalies" label="Goalies" />
      </div>
      <iframe
        key={view}
        title="GameSheet stats"
        src={src}
        style={{ width: '100%', height: 640, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, background: '#fff' }}
      />
      <div style={{ fontSize: 11, color: localC.faint, marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span>Stats synced live from GameSheet.</span>
        <a href={base} target="_blank" rel="noreferrer" style={{ color: accent, fontWeight: 700 }}>Open on GameSheet ↗</a>
      </div>
    </div>
  );
}

export default function StatLeaderboards({ source = 'tournament', id, divisionId = null, accent = C.red, archived = null, gamesheetSeasonId = null, shareMeta = null, revealNames = false }) {
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
    // MULTIDIV-1: tournament stat RPCs accept an optional p_division_id (null = event-wide).
    // League RPCs don't take it, so only thread it when scoping a tournament to a division.
    const args = { [cfg.arg]: id };
    if (source === 'tournament' && divisionId) args.p_division_id = divisionId;
    // perf(scale) — the Stats tab is the hottest per-open surface during a live
    // pilot (5 fresh queries every open, per C08 audit). Cache both RPCs 60s,
    // keyed so the parent page's realtime tick can invalidatePrefix the whole
    // `stats:${source}:${id}` namespace (including SeasonGamePucks) in one call.
    // fetchFn throws on a Supabase error (instead of resolving with it) so
    // cached() never memoizes a transient failure for the full TTL.
    const divKey = divisionId || 'all';
    try {
      const [skData, goData] = await Promise.all([
        cached(`stats:${source}:${id}:${divKey}:skater`, 60_000, async () => {
          const { data, error } = await supabase.rpc(cfg.skater, args);
          if (error) throw error;
          return data;
        }),
        cached(`stats:${source}:${id}:${divKey}:goalie`, 60_000, async () => {
          const { data, error } = await supabase.rpc(cfg.goalie, args);
          if (error) throw error;
          return data;
        }),
      ]);
      // Goalies show on their own board; keep them out of the scoring leaders.
      setSkaters((skData || []).filter(r => !r.is_goalie));
      setGoalies(goData || []);
    } catch {
      setError(true);
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [cfg.skater, cfg.goalie, cfg.arg, id, source, divisionId]);

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

  // SOCIAL-2: external (GameSheet-synced) events embed GameSheet's widget instead
  // of the native boards (after all hooks, to respect rules-of-hooks).
  if (gamesheetSeasonId) {
    return <GameSheetStatsEmbed seasonId={gamesheetSeasonId} accent={accent} />;
  }

  if (loading) {
    return <div style={{ textAlign: 'center', color: localC.faint, fontSize: 13, paddingTop: 40 }}>Loading stats…</div>;
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
        <div style={{ textAlign: 'center', color: localC.faint, fontSize: 13, paddingTop: 40 }}>
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
        <div style={{ textAlign: 'center', color: localC.faint, fontSize: 13, paddingTop: 40 }}>Player and goalie stats appear here as games go final.</div>
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

  // YOUTH-PRIVACY (COPPA): on a youth (youth_competitive) event, a minor's name
  // must never render to the public Stats tab. Show jersey-only ("#42") instead,
  // keeping team context (team name is not minor PII). Adult events, and explicit
  // insider views where the caller vouches for the viewer (revealNames), still
  // show names. Mirrors the youth suppression already applied to the shareable
  // stat card. Safe default: absent an insider signal, youth events hide names.
  const hideYouthName = !!shareMeta?.youth && !revealNames;

  // Identity cell: name (bold) + "#jersey · team" subline. League goaltending
  // rows can have a null jersey (per-team line) — show team only in that case.
  const renderRowId = (r) => {
    if (hideYouthName) {
      const jersey = r.jersey_number != null ? `#${r.jersey_number}` : (r.team_name || '—');
      return (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jersey}</div>
          <div style={{ fontSize: 10, color: localC.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.team_name || ''}</div>
        </>
      );
    }
    return (
      <>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.player_name || r.goalie_name}</div>
        <div style={{ fontSize: 10, color: localC.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.jersey_number != null ? `#${r.jersey_number} · ${r.team_name}` : r.team_name}
        </div>
      </>
    );
  };

  const goalieFootnote = source === 'league'
    ? 'League games don’t record which goalie was in net, so this is team goaltending — attributed to the roster goalie when a team has exactly one. SV% needs logged shots; GAA is per game played.'
    : 'SV% & GAA are computed from logged shots and goals. GAA is shown per game played. When goalies split a game, shots-against is attributed to the starter — exact for single-goalie games.';

  // SHARE-GOAL-1 — a broadcast stat card per row. Only when the parent opts in
  // (adult, publicly shareable); youth names are suppressed to a jersey number.
  const canShare = !!shareMeta?.canShare;
  const skaterShare = canShare ? (row, i) => (
    <ShareButton compact cardType="stat" shareUrl={shareMeta.shareUrl} label=""
      getCard={() => buildStatCardData({
        player: { name: shareMeta.youth ? null : row.player_name, jersey: row.jersey_number, teamName: row.team_name, teamColor: accent },
        league: shareMeta.leagueName, sponsor: shareMeta.sponsor, subtitle: shareMeta.subtitle,
        headline: { label: 'PTS', value: row.points },
        stats: [
          { label: 'G', value: row.goals },
          { label: 'A', value: row.assists },
          { label: 'GP', value: row.gp },
          { label: 'PIM', value: row.pim },
        ],
        rankLabel: i === 0 ? '#1 · Points' : null,
      })} />
  ) : null;
  const goalieShare = canShare ? (row, i) => (
    <ShareButton compact cardType="stat" shareUrl={shareMeta.shareUrl} label=""
      getCard={() => buildStatCardData({
        player: { name: shareMeta.youth ? null : (row.goalie_name || row.player_name), jersey: row.jersey_number, teamName: row.team_name, teamColor: accent, position: 'Goalie' },
        league: shareMeta.leagueName, sponsor: shareMeta.sponsor, subtitle: shareMeta.subtitle,
        headline: { label: 'SV%', value: fmtPct(row.save_pct) },
        stats: [
          { label: 'GAA', value: fmtNum(row.gaa, 2) },
          { label: 'GP', value: row.gp },
          { label: 'W-L-T', value: `${row.wins}-${row.losses}-${row.ties}` },
          { label: 'SO', value: row.shutouts },
        ],
        rankLabel: i === 0 ? '#1 · SV%' : null,
      })} />
  ) : null;

  return (
    <div>
      {SeasonBar}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Toggle active={view === 'skaters'} onClick={() => setView('skaters')} label="Skaters" n={skaters ? skaters.length : 0} accent={accent} />
        <Toggle active={view === 'goalies'} onClick={() => setView('goalies')} label="Goalies" n={goalies ? goalies.length : 0} accent={accent} />
      </div>

      {view === 'skaters' && (
        hasSkaters
          ? <StatTable rows={skaters} accent={accent} idLabel="Player" renderId={renderRowId} cols={skaterCols} action={skaterShare} />
          : <div style={{ textAlign: 'center', color: localC.faint, fontSize: 13, paddingTop: 30 }}>No skater scoring logged yet.</div>
      )}

      {view === 'goalies' && (
        hasGoalies
          ? <>
              <StatTable rows={goalies} accent={accent} idLabel="Goalie" renderId={renderRowId} cols={goalieCols} action={goalieShare} />
              <div style={{ fontSize: 10.5, color: localC.faint, marginTop: 10, lineHeight: 1.5 }}>{goalieFootnote}</div>
            </>
          : <div style={{ textAlign: 'center', color: localC.faint, fontSize: 13, paddingTop: 30 }}>No goalie stats yet — needs a finalized game with a goalie on the roster.</div>
      )}
    </div>
  );
}
