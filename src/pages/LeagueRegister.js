import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { getLeague } from '../lib/leagues';
import { createRegistrationCheckout } from '../lib/registrations';
import { C, colors } from '../lib/tokens';

// Public, unauthenticated registration page: /league/:id/register
// A team contact (who may have no Rinkd account) fills the form → Stripe Checkout
// (paid league) or a direct confirmation (free league). Standalone — no app nav.

const input = {
  width: '100%', background: C.dark, border: `0.5px solid ${C.border}`, borderRadius: 8,
  padding: '12px 14px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 15, outline: 'none',
  boxSizing: 'border-box',
};
const label = { fontSize: 12, fontWeight: 700, color: C.steel, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' };

// S05 C4 — simple client-side email format guard (not exhaustive RFC 5322;
// just catches the "obviously not an email" case before it hits Stripe/DB).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function draftKey(eventId) { return `rinkd_reg_draft_${eventId}`; }

// S05 C4 — before redirecting to Stripe Checkout, stash the three fields in
// sessionStorage so a ?canceled=1 return trip can rehydrate the form instead of
// making the registrant retype everything. Cleared on ?success=1.
function saveDraft(eventId, fields) {
  try { window.sessionStorage.setItem(draftKey(eventId), JSON.stringify(fields)); } catch { /* storage unavailable — best effort only */ }
}
function loadDraft(eventId) {
  try {
    const raw = window.sessionStorage.getItem(draftKey(eventId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearDraft(eventId) {
  try { window.sessionStorage.removeItem(draftKey(eventId)); } catch { /* no-op */ }
}

function Shell({ children }) {
  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 18px' }}>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, letterSpacing: '0.04em', color: C.ice, marginBottom: 22 }}>RINKD</div>
      <div style={{ width: '100%', maxWidth: 460 }}>{children}</div>
    </div>
  );
}

function Card({ children }) {
  return <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: '24px 22px' }}>{children}</div>;
}

export default function LeagueRegister() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const [league, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false); // free-league confirmation
  const [error, setError] = useState(null);

  const isSuccess = sp.get('success') === '1';
  const isCanceled = sp.get('canceled') === '1';

  useEffect(() => {
    let cancelled = false;
    getLeague(id)
      .then(l => { if (!cancelled) setLeague(l); })
      .catch(() => { if (!cancelled) setLeague(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // S05 C4 — on a canceled Stripe return, rehydrate the form from the draft
  // saved right before redirect so the registrant doesn't retype everything.
  // On a successful return, the draft is stale (registration is done) — drop it.
  useEffect(() => {
    if (!id) return;
    if (isSuccess) { clearDraft(id); return; }
    if (isCanceled) {
      const draft = loadDraft(id);
      if (draft) {
        if (draft.teamName) setTeamName(draft.teamName);
        if (draft.contactName) setContactName(draft.contactName);
        if (draft.contactEmail) setContactEmail(draft.contactEmail);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isSuccess, isCanceled]);

  const handleSubmit = async () => {
    setError(null);
    if (!teamName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError('Please fill in all three fields.');
      return;
    }
    if (!EMAIL_RE.test(contactEmail.trim())) {
      setError("That email doesn't look right — double-check it so your confirmation can land.");
      return;
    }
    setSubmitting(true);
    try {
      const fields = { teamName: teamName.trim(), contactName: contactName.trim(), contactEmail: contactEmail.trim() };
      saveDraft(id, fields); // stash before the Stripe redirect so ?canceled=1 can rehydrate
      const res = await createRegistrationCheckout(id, fields);
      if (res?.url) { window.location.href = res.url; return; } // → Stripe Checkout
      clearDraft(id); // free league — registration is done, no return trip needed
      setSubmitted(true); // free league: registration recorded, no payment
    } catch (e) {
      if (e.reason === 'full') setError('This league is full — registration is closed.');
      else if (e.reason === 'deadline_passed' || e.reason === 'closed') setError('Registration is closed for this league.');
      else setError(e.message || "That didn't go through — try again in a sec.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Shell><div style={{ textAlign: 'center', color: C.steel, fontSize: 14 }}>Getting the ice ready.</div></Shell>;
  }

  if (!league) {
    return (
      <Shell>
        <Card>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22 }}>League not found</div>
          <div style={{ fontSize: 14, color: C.steel, marginTop: 8 }}>This registration link may be wrong or the league no longer exists.</div>
        </Card>
      </Shell>
    );
  }

  const feeCents = Number(league.registration_fee_cents) || 0;
  const feeLabel = feeCents > 0 ? `$${(feeCents / 100).toFixed(2)}` : 'Free';
  const deadline = league.registration_deadline ? new Date(league.registration_deadline) : null;
  const deadlinePassed = deadline ? deadline.getTime() < Date.now() : false;
  const closed = !league.registration_open || deadlinePassed;

  // Confirmation (paid return ?success=1, or free-league submit).
  if (isSuccess || submitted) {
    return (
      <Shell>
        <Card>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 24 }}>Registration received!</div>
          <div style={{ fontSize: 15, color: 'rgba(244,247,250,0.75)', marginTop: 10, lineHeight: 1.55 }}>
            Thanks for registering <strong style={{ color: C.ice }}>{league.name}</strong>. The commissioner will be in touch to confirm your spot{feeCents > 0 ? ' — your payment is complete' : ''}.
          </div>
          <button onClick={() => navigate(`/league/${id}`)}
            style={{ marginTop: 20, width: '100%', padding: 13, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 999, color: C.ice, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
            View the league
          </button>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.steel, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Team Registration</div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, marginTop: 4, lineHeight: 1.1 }}>{league.name}</div>
        {(league.season || league.location) && (
          <div style={{ fontSize: 13, color: C.steel, marginTop: 6 }}>{[league.season, league.location].filter(Boolean).join(' · ')}</div>
        )}

        <div style={{ display: 'flex', gap: 18, marginTop: 16, paddingTop: 16, borderTop: `0.5px solid ${C.border}` }}>
          <div>
            <div style={label}>Entry Fee</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: feeCents > 0 ? C.ice : colors.success }}>{feeLabel}</div>
          </div>
          {deadline && (
            <div>
              <div style={label}>Closes</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: deadlinePassed ? C.red : C.ice }}>
                {deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          )}
        </div>

        {closed ? (
          <div style={{ marginTop: 18, background: 'rgba(245,158,11,0.12)', border: '0.5px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.warning }}>Registration is currently closed</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.7)', marginTop: 6, lineHeight: 1.5 }}>
              {deadlinePassed ? 'The registration deadline has passed.' : 'The commissioner hasn’t opened registration yet.'} Reach out to the league directly if you think this is a mistake.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 18 }}>
            {isCanceled && (
              <div style={{ background: 'rgba(46,91,140,0.18)', border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'rgba(244,247,250,0.8)' }}>
                Payment canceled — your spot isn’t reserved yet. You can try again below.
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={label}>Team Name</label>
              <input style={input} value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="e.g. North Shore Eagles" maxLength={80} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={label}>Contact Name</label>
              <input style={input} value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Your full name" maxLength={80} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Contact Email</label>
              <input style={input} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="you@email.com" maxLength={120} />
            </div>

            {error && (
              <div style={{ background: 'rgba(215,38,56,0.14)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>
            )}

            <button onClick={handleSubmit} disabled={submitting}
              style={{ width: '100%', padding: 14, background: submitting ? 'rgba(215,38,56,0.5)' : C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 800, cursor: submitting ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>
              {submitting ? 'Starting…' : feeCents > 0 ? `Register & Pay ${feeLabel}` : 'Submit Registration'}
            </button>
            {feeCents > 0 && (
              <div style={{ fontSize: 11, color: C.steel, textAlign: 'center', marginTop: 10 }}>
                Secure payment by Stripe. You’ll be redirected to complete checkout.
              </div>
            )}
          </div>
        )}
      </Card>
    </Shell>
  );
}
