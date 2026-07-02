import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { listArticles, listCategories } from '../lib/rinkside';
import { useIsRinkdAdmin } from '../lib/userRole';
import { CardGridSkeleton } from '../components/Skeletons';
import EmptyState from '../components/ui/EmptyState';
import { C } from '../lib/tokens';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function FeatureCard({ a, onOpen }) {
  return (
    <div onClick={onOpen}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        overflow: 'hidden',
        cursor: 'pointer',
        marginBottom: 18,
        transition: 'transform 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = C.red; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = C.border; }}>
      <div style={{
        height: 260,
        background: a.hero_image_url ? `linear-gradient(180deg, rgba(7,17,31,0.15) 0%, rgba(7,17,31,0.7) 100%), url(${a.hero_image_url}) center/cover` : C.navy,
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: 12, left: 12,
          background: C.red, color: '#fff',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          padding: '4px 10px', borderRadius: 4, textTransform: 'uppercase',
        }}>★ Featured</div>
        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 16, color: C.ice }}>
          {a.category && <div style={{ fontSize: 11, color: C.red, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>{a.category}</div>}
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase' }}>{a.title}</div>
          {a.subtitle && <div style={{ fontSize: 14, color: 'rgba(244,247,250,0.85)', marginTop: 6, lineHeight: 1.5 }}>{a.subtitle}</div>}
        </div>
      </div>
      <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: C.steel, fontSize: 12 }}>
        <span>{a.author_name || 'Rinkside'}</span>
        <span>{fmtDate(a.published_at)}{a.read_minutes ? ` · ${a.read_minutes} min read` : ''}</span>
      </div>
    </div>
  );
}

function ArticleCard({ a, onOpen }) {
  return (
    <div onClick={onOpen}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = C.red; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = C.border; }}>
      <div style={{
        height: 150,
        background: a.hero_image_url ? `url(${a.hero_image_url}) center/cover` : C.navy,
      }} />
      <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {a.category && <div style={{ fontSize: 10, color: C.red, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>{a.category}</div>}
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18, lineHeight: 1.15, color: C.ice, textTransform: 'uppercase', marginBottom: 6 }}>{a.title}</div>
        {a.subtitle && <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.45, flex: 1 }}>{a.subtitle}</div>}
        <div style={{ marginTop: 10, fontSize: 11, color: C.steel, display: 'flex', justifyContent: 'space-between' }}>
          <span>{a.author_name || 'Rinkside'}</span>
          <span>{fmtDate(a.published_at)}{a.read_minutes ? ` · ${a.read_minutes} min` : ''}</span>
        </div>
      </div>
    </div>
  );
}

export default function Rinkside({ currentUser, profile }) {
  const navigate = useNavigate();
  // Rinkside is platform-level Rinkd-published content. Only staff publish.
  const isAdmin = useIsRinkdAdmin(currentUser?.id);
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: qErr }, cats] = await Promise.all([
      listArticles({ category: activeCategory, limit: 30 }),
      listCategories(),
    ]);
    if (qErr) { setError(qErr.message); setLoading(false); return; }
    setArticles(data);
    setCategories(cats);
    setLoading(false);
  }, [activeCategory]);

  useEffect(() => { load(); }, [load]);

  const featured = articles.find((a) => a.is_featured);
  const rest = articles.filter((a) => a.id !== featured?.id);

  return (
    <Layout profile={profile} currentPage="rinkside">
      <SEO
        title="Rinkside · Daily hockey reporting"
        description="Features, training, and community storytelling from the Rinkd editorial team. The hockey magazine built for the rest of us."
        image="https://rinkd.app/rinkside-logo.png"
        url="https://rinkd.app/rinkside"
      />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 60px' }}>
          {/* Hero */}
          <div style={{ textAlign: 'center', marginBottom: 28, paddingTop: 12 }}>
            <img src="/rinkside-logo.png" alt="Rinkside"
              style={{ width: 100, height: 100, borderRadius: 22, marginBottom: 12, boxShadow: '0 14px 30px rgba(0,0,0,0.45)' }} />
            <div style={{ display: 'block', background: 'rgba(46,91,140,0.18)', color: '#5a9cdc', fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, marginBottom: 10, border: `1px solid ${C.border}`, width: 'fit-content', marginLeft: 'auto', marginRight: 'auto' }}>
              The Content
            </div>
            <div style={{ fontSize: 14, color: C.steel, maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>
              Daily hockey reporting, features, and conversations from the Rinkd community.
            </div>
          </div>

          {/* Admin toolbar */}
          {isAdmin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={() => navigate('/rinkside/new')}
                style={{ background: C.red, color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                + New Article
              </button>
            </div>
          )}

          {/* Category filter */}
          {categories.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, justifyContent: 'center' }}>
              <button onClick={() => setActiveCategory(null)}
                style={{ background: !activeCategory ? C.red : 'transparent', color: !activeCategory ? '#fff' : C.steel, border: `1px solid ${!activeCategory ? C.red : C.border}`, padding: '6px 14px', minHeight: 44, borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>
                All
              </button>
              {categories.map((cat) => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  style={{ background: activeCategory === cat ? C.red : 'transparent', color: activeCategory === cat ? '#fff' : C.steel, border: `1px solid ${activeCategory === cat ? C.red : C.border}`, padding: '6px 14px', minHeight: 44, borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>
                  {cat}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <CardGridSkeleton count={6} />
          ) : error ? (
            <div style={{ padding: 24, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: C.red }}>Couldn't load Rinkside</div>
              <div style={{ fontSize: 12, color: C.steel, marginBottom: 16 }}>{error}</div>
              <button onClick={load}
                style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '8px 20px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          ) : articles.length === 0 ? (
            <EmptyState
              icon="📰"
              title={activeCategory ? `No ${activeCategory} stories yet` : 'The presses are warming up'}
              body={activeCategory ? 'Try another category or take a look at everything we\'ve published so far.' : 'Rinkside articles are dropping soon. In the meantime, help us shape what we cover.'}
              cta={activeCategory
                ? { label: 'See All Articles', onClick: () => setActiveCategory(null) }
                : { label: 'Take the Survey', onClick: () => window.open('https://rinkd.app/survey', '_blank') }}
            />
          ) : (
            <>
              {featured && <FeatureCard a={featured} onOpen={() => navigate(`/rinkside/${featured.slug}`)} />}
              {rest.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {rest.map((a) => (
                    <ArticleCard key={a.id} a={a} onOpen={() => navigate(`/rinkside/${a.slug}`)} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Survey CTA stays — it's the lead-gen tool until article subscriptions ship */}
          <div style={{ marginTop: 36, textAlign: 'center' }}>
            <a href="https://rinkd.app/survey" target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', background: 'transparent', color: C.ice, border: `1.5px solid ${C.border}`, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, padding: '10px 22px', borderRadius: 999, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              📋 Help Shape Rinkside · Take the Survey →
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
