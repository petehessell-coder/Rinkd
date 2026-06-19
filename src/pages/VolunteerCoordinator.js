import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout, { BRAND_COLORS as C } from '../components/Layout';
import { supabase } from '../lib/supabase';
import { listSlotsForTeams, listMyAssignedSlots, createSlot, updateSlot, deleteSlot, releaseSlot } from '../lib/volunteers';
import { getTeamGames } from '../lib/teams';
import { useUndoable } from '../components/ui';

const ROLE_PRESETS = ['Scorekeeper', 'Snack Parent', 'Locker Room Monitor', 'Gear Hauler', 'Statkeeper', 'Off-ice Official', 'Tournament Volunteer'];

const inputStyle = {
  width: '100%', background: '#07111F', border: `0.5px solid ${C.border}`,
  borderRadius: 8, padding: '9px 11px', color: C.ice,
  fontFamily: "'Barlow', sans-serif", fontSize: 13, outline: 'none',
};

/**
 * /volunteer-coordinator — manager-facing dashboard.
 *
 * Top: stat cards (open slots / assigned / past).
 * Middle: tab switcher Open ↔ Filled ↔ Past.
 * Bottom: "+ Add Slot" composer (pick team → pick game OR free-form role and time).
 *
 * Players don't land here today — they'd sign up via the per-game slot list on
 * the team Schedule tab (coming next iteration). Manager can also hand-assign
 * a slot to a roster player from here.
 */
export default function VolunteerCoordinator({ profile }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('open');
  const [teams, setTeams] = useState([]);
  const [slots, setSlots] = useState(null);
  const [mySlots, setMySlots] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setError(null);
    try {
      const { data: t } = await supabase.from('teams').select('id, name, logo_color, logo_initials, manager_id').eq('manager_id', profile.id);
      setTeams(t || []);
      const teamIds = (t || []).map(x => x.id);
      const [forTeams, mine] = await Promise.all([
        teamIds.length ? listSlotsForTeams(teamIds) : Promise.resolve([]),
        listMyAssignedSlots(profile.id),
      ]);
      setSlots(forTeams);
      setMySlots(mine);
    } catch (e) { setError(e.message); setSlots([]); }
  }, [profile?.id]);

  // Optimistically drop a slot from the list and return a synchronous restore
  // (re-inserts it at its original spot) for the deferred delete's Undo.
  const removeSlotFromList = useCallback((id) => {
    let prev;
    setSlots(cur => { prev = cur; return Array.isArray(cur) ? cur.filter(s => s.id !== id) : cur; });
    return () => { if (prev !== undefined) setSlots(prev); };
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const now = Date.now();
    const open = (slots || []).filter(s => !s.assigned_user_id && (!s.slot_time || new Date(s.slot_time).getTime() > now));
    const filled = (slots || []).filter(s => s.assigned_user_id && (!s.slot_time || new Date(s.slot_time).getTime() > now));
    const past = (slots || []).filter(s => s.slot_time && new Date(s.slot_time).getTime() <= now);
    return { open: open.length, filled: filled.length, past: past.length, total: (slots || []).length };
  }, [slots]);

  const visibleSlots = useMemo(() => {
    if (!slots) return [];
    const now = Date.now();
    if (tab === 'open')   return slots.filter(s => !s.assigned_user_id && (!s.slot_time || new Date(s.slot_time).getTime() > now));
    if (tab === 'filled') return slots.filter(s => s.assigned_user_id && (!s.slot_time || new Date(s.slot_time).getTime() > now));
    if (tab === 'past')   return slots.filter(s => s.slot_time && new Date(s.slot_time).getTime() <= now);
    return slots;
  }, [slots, tab]);

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: "'Barlow', sans-serif", color: C.ice }}>
        {/* Header */}
        <div style={{ background: C.navy, padding: '16px 20px', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ maxWidth: 920, margin: '0 auto' }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase' }}>Volunteer Coordinator</div>
            <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>Open up slots, see who's signed up, fill the rest yourself.</div>
          </div>
        </div>

        <div style={{ maxWidth: 920, margin: '0 auto', padding: 20 }}>
          {teams.length === 0 ? (
            <EmptyManager navigate={navigate} />
          ) : (
            <>
              {/* Stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                <StatCard num={counts.open}   label="Open slots"  color={counts.open > 0 ? '#F59E0B' : undefined} />
                <StatCard num={counts.filled} label="Filled"      color="#22C55E" />
                <StatCard num={counts.past}   label="Past"        color={C.steel} />
                <StatCard num={mySlots.length} label="Yours"      color={C.ice} />
              </div>

              {error && <div style={{ background: 'rgba(215,38,56,0.12)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 13, color: C.red }}>{error}</div>}

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {[['open','Open'], ['filled','Filled'], ['past','Past']].map(([key, label]) => (
                  <button key={key} onClick={() => setTab(key)}
                    style={{
                      padding: '7px 14px', borderRadius: 999,
                      background: tab === key ? C.red : 'rgba(46,91,140,0.18)',
                      color: tab === key ? '#fff' : C.steel,
                      border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      fontFamily: 'inherit',
                    }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Slot list */}
              <SlotList slots={visibleSlots} teams={teams} onChange={load} onOptimisticRemove={removeSlotFromList} profile={profile} />

              {/* Add slot composer */}
              <NewSlotForm teams={teams} onCreated={load} />
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

function EmptyManager({ navigate }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '40px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🙋</div>
      <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', fontSize: 24, marginBottom: 8 }}>Volunteer Coordinator</h1>
      <p style={{ fontSize: 14, color: C.steel, lineHeight: 1.5, marginBottom: 18 }}>
        This page is for team managers. You'll see open volunteer slots for teams you manage,
        let players sign up, and fill the gaps. Manage a team first to get started.
      </p>
      <button onClick={() => navigate('/team/create')}
        style={{ padding: '10px 22px', borderRadius: 999, background: C.red, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        Create a team
      </button>
    </div>
  );
}

function StatCard({ num, label, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, color: color || C.ice, lineHeight: 1 }}>{num}</div>
      <div style={{ fontSize: 11, color: C.steel, marginTop: 4, letterSpacing: '0.04em' }}>{label}</div>
    </div>
  );
}

function SlotList({ slots, teams, onChange, onOptimisticRemove, profile }) {
  if (!slots) return <div style={{ padding: 30, textAlign: 'center', color: C.steel, fontSize: 13 }}>Getting the ice ready.</div>;
  if (slots.length === 0) return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.steel, fontSize: 13, marginBottom: 14 }}>
      Nothing here. Use the form below to add a slot.
    </div>
  );

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
      {slots.map(s => <SlotRow key={s.id} slot={s} teams={teams} onChange={onChange} onOptimisticRemove={onOptimisticRemove} profile={profile} />)}
    </div>
  );
}

function SlotRow({ slot, teams, onChange, onOptimisticRemove, profile }) {
  const team = slot.team || teams.find(t => t.id === slot.team_id);
  const dateStr = slot.slot_time
    ? new Date(slot.slot_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No date set';
  const assigned = slot.assigned_user;
  const [busy, setBusy] = useState(false);
  const runUndoable = useUndoable();

  // Optimistic delete + 5s Undo (no confirm) — the real delete is deferred, so
  // Undo just cancels it; restore re-inserts the still-present slot instantly
  // (no network, so it can't fail on flaky rink wifi).
  const handleDelete = () => runUndoable({
    message: `"${slot.role}" slot removed`,
    apply: () => onOptimisticRemove?.(slot.id),
    commit: async () => { await deleteSlot(slot.id); try { await onChange(); } catch { /* reconcile only */ } },
    errorMessage: "That didn't go through — it's back. Try again.",
  });
  const handleRelease = async () => {
    setBusy(true); try { await releaseSlot(slot.id); onChange(); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
      <div style={{ width: 38, height: 38, borderRadius: 9, background: team?.logo_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff', flexShrink: 0 }}>
        {team?.logo_initials || (team?.name || '?').slice(0, 2).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{slot.role}</div>
        <div style={{ fontSize: 11, color: C.steel, marginTop: 1 }}>
          {team?.name || 'Unknown team'} · {dateStr}{slot.notes ? ` · ${slot.notes}` : ''}
        </div>
        {assigned && (
          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: assigned.avatar_color || C.blue, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#fff', fontFamily: "'Barlow Condensed', sans-serif" }}>
              {assigned.avatar_initials || (assigned.name || '?').slice(0, 2).toUpperCase()}
            </span>
            <span style={{ fontSize: 11, color: '#22C55E', fontWeight: 600 }}>{assigned.name} signed up</span>
          </div>
        )}
      </div>
      {assigned ? (
        <button onClick={handleRelease} disabled={busy}
          style={{ background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 999, color: C.steel, fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Open up
        </button>
      ) : (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: '#F59E0B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Open</span>
      )}
      <button onClick={handleDelete} disabled={busy}
        style={{ background: 'transparent', border: 'none', color: 'rgba(244,247,250,0.3)', fontSize: 16, cursor: 'pointer', padding: 4 }} title="Delete">🗑</button>
    </div>
  );
}

function NewSlotForm({ teams, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ team_id: teams[0]?.id || '', role: ROLE_PRESETS[0], notes: '', slot_time: '' });
  const [games, setGames] = useState([]);
  const [gameChoice, setGameChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (teams.length && !form.team_id) setForm(p => ({ ...p, team_id: teams[0].id })); }, [teams, form.team_id]);

  // When team changes, load its games so manager can pin the slot to a specific game
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!form.team_id) { setGames([]); return; }
      try {
        const tgs = await getTeamGames(form.team_id);
        if (cancelled) return;
        const upcoming = tgs.filter(g => g.status === 'scheduled').slice(0, 30);
        setGames(upcoming);
      } catch { setGames([]); }
    }
    run();
    return () => { cancelled = true; };
  }, [form.team_id]);

  const handleGameChange = (e) => {
    const v = e.target.value;
    setGameChoice(v);
    if (v) {
      const g = games.find(x => x.id === v);
      if (g) setForm(p => ({ ...p, slot_time: g.start_time }));
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.team_id) { setError('Pick a team.'); return; }
    if (!form.role.trim()) { setError('Role is required.'); return; }
    setBusy(true);
    try {
      const g = gameChoice ? games.find(x => x.id === gameChoice) : null;
      await createSlot({
        team_id: form.team_id,
        role: form.role,
        notes: form.notes,
        slot_time: form.slot_time || null,
        game_id: gameChoice || null,
        game_source: g ? (g._source || 'team') : null,
      });
      setForm({ team_id: form.team_id, role: ROLE_PRESETS[0], notes: '', slot_time: '' });
      setGameChoice('');
      setOpen(false);
      if (onCreated) onCreated();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{
          width: '100%', padding: 12, background: 'rgba(46,91,140,0.15)',
          border: `1px dashed ${C.border}`, borderRadius: 12, color: C.ice,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
        <span style={{ fontSize: 18 }}>+</span> Add Volunteer Slot
      </button>
    );
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>New slot</div>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: C.steel, fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <Field label="Team">
          <select style={inputStyle} value={form.team_id} onChange={e => setForm(p => ({ ...p, team_id: e.target.value }))}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Role">
          <select style={inputStyle} value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
            {ROLE_PRESETS.map(r => <option key={r} value={r}>{r}</option>)}
            <option value="__custom">Custom…</option>
          </select>
        </Field>
      </div>
      {form.role === '__custom' && (
        <Field label="Custom role">
          <input style={inputStyle} placeholder="e.g. Anthem singer"
            onChange={e => setForm(p => ({ ...p, role: e.target.value }))} />
        </Field>
      )}
      <Field label="Tie to a game (optional)">
        <select style={inputStyle} value={gameChoice} onChange={handleGameChange}>
          <option value="">— No specific game —</option>
          {games.map(g => (
            <option key={g.id} value={g.id}>
              {new Date(g.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {g.is_home ? 'vs.' : '@'} {g.opponent || (g._league_name ? 'league game' : 'opponent')}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <Field label="Slot time">
          <input type="datetime-local" style={inputStyle} value={form.slot_time ? toLocal(form.slot_time) : ''}
            onChange={e => setForm(p => ({ ...p, slot_time: e.target.value ? new Date(e.target.value).toISOString() : '' }))} />
        </Field>
        <Field label="Notes (optional)">
          <input style={inputStyle} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Bring stopwatch" />
        </Field>
      </div>
      {error && <div style={{ marginTop: 10, color: C.red, fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={() => setOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: C.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        <button onClick={handleSubmit} disabled={busy} style={{ flex: 2, padding: 10, borderRadius: 999, background: busy ? C.border : C.red, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {busy ? 'Saving…' : 'Add slot'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, fontFamily: "'Barlow Condensed', sans-serif" }}>{label}</div>
      {children}
    </div>
  );
}

function toLocal(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
