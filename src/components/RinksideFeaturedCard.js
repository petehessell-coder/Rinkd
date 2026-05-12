import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listArticles } from '../lib/rinkside';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

const DISMISS_KEY = 'rinkd_rinkside_card_dismissed_v1';

/**
 * Rinkside Featured Story card — surfaces the latest featured article inside
 * the Feed. Part of Sprint 4D.5 (Complexity Diet): Rinkside is no longer in
 * primary nav, so we need a discovery surface that doesn't force users to
 * hunt for it.
 *
 * Behavior:
 *   - Loads the most-recent featured article on mount
 *   - Renders nothing if there are no featured articles
 *   - Dismissable for the current session (sessionStorage, not localStorage —
 *     we want to re-surface a new featured story tomorrow)
 *   - Tap navigates to the article reader
 */
export default function RinksideFeaturedCard() {
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (dismissed) return;
    (async () => {
      const { data } = await listArticles({ limit: 6 });
      const featured = data.find((a) => a.is_featured) || data[0];
      if (featured) setArticle(featured);
    })();
  }, [dismissed]);

  if (dismissed || !article) return null;

  const handleOpen = () => {
    track('rinkside_featured_card_clicked', { slug: article.slug });
    navigate(`/rinkside/${article.slug}`);
  };
  const handleDismiss = (e) => {
    e.stopPropagation();
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* swallow */ }
    setDismissed(true);
    track('rinkside_featured_card_dismissed', { slug: article.slug });
  };

  return (
    <div onClick={handleOpen}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        marginBottom: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
      }}>
      {/* Rinkside-branded top bar */}
      <div style={{
        background: '#fff',
        padding: '8px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <img src="/rinkside-logo.png" alt="Rinkside" style={{ height: 22, width: 'auto' }} />
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 11, color: C.navy, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          Featured Story
        </span>
        <button onClick={handleDismiss} aria-label="Dismiss"
          style={{ marginLeft: 'auto', background: 'transparent', color: C.steel, border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2 }}>
          ×
        </button>
      </div>

      {/* Hero image */}
      {article.hero_image_url && (
        <div style={{ height: 180, background: `url(${article.hero_image_url}) center/cover`, position: 'relative' }} />
      )}

      {/* Headline + dek */}
      <div style={{ padding: '14px 16px 16px' }}>
        {article.category && (
          <div style={{ fontSize: 10, fontWeight: 700, color: C.red, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
            {article.category}
          </div>
        )}
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
          fontSize: 22, lineHeight: 1.15, color: C.ice, textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          {article.title}
        </div>
        {article.subtitle && (
          <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.5, marginBottom: 12 }}>
            {article.subtitle}
          </div>
        )}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.red, fontWeight: 700, letterSpacing: '0.04em' }}>
          Read on Rinkside <span>→</span>
        </div>
      </div>
    </div>
  );
}
