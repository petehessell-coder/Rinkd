import React, { useEffect, useState } from 'react';
import { Avatar } from './Logos';
import { supabase } from '../lib/supabase';
import {
  getEventPlayerRegistrations, assignRegistrantToTeam, saveWaiverTemplate, regPaymentState,
  getMoneySummary, refundRegistration,
} from '../lib/playerReg';

// REG-3 — org-side player registrations, dropped into the existing
// Registrations tab of LeagueManage + TournamentManage:
//   • settings: per-player fee, open/close toggle, shareable link, waiver editor
//   • the Players list: paid state, waiver state, assign-to-roster (league only)
// All money state reads the spine; assignment uses the consented
// assign_registrant_to_team RPC (migration F).

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
  green: '#22C55E', amber: '#F59E0B',
};
const fmt$ = (c) => `$${((c || 0) / 100).toFixed(2)}`;

export default function PlayerRegistrationsSection({ kind, event, onEventUpdate }) {
  const targetId = event?.id;
  const [regs, setRegs] = useState([]);
  const [teams, setTeams] = useState([]);          // league teams w/ global team link
  const [waiver, setWaiver] = useState(null);
  const [feeDollars, setFeeDollars] = useState(((event?.player_fee_cents || 0) / 100).toString());
  const [open, setOpen] = useState(!!event?.player_registration_open);
  const [maxInst, setMaxInst] = useState(String(event?.player_installments_max || 1));
  const [money, setMoney] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [waiverEditing, setWaiverEditing] = useState(false);

  const load = async () => {
    if (!targetId) return;
    try {
      const [r, w] = await Promise.all([
        getEventPlayerRegistrations(kind, targetId),
        supabase.from('waiver_templates').select('id, title, body_md, required, version')
          .eq('owner_type', kind).eq('owner_id', targetId).maybeSingle().then(x => x.data),
      ]);
      setRegs(r); setWaiver(w);
      // Money summary is org-gated in SQL; ignore failures (pre-migration etc.)
      getMoneySummary(kind, targetId).then(setMoney).catch(() => setMoney(null));
      if (kind === 'league') {
        const { data: lt } = await supabase
          .from('league_teams')
          .select('id, team_id, team_name, team:teams(id, name)')
          .eq('league_id', targetId);
        setTeams((lt || []).filter(t => t.team_id));   // assign needs a global team
      }
    } catch (e) {
      setErr(e?.message || 'Could not load player registrations.');
    }
  };
  // Reload when the event changes. `load` reads only kind/targetId-derived state.
  useEffect(() => { load(); }, [kind, targetId]); // eslint-disable-line

  const saveSettings = async () => {
    setBusy(true); setErr('');
    try {
      const cents = Math.max(Math.round(parseFloat(feeDollars || '0') * 100) || 0, 0);
      if (cents > 0 && cents < 100) {
        setErr('Player fee must be $0 (free) or at least $1.00 — card processing can\'t charge less.');
        setBusy(false);
        return;
      }
      const nInst = Math.min(Math.max(parseInt(maxInst, 10) || 1, 1), 12);
      const table = kind === 'tournament' ? 'tournaments' : 'leagues';
      const { error } = await supabase.from(table)
        .update({ player_fee_cents: cents, player_registration_open: open, player_installments_max: nInst })
        .eq('id', targetId);
      if (error) throw error;
      setMaxInst(String(nInst));
      onEventUpdate?.({ player_fee_cents: cents, player_registration_open: open, player_installments_max: nInst });
    } catch (e) { setErr(e?.message || 'Could not save.'); }
    finally { setBusy(false); }
  };

  const regLink = `${window.location.origin}/${kind}/${targetId}/register-player`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(regLink); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (_) {}
  };

  const assign = async (regId, teamId) => {
    if (!teamId) return;
    setBusy(true); setErr('');
    try { await assignRegistrantToTeam(regId, teamId); await load(); }
    catch (e) { setErr(e?.message || 'Could not assign to team.'); }
    finally { setBusy(false); }
  };

  // Refund + cancel per the locked sliding scale. If the event has no start
  // date the server asks for an explicit percentage (reason 'needs_pct').
  const refund = async (reg) => {
    const name = reg.registrant?.name || 'this player';
    if (!window.confirm(`Refund + cancel ${name}'s registration?\n\nThe refund follows your policy (100% >14 days out / 50% 7–14 / 0% inside 7). Processing fees aren't refundable. All unpaid installments are cancelled.`)) return;
    setBusy(true); setErr('');
    try {
      await refundRegistration(reg.id);
      await load();
    } catch (e) {
      if (e?.reason === 'needs_pct') {
        const raw = window.prompt('This event has no start date, so pick the refund percentage: 0, 50 or 100');
        if (raw === null) { setBusy(false); return; }   // cancelled — quiet
        const pct = parseInt(raw, 10);
        if ([0, 50, 100].includes(pct)) {
          try { await refundRegistration(reg.id, { overridePct: pct }); await load(); }
          catch (e2) { setErr(e2?.message || 'Refund failed.'); }
        } else {
          setErr(`"${raw}" isn't a valid refund percentage — use 0, 50 or 100.`);
        }
      } else {
        setErr(e?.message || 'Refund failed.');
      }
    } finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 28, fontFamily: "'Barlow', sans-serif" }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: B.ice, marginBottom: 10 }}>
        Player registration
      </div>
      {err && <div style={{ background: 'rgba(215,38,56,0.12)', border: '1px solid rgba(215,38,56,0.4)', color: '#FCA5A5', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{err}</div>}

      {/* settings */}
      <div style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: B.steel }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>Fee per player ($)</div>
            <input type="number" min="0" step="0.01" value={feeDollars}
              onChange={e => setFeeDollars(e.target.value)}
              style={{ width: 110, background: B.dark, border: `1px solid ${B.border}`, borderRadius: 8, padding: '8px 10px', color: B.ice, fontSize: 14 }} />
          </label>
          <label style={{ fontSize: 12, color: B.steel }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>Max installments</div>
            <input type="number" min="1" max="12" value={maxInst}
              onChange={e => setMaxInst(e.target.value)}
              title="1 = pay in full only; e.g. 3 lets families split into 3 monthly payments"
              style={{ width: 70, background: B.dark, border: `1px solid ${B.border}`, borderRadius: 8, padding: '8px 10px', color: B.ice, fontSize: 14 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: B.ice, paddingBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} />
            Open for player registration
          </label>
          <button onClick={saveSettings} disabled={busy}
            style={{ background: B.blue, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Save
          </button>
          <button onClick={copy}
            style={{ background: 'transparent', color: B.ice, border: `1px solid ${B.border}`, borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {copied ? 'Link copied ✓' : 'Copy registration link'}
          </button>
        </div>

        {/* waiver */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${B.border}` }}>
          {waiverEditing ? (
            <WaiverEditor kind={kind} targetId={targetId} waiver={waiver}
              onDone={async () => { setWaiverEditing(false); await load(); }}
              onCancel={() => setWaiverEditing(false)} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: B.steel }}>
              {waiver
                ? <>📄 <strong style={{ color: B.ice }}>{waiver.title}</strong> · v{waiver.version} · {waiver.required ? 'required at checkout' : 'optional'}</>
                : <>No waiver yet — registrants won't be asked to sign anything.</>}
              <button onClick={() => setWaiverEditing(true)}
                style={{ marginLeft: 'auto', background: 'transparent', color: B.blue, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {waiver ? 'Edit waiver' : '＋ Add waiver'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CROSSBAR-1 money view (spine-only) */}
      {money && (
        <div style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <Tile label="Today" value={fmt$(money.collected_today)} color={B.green} />
            <Tile label="Yesterday" value={fmt$(money.collected_yesterday)} color={B.green} />
            <Tile label="Collected" value={fmt$(money.collected_total)} color={B.ice} />
            <Tile label="Outstanding" value={fmt$(money.outstanding)} color={B.amber} />
            <Tile label="Past due" value={fmt$(money.past_due)} color={B.red} />
            {money.refunded_total > 0 && <Tile label="Refunded" value={fmt$(money.refunded_total)} color={B.steel} />}
          </div>
          {money.past_due > 0 && (
            <div style={{ fontSize: 12, color: B.steel, marginBottom: 8 }}>
              Aging: <span style={{ color: B.amber }}>{fmt$(money.aging?.d1_30)} (1–30d)</span>
              {' · '}<span style={{ color: '#FB923C' }}>{fmt$(money.aging?.d31_60)} (31–60d)</span>
              {' · '}<span style={{ color: '#FCA5A5' }}>{fmt$(money.aging?.d61_up)} (61d+)</span>
            </div>
          )}
          {(money.by_month || []).length > 0 && (
            <details>
              <summary style={{ fontSize: 12, color: B.steel, cursor: 'pointer' }}>Revenue by month</summary>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {money.by_month.map(m => (
                  <div key={m.month} style={{ display: 'flex', gap: 12, fontSize: 12, color: B.steel }}>
                    <span style={{ width: 64, color: B.ice, fontWeight: 600 }}>{m.month}</span>
                    <span style={{ color: B.green }}>paid {fmt$(m.paid)}</span>
                    <span>pending {fmt$(m.pending)}</span>
                    <span style={{ color: m.past_due > 0 ? '#FCA5A5' : B.steel }}>past due {fmt$(m.past_due)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* players */}
      {regs.length === 0 ? (
        <div style={{ color: B.steel, fontSize: 13 }}>No player registrations yet. Share the link above to get started.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {regs.map(r => {
            const pay = regPaymentState(r);
            const signed = (r.waivers || []).length > 0;
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 12, flexWrap: 'wrap' }}>
                <Avatar profile={r.registrant} size={34} />
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: B.ice }}>{r.registrant?.name || 'Player'}</div>
                  <div style={{ fontSize: 11, color: B.steel }}>
                    {new Date(r.created_at).toLocaleDateString()} · {fmt$(r.amount_cents)}{signed ? ' · waiver ✓' : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 10px',
                  background: pay === 'paid' || pay === 'free' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                  color: pay === 'paid' || pay === 'free' ? B.green : B.amber,
                }}>
                  {pay === 'paid' ? '✓ Paid' : pay === 'free' ? '✓ Registered' : pay === 'unpaid' ? 'Unpaid' : pay}
                </span>
                {r.status !== 'cancelled' && (
                  <button onClick={() => refund(r)} disabled={busy}
                    title="Refund per policy + cancel this registration"
                    style={{ background: 'transparent', color: B.steel, border: `1px solid ${B.border}`, borderRadius: 999, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    Refund
                  </button>
                )}
                {r.status === 'cancelled' && (
                  <span style={{ fontSize: 11, color: B.steel }}>Cancelled</span>
                )}
                {kind === 'league' && r.status === 'active' && (
                  r.rostered_team_id ? (
                    <span style={{ fontSize: 12, color: B.steel }}>
                      On {teams.find(t => t.team_id === r.rostered_team_id)?.team?.name
                        || teams.find(t => t.team_id === r.rostered_team_id)?.team_name || 'a team'} ✓
                    </span>
                  ) : teams.length > 0 ? (
                    <select defaultValue="" disabled={busy} onChange={e => assign(r.id, e.target.value)}
                      style={{ background: B.dark, color: B.ice, border: `1px solid ${B.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 12 }}>
                      <option value="" disabled>Assign to team…</option>
                      {teams.map(t => (
                        <option key={t.id} value={t.team_id}>{t.team?.name || t.team_name}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: 11, color: B.steel }}>No rosterable teams yet</span>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, color }) {
  return (
    <div style={{ minWidth: 92, background: B.dark, border: `1px solid ${B.border}`, borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: B.steel }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "'Barlow Condensed', sans-serif" }}>{value}</div>
    </div>
  );
}

function WaiverEditor({ kind, targetId, waiver, onDone, onCancel }) {
  const [title, setTitle] = useState(waiver?.title || 'Participation Waiver');
  const [body, setBody] = useState(waiver?.body_md || '');
  const [required, setRequired] = useState(waiver ? !!waiver.required : true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!body.trim()) { setErr('Waiver text is required.'); return; }
    setBusy(true); setErr('');
    try { await saveWaiverTemplate(kind, targetId, { title: title.trim() || 'Participation Waiver', body_md: body, required }); onDone(); }
    catch (e) { setErr(e?.message || 'Could not save the waiver.'); setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {err && <div style={{ color: '#FCA5A5', fontSize: 12 }}>{err}</div>}
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Waiver title"
        style={{ background: B.dark, border: `1px solid ${B.border}`, borderRadius: 8, padding: '8px 10px', color: B.ice, fontSize: 13 }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
        placeholder="Paste your waiver text here. Registrants (or their guardian, for kids) accept it at checkout — each acceptance is recorded with who signed, for whom, and when."
        style={{ background: B.dark, border: `1px solid ${B.border}`, borderRadius: 8, padding: '8px 10px', color: B.ice, fontSize: 13, fontFamily: "'Barlow', sans-serif", resize: 'vertical' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: B.ice, cursor: 'pointer' }}>
        <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
        Required to register {waiver ? `(saving bumps it to v${(waiver.version || 1) + 1})` : ''}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={busy} style={{ background: B.blue, color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Save waiver</button>
        <button onClick={onCancel} style={{ background: 'transparent', color: B.steel, border: `1px solid ${B.border}`, borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
