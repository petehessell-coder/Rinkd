import React, { useEffect, useState } from 'react';
import { isPinned, setNavPin, clearNavPin } from '../lib/navPins';

// NAV-PIN-2 — the 📌 "Pin to nav" toggle shown on a League / Team / Tournament
// page header. Pins this entity to the user's nav (up to 3, one per type;
// pinning swaps any existing pin of this type). Tournament pins auto-expire 7
// days after the event (server-side). Hidden when signed out.
//
// Props: userId, pinType ('league'|'team'|'tournament'), targetId.
export default function PinToNavButton({ userId, pinType, targetId }) {
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId || !targetId) return undefined;
    let cancelled = false;
    isPinned(userId, pinType, targetId)
      .then((v) => { if (!cancelled) setPinned(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, pinType, targetId]);

  if (!userId || !targetId) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const next = !pinned;
    setPinned(next); // optimistic
    try {
      if (next) await setNavPin(pinType, targetId);
      else await clearNavPin(pinType);
    } catch {
      setPinned(!next); // roll back
    }
    setBusy(false);
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={pinned ? 'Pinned to your nav — tap to unpin' : 'Pin to your nav for one-tap access'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 999, cursor: busy ? 'wait' : 'pointer',
        fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap',
        opacity: busy ? 0.6 : 1,
        background: pinned ? 'rgba(215,38,56,0.16)' : 'rgba(46,91,140,0.25)',
        border: `1px solid ${pinned ? '#D72638' : 'rgba(46,91,140,0.5)'}`,
        color: '#F4F7FA',
      }}
    >
      {pinned ? '📌 Pinned' : '📌 Pin'}
    </button>
  );
}
