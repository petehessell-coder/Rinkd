import { useEffect } from 'react';

/**
 * Dead-simple SEO component. No react-helmet — we just mutate document.head
 * directly because we don't need SSR hydration semantics.
 *
 * Usage:
 *   <SEO title="Rinkd · Detroit Beer League"
 *        description="Schedule, standings, and locker-room chatter for the Detroit Beer League."
 *        image="https://rinkd.app/og/team/abc.jpg" />
 *
 * Every public-facing page should drop one of these in.
 */

const DEFAULTS = {
  title: 'Rinkd · Where Hockey Lives Online',
  description: 'The mobile-first social platform built for the hockey community. Teams, leagues, scores, and stories — all in one place.',
  image: 'https://rinkd.app/rinkd-wordmark-large.png',
  siteName: 'Rinkd',
  type: 'website',
  twitterCard: 'summary_large_image',
};

function setMeta(selector, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'content') continue;
      el.setAttribute(k, v);
    }
    document.head.appendChild(el);
  }
  el.setAttribute('content', attrs.content || '');
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export default function SEO({ title, description, image, type, url, noIndex }) {
  useEffect(() => {
    const t = title ? `${title} · Rinkd` : DEFAULTS.title;
    const d = description || DEFAULTS.description;
    const i = image || DEFAULTS.image;
    const ty = type || DEFAULTS.type;
    const u = url || (typeof window !== 'undefined' ? window.location.href : 'https://rinkd.app');

    document.title = t;

    setMeta('meta[name="description"]', { name: 'description', content: d });
    setMeta('meta[name="theme-color"]', { name: 'theme-color', content: '#0B1F3A' });

    // Open Graph
    setMeta('meta[property="og:title"]', { property: 'og:title', content: t });
    setMeta('meta[property="og:description"]', { property: 'og:description', content: d });
    setMeta('meta[property="og:image"]', { property: 'og:image', content: i });
    setMeta('meta[property="og:url"]', { property: 'og:url', content: u });
    setMeta('meta[property="og:type"]', { property: 'og:type', content: ty });
    setMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: DEFAULTS.siteName });

    // Twitter
    setMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: DEFAULTS.twitterCard });
    setMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: t });
    setMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: d });
    setMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: i });

    // Canonical
    setLink('canonical', u);

    // Robots
    setMeta('meta[name="robots"]', { name: 'robots', content: noIndex ? 'noindex,nofollow' : 'index,follow' });
  }, [title, description, image, type, url, noIndex]);

  return null;
}
