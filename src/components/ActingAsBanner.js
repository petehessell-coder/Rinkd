import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamily } from '../lib/familyContext';

// REG-2 — thin persistent bar shown whenever the user is acting as a managed
// person (not themselves). Keeps the acting-as context visible so a guardian
// never RSVPs or registers "as Henry" without realizing it, with a one-tap
// switch-back. Renders nothing when acting as self.

const B = { red: '#D72638', ice: '#F4F7FA', navy: '#0B1F3A' };

export default function ActingAsBanner() {
  const navigate = useNavigate();
  const { isSelf, activePerson, setActingAs } = useFamily();
  if (isSelf || !activePerson) return null;
  const first = (activePerson.name || 'this person').split(' ')[0];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      background: B.red, color: B.ice, padding: '7px 14px',
      fontFamily: "'Barlow', sans-serif", fontSize: 13, fontWeight: 600,
    }}>
      <span>Acting as <strong>{activePerson.name}</strong></span>
      <button
        onClick={() => { setActingAs(null); navigate('/feed'); }}
        style={{
          background: 'rgba(255,255,255,0.18)', color: B.ice, border: 'none',
          borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: "'Barlow', sans-serif",
        }}>
        Switch back to you
      </button>
      <span aria-hidden style={{ opacity: 0.7 }}>· viewing {first}'s schedule</span>
    </div>
  );
}
