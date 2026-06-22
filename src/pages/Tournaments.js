import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Layout from '../components/Layout';
import TapeText from '../components/TapeText';

export default function Tournaments({ profile, currentUser }) {
  const navigate = useNavigate();
  // Public access path: an anonymous spectator can browse the index, see
  // which tournaments are running, and click through to the public landing
  // for any of them. We hide the "+ Create" CTA (auth-required) and
  // surface a small sign-in prompt instead.
  const isAnon = !currentUser;
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // TODO: paginate — cap unbounded query for now. 50 is comfortably above
    // the active/complete tournament count and prevents the page from
    // dragging when the archive grows.
    // Sort by end_date desc so just-finished events surface before older archives,
    // and active events (whose end_date is in the future) lead the list. Falls
    // back to start_date for rows missing an end_date.
    // YOUTH-PRIVACY: youth events are excluded from the public directory (parity
    // with youth teams). A signed-in user still sees youth events they DIRECT, so a
    // youth-event director can find + manage theirs from here; anon + everyone else
    // sees adult events only. The youth landing page itself stays reachable by
    // direct link with minor names shielded — this is discovery exclusion, not full
    // row-privacy.
    let q = supabase
      .from('tournaments')
      .select('*')
      .in('status', ['active', 'complete']);
    q = currentUser?.id
      ? q.or(`is_youth.eq.false,director_id.eq.${currentUser.id}`)
      : q.eq('is_youth', false);
    const { data, error: qErr } = await q
      .order('end_date', { ascending: false, nullsFirst: false })
      .order('start_date', { ascending: false })
      .limit(50);
    if (qErr) { setError(qErr.message); setLoading(false); return; }
    setTournaments(data || []);
    setLoading(false);
  }, [currentUser?.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <Layout profile={profile}>
      <div style={{ background: '#07111F', minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: '#F4F7FA' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4, gap: 10 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 28 }}><TapeText height={26}>TOURNAMENTS</TapeText></div>
          {isAnon
            ? <button onClick={() => navigate('/login?returnTo=%2Ftournaments')}
                style={{ background: '#D72638', color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Sign in
              </button>
            : <button onClick={() => navigate('/tournament/create')}
                style={{ background: '#D72638', color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                + Create
              </button>}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Live standings · real-time scoring · LiveBarn streams</div>
        {isAnon && (
          <div style={{ background: 'linear-gradient(135deg,rgba(215,38,56,0.18) 0%,#0f2847 100%)', border: '1px solid rgba(215,38,56,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 18, fontSize: 13, lineHeight: 1.5, color: 'rgba(244,247,250,0.9)' }}>
            👋 Browsing as a guest. <button onClick={() => navigate('/login?returnTo=%2Ftournaments')} style={{ background: 'none', border: 'none', color: '#D72638', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, padding: 0, fontWeight: 700 }}>Sign up free</button> to see live scores, standings, and bracket as games unfold.
          </div>
        )}

        {loading && <div style={{ color: 'rgba(244,247,250,0.3)', fontSize: 13 }}>Getting the ice ready.</div>}

        {!loading && error && (
          <div style={{ background: '#0f2847', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#D72638' }}>Couldn't load tournaments</div>
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 16 }}>{error}</div>
            <button onClick={load}
              style={{ background: '#D72638', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 20px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && tournaments.length === 0 && (
          <div style={{ background: '#0f2847', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🥅</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No tournaments yet</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 16 }}>Want to host your tournament on Rinkd?</div>
            <a href="mailto:hello@rinkd.app?subject=Tournament Hosting Inquiry" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#D72638', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 20px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              ✉️ hello@rinkd.app
            </a>
          </div>
        )}

        {!error && tournaments.map(t => {
          // Show ● Live only when the event hasn't already ended. Without the
          // end_date guard, archived 'active' tournaments (those never marked
          // 'complete' after they wrapped) keep claiming to be live forever.
          const todayISO = new Date().toISOString().slice(0, 10);
          const isLive = t.status === 'active' && (!t.end_date || t.end_date >= todayISO);
          const showFinal = t.status === 'complete' || (t.status === 'active' && t.end_date && t.end_date < todayISO);
          return (
          <div key={t.id} onClick={() => navigate('/tournament/' + t.id)}
            style={{ background: '#0f2847', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '16px 18px', marginBottom: 10, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.border = '0.5px solid rgba(46,91,140,0.8)'}
            onMouseLeave={e => e.currentTarget.style.border = '0.5px solid rgba(46,91,140,0.4)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 17 }}>{t.name.toUpperCase()}</div>
              {isLive && <span style={{ background: 'rgba(215,38,56,0.15)', color: '#D72638', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>● Live</span>}
              {showFinal && <span style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>Final</span>}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>{t.division} · {t.start_date} – {t.end_date}</div>
          </div>
          );
        })}
      </div>
    </Layout>
  );
}
