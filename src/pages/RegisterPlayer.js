import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Avatar } from '../components/Logos';
import { useAuth } from '../lib/authContext';
import { useFamily } from '../lib/familyContext';
import { createHousehold, createManagedProfile } from '../lib/family';
import { getPlayerRegContext, startPlayerRegistration } from '../lib/playerReg';

// REG-3 — /league/:id/register-player and /tournament/:id/register-player.
// THE bar: a first-time parent registers a kid and pays, on a phone, first
// try, no manual. Three steps on one screen, progressively disclosed:
//   1. Who's playing?  — me + my managed people (+ add a child inline; creates
//      the household on the fly for a first-time parent)
//   2. Waiver          — accepted by the guardian, recorded server-side
//   3. Pay             — Stripe Checkout (1% platform fee, processing grossed up)
// Signed-out users bounce to /login?returnTo=<here> and land right back.

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
  green: '#22C55E', amber: '#F59E0B',
};
const fmt$ = (c) => `$${((c || 0) / 100).toFixed(2)}`;

export default function RegisterPlayer({ profile, kind = 'league' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const fam = useFamily();

  const [ctx, setCtx] = useState(null);          // { event, waiver }
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState(null);          // profile id
  const [agree, setAgree] = useState(false);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const success = params.get('success') === '1';
  const canceled = params.get('canceled') === '1';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getPlayerRegContext(kind, id);
        if (!cancelled) setCtx(c);
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load this event.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, id]);

  // Signed-out → login and come back (token-free URL, safe round trip).
  useEffect(() => {
    if (authLoading || user) return;
    const back = encodeURIComponent(`/${kind}/${id}/register-player`);
    navigate(`/login?returnTo=${back}`, { replace: true });
  }, [authLoading, user, kind, id, navigate]);

  const people = fam.members; // me-first + managed
  const chosen = useMemo(() => people.find(p => p.profile_id === who) || null, [people, who]);
  const fee = ctx?.event?.player_fee_cents || 0;
  const total = fee > 0 ? Math.round((fee + 30) / 0.971) : 0;
  const waiver = ctx?.waiver;
  const needsAgree = !!waiver?.required;

  const submit = async () => {
    if (!who) { setErr('Pick who you\'re registering.'); return; }
    if (needsAgree && !agree) { setErr('Please accept the waiver to continue.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await startPlayerRegistration({
        kind, targetId: id, profileId: who, waiverAccepted: agree,
        waiverVersion: waiver?.version ?? null,
      });
      if (res?.url) { window.location.href = res.url; return; }
      if (res?.free) { navigate(`/${kind}/${id}/register-player?success=1`, { replace: true }); }
    } catch (e) {
      if (e?.reason === 'waiver_changed') {
        // Organizer edited the waiver mid-flow — reload it and re-ask.
        setAgree(false);
        try { const c = await getPlayerRegContext(kind, id); setCtx(c); } catch (_) {}
        setErr('The waiver was just updated — please read the new version and accept again.');
      } else {
        setErr(e?.reason === 'duplicate'
          ? e.message
          : (e?.message || 'Could not start the registration.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const wrap = { maxWidth: 560, margin: '0 auto', padding: '20px 16px 48px', fontFamily: "'Barlow', sans-serif" };
  const h1 = { fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, color: B.ice, margin: 0 };
  const label = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: B.steel, margin: '20px 0 8px' };

  if (loading || authLoading) {
    return <Layout profile={profile}><div style={wrap}><div style={{ color: B.steel }}>Loading…</div></div></Layout>;
  }
  if (!ctx?.event) {
    return <Layout profile={profile}><div style={wrap}><div style={{ color: B.steel }}>{err || 'Event not found.'}</div></div></Layout>;
  }

  if (success) {
    return (
      <Layout profile={profile}>
        <div style={{ ...wrap, textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🏒</div>
          <h1 style={h1}>You're all set.</h1>
          <p style={{ color: B.steel, fontSize: 14, lineHeight: 1.6 }}>
            Registration received for <strong style={{ color: B.ice }}>{ctx.event.name}</strong>.
            {fee > 0 ? ' Your receipt is in your email.' : ''} The organizer will assign a team —
            you'll see everything on their player card.
          </p>
          <button onClick={() => navigate('/family')} style={primaryBtn(false)}>Go to my family</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout profile={profile}>
      <div style={wrap}>
        <h1 style={h1}>{ctx.event.name}</h1>
        <div style={{ color: B.steel, fontSize: 13, marginTop: 4 }}>
          Player registration{fee > 0 ? ` · ${fmt$(fee)}` : ' · Free'}
        </div>

        {!ctx.event.player_registration_open && (
          <Banner color={B.amber} text="Player registration isn't open for this event right now." />
        )}
        {canceled && <Banner color={B.steel} text="Checkout canceled — nothing was charged. Pick up where you left off below." />}
        {err && <Banner color={B.red} text={err} />}

        {/* 1 ── who's playing */}
        <div style={label}>1 · Who's playing?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {people.map(p => (
            <button key={p.profile_id} onClick={() => setWho(p.profile_id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12,
                background: who === p.profile_id ? B.blue + '33' : B.card,
                border: `1px solid ${who === p.profile_id ? B.blue : B.border}`,
                cursor: 'pointer', textAlign: 'left', fontFamily: "'Barlow', sans-serif",
              }}>
              <Avatar profile={p.profile} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: B.ice }}>{p.isSelf ? 'Me' : p.profile?.name}</div>
                {!p.isSelf && (
                  <div style={{ fontSize: 11, color: B.steel }}>
                    {p.profile?.account_type === 'minor' ? 'Child' : 'Managed'}
                  </div>
                )}
              </div>
              <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: `2px solid ${who === p.profile_id ? B.red : B.border}`, background: who === p.profile_id ? B.red : 'transparent' }} />
            </button>
          ))}
          <button onClick={() => setAddOpen(true)} style={{ ...ghostBtn, alignSelf: 'flex-start' }}>＋ Add a child</button>
        </div>

        {/* 2 ── waiver */}
        {waiver && (
          <>
            <div style={label}>2 · {waiver.title}</div>
            <div style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{
                fontSize: 13, color: B.steel, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                maxHeight: waiverOpen ? 'none' : 120, overflow: 'hidden', position: 'relative',
              }}>
                {waiver.body_md}
              </div>
              {!waiverOpen && (waiver.body_md || '').length > 400 && (
                <button onClick={() => setWaiverOpen(true)} style={{ background: 'transparent', border: 'none', color: B.blue, cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 0 0', fontFamily: "'Barlow', sans-serif" }}>
                  Read the full waiver ↓
                </button>
              )}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13, color: B.ice, lineHeight: 1.5 }}>
                  I agree to this waiver
                  {chosen && !chosen.isSelf ? <> on behalf of <strong>{chosen.profile?.name}</strong>, as their guardian</> : null}.
                  {needsAgree ? '' : ' (optional)'}
                </span>
              </label>
            </div>
          </>
        )}

        {/* 3 ── pay */}
        <div style={label}>{waiver ? '3' : '2'} · {fee > 0 ? 'Payment' : 'Finish'}</div>
        {fee > 0 && (
          <div style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 14, fontSize: 13, color: B.steel }}>
            <Row k="Registration" v={fmt$(fee)} />
            <Row k="Processing fee" v={fmt$(total - fee)} />
            <div style={{ height: 1, background: B.border, margin: '8px 0' }} />
            <Row k={<strong style={{ color: B.ice }}>Total today</strong>} v={<strong style={{ color: B.ice }}>{fmt$(total)}</strong>} />
          </div>
        )}
        <button onClick={submit}
          disabled={busy || !ctx.event.player_registration_open || !who || (needsAgree && !agree)}
          style={{ ...primaryBtn(busy || !ctx.event.player_registration_open || !who || (needsAgree && !agree)), width: '100%', marginTop: 12, padding: '14px 22px', fontSize: 15 }}>
          {busy ? 'One sec…' : fee > 0 ? `Pay ${fmt$(total)} →` : 'Complete registration'}
        </button>
        <div style={{ fontSize: 11, color: B.steel, marginTop: 8, textAlign: 'center' }}>
          {fee > 0 ? 'Secure checkout by Stripe. ' : ''}You'll get a confirmation right after.
        </div>
      </div>

      {addOpen && (
        <AddChildInline
          onClose={() => setAddOpen(false)}
          fam={fam}
          onAdded={(pid) => { setAddOpen(false); setWho(pid); }}
        />
      )}
    </Layout>
  );
}

// Inline add-a-child: creates the household on the fly for a first-time parent
// (the no-manual path — they never have to visit /family first).
function AddChildInline({ onClose, fam, onAdded }) {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!name.trim() || !dob) { setErr('Name and date of birth are required.'); return; }
    setBusy(true); setErr('');
    try {
      let householdId = fam.household?.id;
      if (!householdId) householdId = await createHousehold(null);
      const { profileId, outcome } = await createManagedProfile(householdId, name.trim(), dob, 'minor');
      await fam.refresh();
      if (outcome === 'claim_requested') {
        setErr(`${name.trim()} already exists in another family — we've asked their guardian to share access. You can register them once it's approved.`);
        setBusy(false);
        return;
      }
      onAdded(profileId);
    } catch (e) {
      setErr(e?.message || 'Could not add this child.');
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 16, padding: 20, width: '100%', maxWidth: 400, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: B.ice, marginBottom: 12 }}>Add a child</div>
        {err && <Banner color={B.red} text={err} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Child's name" style={input} />
          <input type="date" value={dob} onChange={e => setDob(e.target.value)} style={input} />
          <div style={{ fontSize: 12, color: B.steel, lineHeight: 1.5 }}>
            They get a real profile with no login — you manage it from your family.
          </div>
          <button onClick={submit} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Adding…' : 'Add child'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>{k}</span><span>{v}</span></div>;
}
function Banner({ color, text }) {
  return (
    <div style={{ background: `${color}1f`, border: `1px solid ${color}66`, color, borderRadius: 10, padding: '8px 12px', fontSize: 13, margin: '12px 0' }}>
      {text}
    </div>
  );
}
function primaryBtn(disabled) {
  return { background: disabled ? '#1E3A5C' : '#D72638', color: '#fff', border: 'none', borderRadius: 999, padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: "'Barlow', sans-serif" };
}
const ghostBtn = { background: 'transparent', color: '#F4F7FA', border: '1px solid #1E3A5C', borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" };
const input = { width: '100%', boxSizing: 'border-box', background: '#07111F', border: '1px solid #1E3A5C', borderRadius: 10, padding: '10px 12px', color: '#F4F7FA', fontSize: 14, fontFamily: "'Barlow', sans-serif" };
