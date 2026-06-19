import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { getTournament } from '../lib/tournaments';
import { createRegistrationCheckout } from '../lib/registrations';

// Public, unauthenticated registration page: /tournament/:id/register
// Mirror of LeagueRegister — a team contact (who may have no Rinkd account) fills
// the form → Stripe Checkout (paid) or a direct confirmation (free). Standalone.

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  green: '#22C55E', amber: '#F59E0B',
};

const input = {
  width: '100%', background: C.dark, border: `0.5px solid ${C.border}`, borderRadius: 8,
  padding: '12px 14px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 15, outline: 'none',
  boxSizing: 'border-box',
};
const label = { fontSize: 12, fontWeight: 700, color: C.steel, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' };

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

export default function TournamentRegister() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false); // free-tournament confirmation
  const [error, setError] = useState(null);

  const isSuccess = sp.get('success') === '1';
  const isCanceled = sp.get('canceled') === '1';

  useEffect(() => {
    let cancelled = false;
    getTournament(id)
      .then(t => { if (!cancelled) setTournament(t); })
      .catch(() => { if (!cancelled) setTournament(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const handleSubmit = async () => {
    setError(null);
    if (!teamName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError('Please fill in all three fields.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await createRegistrationCheckout(id, {
        teamName: teamName.trim(), contactName: contactName.trim(), contactEmail: contactEmail.trim(),
      }, 'tournament');
      if (res?.url) { window.location.href = res.url; return; } // → Stripe Checkout
      setSubmitted(true); // free tournament: registration recorded, no payment
    } catch (e) {
      if (e.reason === 'full') setError('This tournament is full — registration is closed.');
      else if (e.reason === 'deadline_passed' || e.reason === 'closed') setError('Registration is closed for this tournament.');
      else setError(e.message || "That didn't go through — try again in a sec.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Shell><div style={{ textAlign: 'center', color: C.steel, fontSize: 14 }}>Getting the ice ready.</div></Shell>;
  }

  if (!tournament) {
    return (
      <Shell>
        <Card>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22 }}>Tournament not found</div>
          <div style={{ fontSize: 14, color: C.steel, marginTop: 8 }}>This registration link may be wrong or the tournament no longer exists.</div>
        </Card>
      </Shell>
    );
  }

  const feeCents = Number(tournament.registration_fee_cents) || 0;
  const feeLabel = feeCents > 0 ? `$${(feeCents / 100).toFixed(2)}` : 'Free';
  const deadline = tournament.registration_deadline ? new Date(tournament.registration_deadline) : null;
  const deadlinePassed = deadline ? deadline.getTime() < Date.now() : false;
  const closed = !tournament.registration_open || deadlinePassed;
  const startDate = tournament.start_date ? new Date(tournament.start_date + 'T00:00:00') : null;
  const subtitle = [
    startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
    tournament.settings?.venue_name || null,
  ].filter(Boolean).join(' · ');

  // Confirmation (paid return ?success=1, or free-tournament submit).
  if (isSuccess || submitted) {
    return (
      <Shell>
        <Card>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 24 }}>Registration received!</div>
          <div style={{ fontSize: 15, color: 'rgba(244,247,250,0.75)', marginTop: 10, lineHeight: 1.55 }}>
            Thanks for registering <strong style={{ color: C.ice }}>{tournament.name}</strong>. The director will be in touch to confirm your spot{feeCents > 0 ? ' — your payment is complete' : ''}.
          </div>
          <button onClick={() => navigate(`/tournament/${id}`)}
            style={{ marginTop: 20, width: '100%', padding: 13, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 999, color: C.ice, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
            View the tournament
          </button>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.steel, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Team Registration</div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, marginTop: 4, lineHeight: 1.1 }}>{tournament.name}</div>
        {subtitle && <div style={{ fontSize: 13, color: C.steel, marginTop: 6 }}>{subtitle}</div>}

        <div style={{ display: 'flex', gap: 18, marginTop: 16, paddingTop: 16, borderTop: `0.5px solid ${C.border}` }}>
          <div>
            <div style={label}>Entry Fee</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: feeCents > 0 ? C.ice : C.green }}>{feeLabel}</div>
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
            <div style={{ fontSize: 14, fontWeight: 700, color: C.amber }}>Registration is currently closed</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.7)', marginTop: 6, lineHeight: 1.5 }}>
              {deadlinePassed ? 'The registration deadline has passed.' : 'The director hasn’t opened registration yet.'} Reach out to the tournament directly if you think this is a mistake.
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
