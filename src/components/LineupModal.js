import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getTeamMembers } from '../lib/teams';
import { getLineup, setLineup, resolveLineupPlayers } from '../lib/lineups';
// LRS-1 P3 — day-of subs from the league's pools. A pulled sub is just a
// lineup row for a user with no roster spot on this team: it saves through
// the same set_lineup RPC, so Migration H's minor gate applies unchanged
// (adult subs pass; a minor anchored only to the pool is blocked by design).
import { listSubPoolsForTeam, sendSubNeededAlert } from '../lib/subPools';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE',
  card: '#112236', border: '#1E3A5C', amber: '#F59E0B', green: '#22C55E',
};

/**
 * Pick the lineup for a specific (game, team), in two steps:
 *
 *   1. Dressing — who's playing tonight. Loads the team roster, marks
 *      everyone already on the saved lineup, pre-checks RSVP'd-in players.
 *      Players who RSVP'd OUT are collapsed under "Marked out" — availability
 *      drives what's offered, but a coach can still expand and override
 *      (rec-hockey reality: people un-flake).
 *   2. Lines — optional line combinations on the dressed players.
 *      Forwards L1–L4, defense pairs 1–3, goalies Starter/Backup.
 *      Saving from step 1 without touching lines is still one tap.
 *
 * On save the rows carry player_id (identity resolved from the roster) and
 * the GS-5 resolver runs server-side to attribute any ghost rows.
 *
 * Props:
 *   open: bool
 *   onClose: () => void
 *   gameId, gameSource ('league'|'tournament'|'team'), teamId (REAL teams.id),
 *   lineupTeamId  — the league_teams.id or tournament_teams.id used as the
 *                   `team_id` on game_goals / game_lineups (so stats roll up)
 *   gameTitle (display only)
 *   onSaved: () => void
 */
export default function LineupModal({
  open, onClose, gameId, gameSource, teamId, lineupTeamId, gameTitle, onSaved,
}) {
  const [members, setMembers] = useState([]);
  const [rsvpStatus, setRsvpStatus] = useState({});   // user_id -> 'in'|'out'|'maybe'
  const [selected, setSelected] = useState(new Set()); // member.id values
  const [lines, setLines] = useState({});              // member.id -> 1..4
  const [step, setStep] = useState('dress');           // 'dress' | 'lines'
  const [showOut, setShowOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // P3 subs — pulled-for-tonight players from the league's sub pools.
  // {user_id, name, jersey (string, editable), is_goalie} per entry. Saved
  // subs are reconstructed from lineup rows whose user is not on the roster.
  const [subs, setSubs] = useState([]);
  const [showSubs, setShowSubs] = useState(false);
  const [subPools, setSubPools] = useState(null); // null = not loaded yet
  const [subAlertMsg, setSubAlertMsg] = useState(null);
  const [subAlertBusy, setSubAlertBusy] = useState(null); // pool.id while posting

  const load = useCallback(async () => {
    if (!open || !teamId || !gameId) return;
    setError(null);
    setStep('dress');
    setShowOut(false);
    setShowSubs(false);
    setSubPools(null);
    setSubAlertMsg(null);
    setSubAlertBusy(null);
    try {
      const [ms, lineup, rsvps] = await Promise.all([
        getTeamMembers(teamId),
        getLineup(gameId, lineupTeamId || teamId),
        supabase.from('team_game_rsvps').select('user_id, status').eq('game_id', gameId),
      ]);
      setMembers(ms);
      // Saved subs survive an edit: lineup rows whose user has NO roster spot
      // here are day-of pulls — without this they'd be silently dropped on the
      // next save (set_lineup is a full replace).
      setSubs(lineup
        .filter(l => l.user_id && !ms.some(m => m.user_id === l.user_id))
        .map(l => ({
          user_id: l.user_id,
          name: l.invite_name || 'Sub',
          jersey: l.jersey_number != null ? String(l.jersey_number) : '',
          is_goalie: !!l.is_goalie,
        })));
      const statusByUser = {};
      for (const r of (rsvps.data || [])) if (r.user_id) statusByUser[r.user_id] = r.status;
      setRsvpStatus(statusByUser);
      // Pre-select: anyone already on the saved lineup, otherwise anyone who
      // RSVP'd in. Restore saved line assignments alongside.
      if (lineup.length > 0) {
        const sel = new Set();
        const ln = {};
        for (const l of lineup) {
          const match = ms.find(m =>
            (l.user_id && m.user_id === l.user_id) ||
            (!l.user_id && m.jersey_number === l.jersey_number)
          );
          if (match) {
            sel.add(match.id);
            if (l.line != null) ln[match.id] = l.line;
          }
        }
        setSelected(sel);
        setLines(ln);
      } else {
        const sel = new Set();
        for (const m of ms) if (m.user_id && statusByUser[m.user_id] === 'in') sel.add(m.id);
        setSelected(sel);
        setLines({});
      }
    } catch (e) { setError(e.message); }
  }, [open, teamId, gameId, lineupTeamId]);

  useEffect(() => { load(); }, [load]);

  const isGoalieM = (m) => (m.role === 'goalie') || (m.position || '').toLowerCase().includes('goalie');
  const goalies  = useMemo(() => members.filter(isGoalieM), [members]);
  const defense  = useMemo(() => members.filter(m => !isGoalieM(m) && (m.position || '').toLowerCase().includes('def')), [members]);
  const forwards = useMemo(() => members.filter(m => !isGoalieM(m) && !defense.includes(m) && m.role !== 'manager' && m.role !== 'coach'), [members, defense]);

  const isOut = (m) => !!(m.user_id && rsvpStatus[m.user_id] === 'out');
  const rsvpInCount = useMemo(
    () => members.filter(m => m.user_id && rsvpStatus[m.user_id] === 'in').length,
    [members, rsvpStatus]
  );

  const toggle = (id) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) {
        n.delete(id);
        // A scratched player keeps no line slot.
        setLines(l => { const c = { ...l }; delete c[id]; return c; });
      } else n.add(id);
      return n;
    });
  };

  const selectAll  = () => setSelected(new Set(members.filter(m => !isOut(m)).map(m => m.id)));
  const selectNone = () => { setSelected(new Set()); setLines({}); };
  const selectRSVPed = () => {
    const sel = new Set();
    for (const m of members) if (m.user_id && rsvpStatus[m.user_id] === 'in') sel.add(m.id);
    setSelected(sel);
  };

  // ── P3 subs handlers ──────────────────────────────────────────────────────
  const toggleSubsPanel = async () => {
    setShowSubs(v => !v);
    if (subPools === null && gameSource === 'league') {
      try { setSubPools(await listSubPoolsForTeam(lineupTeamId || teamId)); }
      catch { setSubPools([]); }
    }
  };
  const addSub = (m, pool) => {
    if (!m.user_id) return;
    setSubs(s => s.some(x => x.user_id === m.user_id) ? s : [...s, {
      user_id: m.user_id,
      name: m.profile?.name || m.profile?.handle || 'Sub',
      jersey: m.jersey_number != null ? String(m.jersey_number) : '',
      is_goalie: pool.sub_pool_kind === 'goalies',
    }]);
  };
  const removeSub = (userId) => setSubs(s => s.filter(x => x.user_id !== userId));
  const setSubJersey = (userId, v) => setSubs(s => s.map(x => x.user_id === userId ? { ...x, jersey: v.replace(/[^0-9]/g, '').slice(0, 2) } : x));
  const alertPool = async (pool) => {
    if (subAlertBusy) return;
    setSubAlertBusy(pool.id); setSubAlertMsg(null);
    try {
      const { pushed } = await sendSubNeededAlert({ pool, gameTitle });
      setSubAlertMsg(pushed
        ? `Posted on ${pool.team_name} and pushed to the pool.`
        : `Posted on ${pool.team_name} — the push may be delayed.`);
    } catch (e) { setSubAlertMsg(`Could not post the alert: ${e.message}`); }
    finally { setSubAlertBusy(null); }
  };

  const setLine = (member, n) => {
    setLines(l => {
      const c = { ...l };
      if (c[member.id] === n) { delete c[member.id]; return c; }
      // Only one starting goalie: taking the net clears whoever held it.
      if (isGoalieM(member) && n === 1) {
        for (const g of goalies) if (g.id !== member.id && c[g.id] === 1) delete c[g.id];
      }
      c[member.id] = n;
      return c;
    });
  };

  const handleSave = async () => {
    setBusy(true); setError(null);
    try {
      const dressed = members.filter(m => selected.has(m.id));
      // Duplicate jerseys can't save (DB-unique per game+team) — catch it
      // here with a name-level message instead of a constraint error. Subs
      // count too: a pulled sub wearing a dressed player's number is the
      // most common collision on sub night.
      const seen = new Map();
      const jerseyEntries = [
        ...dressed.map(m => ({ jersey: m.jersey_number, label: m.profile?.name || m.invite_name || '?' })),
        ...subs.map(s => ({ jersey: s.jersey === '' ? null : parseInt(s.jersey, 10), label: `${s.name} (sub)` })),
      ];
      for (const e of jerseyEntries) {
        if (e.jersey == null) continue;
        if (seen.has(e.jersey)) {
          setError(`Two dressed players share #${e.jersey} (${seen.get(e.jersey)} and ${e.label}) — fix the jersey numbers first.`);
          setBusy(false);
          return;
        }
        seen.set(e.jersey, e.label);
      }
      // Goalies: a designated STARTER flips everyone else to backup; with no
      // starter designated (even if a backup is marked) keep the legacy
      // default so a lone goalie never reads as a non-starter.
      const starterGoalieId = goalies.find(g => selected.has(g.id) && lines[g.id] === 1)?.id || null;
      const players = dressed
        .map(m => {
          const goalie = isGoalieM(m);
          return {
            user_id: m.user_id || null,
            player_id: m.user_id || null,
            invite_name: m.invite_name || m.profile?.name || null,
            jersey_number: m.jersey_number,
            position: m.position,
            is_captain: m.is_captain,
            is_alternate: m.is_alternate,
            is_goalie: goalie,
            line: lines[m.id] != null ? lines[m.id] : null,
            is_starter: goalie && starterGoalieId ? m.id === starterGoalieId : true,
          };
        });
      // P3 day-of pulls: rows for users with no roster spot here. Saved
      // through the same RPC, so Migration H's minor gate is the authority —
      // an adult sub passes, a minor sub (pool-anchored only) is refused
      // with the gate's own message.
      const subPlayers = subs.map(s => ({
        user_id: s.user_id,
        player_id: s.user_id,
        invite_name: s.name,
        jersey_number: s.jersey === '' ? null : parseInt(s.jersey, 10),
        position: null,
        is_captain: false,
        is_alternate: false,
        is_goalie: s.is_goalie,
        line: null,
        is_starter: s.is_goalie && starterGoalieId ? false : true,
      }));
      await setLineup({ gameId, gameSource, teamId: lineupTeamId || teamId }, [...players, ...subPlayers]);
      // Best-effort GS-5 pass for ghost rows; never fails the save.
      await resolveLineupPlayers(gameId);
      onSaved?.();
      onClose?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  const dressedIn = (list) => list.filter(m => selected.has(m.id));
  const linesAssigned = Object.keys(lines).length;

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 14, maxWidth: 520, width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '20px 22px', fontFamily: "'Barlow', sans-serif", color: B.ice }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase' }}>Set Lineup</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: B.steel, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        {gameTitle && <div style={{ fontSize: 12, color: B.steel, marginBottom: 12 }}>{gameTitle}</div>}

        {/* Step toggle */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 12, background: B.navy, border: `1px solid ${B.border}`, borderRadius: 999, padding: 3 }}>
          {[['dress', `1 · Dressing (${selected.size})`], ['lines', `2 · Lines${linesAssigned ? ` (${linesAssigned})` : ''}`]].map(([key, label]) => (
            <button key={key} onClick={() => setStep(key)}
              style={{ flex: 1, padding: '7px 0', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                background: step === key ? B.blue : 'transparent', color: step === key ? '#fff' : B.steel }}>
              {label}
            </button>
          ))}
        </div>

        {error && <div style={{ background: 'rgba(215,38,56,0.12)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12, color: B.red }}>{error}</div>}

        {step === 'dress' && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button onClick={selectAll}    style={chip(B)}>Everyone</button>
              <button onClick={selectRSVPed} style={chip(B)}>✓ RSVP'd in ({rsvpInCount})</button>
              <button onClick={selectNone}   style={chip(B)}>Clear</button>
            </div>

            <Section title="Goalies"  list={goalies.filter(m => !isOut(m))}  selected={selected} toggle={toggle} />
            <Section title="Defense"  list={defense.filter(m => !isOut(m))}  selected={selected} toggle={toggle} />
            <Section title="Forwards" list={forwards.filter(m => !isOut(m))} selected={selected} toggle={toggle} />

            {members.some(isOut) && (
              <>
                <button onClick={() => setShowOut(v => !v)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: B.amber, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
                  {showOut ? '▾' : '▸'} Marked out ({members.filter(isOut).length})
                </button>
                {showOut && (
                  <Section title={null} list={members.filter(isOut)} selected={selected} toggle={toggle} outTag />
                )}
              </>
            )}

            {members.length === 0 && <div style={{ padding: 16, color: B.steel, fontSize: 13, textAlign: 'center' }}>This team has no roster yet — add players first.</div>}

            {/* P3 — day-of subs from the league's pools (league games only). */}
            {gameSource === 'league' && (
              <>
                <button onClick={toggleSubsPanel}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: B.blue, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
                  {showSubs ? '▾' : '▸'} Subs from the pool{subs.length ? ` (${subs.length} pulled)` : ''}
                </button>

                {subs.length > 0 && (
                  <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
                    {subs.map(s => (
                      <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(46,91,140,0.3)', color: B.steel, flexShrink: 0 }}>SUB</span>
                        <span style={{ fontSize: 13, color: B.ice, flex: 1 }}>{s.name}{s.is_goalie ? ' 🥅' : ''}</span>
                        <input value={s.jersey} onChange={e => setSubJersey(s.user_id, e.target.value)} placeholder="#"
                          inputMode="numeric"
                          style={{ width: 44, background: '#07111F', border: `1px solid ${B.border}`, borderRadius: 6, padding: '5px 6px', color: B.ice, fontSize: 13, textAlign: 'center', fontFamily: 'inherit' }} />
                        <button onClick={() => removeSub(s.user_id)} style={{ background: 'none', border: 'none', color: B.steel, fontSize: 15, cursor: 'pointer' }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {showSubs && (
                  subPools === null
                    ? <div style={{ padding: 10, color: B.steel, fontSize: 12 }}>Loading pools…</div>
                    : subPools.length === 0
                      ? <div style={{ padding: 10, color: B.steel, fontSize: 12, lineHeight: 1.5 }}>No sub pools yet — a commissioner can create them from League Manage → Teams.</div>
                      : subPools.map(pool => {
                          const candidates = pool.members.filter(m =>
                            m.user_id
                            && !subs.some(x => x.user_id === m.user_id)
                            && !members.some(x => x.user_id === m.user_id));
                          return (
                            <div key={pool.id} style={{ marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
                                  {pool.team_name}
                                </span>
                                <button onClick={() => alertPool(pool)} disabled={!!subAlertBusy}
                                  style={{ background: 'rgba(245,158,11,0.15)', border: `1px solid rgba(245,158,11,0.45)`, color: B.amber, borderRadius: 999, padding: '3px 10px', fontSize: 10.5, fontWeight: 700, cursor: subAlertBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                                  {subAlertBusy === pool.id ? 'Posting…' : '🚨 Sub needed — alert the pool'}
                                </button>
                              </div>
                              <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden' }}>
                                {candidates.length === 0 && <div style={{ padding: '8px 12px', color: B.steel, fontSize: 12 }}>No available players in this pool.</div>}
                                {candidates.map(m => (
                                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: 'rgba(244,247,250,0.5)', width: 24, textAlign: 'right' }}>{m.jersey_number || '—'}</span>
                                    <span style={{ fontSize: 13, color: B.ice, flex: 1 }}>{m.profile?.name || m.profile?.handle || 'Unknown'}</span>
                                    <button onClick={() => addSub(m, pool)}
                                      style={{ background: 'rgba(34,197,94,0.15)', border: `1px solid rgba(34,197,94,0.4)`, color: B.green, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                      + Pull in
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })
                )}
                {subAlertMsg && <div style={{ padding: '6px 2px', color: B.amber, fontSize: 11.5 }}>{subAlertMsg}</div>}
              </>
            )}
          </>
        )}

        {step === 'lines' && (
          <>
            <div style={{ fontSize: 11.5, color: B.steel, marginBottom: 10, lineHeight: 1.5 }}>
              Optional — tap a slot to assign. Forwards run L1–L4, defense pairs 1–3, and the starting goalie gets the net.
            </div>
            <LineSection title="Goalies"  list={dressedIn(goalies)}  lines={lines} setLine={setLine}
              slots={[[1, 'Starter'], [2, 'Backup']]} />
            <LineSection title="Defense"  list={dressedIn(defense)}  lines={lines} setLine={setLine}
              slots={[[1, 'P1'], [2, 'P2'], [3, 'P3']]} />
            <LineSection title="Forwards" list={dressedIn(forwards)} lines={lines} setLine={setLine}
              slots={[[1, 'L1'], [2, 'L2'], [3, 'L3'], [4, 'L4']]} />
            {selected.size === 0 && <div style={{ padding: 16, color: B.steel, fontSize: 13, textAlign: 'center' }}>No one's dressed yet — pick the lineup in step 1 first.</div>}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {step === 'dress' ? (
            <button onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          ) : (
            <button onClick={() => setStep('dress')} style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
          )}
          {step === 'dress' && (
            <button onClick={() => setStep('lines')} disabled={selected.size === 0}
              style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(46,91,140,0.35)', border: 'none', color: selected.size === 0 ? B.steel : '#fff', fontSize: 13, fontWeight: 700, cursor: selected.size === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              Lines →
            </button>
          )}
          <button onClick={handleSave} disabled={busy} style={{ flex: 2, padding: 10, borderRadius: 999, background: busy ? B.border : B.red, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Saving…' : `Save lineup (${selected.size + subs.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, list, selected, toggle, outTag = false }) {
  if (!list || list.length === 0) return null;
  return (
    <>
      {title && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', marginTop: 10, marginBottom: 6, fontFamily: "'Barlow Condensed', sans-serif" }}>{title}</div>}
      <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {list.map(m => {
          const isOn = selected.has(m.id);
          return (
            <label key={m.id} onClick={() => toggle(m.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `0.5px solid rgba(244,247,250,0.06)`, cursor: 'pointer', background: isOn ? 'rgba(34,197,94,0.08)' : 'transparent', opacity: outTag && !isOn ? 0.65 : 1 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${isOn ? B.green : B.border}`, background: isOn ? B.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {isOn && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>✓</span>}
              </div>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: 'rgba(244,247,250,0.5)', width: 24, textAlign: 'right' }}>{m.jersey_number || '—'}</span>
              <span style={{ fontSize: 13, color: B.ice }}>{m.profile?.name || m.invite_name || 'Unknown'}</span>
              {m.is_captain && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(215,38,56,0.2)', color: B.red }}>C</span>}
              {m.is_alternate && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(46,91,140,0.3)', color: B.steel }}>A</span>}
              {outTag && <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.18)', color: B.amber }}>OUT</span>}
            </label>
          );
        })}
      </div>
    </>
  );
}

function LineSection({ title, list, lines, setLine, slots }) {
  if (!list || list.length === 0) return null;
  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', marginTop: 10, marginBottom: 6, fontFamily: "'Barlow Condensed', sans-serif" }}>{title}</div>
      <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {list.map(m => {
          const current = lines[m.id];
          return (
            <div key={m.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `0.5px solid rgba(244,247,250,0.06)` }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: 'rgba(244,247,250,0.5)', width: 24, textAlign: 'right', flexShrink: 0 }}>{m.jersey_number || '—'}</span>
              <span style={{ fontSize: 13, color: B.ice, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.profile?.name || m.invite_name || 'Unknown'}</span>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {slots.map(([n, label]) => {
                  const active = current === n;
                  return (
                    <button key={n} onClick={() => setLine(m, n)}
                      style={{ minWidth: 30, padding: '4px 7px', borderRadius: 6, border: `1px solid ${active ? B.green : B.border}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700,
                        background: active ? 'rgba(34,197,94,0.18)' : 'transparent', color: active ? B.green : B.steel }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function chip(theme) {
  return {
    padding: '6px 11px', borderRadius: 999, background: 'rgba(46,91,140,0.18)',
    border: 'none', color: theme.ice, fontSize: 11, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  };
}
