import React, { useState } from 'react';
import { goalHornEnabled, setGoalHornEnabled, supportsSound } from '../lib/sound';

// SHARE-GOAL-1 — the opt-in goal-horn toggle.
//
// Muted by default (per spec). The TAP that turns it on doubles as the user
// gesture that unlocks the AudioContext (mobile autoplay policy) and previews
// the horn, so the user hears exactly what they enabled. Lives on the live
// surfaces (the in-feed live float, the public spectator scoreboard) where the
// horn is contextually relevant. Hidden entirely where Web Audio is unavailable.
//
// 44×44 hit area (manifesto accessibility minimum) with a light icon-button look.

function SpeakerOn({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a8 8 0 0 1 0 12" />
    </svg>
  );
}
function SpeakerOff({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

export default function SoundToggle({ color = '#8BA3BE', activeColor = '#D72638', style }) {
  const [on, setOn] = useState(goalHornEnabled());
  if (!supportsSound()) return null;

  const toggle = (e) => {
    e.stopPropagation();          // never trip the card's tap-through navigation
    e.preventDefault();
    const next = !on;
    setGoalHornEnabled(next);     // unlocks audio + previews the horn when turning on
    setOn(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Goal horn on — tap to mute' : 'Goal horn off — tap to enable'}
      title={on ? 'Goal horn on' : 'Enable goal horn'}
      style={{
        flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', borderRadius: 999, cursor: 'pointer', padding: 0,
        color: on ? activeColor : color, transition: 'color 0.15s',
        ...style,
      }}
    >
      {on ? <SpeakerOn color={activeColor} /> : <SpeakerOff color={color} />}
    </button>
  );
}
