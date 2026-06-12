import React, { useState } from 'react';

// GS-2 — the modal ScorerView raises right after a Game Misconduct / Match
// Penalty is logged. Filing is a deliberate second step (the penalty is
// already saved): the scorer picks a length, optionally adds notes, and either
// files the suspension or dismisses with no record. Visual language matches
// ScorerView's bottom-sheet modals.
//
// The parent owns the actual write (onFile goes through GS-1's queuedWrite so
// a rink-side filing is offline-safe) — this component is pure UI.

const C = {
  navy: '#0B1F3A', red: '#D72638', ice: '#F4F7FA',
  border: 'rgba(46,91,140,0.4)', amber: '#F59E0B',
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: '#07111F',
  border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 8, padding: '10px 12px',
  color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none',
};

// Picker value → the row we file. 'indefinite' uses games_remaining=0 as the
// "not games-counted" sentinel (Migration J pins that with a CHECK).
const LENGTHS = [
  { key: 'suspension_1', label: '1 Game', games: 1 },
  { key: 'suspension_2', label: '2 Games', games: 2 },
  { key: 'suspension_3', label: '3 Games', games: 3 },
  { key: 'indefinite', label: 'Indefinite', games: 0 },
];

export default function SuspensionPrompt({ penalty, playerLabel, teamName, busy, onFile, onDismiss }) {
  const [picked, setPicked] = useState('suspension_1');
  const [notes, setNotes] = useState('');
  const isMatch = penalty?.severity === 'Match Penalty';
  const choice = LENGTHS.find((l) => l.key === picked) || LENGTHS[0];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 210, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: C.navy, borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 480, borderTop: '0.5px solid rgba(46,91,140,0.4)' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: C.ice, marginBottom: 6 }}>
          🚨 {isMatch ? 'Match Penalty' : 'Game Misconduct'} — {playerLabel}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.6)', lineHeight: 1.5, marginBottom: 14 }}>
          {teamName ? `${teamName} · ` : ''}automatic suspension review. The penalty is already on the
          scoresheet — filing here puts the player on the tournament&apos;s suspension list and alerts the director.
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Suspension length</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          {LENGTHS.map((l) => (
            <button key={l.key} onClick={() => setPicked(l.key)}
              style={{
                padding: '11px 0',
                border: `1px solid ${picked === l.key ? C.amber : C.border}`,
                background: picked === l.key ? 'rgba(245,158,11,0.18)' : 'rgba(46,91,140,0.15)',
                color: C.ice, borderRadius: 10, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Barlow, sans-serif',
              }}>
              {picked === l.key ? '✓ ' : ''}{l.label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Notes (optional)</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened — for the director's review"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', marginBottom: 16 }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={busy ? undefined : onDismiss} disabled={busy}
            style={{ flex: 1, padding: 12, background: 'rgba(244,247,250,0.08)', border: 'none', borderRadius: 999, color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>
            Dismiss — no suspension
          </button>
          <button onClick={busy ? undefined : () => onFile(choice.key, choice.games, notes.trim() || null)} disabled={busy}
            style={{ flex: 1, padding: 12, background: busy ? C.border : C.red, border: 'none', borderRadius: 999, color: '#fff', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Filing…' : 'File Suspension'}
          </button>
        </div>
      </div>
    </div>
  );
}
