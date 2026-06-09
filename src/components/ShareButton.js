import React, { useState } from 'react';
import { composeRecapCard } from '../lib/shareCard';
import { canWebShareFiles, downloadBlob, copyText, absoluteShareUrl } from '../lib/share';
import { gameShareUrl } from '../lib/publicShare';
import { track } from '../lib/analytics';

// GROWTH-SHARE-1 · M3 — the Share button.
//
// On tap: compose the recap card client-side → if the browser can share files
// (mobile), fire the native Web Share sheet; else open a fallback modal showing
// the card + Download + Copy-link (desktop). Reusable on the public game page
// and on recap posts in every feed.
//
// Props:
//   getCard  : () => cardData | Promise<cardData>  (built via buildRecapCardData)
//   isLeague : bool   — picks /g vs /lg for the deep link
//   gameId   : string
//   variant  : 'solid' | 'ghost'  (styling)

const C = { blue: '#2E5B8C', ice: '#F4F7FA', steel: '#8BA3BE', card: '#0f2847', border: 'rgba(46,91,140,0.4)', dark: '#07111F' };

export default function ShareButton({ getCard, isLeague, gameId, variant = 'ghost', label = 'Share' }) {
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { imgUrl, blob, deepLink }
  const [copied, setCopied] = useState(false);

  const deepLink = absoluteShareUrl(gameShareUrl(!!isLeague, gameId));

  const onShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const card = await getCard();
      const blob = await composeRecapCard(card, { format: 'portrait' });
      const text = `${card.home.name} ${card.homeScore ?? 0}, ${card.away.name} ${card.awayScore ?? 0} — on Rinkd`;

      if (canWebShareFiles()) {
        const file = new File([blob], 'rinkd-recap.png', { type: 'image/png' });
        try {
          await navigator.share({ files: [file], text, url: deepLink });
          track('share_recap', { method: 'web_share', kind: isLeague ? 'league' : 'tournament', game_id: gameId });
          setBusy(false);
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') { setBusy(false); return; } // user cancelled
          // any other failure → drop to the fallback modal
        }
      }
      setModal({ imgUrl: URL.createObjectURL(blob), blob, deepLink });
      track('share_recap', { method: 'fallback', kind: isLeague ? 'league' : 'tournament', game_id: gameId });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ShareButton] compose/share failed', e);
    }
    setBusy(false);
  };

  const closeModal = () => {
    if (modal?.imgUrl) { try { URL.revokeObjectURL(modal.imgUrl); } catch { /* noop */ } }
    setModal(null); setCopied(false);
  };

  const btnStyle = variant === 'solid'
    ? { background: C.blue, color: '#fff', border: 'none' }
    : { background: 'transparent', color: C.ice, border: `1px solid ${C.border}` };

  return (
    <>
      <button onClick={onShare} disabled={busy} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 999,
        fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1, ...btnStyle,
      }}>
        <ShareIcon /> {busy ? 'Preparing…' : label}
      </button>

      {modal && (
        <div onClick={closeModal} style={{ position: 'fixed', inset: 0, background: 'rgba(3,9,18,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: 18, maxWidth: 360, width: '100%' }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: C.ice, marginBottom: 12 }}>Share this recap</div>
            <img src={modal.imgUrl} alt="Recap card" style={{ width: '100%', borderRadius: 10, display: 'block', marginBottom: 14, border: `1px solid ${C.border}` }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => downloadBlob(modal.blob, 'rinkd-recap.png')} style={{ flex: 1, background: C.blue, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 0', fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>⬇ Download</button>
              <button onClick={async () => { const ok = await copyText(modal.deepLink); setCopied(ok); }} style={{ flex: 1, background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, borderRadius: 999, padding: '11px 0', fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{copied ? '✓ Link copied' : '🔗 Copy link'}</button>
            </div>
            <button onClick={closeModal} style={{ width: '100%', marginTop: 10, background: 'transparent', color: C.steel, border: 'none', padding: 8, fontSize: 13, cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}
