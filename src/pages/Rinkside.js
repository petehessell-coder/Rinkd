import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { listArticles, listCategories } from '../lib/rinkside';
import { useUserRole } from '../lib/userRole';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

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
  const role = useUserRole(currentUser?.id);
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data }, cats] = await Promise.all([
        listArticles({ category: activeCategory, limit: 30 }),
        listCategories(),
      ]);
      setArticles(data);
      setCategories(cats);
      setLoading(false);
    })();
  }, [activeCategory]);

  const featured = articles.find((a) => a.is_featured);
  const rest = articles.filter((a) => a.id !== featured?.id);
  const isAdmin = role === 'commissioner';

  return (
    <Layout profile={profile} currentPage="rinkside">
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 60px' }}>
          {/* Hero */}
          <div style={{ textAlign: 'center', marginBottom: 28, paddingTop: 12 }}>
            <img src="/rinkside-logo.png" alt="Rinkside"
              style={{ width: 100, height: 100, borderRadius: 22, marginBottom: 12, boxShadow: '0 14px 30px rgba(0,0,0,0.45)' }} />
            <div style={{ display: 'block', background: 'rgba(46,91,140,0.18)', color: '#5a9cdc', fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, marginBottom: 10, border: '1px solid rgba(46,91,140,0.4)', width: 'fit-content', marginLeft: 'auto', marginRight: 'auto' }}>
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
                style={{ background: !activeCategory ? C.red : 'transparent', color: !activeCategory ? '#fff' : C.steel, border: `1px solid ${!activeCategory ? C.red : C.border}`, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>
                All
              </button>
              {categories.map((cat) => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  style={{ background: activeCategory === cat ? C.red : 'transparent', color: activeCategory === cat ? '#fff' : C.steel, border: `1px solid ${activeCategory === cat ? C.red : C.border}`, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>
                  {cat}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>Loading articles…</div>
          ) : articles.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📰</div>
              No articles yet — check back soon.
            </div>
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
