import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getGamePuck, getMyGamePuckVote, castGamePuckVote } from '../lib/gamePucks';

// Rinkd Game Puck (SOCIAL-3, Phase 1) — fan "Game Puck" / Fans' Pick vote on a
// FINAL league or tournament game. Jersey-keyed: candidate players come from the
// game lineup (preferred) plus anyone who appears in the goal log, so a game
// with thin rosters still has something to vote on. One vote per user,
// change-able. Live tally + leader shown to everyone; voting needs a login.
//
// Props:
//   gameId        league_games.id (kind='league') OR games.id (tournament)
//   kind          'league' | 'tournament'
//   homeTeam      { id, name, logo_color, logo_initials }
//   awayTeam      { id, name, logo_color, logo_initials }
//   lineupByTeam  { [team_id]: { [jersey]: name|null } }  (from GameDetail)
//   goals         game_goals rows (supplements the candidate list)
//   canVote       boolean — is a user signed in
//   accent        leader/selection accent color

const C = {
  card: '#0f2847', border: 'rgba(46,91,140,0.4)', ice: '#F4F7FA',
  dim: 'rgba(244,247,250,0.5)', faint: 'rgba(244,247,250,0.3)',
  chip: 'rgba(46,91,140,0.18)', chipBorder: 'rgba(46,91,140,0.5)',
};

const keyOf = (teamId, jersey) => `${teamId}:${jersey}`;

export default function GamePuckCard({
  gameId, kind, homeTeam, awayTeam, lineupByTeam = {}, goals = [],
  canVote = false, accent = '#D72638',
}) {
  const [tally, setTally] = useState(null);     // { rows, total, leader }
  const [myVote, setMyVote] = useState(null);   // { team_id, jersey } | null
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    setErr(false);
    try {
      const [t, mine] = await Promise.all([
        getGamePuck(gameId, kind),
        canVote ? getMyGamePuckVote(gameId, kind) : Promise.resolve(null),
      ]);
      setTally(t);
      setMyVote(mine);
    } catch (e) {
      console.error('[GamePuck] load failed', e);
      setErr(true);
    }
    setLoading(false);
  }, [gameId, kind, canVote]);

  useEffect(() => { load(); }, [load]);

  // Candidate players per team: union of lineup jerseys + goal participants.
  const candidatesByTeam = useMemo(() => {
    const build = (teamId) => {
      const seen = new Map(); // jersey -> name|null
      const lu = lineupByTeam[teamId] || {};
      Object.keys(lu).forEach((j) => {
        const n = Number(j);
        if (!Number.isNaN(n)) seen.set(n, lu[j] || null);
      });
      goals.filter((g) => g.team_id === teamId).forEach((g) => {
        [g.scorer_number, g.assist1_number, g.assist2_number].forEach((num) => {
          if (num != null && !seen.has(num)) seen.set(num, lu[num] || null);
        });
      });
      return [...seen.entries()]
        .map(([jersey, name]) => ({ jersey, name }))
        .sort((a, b) => a.jersey - b.jersey);
    };
    return {
      [homeTeam.id]: build(homeTeam.id),
      [awayTeam.id]: build(awayTeam.id),
    };
  }, [homeTeam.id, awayTeam.id, lineupByTeam, goals]);

  const hasCandidates =
    (candidatesByTeam[homeTeam.id]?.length || 0) +
    (candidatesByTeam[awayTeam.id]?.length || 0) > 0;

  const voteMap = useMemo(() => {
    const m = {};
    (tally?.rows || []).forEach((r) => { m[keyOf(r.team_id, r.jersey)] = r.votes; });
    return m;
  }, [tally]);

  const onVote = async (teamId, jersey) => {
    if (!canVote || saving) return;
    const already = myVote && myVote.team_id === teamId && myVote.jersey === jersey;
    if (already) return; // tapping your current pick is a no-op
    setSaving(true);
    const prev = myVote;
    setMyVote({ team_id: teamId, jersey }); // optimistic
    try {
      await castGamePuckVote(gameId, kind, teamId, jersey);
      await load();
    } catch (e) {
      console.error('[GamePuck] vote failed', e);
      setMyVote(prev); // roll back
      setErr(true);
    }
    setSaving(false);
  };

  const total = tally?.total || 0;
  const leader = tally?.leader || null;
  const nameFor = (teamId, jersey) => lineupByTeam[teamId]?.[jersey] || null;
  const teamNameFor = (teamId) => (teamId === homeTeam.id ? homeTeam.name : awayTeam.name);
  const labelFor = (teamId, jersey) => {
    const n = nameFor(teamId, jersey);
    return n ? `${n} · #${jersey}` : `#${jersey}`;
  };

  const Wrap = ({ children }) => (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '12px 14px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 11, height: 11, borderRadius: '50%', background: '#0a0a0a', border: '1px solid rgba(244,247,250,0.35)', display: 'inline-block' }} />
          Game Puck
        </div>
        {total > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: C.faint }}>{total} {total === 1 ? 'vote' : 'votes'}</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>Fans’ Pick — who earned it?</div>
      {children}
    </div>
  );

  if (loading) {
    return <Wrap><div style={{ color: C.faint, fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Loading…</div></Wrap>;
  }

  if (!hasCandidates) {
    return (
      <Wrap>
        <div style={{ color: C.faint, fontSize: 12.5, textAlign: 'center', padding: '10px 0', lineHeight: 1.5 }}>
          Fan voting opens once a roster or scoring is logged for this game.
        </div>
      </Wrap>
    );
  }

  const renderTeam = (team) => {
    const cands = candidatesByTeam[team.id] || [];
    if (cands.length === 0) return null;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: team.logo_color || accent, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {cands.map(({ jersey, name }) => {
            const votes = voteMap[keyOf(team.id, jersey)] || 0;
            const mine = myVote && myVote.team_id === team.id && myVote.jersey === jersey;
            const isLeader = leader && leader.team_id === team.id && leader.jersey === jersey && total > 0;
            return (
              <button
                key={jersey}
                onClick={() => onVote(team.id, jersey)}
                disabled={!canVote || saving}
                title={canVote ? (mine ? 'Your pick' : 'Vote') : 'Sign in to vote'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px', borderRadius: 999,
                  fontFamily: 'Barlow, sans-serif', fontSize: 12, fontWeight: 600,
                  cursor: canVote && !saving ? 'pointer' : 'default',
                  color: mine ? '#fff' : C.ice,
                  background: mine ? accent : C.chip,
                  border: `1px solid ${mine ? accent : (isLeader ? 'rgba(244,247,250,0.45)' : C.chipBorder)}`,
                  transition: 'all 0.12s',
                }}
              >
                <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name ? `${name} ` : ''}<span style={{ opacity: name ? 0.7 : 1 }}>#{jersey}</span>
                </span>
                {votes > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, lineHeight: 1,
                    padding: '2px 6px', borderRadius: 999,
                    background: mine ? 'rgba(255,255,255,0.22)' : 'rgba(244,247,250,0.1)',
                    color: mine ? '#fff' : 'rgba(244,247,250,0.8)',
                  }}>{votes}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Wrap>
      {total > 0 && leader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(46,91,140,0.14)', border: `0.5px solid ${C.border}`, borderRadius: 9, padding: '8px 11px', marginBottom: 12 }}>
          <span aria-hidden style={{ fontSize: 16 }}>🏒</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: C.faint, textTransform: 'uppercase' }}>Leading</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {labelFor(leader.team_id, leader.jersey)}
              <span style={{ fontWeight: 400, color: C.dim }}> · {teamNameFor(leader.team_id)}</span>
            </div>
          </div>
        </div>
      )}

      {renderTeam(homeTeam)}
      {renderTeam(awayTeam)}

      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
        {!canVote
          ? 'Sign in to cast your vote for the Game Puck.'
          : myVote
            ? 'Tap another player to change your pick. Fan vote — separate from any team or league award.'
            : 'Tap a player to cast your vote. One vote per game.'}
        {err && <span style={{ color: accent }}> · Something went wrong, try again.</span>}
      </div>
    </Wrap>
  );
}
