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
// transpile / React-pragma dependency in the edge bundle. Satori REQUIRES a font
// to draw any text, so we fetch Barlow Condensed first and bail to the static
// brand card if it (or the render) fails — the render is AWAITED here (not
// streamed) precisely so a failure becomes a clean fallback, never a broken
// 200-with-empty-body image.

export const config = { runtime: 'edge' };

const NAVY = '#0B1F3A';
const NAVY2 = '#07111F';
const RED = '#D72638';
const ICE = '#F4F7FA';
const STEEL = '#8BA3BE';

// Barlow Condensed (700 + 900), latin subset — small, fast, reliably hosted.
// Cached for the life of the isolate.
const FONT_URLS = [
  { weight: 700, url: 'https://cdn.jsdelivr.net/npm/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff' },
  { weight: 900, url: 'https://cdn.jsdelivr.net/npm/@fontsource/barlow-condensed/files/barlow-condensed-latin-900-normal.woff' },
];
let fontsPromise = null;
function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all(FONT_URLS.map(async (f) => {
      try {
        const r = await fetch(f.url);
        if (!r.ok) return null;
        return { name: 'Barlow Condensed', data: await r.arrayBuffer(), weight: f.weight, style: 'normal' };
      } catch { return null; }
    })).then((list) => list.filter(Boolean));
  }
  return fontsPromise;
}

// Tiny hyperscript for Satori — { type, props:{ style, children } }.
const el = (type, style, children) => ({ type, props: { style, children } });

function teamBlock(name, score, align) {
  return el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 460 }, [
    el('div', {
      display: 'flex', fontSize: 200, fontWeight: 900, fontStyle: 'italic', color: ICE,
      lineHeight: 1, textShadow: '0 6px 18px rgba(0,0,0,0.5)',
    }, [String(score)]),
    el('div', {
      display: 'flex', marginTop: 14, fontSize: 40, fontWeight: 700, color: STEEL,
      textTransform: 'uppercase', maxWidth: 440, overflow: 'hidden',
    }, [String(name).toUpperCase()]),
    el('div', { display: 'flex', fontSize: 22, fontWeight: 700, color: STEEL, marginTop: 2 }, [align]),
  ]);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const p = url.searchParams;
  const origin = url.origin;
  const fallback = () => Response.redirect(`${origin}/og-fallback-rinkd.png`, 302);

  const fonts = await loadFonts();
  if (!fonts.length) return fallback(); // no font → Satori can't draw text → static card

  try {
    const home = p.get('home') || 'Home';
    const away = p.get('away') || 'Away';
    const hs = p.get('hs');
    const as = p.get('as');
    const status = (p.get('status') || '').toUpperCase(); // FINAL | LIVE | ''
    const title = p.get('title') || 'Rinkd';
    const sub = p.get('sub') || 'Every game lives on Rinkd';
    const hasScore = hs !== null && as !== null && hs !== '' && as !== '';

    const pill = status
      ? el('div', {
        display: 'flex', alignItems: 'center', padding: '8px 22px', borderRadius: 999,
        backgroundColor: status === 'LIVE' ? RED : 'rgba(244,247,250,0.12)', color: ICE,
        fontSize: 26, fontWeight: 900, fontStyle: 'italic',
      }, [status])
      : null;

    const center = hasScore
      ? el('div', { display: 'flex', alignItems: 'center', justifyContent: 'center' }, [
        teamBlock(away, as, 'AWAY'),
        el('div', { display: 'flex', fontSize: 110, fontWeight: 700, color: STEEL, marginLeft: 28, marginRight: 28 }, ['–']),
        teamBlock(home, hs, 'HOME'),
      ])
      : el('div', {
        display: 'flex', textAlign: 'center', maxWidth: 1000,
        fontSize: 88, fontWeight: 900, fontStyle: 'italic', color: ICE,
        lineHeight: 1.04, textTransform: 'uppercase',
      }, [title]);

    const tree = el('div', {
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      backgroundColor: NAVY,
      backgroundImage: `linear-gradient(160deg, #13335c 0%, ${NAVY} 55%, ${NAVY2} 100%)`,
      color: ICE, fontFamily: 'Barlow Condensed',
    }, [
      el('div', { display: 'flex', height: 10, width: '100%', backgroundColor: RED }, []),
      el('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '30px 56px 0',
      }, [
        el('div', { display: 'flex', alignItems: 'center' }, [
          el('div', { display: 'flex', fontSize: 48, fontWeight: 900, fontStyle: 'italic', color: ICE }, ['RINKD']),
          el('div', { display: 'flex', width: 16, height: 16, borderRadius: 999, backgroundColor: RED, marginLeft: 14 }, []),
        ]),
        el('div', { display: 'flex', fontSize: 28, fontWeight: 700, color: STEEL, textTransform: 'uppercase', maxWidth: 620, overflow: 'hidden' }, [String(sub).toUpperCase()]),
      ]),
      el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: '0 56px' }, [
        ...(pill ? [pill, el('div', { display: 'flex', height: 26 }, [])] : []),
        center,
      ]),
      el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 56px 34px' }, [
        el('div', { display: 'flex', fontSize: 26, fontWeight: 700, color: STEEL }, ['rinkd.app']),
        el('div', { display: 'flex', fontSize: 24, fontWeight: 700, fontStyle: 'italic', color: ICE }, ['FOLLOW LIVE ON RINKD →']),
      ]),
    ]);

    // AWAIT the render so a Satori error is catchable here (a streamed
    // ImageResponse would 200 with an empty body on failure).
    const image = new ImageResponse(tree, { width: 1200, height: 630, fonts });
    const buf = await image.arrayBuffer();
    return new Response(buf, {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return fallback();
  }
}
