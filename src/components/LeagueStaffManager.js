import React, { useCallback, useEffect, useState } from 'react';
import {
  listLeagueStaff, assignLeagueManagerByInput, removeLeagueManager, revokeLeagueManagerInvite,
} from '../lib/leagueManagers';
import { useUndoable } from './ui';
import { C, colors } from '../lib/tokens';

// LEAGUE-MGR-1 — the commissioner-only "Staff" tab. Add/remove league managers
// (operational staff: teams/schedule/divisions/playoffs/feed + join-requests;
// NOT settings/billing/activation/delete/staff). Add by @handle (existing account)
// or email (magic-link invite). Mirrors the team-manager assign flow one level up.
//
//   <LeagueStaffManager leagueId={id} leagueName={...} invitedBy={...} />

const LOCAL = { dim: '#7C8B9F', panel: '#11253E', green: '#5BCF8E', amber: '#E0A93B' };
const inputStyle = { width: '100%', boxSizing: 'border-box', background: C.dark, color: C.ice, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 11px', fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none' };
const label = { fontSize: 11, fontWeight: 700, color: C.steel, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 5 };
const pillBtn = (bg, fg, brd) => ({ background: bg, color: fg, border: brd || 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' });

const initials = (m) => m.avatar_initials || (m.name || m.handle || '?').slice(0, 2).toUpperCase();

export default function LeagueStaffManager({ leagueId, leagueName, invitedBy }) {
  const [staff, setStaff] = useState(null); // null = loading; { managers, pending_invites }
  const [input, setInput] = useState('');
  const [fallbackEmail, setFallbackEmail] = useState('');
  const [needsEmailFor, setNeedsEmailFor] = useState(null); // handle that didn't resolve
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const runUndoable = useUndoable();
  const flash = (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };

  const load = useCallback(async () => {
    try { setStaff(await listLeagueStaff(leagueId)); }
    catch (e) { flash('err', e.message || "Couldn't load staff — check your connection and try again."); setStaff({ managers: [], pending_invites: [] }); }
  }, [leagueId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const raw = input.trim();
    if (!raw) { flash('err', 'Enter a handle or email to add a manager.'); return; }
    setBusy(true); setMsg(null);
    const res = await assignLeagueManagerByInput({
      leagueId, input: raw, leagueName, invitedBy,
      fallbackEmail: needsEmailFor ? fallbackEmail : null,
    });
    setBusy(false);
    if (res.status === 'assigned') {
      flash('ok', `Manager added: ${res.profile.name || '@' + res.profile.handle}`);
      setInput(''); setFallbackEmail(''); setNeedsEmailFor(null);
      await load();
    } else if (res.status === 'invited') {
      flash('ok', `Invite emailed to ${res.email}. They become a manager once they sign up + click the link.`);
      setInput(''); setFallbackEmail(''); setNeedsEmailFor(null);
      await load();
    } else if (res.status === 'needs_email') {
      setNeedsEmailFor(res.handle);
      flash('err', `No Rinkd account for "@${res.handle}". Enter their email and we'll send an invite.`);
    } else {
      flash('err', res.message || "Couldn't add that manager — double-check the handle or email and try again.");
    }
  };

  // Optimistic remove + 5s Undo (no confirm) — the delete is deferred, so Undo
  // just cancels it; restore re-inserts the still-present row instantly (no
  // network, so it can't fail on flaky rink wifi).
  const remove = (m) => runUndoable({
    message: `${m.name || '@' + m.handle} removed`,
    apply: () => {
      let prev;
      setStaff((s) => { prev = s; return s ? { ...s, managers: (s.managers || []).filter((x) => x.user_id !== m.user_id) } : s; });
      return () => { if (prev !== undefined) setStaff(prev); };
    },
    commit: async () => { const r = await removeLeagueManager(leagueId, m.user_id); if (r && r.error) throw r.error; load().catch(() => {}); },
    errorMessage: "That didn't go through — they're back. Try again.",
  });

  const revoke = (inv) => runUndoable({
    message: `Invite to ${inv.email} revoked`,
    apply: () => {
      let prev;
      setStaff((s) => { prev = s; return s ? { ...s, pending_invites: (s.pending_invites || []).filter((x) => x.id !== inv.id) } : s; });
      return () => { if (prev !== undefined) setStaff(prev); };
    },
    commit: async () => { const r = await revokeLeagueManagerInvite(inv.id); if (r && r.error) throw r.error; load().catch(() => {}); },
    errorMessage: "That didn't go through — the invite's back. Try again.",
  });

  const managers = staff?.managers || [];
  const invites = staff?.pending_invites || [];

  return (
    <div style={{ fontFamily: 'Barlow, sans-serif' }}>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
        Add managers to help run the league — they can manage teams, the schedule, divisions, playoffs, the feed, and roster join-requests. They <strong>cannot</strong> change league settings, billing, activation, delete the league, or manage staff.
      </div>

      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.kind === 'ok' ? LOCAL.green : colors.redSoft }}>{msg.text}</div>}

      {/* Add manager */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 12 }}>Add a Manager</div>
        <label style={label}>Handle or email</label>
        <input value={input} onChange={(e) => { setInput(e.target.value); setNeedsEmailFor(null); }} placeholder="@handle or name@email.com"
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) add(); }} style={inputStyle} />
        {needsEmailFor && (
          <div style={{ marginTop: 10 }}>
            <label style={label}>Email for @{needsEmailFor} (send an invite)</label>
            <input value={fallbackEmail} onChange={(e) => setFallbackEmail(e.target.value)} placeholder="name@email.com"
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) add(); }} style={inputStyle} />
          </div>
        )}
        <div style={{ fontSize: 11, color: LOCAL.dim, marginTop: 8 }}>
          Existing account → added right away. No account yet → we email a one-time magic link (expires in 14 days); they become a manager after signing up with that email and clicking it.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={add} disabled={busy} style={pillBtn(busy ? C.border : C.blue, '#fff')}>{busy ? 'Working…' : (needsEmailFor ? 'Send invite' : 'Add manager')}</button>
        </div>
      </div>

      {/* Current managers */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>Managers</div>
      {staff === null ? (
        <div style={{ color: LOCAL.dim, fontSize: 13, padding: '14px 0' }}>Warming up.</div>
      ) : managers.length === 0 ? (
        <div style={{ color: LOCAL.dim, fontSize: 13, padding: '14px 0' }}>No managers yet — add one above to share the workload. You keep full commissioner control either way.</div>
      ) : managers.map((m) => (
        <div key={m.user_id} style={{ background: LOCAL.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 38, height: 38, borderRadius: 999, background: m.avatar_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#fff', flexShrink: 0 }}>{initials(m)}</div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ color: C.ice, fontWeight: 700, fontSize: 14 }}>{m.name || `@${m.handle}`}</div>
            <div style={{ color: LOCAL.dim, fontSize: 12 }}>{m.handle ? `@${m.handle}` : ''} · Manager</div>
          </div>
          <button onClick={() => remove(m)} style={pillBtn('transparent', colors.redSoft, `1px solid ${colors.redSoft}`)}>Remove</button>
        </div>
      ))}

      {/* Pending invites */}
      {invites.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', margin: '18px 0 8px' }}>Pending invites</div>
          {invites.map((inv) => (
            <div key={inv.id} style={{ background: LOCAL.panel, border: `1px dashed ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 18 }}>✉️</div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ color: C.ice, fontWeight: 700, fontSize: 14 }}>{inv.email}</div>
                <div style={{ color: LOCAL.amber, fontSize: 12 }}>Invited · awaiting signup{inv.expires_at ? ` · expires ${new Date(inv.expires_at).toLocaleDateString()}` : ''}</div>
              </div>
              <button onClick={() => revoke(inv)} style={pillBtn('transparent', colors.redSoft, `1px solid ${colors.redSoft}`)}>Revoke</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
