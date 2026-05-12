import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { CardGridSkeleton, EmptyState } from '../components/Skeletons';
import { listShows, hasCreaseAccess } from '../lib/crease';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

function ShowCard({ show, onOpen }) {
  return (
    <div onClick={onOpen}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'transform 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = C.red; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = C.border; }}>
      <div style={{
        height: 160,
        background: show.hero_image_url ? `linear-gradient(180deg, rgba(7,17,31,0.2) 0%, rgba(7,17,31,0.85) 100%), url(${show.hero_image_url}) center/cover` : C.navy,
        position: 'relative',
      }}>
        {show.is_premium && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(0,0,0,0.55)', color: C.red,
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase',
            border: '1px solid rgba(215,38,56,0.4)',
          }}>🔒 Crease</div>
        )}
        <div style={{ position: 'absolute', left: 14, bottom: 12, right: 14 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: C.ice, lineHeight: 1.1, textTransform: 'uppercase' }}>
            {show.title}
          </div>
          {show.tagline && <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>{show.tagline}</div>}
        </div>
      </div>
      <div style={{ padding: 14 }}>
        {show.host && <div style={{ fontSize: 11, color: C.steel, marginBottom: 6, letterSpacing: '0.05em' }}>HOSTED BY <span style={{ color: C.ice, fontWeight: 600 }}>{show.host}</span></div>}
        {show.description && <div style={{ fontSize: 13, color: C.ice, lineHeight: 1.5, opacity: 0.85 }}>{show.description}</div>}
      </div>
    </div>
  );
}

export default function CreasePage({ currentUser, profile }) {
  const navigate = useNavigate();
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await listShows();
      setShows(data);
      if (currentUser) setHasAccess(await hasCreaseAccess(currentUser.id));
      setLoading(false);
    })();
  }, [currentUser]);

  return (
    <Layout profile={profile} currentPage="crease">
      <SEO
        title="Crease · Original hockey shows"
        description="Long-form interviews, locker-room debates, and the conversations the league won't have anywhere else. Crease is the premium content layer of Rinkd."
        image="https://rinkd.app/crease-logo.png"
        url="https://rinkd.app/crease"
      />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 60px' }}>
          {/* Hero */}
          <div style={{ marginBottom: 24, textAlign: 'center', paddingTop: 12 }}>
            <img src="/crease-logo.png" alt="Crease"
              style={{ width: 140, height: 140, borderRadius: 28, marginBottom: 14, boxShadow: '0 18px 40px rgba(0,0,0,0.5)' }} />
            <div style={{ display: 'block', background: 'rgba(215,38,56,0.15)', color: C.red, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, marginBottom: 10, border: '1px solid rgba(215,38,56,0.3)', width: 'fit-content', marginLeft: 'auto', marginRight: 'auto' }}>
              The Premium
            </div>
            <div style={{ fontSize: 14, color: C.steel, maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>
              Original shows for the hockey lifer. Long-form interviews, locker-room debates, and the conversations the league won't have anywhere else.
            </div>
            {!hasAccess && currentUser && (() => {
              const paymentsLive = process.env.REACT_APP_CREASE_PAYMENTS_LIVE === '1';
              const href = paymentsLive
                ? (process.env.REACT_APP_CREASE_CHECKOUT_URL || 'mailto:hello@rinkd.app?subject=Crease%20Premium')
                : 'mailto:hello@rinkd.app?subject=Crease%20Early%20Access&body=Count%20me%20in%20when%20Crease%20launches.';
              return (
                <a href={href}
                  style={{ display: 'inline-block', marginTop: 16, padding: '11px 22px', background: C.red, color: '#fff', textDecoration: 'none', borderRadius: 999, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 14, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {paymentsLive ? 'Start 7-day free trial · $4.99/mo' : 'Join Crease Early-Access List'}
                </a>
              );
            })()}
            {hasAccess && (
              <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#22C55E', fontWeight: 600 }}>
                ✓ Crease Premium active
              </div>
            )}
          </div>

          {loading ? (
            <CardGridSkeleton count={4} />
          ) : shows.length === 0 ? (
            <EmptyState
              icon="🎬"
              title="Crease is loading the schedule"
              body="Original shows are dropping soon. Join the early-access list and we'll let you know the moment episode one is live."
              cta={{ label: 'Join Early Access', onClick: () => { window.location.href = 'mailto:hello@rinkd.app?subject=Crease%20Early%20Access'; } }}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {shows.map((s) => (
                <ShowCard key={s.id} show={s} onOpen={() => navigate(`/crease/${s.slug}`)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
