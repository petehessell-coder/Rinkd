import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import CreasePaywall from '../components/CreasePaywall';
import { getShowBySlug, getEpisode, hasCreaseAccess, formatDuration } from '../lib/crease';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

export default function CreaseEpisodePage({ currentUser, profile }) {
  const { showSlug, episodeNumber } = useParams();
  const navigate = useNavigate();
  const [show, setShow] = useState(null);
  const [episode, setEpisode] = useState(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: s, error: showErr } = await getShowBySlug(showSlug);
    if (showErr) { setError(showErr.message || "Couldn't load this show — refresh and try again."); setLoading(false); return; }
    if (!s) { setLoading(false); return; }
    setShow(s);
    const { data: ep, error: epErr } = await getEpisode(s.id, parseInt(episodeNumber, 10));
    if (epErr) { setError(epErr.message || "Couldn't load this episode — refresh and try again."); setLoading(false); return; }
    setEpisode(ep);
    if (currentUser) setHasAccess(await hasCreaseAccess(currentUser.id));
    setLoading(false);
  }, [showSlug, episodeNumber, currentUser]);

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
            <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>Couldn't load this episode</div>
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

  if (!show || !episode) {
    return (
      <Layout profile={profile} currentPage="crease">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12 }}>
          <div>Episode not found</div>
          <button onClick={() => navigate('/crease')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Crease</button>
        </div>
      </Layout>
    );
  }

  const locked = episode.is_premium && !hasAccess;

  return (
    <Layout profile={profile} currentPage="crease">
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '20px 16px 60px' }}>
          <button onClick={() => navigate(`/crease/${show.slug}`)} style={{
            background: 'transparent', color: C.steel, border: 'none',
            padding: '4px 0', fontSize: 13, cursor: 'pointer',
            fontFamily: 'Barlow, sans-serif', marginBottom: 12,
          }}>← {show.title}</button>

          {/* Player or paywall */}
          {locked ? (
            <div style={{ marginBottom: 24 }}>
              <div style={{
                aspectRatio: '16/9',
                background: episode.thumbnail_url ? `linear-gradient(180deg, rgba(7,17,31,0.4) 0%, rgba(7,17,31,0.9) 100%), url(${episode.thumbnail_url}) center/cover` : C.navy,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
                position: 'relative',
              }}>
                <div style={{ fontSize: 60, opacity: 0.7 }}>🔒</div>
              </div>
              <CreasePaywall episodeTitle={episode.title} showTitle={show.title} />
            </div>
          ) : episode.video_url ? (
            <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
              <video src={episode.video_url} controls playsInline poster={episode.thumbnail_url}
                style={{ width: '100%', display: 'block', maxHeight: 540 }} />
            </div>
          ) : (
            <div style={{
              aspectRatio: '16/9',
              background: episode.thumbnail_url ? `url(${episode.thumbnail_url}) center/cover` : C.navy,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              color: C.steel,
              fontSize: 14,
            }}>
              Video coming soon
            </div>
          )}

          <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            {show.title} · Episode {episode.episode_number}
            {episode.duration_seconds ? ` · ${formatDuration(episode.duration_seconds)}` : ''}
          </div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.01em', marginBottom: 12 }}>
            {episode.title}
          </div>
          {episode.description && (
            <div style={{ fontSize: 15, color: C.ice, lineHeight: 1.6, opacity: 0.9 }}>{episode.description}</div>
          )}
        </div>
      </div>
    </Layout>
  );
}
