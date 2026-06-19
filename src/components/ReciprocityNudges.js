import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { C, colors, radii, type } from '../lib/tokens';
import { Icon } from './ui';
import { plural } from '../lib/format';

// ENGAGE-1 reciprocity — the give-and-take pull. Surfaces the people waiting on
// YOU (unread @mentions, replies, reactions) as one tap-to-respond prompt, so
// engagement flows both ways. Pairs with the game-day RSVP nudge (HypeCard) —
// that's the "your team is waiting" beat; this is the "your people are waiting"
// beat. Self-hides when there's nothing to reciprocate.
//
// Scale: a single COUNT query (head:true → no rows) on notifications, indexed by
// recipient. No actor embed — notifications has two FKs to profiles
// (actor + recipient), so a bare embed would be ambiguous (a known footgun).
export default function ReciprocityNudges({ currentUserId, navigate }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!currentUserId) return undefined;
    let alive = true;
    (async () => {
      const { count: n, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', currentUserId)
        .is('read_at', null)
        .in('kind', ['mention', 'comment', 'reaction']);
      if (!alive || error) return;
      setCount(n || 0);
    })();
    return () => { alive = false; };
  }, [currentUserId]);

  if (!count) return null;

  return (
    <div
      onClick={() => navigate('/notifications')}
      className="rinkd-pressable"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        background: 'rgba(46,91,140,0.18)', border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${C.blue}`, borderRadius: radii.card,
        padding: '12px 14px', marginBottom: 12,
      }}
    >
      <div style={{ width: 36, height: 36, borderRadius: 999, flexShrink: 0, background: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="comment" size={18} color={C.blue} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...type.body, fontWeight: 700, color: C.ice }}>
          {plural(count, 'chirp')} waiting on you
        </div>
        <div style={{ ...type.meta, color: C.steel }}>Mentions, replies, and reactions — jump back in.</div>
      </div>
      <Icon name="more" size={18} color={C.steel} style={{ transform: 'rotate(0deg)' }} />
    </div>
  );
}
