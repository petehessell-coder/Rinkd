import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamily } from '../lib/familyContext';
import { useAuth } from '../lib/authContext';
import {
  getMyFamilyRegistrations, familyInvoices, payInstallment, setupAutopay,
} from '../lib/playerReg';

// REG-4 — the family money surface ("money is woven in", REGISTRATION_PARITY §3):
//   <FamilyMoney/>     — Invoices (unpaid w/ Pay now + Auto-Pay) and Receipts,
//                        rendered inside /family.
//   <UpNextPayment/>   — the gentle one-liner atop the Feed: "You owe $X for
//                        Henry, due Friday — Pay". Renders nothing when the
//                        family owes nothing (never an empty-state card).
// Both read ONLY the Phase-3/4 money spine and degrade to nothing before the
// migrations land.

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
  green: '#22C55E', amber: '#F59E0B',
};
const fmt$ = (c) => `$${((c || 0) / 100).toFixed(2)}`;
const fmtDue = (d) => {
  try {
    const date = new Date(`${d}T12:00:00`);
    const days = Math.round((date - new Date()) / 86400000);
    if (days < 0) return 'past due';
    if (days === 0) return 'due today';
    if (days <= 6) return `due ${date.toLocaleDateString('en-US', { weekday: 'long' })}`;
    return `due ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  } catch { return ''; }
};

function useFamilyInvoices() {
  const { profile } = useAuth();
  const fam = useFamily();
  const [regs, setRegs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const ids = useMemo(
    () => (profile ? [profile.id, ...fam.managed.map(m => m.profile_id)] : []),
    [profile, fam.managed]
  );
  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) { setRegs([]); setLoaded(true); return undefined; }
    (async () => {
      try {
        const r = await getMyFamilyRegistrations(ids);
        if (!cancelled) setRegs(r);
      } catch (_) {
        if (!cancelled) setRegs([]);   // pre-migration / offline: just hide
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [ids]);
  return { ...familyInvoices(regs), loaded, refresh: () => setLoaded(false) };
}

export default function FamilyMoney() {
  const { unpaid, receipts, loaded } = useFamilyInvoices();
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  if (!loaded || (unpaid.length === 0 && receipts.length === 0)) return null;

  const pay = async (row) => {
    setBusyId(row.installmentId); setErr('');
    try {
      const { url } = await payInstallment(row.installmentId);
      if (url) window.location.href = url;
    } catch (e) { setErr(e?.message || 'Could not start payment.'); setBusyId(null); }
  };
  const enroll = async (row) => {
    setBusyId(`ap-${row.planId}`); setErr('');
    try {
      const { url } = await setupAutopay(row.planId);
      if (url) window.location.href = url;
    } catch (e) { setErr(e?.message || 'Could not start Auto-Pay setup.'); setBusyId(null); }
  };

  return (
    <div style={{ marginTop: 22, fontFamily: "'Barlow', sans-serif" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: B.steel, margin: '0 0 8px' }}>
        Money
      </div>
      {err && <div style={{ background: 'rgba(215,38,56,0.12)', border: '1px solid rgba(215,38,56,0.4)', color: '#FCA5A5', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{err}</div>}

      {unpaid.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {unpaid.map(row => (
            <div key={row.installmentId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: B.card, border: `1px solid ${row.status === 'past_due' ? 'rgba(215,38,56,0.5)' : B.border}`, borderRadius: 12, padding: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: B.ice }}>
                  {fmt$(row.amountCents)}{row.registrant?.name ? ` · ${row.registrant.name.split(' ')[0]}` : ''}
                </div>
                <div style={{ fontSize: 12, color: row.status === 'past_due' ? '#FCA5A5' : B.steel }}>
                  {row.targetType === 'league' ? 'League' : 'Tournament'} registration · {fmtDue(row.dueDate)}
                  {row.autopay ? ' · Auto-Pay on' : ''}
                </div>
              </div>
              <button onClick={() => pay(row)} disabled={busyId === row.installmentId}
                style={{ background: B.red, color: '#fff', border: 'none', borderRadius: 999, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}>
                {busyId === row.installmentId ? 'One sec…' : 'Pay now'}
              </button>
              {!row.autopay && (
                <button onClick={() => enroll(row)} disabled={busyId === `ap-${row.planId}`}
                  style={{ background: 'transparent', color: B.ice, border: `1px solid ${B.border}`, borderRadius: 999, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}>
                  {busyId === `ap-${row.planId}` ? '…' : 'Set up Auto-Pay'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {receipts.length > 0 && (
        <details>
          <summary style={{ fontSize: 12, color: B.steel, cursor: 'pointer', marginBottom: 8 }}>
            Receipts ({receipts.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {receipts.map(row => (
              <div key={row.installmentId} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: B.steel, padding: '6px 4px' }}>
                <span style={{ color: B.green }}>✓</span>
                <span style={{ color: B.ice, fontWeight: 600 }}>{fmt$(row.amountCents)}</span>
                <span>{row.registrant?.name?.split(' ')[0] || ''}</span>
                <span style={{ marginLeft: 'auto' }}>
                  {row.paidAt ? new Date(row.paidAt).toLocaleDateString() : ''}
                  {row.status !== 'paid' ? ` · ${row.status.replace('_', ' ')}` : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// The one genuinely useful home widget (REGISTRATION_PARITY §3): a single
// gentle line atop the Feed when something is owed. Nothing owed → nothing
// rendered.
export function UpNextPayment() {
  const navigate = useNavigate();
  const { unpaid, loaded } = useFamilyInvoices();
  if (!loaded || unpaid.length === 0) return null;
  const next = unpaid[0];
  const more = unpaid.length - 1;
  return (
    <button onClick={() => navigate('/family')}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)',
        borderRadius: 12, padding: '10px 14px', marginBottom: 12, cursor: 'pointer',
        textAlign: 'left', fontFamily: "'Barlow', sans-serif",
      }}>
      <span style={{ fontSize: 16 }}>💳</span>
      <span style={{ flex: 1, fontSize: 13, color: B.ice }}>
        You owe <strong>{fmt$(next.amountCents)}</strong>
        {next.registrant?.name ? <> for <strong>{next.registrant.name.split(' ')[0]}</strong></> : null}
        , {fmtDue(next.dueDate)}{more > 0 ? ` (+${more} more)` : ''}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: B.amber }}>Pay →</span>
    </button>
  );
}
