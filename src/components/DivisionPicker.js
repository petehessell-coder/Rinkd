import React, { useState, useRef, useEffect } from 'react';
import { C } from '../lib/tokens';

// Local drift: not in shared C/colors (steel there is solid '#8BA3BE'); this is
// a translucent ice — no exact token match, kept inline per migration rules.
const STEEL_TRANSLUCENT = 'rgba(244,247,250,0.5)';

/**
 * Adaptive division selector (LEAGUE-DIV-1, Decision #6). Scales by count:
 *   - ≤1 division  → renders nothing (single-division leagues unchanged)
 *   - 2–5          → chip row (tournament-parity look)
 *   - >5           → a `Division: <name> ▾` button opening a searchable list
 *                    (CAHL = 14 divisions; a flat chip row would be unusable)
 *
 * Shared by the public League page and the LeagueManage scope selector (M3).
 * Divisions arrive pre-ordered by sort_order.
 */
export default function DivisionPicker({ divisions, selectedId, onSelect, accent = C.red }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!divisions || divisions.length <= 1) return null;
  const selected = divisions.find((d) => d.id === selectedId) || divisions[0];

  // Small leagues: chips.
  if (divisions.length <= 5) {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {divisions.map((d) => {
          const on = d.id === selectedId;
          return (
            <button key={d.id} onClick={() => onSelect(d.id)}
              style={{
                padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: "'Barlow', sans-serif",
                border: `1px solid ${on ? accent : C.border}`,
                background: on ? accent : 'transparent', color: on ? '#fff' : C.ice,
                transition: 'all 0.12s',
              }}>
              {d.name}
            </button>
          );
        })}
      </div>
    );
  }

  // Many divisions: searchable picker.
  const term = q.trim().toLowerCase();
  const filtered = term ? divisions.filter((d) => (d.name || '').toLowerCase().includes(term)) : divisions;
  return (
    <div ref={rootRef} style={{ position: 'relative', marginBottom: 14 }}>
      <button onClick={() => { setOpen((o) => !o); setQ(''); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px',
          borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.ice,
          cursor: 'pointer', fontFamily: "'Barlow', sans-serif", fontSize: 14, fontWeight: 700,
        }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: STEEL_TRANSLUCENT }}>Division</span>
        <span>{selected?.name}</span>
        <span style={{ color: STEEL_TRANSLUCENT }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 60,
          width: 260, maxWidth: '90vw', background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.45)', overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${C.border}` }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search divisions…"
              style={{
                width: '100%', boxSizing: 'border-box', background: C.navy, border: `1px solid ${C.border}`,
                color: C.ice, borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none',
                fontFamily: "'Barlow', sans-serif",
              }} />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: 14, fontSize: 13, color: STEEL_TRANSLUCENT, textAlign: 'center' }}>No match</div>
            )}
            {filtered.map((d) => {
              const on = d.id === selectedId;
              return (
                <button key={d.id} onClick={() => { onSelect(d.id); setOpen(false); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: on ? 'rgba(46,91,140,0.25)' : 'transparent', border: 'none',
                    borderTop: '1px solid rgba(46,91,140,0.18)', color: C.ice, cursor: 'pointer',
                    fontSize: 14, fontWeight: on ? 700 : 500, fontFamily: "'Barlow', sans-serif",
                  }}>
                  {d.name}{on ? '  ✓' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
