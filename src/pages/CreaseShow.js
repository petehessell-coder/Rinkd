import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import CreasePaywall from '../components/CreasePaywall';
import { getShowBySlug, listEpisodes, hasCreaseAccess, formatDuration } from '../lib/crease';
import { C } from '../lib/tokens';

export default function CreaseShowPage({ currentUser, profile }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [show, setShow] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: s, error: showErr } = await getShowBySlug(slug);
    if (showErr) { setError(showErr.message || "Couldn't load this show — refresh and try again."); setLoading(false); return; }
    if (!s) { setLoading(false); return; }
    setShow(s);
    const { data: eps, error: epErr } = await listEpisodes(s.id);
    if (epErr) { setError(epErr.message || "Couldn't load these episodes — refresh and try again."); setLoading(false); return; }
    setEpisodes(eps);
    if (currentUser) setHasAccess(await hasCreaseAccess(currentUser.id));
    setLoading(false);
  }, [slug, currentUser]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Layout profile={profile} currentPage="crease">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>Getting the ice ready.</div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout profile={profile} currentPage="crease">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, padding: 20, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>Couldn't load this show</div>
            <div style={{ color: C.steel, fontSize: 12, marginBottom: 16 }}>{error}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={load} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontWeight: 700 }}>Retry</button>
              <button onClick={() => navigate('/crease')} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Crease</button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!show) {
    return (
      <Layout profile={profile} currentPage="crease">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12 }}>
          <div>Show not found</div>
          <button onClick={() => navigate('/crease')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Crease</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout profile={profile} currentPage="crease">
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        {/* Hero */}
        <div style={{
          height: 260,
          background: show.hero_image_url ? `linear-gradient(180deg, rgba(7,17,31,0.2) 0%, ${C.dark} 100%), url(${show.hero_image_url}) center/cover` : C.navy,
          position: 'relative',
        }}>
          <button onClick={() => navigate('/crease')} style={{
            position: 'absolute', top: 16, left: 16,
            background: 'rgba(0,0,0,0.45)', color: C.ice, border: 'none',
            padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
            fontFamily: 'Barlow, sans-serif',
          }}>← Crease</button>
        </div>

        <div style={{ maxWidth: 820, margin: '-60px auto 0', padding: '0 16px 60px', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(215,38,56,0.15)', color: C.red, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '4px 12px 4px 4px', borderRadius: 999, marginBottom: 10, border: '1px solid rgba(215,38,56,0.3)' }}>
            <img src="/crease-logo.png" alt="" style={{ width: 22, height: 22, borderRadius: 5, display: 'block' }} />
            Crease Premium
          </div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.01em', textTransform: 'uppercase', marginBottom: 6 }}>
            {show.title}
          </div>
          {show.tagline && <div style={{ fontSize: 16, color: C.steel, marginBottom: 14 }}>{show.tagline}</div>}
          {show.host && <div style={{ fontSize: 12, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Hosted by <span style={{ color: C.ice, fontWeight: 600 }}>{show.host}</span></div>}
          {show.description && <div style={{ fontSize: 15, color: C.ice, lineHeight: 1.6, opacity: 0.9, marginBottom: 24 }}>{show.description}</div>}

          {!hasAccess && show.is_premium && (
            <div style={{ marginBottom: 24 }}>
              <CreasePaywall showTitle={show.title} />
            </div>
          )}

          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 22, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 12 }}>
            Episodes
          </div>

          {episodes.length === 0 ? (
            <div style={{ color: C.steel, padding: '20px 0', fontSize: 14 }}>No episodes published yet.</div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {episodes.map((ep, idx) => {
                const locked = ep.is_premium && !hasAccess;
                return (
                  <div key={ep.id}
                    onClick={() => navigate(`/crease/${show.slug}/${ep.episode_number}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: 14,
                      cursor: 'pointer',
                      borderTop: idx === 0 ? 'none' : '1px solid rgba(46,91,140,0.25)',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(46,91,140,0.12)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <div style={{
                      width: 90, height: 56, borderRadius: 8, flexShrink: 0,
                      background: ep.thumbnail_url ? `url(${ep.thumbnail_url}) center/cover` : C.navy,
                      position: 'relative',
                    }}>
                      {locked && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>🔒</div>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
                        Episode {ep.episode_number}{ep.duration_seconds ? ` · ${formatDuration(ep.duration_seconds)}` : ''}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.ice, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
                      {ep.description && <div style={{ fontSize: 12, color: C.steel, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{ep.description}</div>}
                    </div>
                    <div style={{ fontSize: 18, color: locked ? C.steel : C.red, flexShrink: 0 }}>{locked ? '🔒' : '▶'}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
