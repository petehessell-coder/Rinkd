import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../lib/authContext';
import { useFamily } from '../lib/familyContext';
import { acceptHouseholdInvite } from '../lib/family';

// /accept-household-invite?token=<hex>
//
// Magic-link landing for household co-guardian invites (REG-2). Mirrors
// AcceptTeamInvite's three-state machine:
//   1. Not signed in → /login?returnTo=/accept-household-invite?token=...
//   2. Signed in, token valid → accept_household_invite RPC, go to /family
//   3. Error (wrong email / expired / used) → show the RPC's precise message
//
// The RPC enforces the email match (you must be signed in as the invited
// address) and consume-before-grant — see migration C §4.4.

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

export default function AcceptHouseholdInvite({ profile }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { refresh } = useFamily();
  const token = params.get('token') || '';
  const [state, setState] = useState({ kind: 'pending' });

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token. Ask whoever invited you to re-send it.' });
      return;
    }
    if (!user) {
      const back = encodeURIComponent(`/accept-household-invite?token=${encodeURIComponent(token)}`);
      navigate(`/login?returnTo=${back}`, { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await acceptHouseholdInvite(token);
        if (cancelled) return;
        setState({ kind: 'success' });
        refresh?.();   // pull the new household into the switcher
        setTimeout(() => { if (!cancelled) navigate('/family', { replace: true }); }, 1500);
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'error', message: e?.message || 'Could not accept the invite.' });
      }
    })();
    return () => { cancelled = true; };
  }, [token, user, authLoading, navigate, refresh]);

  const center = { background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif', padding: 24, textAlign: 'center' };
  const head = { fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 8 };
  const sub = { fontSize: 13, color: 'rgba(244,247,250,0.55)' };

  if (authLoading || state.kind === 'pending') {
    return (
      <Layout profile={profile}>
        <div style={center}><div style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>👪</div>
          <div style={head}>Joining the family…</div>
          <div style={sub}>One moment while we add you as a guardian.</div>
        </div></div>
      </Layout>
    );
  }

  if (state.kind === 'success') {
    return (
      <Layout profile={profile}>
        <div style={center}><div style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={head}>You're in.</div>
          <div style={{ ...sub, marginBottom: 18 }}>You now share this household. Taking you to your family…</div>
        </div></div>
      </Layout>
    );
  }

  return (
    <Layout profile={profile}>
      <div style={center}><div style={{ maxWidth: 360 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={head}>Invite couldn't be accepted</div>
        <div style={{ ...sub, marginBottom: 18, lineHeight: 1.55 }}>{state.message}</div>
        <button onClick={() => navigate('/feed', { replace: true })} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Feed</button>
      </div></div>
    </Layout>
  );
}
