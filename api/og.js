import { ImageResponse } from '@vercel/og';

// SHARE-GOAL-1 · OG — the server-rendered Open Graph image.
//
// Renders a 1200×630 broadcast card at the edge from query params (so a pasted
// Rinkd link unfurls richly on iMessage / Slack / X / Facebook, none of which run
// the SPA's JS). Driven by /api/unfurl, which fetches the game/event and passes
// the display values here. Pure rendering — no DB calls — so it's fast and can't
// leak anything the unfurl layer didn't already decide to expose.
//
// Built with Satori's plain-object element form (NOT JSX) so there's no JSX
// transpile / React-pragma dependency in the edge bundle. ANY failure falls back
// to the static brand image — a link must never unfurl broken.

export const config = { runtime: 'edge' };

const NAVY = '#0B1F3A';
const NAVY2 = '#07111F';
const RED = '#D72638';
const ICE = '#F4F7FA';
const STEEL = '#8BA3BE';

// Barlow Condensed Black for the broadcast numerals — best-effort, cached for
// the life of the isolate. If it can't be fetched we render in the default sans
// (still bold + legible); the unfurl never blocks on a font.
let fontPromise = null;
function loadFont() {
  if (!fontPromise) {
    fontPromise = fetch('https://cdn.jsdelivr.net/gh/google/fonts/ofl/barlowcondensed/BarlowCondensed-Black.ttf')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }
  return fontPromise;
}

// Tiny hyperscript for Satori — { type, props:{ style, children } }.
const el = (type, style, children) => ({ type, props: { style, children } });

function teamBlock(name, score, align) {
  return el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 460 }, [
    el('div', {
      display: 'flex', fontSize: 200, fontWeight: 900, fontStyle: 'italic', color: ICE,
      lineHeight: 1, fontFamily: 'Barlow Condensed', textShadow: '0 6px 18px rgba(0,0,0,0.5)',
    }, [String(score)]),
    el('div', {
      display: 'flex', marginTop: 14, fontSize: 40, fontWeight: 800, color: STEEL,
      textTransform: 'uppercase', letterSpacing: 1, maxWidth: 440, overflow: 'hidden',
      textAlign: 'center', justifyContent: 'center',
    }, [String(name).toUpperCase()]),
    el('div', { display: 'flex', fontSize: 22, color: STEEL, marginTop: 2, letterSpacing: 2 }, [align]),
  ]);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const p = url.searchParams;
  const origin = url.origin;

  try {
    const home = p.get('home') || 'Home';
    const away = p.get('away') || 'Away';
    const hs = p.get('hs');
    const as = p.get('as');
    const status = (p.get('status') || '').toUpperCase(); // FINAL | LIVE | ''
    const title = p.get('title') || 'Rinkd';
    const sub = p.get('sub') || 'Every game lives on Rinkd';
    const hasScore = hs !== null && as !== null && hs !== '' && as !== '';

    const font = await loadFont();
    const fonts = font ? [{ name: 'Barlow Condensed', data: font, weight: 900, style: 'normal' }] : [];

    // The pill (FINAL / LIVE) — red for live, light for final.
    const pill = status
      ? el('div', {
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 22px', borderRadius: 999,
        background: status === 'LIVE' ? RED : 'rgba(244,247,250,0.12)', color: ICE,
        fontSize: 26, fontWeight: 900, fontStyle: 'italic', fontFamily: 'Barlow Condensed', letterSpacing: 2,
      }, [status])
      : null;

    const center = hasScore
      ? el('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 36 }, [
        teamBlock(away, as, 'AWAY'),
        el('div', { display: 'flex', fontSize: 110, color: STEEL, fontWeight: 800, fontFamily: 'Barlow Condensed' }, ['–']),
        teamBlock(home, hs, 'HOME'),
      ])
      : el('div', {
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', maxWidth: 1000,
        fontSize: 88, fontWeight: 900, fontStyle: 'italic', color: ICE, fontFamily: 'Barlow Condensed',
        lineHeight: 1.04, textTransform: 'uppercase',
      }, [title]);

    const tree = el('div', {
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      backgroundColor: NAVY,
      backgroundImage: `linear-gradient(160deg, #13335c 0%, ${NAVY} 55%, ${NAVY2} 100%)`,
      color: ICE, fontFamily: 'Barlow, sans-serif', position: 'relative',
    }, [
      // top accent bar
      el('div', { display: 'flex', height: 10, width: '100%', backgroundColor: RED }, []),
      // top strip
      el('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '30px 56px 0',
      }, [
        el('div', { display: 'flex', alignItems: 'center', gap: 14 }, [
          el('div', { display: 'flex', fontSize: 48, fontWeight: 900, fontStyle: 'italic', fontFamily: 'Barlow Condensed', color: ICE, letterSpacing: 1 }, ['RINKD']),
          el('div', { display: 'flex', width: 16, height: 16, borderRadius: 999, backgroundColor: RED }, []),
        ]),
        el('div', { display: 'flex', fontSize: 28, fontWeight: 700, color: STEEL, textTransform: 'uppercase', letterSpacing: 2, maxWidth: 620, overflow: 'hidden' }, [String(sub).toUpperCase()]),
      ]),
      // center stage
      el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 26, padding: '0 56px' }, [
        pill, center,
      ].filter(Boolean)),
      // footer
      el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 56px 34px' }, [
        el('div', { display: 'flex', fontSize: 26, color: STEEL, fontWeight: 700 }, ['rinkd.app']),
        el('div', { display: 'flex', fontSize: 24, color: ICE, fontWeight: 700, fontStyle: 'italic', fontFamily: 'Barlow Condensed', letterSpacing: 1 }, ['FOLLOW LIVE ON RINKD →']),
      ]),
    ]);

    return new ImageResponse(tree, { width: 1200, height: 630, fonts });
  } catch (e) {
    // Never break the unfurl — fall back to the static brand card.
    return Response.redirect(`${origin}/og-fallback-rinkd.png`, 302);
  }
}
