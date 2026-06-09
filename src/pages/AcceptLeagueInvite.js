import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../lib/authContext';
import { acceptLeagueManagerInvite } from '../lib/leagueManagers';

// /accept-league-invite?token=<hex>
//
// Magic-link landing for LEAGUE-MANAGER invites (LEAGUE-MGR-1). Three states:
//   1. Not signed in → redirect to /login?returnTo=/accept-league-invite?token=...
//      After signup/signin the user comes back here, signed in.
//   2. Signed in, token valid → call accept RPC, redirect to /league/:id
//   3. Signed in, token invalid/expired/already-used/wrong-email → show
//      the precise error from the RPC + a back-to-feed button.

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

export default function AcceptLeagueInvite({ profile }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const token = params.get('token') || '';
  const [state, setState] = useState({ kind: 'pending' });

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token. Ask the commissioner to re-send.' });
      return;
    }
    if (!user) {
      const back = encodeURIComponent(`/accept-league-invite?token=${encodeURIComponent(token)}`);
      navigate(`/login?returnTo=${back}`, { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { leagueId } = await acceptLeagueManagerInvite(token);
        if (cancelled) return;
        setState({ kind: 'success', leagueId });
        setTimeout(() => {
          if (cancelled) return;
          if (leagueId) navigate(`/league/${leagueId}`, { replace: true });
          else navigate('/feed', { replace: true });
        }, 1500);
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'error', message: e?.message || 'Could not accept the invite.' });
      }
    })();
    return () => { cancelled = true; };
  }, [token, user, authLoading, navigate]);

  const center = { background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif', padding: 24, textAlign: 'center' };

  if (authLoading || state.kind === 'pending') {
    return (
      <Layout profile={profile}>
        <div style={center}>
          <div style={{ maxWidth: 360 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎟️</div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 8 }}>Accepting your invite…</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.55)' }}>One moment while we set you up as a league manager.</div>
          </div>
        </div>
      </Layout>
    );
  }

  if (state.kind === 'success') {
    return (
      <Layout profile={profile}>
        <div style={center}>
          <div style={{ maxWidth: 360 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 8 }}>You're a league manager.</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.55)', marginBottom: 18 }}>Taking you to the league page…</div>
          </div>
        </div>
      </Layout>
    );
  }

  // error
  return (
    <Layout profile={profile}>
      <div style={center}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 8 }}>Invite couldn't be accepted</div>
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.55)', marginBottom: 18, lineHeight: 1.55 }}>{state.message}</div>
          <button onClick={() => navigate('/feed', { replace: true })} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Feed</button>
        </div>
      </div>
    </Layout>
  );
}
