import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getArticleBySlug, incrementView, renderMarkdown } from '../lib/rinkside';
import { useIsRinkdAdmin } from '../lib/userRole';
import { track } from '../lib/analytics';
import SEO from '../components/SEO';
import { C } from '../lib/tokens';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function RinksideArticle({ currentUser, profile }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsRinkdAdmin(currentUser?.id);
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await getArticleBySlug(slug);
    setLoading(false);
    if (qErr) {
      // Distinguish a fetch failure from "article not found." The previous
      // version set article=null in both cases, so a flaky connection looked
      // like a permanent 404.
      setError(qErr.message || "Couldn't load this article — refresh and try again.");
      return;
    }
    setArticle(data);
    if (data?.id) {
      // Count one view per article per browser session — guards against
      // remounts, StrictMode double-invokes, and refresh-spamming.
      const seenKey = 'rinkd_viewed_' + data.id;
      if (!sessionStorage.getItem(seenKey)) {
        incrementView(data.id);
        try { sessionStorage.setItem(seenKey, '1'); } catch (_) {}
      }
      track('article_read', { slug: data.slug, title: data.title, category: data.category });
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Layout profile={profile} currentPage="rinkside">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>Getting the ice ready.</div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout profile={profile} currentPage="rinkside">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, padding: 20, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>Couldn't load this article</div>
            <div style={{ color: C.steel, fontSize: 12, marginBottom: 16 }}>{error}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={load} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontWeight: 700 }}>Retry</button>
              <button onClick={() => navigate('/rinkside')} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Rinkside</button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!article) {
    return (
      <Layout profile={profile} currentPage="rinkside">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12 }}>
          <div>Article not found</div>
          <button onClick={() => navigate('/rinkside')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Rinkside</button>
        </div>
      </Layout>
    );
  }

  const canEdit = isAdmin || article.author_id === currentUser?.id;

  return (
    <Layout profile={profile} currentPage="rinkside">
      <SEO
        title={article.title}
        description={article.subtitle || `${article.author_name || 'Rinkside'} · Rinkd hockey reporting and features`}
        image={article.hero_image_url}
        type="article"
        url={`https://rinkd.app/rinkside/${article.slug}`}
      />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        {/* Hero */}
        {article.hero_image_url && (
          <div style={{
            height: 360,
            background: `linear-gradient(180deg, rgba(7,17,31,0.2) 0%, ${C.dark} 100%), url(${article.hero_image_url}) center/cover`,
            position: 'relative',
          }}>
            <button onClick={() => navigate('/rinkside')} style={{
              position: 'absolute', top: 16, left: 16,
              background: 'rgba(0,0,0,0.45)', color: C.ice, border: 'none',
              padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
              fontFamily: 'Barlow, sans-serif',
            }}>← Rinkside</button>
          </div>
        )}

        <article style={{ maxWidth: 720, margin: article.hero_image_url ? '-80px auto 0' : '20px auto 0', padding: '0 18px 80px', position: 'relative' }}>
          {!article.hero_image_url && (
            <button onClick={() => navigate('/rinkside')} style={{
              background: 'transparent', color: C.steel, border: 'none',
              padding: '4px 0', fontSize: 13, cursor: 'pointer',
              fontFamily: 'Barlow, sans-serif', marginBottom: 12,
            }}>← Rinkside</button>
          )}

          {article.category && (
            <div style={{ fontSize: 11, color: C.red, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
              {article.category}
            </div>
          )}

          <h1 style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontStyle: 'italic', fontWeight: 900,
            fontSize: 42, lineHeight: 1.05, letterSpacing: '-0.01em',
            margin: 0, marginBottom: 12, textTransform: 'uppercase',
          }}>{article.title}</h1>

          {article.subtitle && (
            <div style={{ fontSize: 19, color: C.steel, lineHeight: 1.5, marginBottom: 18 }}>{article.subtitle}</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, paddingBottom: 16, borderBottom: `1px solid ${C.border}`, fontSize: 13, color: C.steel }}>
            <span style={{ color: C.ice, fontWeight: 600 }}>{article.author_name || 'Rinkside Editorial'}</span>
            <span>·</span>
            <span>{fmtDate(article.published_at)}</span>
            {article.read_minutes && (<><span>·</span><span>{article.read_minutes} min read</span></>)}
            {canEdit && (
              <button onClick={() => navigate(`/rinkside/${article.slug}/edit`)}
                style={{ marginLeft: 'auto', background: 'transparent', color: C.red, border: `1px solid ${C.red}`, padding: '4px 12px', borderRadius: 999, fontSize: 11, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontWeight: 600 }}>
                Edit
              </button>
            )}
          </div>

          {/* Body */}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(article.body_markdown) }} />

          {/* Tags */}
          {article.tags?.length > 0 && (
            <div style={{ marginTop: 32, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {article.tags.map((t) => (
                <span key={t} style={{ background: 'rgba(46,91,140,0.2)', color: C.steel, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>#{t}</span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: 40, padding: '22px 0', borderTop: `1px solid ${C.border}`, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: C.steel, marginBottom: 12 }}>Want more like this?</div>
            <a href="https://rinkd.app/survey" target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', background: C.red, color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 14, padding: '10px 22px', borderRadius: 999, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Help Shape Rinkd · Take the Survey →
            </a>
          </div>
        </article>
      </div>
    </Layout>
  );
}
