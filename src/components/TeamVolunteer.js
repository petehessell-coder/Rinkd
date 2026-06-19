import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listTeamSlots, createSlot, deleteSlot, claimSlot, releaseSlot } from '../lib/volunteers';
import { getTeamGames } from '../lib/teams';
import { useUndoable } from './ui';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847',
  border: 'rgba(46,91,140,0.4)', green: '#22C55E', amber: '#F59E0B',
};

const ROLE_PRESETS = ['Scorekeeper', 'Snack Parent', 'Locker Room Monitor', 'Gear Hauler', 'Statkeeper', 'Off-ice Official', 'Tournament Volunteer'];

const inputStyle = {
  width: '100%', background: '#07111F', border: `0.5px solid ${C.border}`,
  borderRadius: 8, padding: '9px 11px', color: C.ice,
  fontFamily: "'Barlow', sans-serif", fontSize: 13, outline: 'none',
};

/**
 * Volunteer surface scoped to a single team. Lives on the Team page's
 * Volunteer tab (src/pages/Team.js).
 *
 *   - Players see open slots and can Claim/Release their own assignments.
 *   - Managers additionally see + Add Volunteer Slot and a Delete affordance.
 *   - Past slots auto-hide; toggle button reveals them when audit is needed.
 */
export default function TeamVolunteer({ teamId, isManager, currentUser }) {
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listTeamSlots(teamId);
      setSlots(data);
      setError(null);
    } catch (e) { setError(e.message); }
  }, [teamId]);

  // Optimistically drop a slot from the list (used by the deferred delete + Undo).
  const removeSlotFromList = useCallback((id) => {
    setSlots(prev => Array.isArray(prev) ? prev.filter(s => s.id !== id) : prev);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (slots === null) {
    return <div style={{ padding: 30, textAlign: 'center', color: C.steel, fontSize: 13 }}>Warming up.</div>;
  }

  const now = Date.now();
  const upcoming = slots.filter(s => !s.slot_time || new Date(s.slot_time).getTime() > now);
  const past = slots.filter(s => s.slot_time && new Date(s.slot_time).getTime() <= now);
  const openCount = upcoming.filter(s => !s.assigned_user_id).length;
  const filledCount = upcoming.filter(s => s.assigned_user_id).length;

  return (
    <div>
      {/* Stat strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <StatPill num={openCount}   label="Open"   color={openCount > 0 ? C.amber : undefined} />
        <StatPill num={filledCount} label="Filled" color={C.green} />
        {past.length > 0 && <StatPill num={past.length} label="Past" color={C.steel} />}
      </div>

      {error && (
        <div style={{ background: 'rgba(215,38,56,0.12)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      {/* Upcoming slots */}
      {upcoming.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.steel, fontSize: 13, marginBottom: 14 }}>
          {isManager ? 'No volunteer slots yet — post one below and the team can sign up.' : 'No slots posted yet. Check back when the manager opens some up.'}
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
          {upcoming.map(s => (
            <SlotRow
              key={s.id}
              slot={s}
              isManager={isManager}
              currentUser={currentUser}
              onChange={load}
              onOptimisticRemove={removeSlotFromList}
            />
          ))}
        </div>
      )}

      {/* Past slots toggle */}
      {past.length > 0 && (
        <>
          <button onClick={() => setShowPast(p => !p)} style={{ background: 'transparent', border: 'none', color: C.steel, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer', marginBottom: 8, padding: '4px 0' }}>
            {showPast ? '▲ Hide past' : `▼ Show ${past.length} past`}
          </button>
          {showPast && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14, opacity: 0.7 }}>
              {past.map(s => (
                <SlotRow
                  key={s.id}
                  slot={s}
                  isManager={isManager}
                  currentUser={currentUser}
                  onChange={load}
                  isPast
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Manager-only: add slot */}
      {isManager && <NewSlotForm teamId={teamId} onCreated={load} />}
    </div>
  );
}

function StatPill({ num, label, color }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '8px 12px', flex: 1, textAlign: 'center',
    }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: color || C.ice, lineHeight: 1 }}>{num}</div>
      <div style={{ fontSize: 10, color: C.steel, marginTop: 2, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function SlotRow({ slot, isManager, currentUser, onChange, onOptimisticRemove, isPast }) {
  const [busy, setBusy] = useState(false);
  const runUndoable = useUndoable();
  const assigned = slot.assigned_user;
  const isClaimedByMe = currentUser && slot.assigned_user_id === currentUser.id;
  const dateStr = slot.slot_time
    ? new Date(slot.slot_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No date set';

  const wrap = async (fn) => {
    setBusy(true);
    try { await fn(); await onChange(); }
    catch (e) { alert(e.message || "That didn't go through — check your connection and try again."); }
    finally { setBusy(false); }
  };

  // Optimistic delete + 5s Undo (no confirm) — the real delete is deferred, so
  // Undo just cancels it; restore re-fetches the still-present slot.
  const remove = () => runUndoable({
    message: `"${slot.role}" slot removed`,
    apply: () => { onOptimisticRemove?.(slot.id); return onChange; },
    commit: async () => { await deleteSlot(slot.id); await onChange(); },
    errorMessage: "That didn't go through — it's back. Try again.",
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{slot.role}</div>
        <div style={{ fontSize: 11, color: C.steel, marginTop: 1 }}>
          {dateStr}{slot.notes ? ` · ${slot.notes}` : ''}
        </div>
        {assigned && (
          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: assigned.avatar_color || C.blue, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#fff', fontFamily: "'Barlow Condensed', sans-serif" }}>
              {assigned.avatar_initials || (assigned.name || '?').slice(0, 2).toUpperCase()}
            </span>
            <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>
              {isClaimedByMe ? "You're signed up" : `${assigned.name} signed up`}
            </span>
          </div>
        )}
      </div>

      {/* Action button */}
      {!isPast && (
        <>
          {!assigned && currentUser && (
            <button onClick={() => wrap(() => claimSlot(slot.id))} disabled={busy}
              style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {busy ? '…' : 'Claim'}
            </button>
          )}
          {assigned && (isClaimedByMe || isManager) && (
            <button onClick={() => wrap(() => releaseSlot(slot.id))} disabled={busy}
              style={{ background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 999, color: C.steel, fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {isClaimedByMe ? 'Cancel' : 'Open up'}
            </button>
          )}
          {!assigned && !currentUser && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: C.amber, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Open</span>
          )}
        </>
      )}

      {/* Manager-only delete */}
      {isManager && !isPast && (
        <button onClick={remove} disabled={busy}
          style={{ background: 'transparent', border: 'none', color: 'rgba(244,247,250,0.3)', fontSize: 15, cursor: 'pointer', padding: 4 }} title="Delete">
          🗑
        </button>
      )}
    </div>
  );
}

function NewSlotForm({ teamId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ role: ROLE_PRESETS[0], custom_role: '', notes: '', slot_time: '' });
  const [games, setGames] = useState([]);
  const [gameChoice, setGameChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Load this team's upcoming games so the manager can pin the slot to a game.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const tgs = await getTeamGames(teamId);
        if (cancelled) return;
        setGames(tgs.filter(g => g.status === 'scheduled').slice(0, 30));
      } catch { setGames([]); }
    }
    if (open) run();
    return () => { cancelled = true; };
  }, [teamId, open]);

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
    const role = form.role === '__custom' ? form.custom_role.trim() : form.role;
    if (!role) { setError('Name the role to post this slot.'); return; }
    setBusy(true);
    try {
      const g = gameChoice ? games.find(x => x.id === gameChoice) : null;
      await createSlot({
        team_id: teamId,
        role,
        notes: form.notes,
        slot_time: form.slot_time || null,
        game_id: gameChoice || null,
        game_source: g ? (g._source || 'team') : null,
      });
      setForm({ role: ROLE_PRESETS[0], custom_role: '', notes: '', slot_time: '' });
      setGameChoice('');
      setOpen(false);
      onCreated?.();
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
      <Field label="Role">
        <select style={inputStyle} value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
          {ROLE_PRESETS.map(r => <option key={r} value={r}>{r}</option>)}
          <option value="__custom">Custom…</option>
        </select>
      </Field>
      {form.role === '__custom' && (
        <Field label="Custom role">
          <input style={inputStyle} placeholder="e.g. Anthem singer" value={form.custom_role}
            onChange={e => setForm(p => ({ ...p, custom_role: e.target.value }))} />
        </Field>
      )}
      {games.length > 0 && (
        <Field label="Pin to game (optional)">
          <select style={inputStyle} value={gameChoice} onChange={handleGameChange}>
            <option value="">— None —</option>
            {games.map(g => (
              <option key={g.id} value={g.id}>
                {new Date(g.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {g.opponent || 'TBD'}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={gameChoice ? 'Time (auto-set from game)' : 'Time'}>
        <input style={{ ...inputStyle, opacity: gameChoice ? 0.6 : 1 }} type="datetime-local"
          value={form.slot_time ? new Date(form.slot_time).toISOString().slice(0, 16) : ''}
          onChange={e => setForm(p => ({ ...p, slot_time: e.target.value }))}
          disabled={!!gameChoice} />
      </Field>
      <Field label="Notes (optional)">
        <input style={inputStyle} value={form.notes} placeholder="e.g. Arrive 30 min early"
          onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
      </Field>
      {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <button onClick={handleSubmit} disabled={busy}
        style={{ width: '100%', padding: 11, background: C.red, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
        {busy ? 'Saving…' : 'Add slot'}
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.steel, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5, fontFamily: "'Barlow Condensed', sans-serif" }}>{label}</label>
      {children}
    </div>
  );
}
