import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getTeamMembers } from '../lib/teams';
import { getLineup, setLineup } from '../lib/lineups';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE',
  card: '#112236', border: '#1E3A5C', amber: '#F59E0B', green: '#22C55E',
};

/**
 * Pick the lineup for a specific (game, team). Loads the team roster, marks
 * everyone who's already on the lineup, and lets the manager toggle players
 * in/out. Defaults pre-check anyone who RSVP'd "in" so it's fast.
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
  const [rsvpIns, setRsvpIns] = useState(new Set());
  const [selected, setSelected] = useState(new Set()); // member.id values
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!open || !teamId || !gameId) return;
    setError(null);
    try {
      const [ms, lineup, rsvps] = await Promise.all([
        getTeamMembers(teamId),
        getLineup(gameId, lineupTeamId || teamId),
        supabase.from('team_game_rsvps').select('user_id, status').eq('game_id', gameId).eq('status', 'in'),
      ]);
      setMembers(ms);
      const ins = new Set((rsvps.data || []).map(r => r.user_id).filter(Boolean));
      setRsvpIns(ins);
      // Pre-select: anyone already on the saved lineup, otherwise anyone who RSVP'd in.
      if (lineup.length > 0) {
        const sel = new Set();
        for (const l of lineup) {
          const match = ms.find(m =>
            (l.user_id && m.user_id === l.user_id) ||
            (!l.user_id && m.jersey_number === l.jersey_number)
          );
          if (match) sel.add(match.id);
        }
        setSelected(sel);
      } else {
        const sel = new Set();
        for (const m of ms) if (m.user_id && ins.has(m.user_id)) sel.add(m.id);
        setSelected(sel);
      }
    } catch (e) { setError(e.message); }
  }, [open, teamId, gameId, lineupTeamId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAll  = () => setSelected(new Set(members.map(m => m.id)));
  const selectNone = () => setSelected(new Set());
  const selectRSVPed = () => {
    const sel = new Set();
    for (const m of members) if (m.user_id && rsvpIns.has(m.user_id)) sel.add(m.id);
    setSelected(sel);
  };

  const handleSave = async () => {
    setBusy(true); setError(null);
    try {
      const players = members
        .filter(m => selected.has(m.id))
        .map(m => ({
          user_id: m.user_id || null,
          invite_name: m.invite_name || m.profile?.name || null,
          jersey_number: m.jersey_number,
          position: m.position,
          is_captain: m.is_captain,
          is_alternate: m.is_alternate,
          is_goalie: (m.role === 'goalie') || (m.position || '').toLowerCase().includes('goalie'),
        }));
      await setLineup({ gameId, gameSource, teamId: lineupTeamId || teamId }, players);
      onSaved?.();
      onClose?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  const goalies = members.filter(m => (m.role === 'goalie') || (m.position || '').toLowerCase().includes('goalie'));
  const defense = members.filter(m => !goalies.includes(m) && (m.position || '').toLowerCase().includes('def'));
  const forwards = members.filter(m => !goalies.includes(m) && !defense.includes(m) && m.role !== 'manager' && m.role !== 'coach');

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

        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button onClick={selectAll}    style={chip(B)}>Everyone</button>
          <button onClick={selectRSVPed} style={chip(B)}>✓ RSVP'd in ({[...rsvpIns].length})</button>
          <button onClick={selectNone}   style={chip(B)}>Clear</button>
          <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11, color: B.steel }}>{selected.size} selected</span>
        </div>

        {error && <div style={{ background: 'rgba(215,38,56,0.12)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12, color: B.red }}>{error}</div>}

        <Section title="Goalies"   list={goalies}   selected={selected} toggle={toggle} />
        <Section title="Defense"   list={defense}   selected={selected} toggle={toggle} />
        <Section title="Forwards"  list={forwards}  selected={selected} toggle={toggle} />
        {members.length === 0 && <div style={{ padding: 16, color: B.steel, fontSize: 13, textAlign: 'center' }}>This team has no roster yet — add players first.</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={handleSave} disabled={busy} style={{ flex: 2, padding: 10, borderRadius: 999, background: busy ? B.border : B.red, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Saving…' : `Save lineup (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, list, selected, toggle }) {
  if (!list || list.length === 0) return null;
  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', marginTop: 10, marginBottom: 6, fontFamily: "'Barlow Condensed', sans-serif" }}>{title}</div>
      <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {list.map(m => {
          const isOn = selected.has(m.id);
          return (
            <label key={m.id} onClick={() => toggle(m.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `0.5px solid rgba(244,247,250,0.06)`, cursor: 'pointer', background: isOn ? 'rgba(34,197,94,0.08)' : 'transparent' }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${isOn ? B.green : B.border}`, background: isOn ? B.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {isOn && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>✓</span>}
              </div>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: 'rgba(244,247,250,0.5)', width: 24, textAlign: 'right' }}>{m.jersey_number || '—'}</span>
              <span style={{ fontSize: 13, color: B.ice }}>{m.profile?.name || m.invite_name || 'Unknown'}</span>
              {m.is_captain && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(215,38,56,0.2)', color: B.red }}>C</span>}
              {m.is_alternate && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(46,91,140,0.3)', color: B.steel }}>A</span>}
            </label>
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
