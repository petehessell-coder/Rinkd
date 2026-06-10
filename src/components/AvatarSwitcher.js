import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from './Logos';
import { useFamily } from '../lib/familyContext';

// REG-2 — the family identity switcher. "Acting as Me / Henry" (Netflix
// who's-watching pattern), computed from household_members via useFamily().
//
// Light acting-as: selecting a managed person sets the acting-as context AND
// opens their person-card. Selecting "You" resets to self. The social feed is
// unaffected — see familyContext.js.
//
// variant: 'footer'  → desktop sidebar footer block (panel opens upward)
//          'compact' → mobile top-bar avatar button (panel opens downward)

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', ice: '#F4F7FA', steel: '#8BA3BE',
  card: '#112236', border: '#1E3A5C', red: '#D72638',
};

export default function AvatarSwitcher({ profile, variant = 'footer' }) {
  const navigate = useNavigate();
  const { members, managed, actingForId, isSelf, setActingAs } = useFamily();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!profile) return null;

  const activeProfile = members.find(m => m.profile_id === actingForId)?.profile || profile;
  const hasFamily = managed.length > 0;

  const pick = (entry) => {
    setOpen(false);
    if (entry.isSelf) { setActingAs(null); navigate('/feed'); }
    else { setActingAs(entry.profile_id); navigate(`/family/${entry.profile_id}`); }
  };

  const go = (path) => { setOpen(false); navigate(path); };

  // ── trigger ──
  const trigger = variant === 'compact' ? (
    <button onClick={() => setOpen(o => !o)} aria-label="Switch person"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, position: 'relative', display: 'inline-flex' }}>
      <Avatar profile={activeProfile} size={26} />
      {!isSelf && <span style={dot} />}
    </button>
  ) : (
    <button onClick={() => setOpen(o => !o)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left', padding: 0 }}>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <Avatar profile={activeProfile} size={36} />
        {!isSelf && <span style={dot} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: B.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {activeProfile.name}
        </div>
        <div style={{ fontSize: 11, color: isSelf ? B.steel : B.red }}>
          {isSelf ? `@${profile.handle}` : 'acting as · tap to switch'}
        </div>
      </div>
      <span style={{ color: B.steel, fontSize: 11 }}>{hasFamily ? '⌃' : ''}</span>
    </button>
  );

  // ── panel ──
  const panelPos = variant === 'compact'
    ? { top: 'calc(100% + 8px)', right: 0 }
    : { bottom: 'calc(100% + 8px)', left: 0, right: 0 };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger}
      {open && (
        <div style={{
          position: 'absolute', ...panelPos, zIndex: 300,
          minWidth: 220, background: B.card, border: `1px solid ${B.border}`,
          borderRadius: 12, boxShadow: '0 12px 30px rgba(0,0,0,0.45)', padding: 6,
          fontFamily: "'Barlow', sans-serif",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: B.steel, padding: '6px 10px 4px' }}>
            Who's this for?
          </div>
          {members.map((m) => {
            const active = m.profile_id === actingForId;
            return (
              <button key={m.profile_id} onClick={() => pick(m)} style={rowBtn(active)}
                onMouseEnter={e => { e.currentTarget.style.background = B.border + '66'; }}
                onMouseLeave={e => { e.currentTarget.style.background = active ? B.blue + '33' : 'transparent'; }}>
                <Avatar profile={m.profile} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: B.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.isSelf ? 'You' : m.profile?.name}
                  </div>
                  {!m.isSelf && (
                    <div style={{ fontSize: 11, color: B.steel }}>
                      {m.profile?.account_type === 'minor' ? 'Child' : 'Managed'}
                    </div>
                  )}
                </div>
                {active && <span style={{ color: B.red, fontSize: 12, fontWeight: 700 }}>●</span>}
              </button>
            );
          })}
          <div style={{ height: 1, background: B.border, margin: '6px 4px' }} />
          <button onClick={() => go('/family')} style={rowBtn(false)}
            onMouseEnter={e => { e.currentTarget.style.background = B.border + '66'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <span style={iconCircle}>＋</span>
            <span style={{ fontSize: 13, color: B.ice }}>Add a family member</span>
          </button>
          <button onClick={() => go('/family')} style={rowBtn(false)}
            onMouseEnter={e => { e.currentTarget.style.background = B.border + '66'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <span style={iconCircle}>⚙</span>
            <span style={{ fontSize: 13, color: B.ice }}>Family settings</span>
          </button>
        </div>
      )}
    </div>
  );
}

const dot = {
  position: 'absolute', bottom: -1, right: -1, width: 10, height: 10,
  borderRadius: '50%', background: '#D72638', border: '2px solid #0B1F3A',
};
const iconCircle = {
  width: 30, height: 30, borderRadius: '50%', background: '#1E3A5C',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 15, color: '#F4F7FA', flexShrink: 0,
};
function rowBtn(active) {
  return {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: active ? '#2E5B8C33' : 'transparent', textAlign: 'left',
    fontFamily: "'Barlow', sans-serif", transition: 'background 0.12s',
  };
}
