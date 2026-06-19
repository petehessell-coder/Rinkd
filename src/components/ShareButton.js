import React, { useState } from 'react';
import { composeRecapCard, composeGamePuckCard, composeWatermarkedPhoto, composeStatCard } from '../lib/shareCard';
import { composeRecapCardV2 } from '../lib/recapShareV2';
import { prefersNativeShare, downloadBlob, copyText, absoluteShareUrl } from '../lib/share';
import { gameShareUrl } from '../lib/publicShare';
import { uploadShareCard } from '../lib/ogCard';
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

export default function ShareButton({ getCard, isLeague, gameId, variant = 'ghost', label = 'Share', cardType = 'recap', compact = false, shareUrl = null }) {
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { imgUrl, blob, deepLink }
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(false);

  const gameDeepLink = gameId ? absoluteShareUrl(gameShareUrl(!!isLeague, gameId)) : (shareUrl || absoluteShareUrl('/'));
  const kind = isLeague ? 'league' : 'tournament';
  const isPuck = cardType === 'gamepuck';
  const isPhoto = cardType === 'photo';
  const isRecapV2 = cardType === 'recapv2';
  const isStat = cardType === 'stat';
  const fileName = isPhoto ? 'rinkd-photo.jpg' : isPuck ? 'rinkd-gamepuck.png' : isStat ? 'rinkd-stat.png' : 'rinkd-recap.png';
  const mime = isPhoto ? 'image/jpeg' : 'image/png';

  const onShare = async () => {
    if (busy) return;
    setBusy(true); setErr(false);
    // 1) Compose. If this fails, SHOW it — never fail silently.
    let blob, card;
    try {
      card = await getCard();
      blob = isPhoto ? await composeWatermarkedPhoto(card.imageUrl, { tag: card.tag })
        : isPuck ? await composeGamePuckCard(card)
          : isStat ? await composeStatCard(card)
            : isRecapV2 ? await composeRecapCardV2(card, { shareUrl: shareUrl || gameDeepLink, sponsorName: card.sponsorName })
              : await composeRecapCard(card, { format: 'portrait' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ShareButton] compose failed', e);
      setErr(true); setBusy(false);
      return;
    }
    // Photos + stat cards deep-link to the event page; games to /g|/lg.
    const link = (isPhoto && card.deepLink) ? card.deepLink : (shareUrl || gameDeepLink);
    // Fire-and-forget OG upload — recap only (the game's OG image is the recap card).
    if (cardType === 'recap') uploadShareCard(gameId, isLeague, card);
    const text = isPhoto
      ? `📸 ${card.tag ? card.tag + ' · ' : ''}on Rinkd`
      : isPuck
        ? `🏒 Game Puck: ${card.player.name || '#' + card.player.jersey} — ${card.player.teamName} · on Rinkd`
        : isStat
          ? `🏒 ${card.player.name || '#' + card.player.jersey}${card.headline ? ` — ${card.headline.value} ${card.headline.label}` : ''} · on Rinkd`
          : isRecapV2
            ? `${card.away?.name || 'Away'} ${card.away_score ?? 0}, ${card.home?.name || 'Home'} ${card.home_score ?? 0} — on Rinkd`
            : `${card.home.name} ${card.homeScore ?? 0}, ${card.away.name} ${card.awayScore ?? 0} — on Rinkd`;
    // 2) Touch device with file-share → one-tap native sheet. Any failure (incl.
    //    lost user-activation after the async compose) drops to the modal.
    if (prefersNativeShare()) {
      try {
        const file = new File([blob], fileName, { type: mime });
        await navigator.share({ files: [file], text, url: link });
        track('share_recap', { method: 'web_share', kind, game_id: gameId, card_type: cardType });
        setBusy(false);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { setBusy(false); return; } // user cancelled
        // else fall through to the modal
      }
    }
    // 3) Desktop / fallback → modal with the image + Download + Copy link.
    setModal({ imgUrl: URL.createObjectURL(blob), blob, deepLink: link });
    track('share_recap', { method: 'fallback', kind, game_id: gameId, card_type: cardType });
    setBusy(false);
  };

  const closeModal = () => {
    if (modal?.imgUrl) { try { URL.revokeObjectURL(modal.imgUrl); } catch { /* noop */ } }
    setModal(null); setCopied(false);
  };

  const btnStyle = variant === 'solid'
    ? { background: C.blue, color: '#fff', border: 'none' }
    : { background: 'transparent', color: C.ice, border: `1px solid ${C.border}` };

  const noun = isPhoto ? 'photo' : isPuck ? 'Game Puck' : isStat ? 'card' : 'recap';
  const renderModal = () => (
    <div onClick={closeModal} style={{ position: 'fixed', inset: 0, background: 'rgba(3,9,18,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: 18, maxWidth: 360, width: '100%' }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: C.ice, marginBottom: 12 }}>Share this {noun}</div>
        <img src={modal.imgUrl} alt={`Rinkd ${noun}`} style={{ width: '100%', borderRadius: 10, display: 'block', marginBottom: 14, border: `1px solid ${C.border}` }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => downloadBlob(modal.blob, fileName)} style={{ flex: 1, background: C.blue, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 0', fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>⬇ Download</button>
          <button onClick={async () => { const ok = await copyText(modal.deepLink); setCopied(ok); }} style={{ flex: 1, background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, borderRadius: 999, padding: '11px 0', fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{copied ? '✓ Link copied' : '🔗 Copy link'}</button>
        </div>
        <button onClick={closeModal} style={{ width: '100%', marginTop: 10, background: 'transparent', color: C.steel, border: 'none', padding: 8, fontSize: 13, cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  );

  if (compact) {
    return (
      <>
        <button onClick={(e) => { e.stopPropagation(); onShare(); }} disabled={busy}
          aria-label={err ? 'Could not build the card — tap to try again' : 'Share card'}
          title={err ? 'Could not build the card — tap to try again' : 'Share card'}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44,
            borderRadius: 999, background: 'transparent', border: 'none', cursor: busy ? 'default' : 'pointer',
            color: err ? '#E26B6B' : busy ? '#8BA3BE' : '#9ec3ec', opacity: busy ? 0.7 : 1, padding: 0,
          }}>
          <ShareIcon />
        </button>
        {modal && renderModal()}
      </>
    );
  }

  return (
    <>
      <button onClick={onShare} disabled={busy} title={err ? 'Could not build the card — tap to try again' : 'Share'} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 999,
        fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1, ...btnStyle, ...(err ? { color: '#E26B6B', borderColor: '#E26B6B' } : {}),
      }}>
        <ShareIcon /> {busy ? 'Preparing…' : err ? 'Try again' : label}
      </button>

      {modal && renderModal()}
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
