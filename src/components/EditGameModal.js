import React, { useState } from 'react';

// Shared "edit a previously-scheduled game" modal for both the league and
// tournament Schedule tabs. Presentational only: it normalizes the form into a
// canonical snake_case `values` object and hands it to `onSave` — each surface
// maps that to its own update function (updateLeagueGame / updateGame).
//
// Fields: date & time · rink (picker) · location (free-text override) ·
// LiveBarn venue id · stream URL · optional home/away (when `teams` is passed).
//
// Props:
//   game     - the game row (start_time, rink_id, location, live_barn_venue_id,
//              youtube_url, home_team_id, away_team_id, status)
//   rinks    - [{ id, name, sub_rink, live_barn_venue_id, youtube_url }]
//   teams    - optional [{ id, name }]; renders home/away selectors when present
//   title    - header text
//   onClose  - () => void
//   onSave   - async (values) => void   (throw to surface an inline error)
//   onDelete - optional async () => void (renders a Delete button when present)

const C = {
  ink: '#07111F',
  card: '#0E2036',
  border: 'rgba(46,91,140,0.45)',
  ice: '#F4F7FA',
  steel: 'rgba(244,247,250,0.55)',
  red: '#E2342B',
  blue: '#2E5B8C',
};

const inputStyle = {
  width: '100%',
  background: C.ink,
  border: `0.5px solid ${C.border}`,
  borderRadius: 8,
  padding: '9px 10px',
  color: C.ice,
  fontFamily: 'Barlow, sans-serif',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.steel, marginBottom: 5 };

function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localToIso(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export default function EditGameModal({ game, rinks = [], teams = null, title = 'Edit game', onClose, onSave, onDelete }) {
  const [startTime, setStartTime] = useState(isoToLocal(game?.start_time));
  const [rinkId, setRinkId] = useState(game?.rink_id || '');
  const [location, setLocation] = useState(game?.location || '');
  const [liveBarn, setLiveBarn] = useState(game?.live_barn_venue_id || '');
  const [stream, setStream] = useState(game?.youtube_url || '');
  const [homeId, setHomeId] = useState(game?.home_team_id || '');
  const [awayId, setAwayId] = useState(game?.away_team_id || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const pickedRink = rinks.find((r) => r.id === rinkId);

  const handleSave = async () => {
    setErr(null);
    setBusy(true);
    try {
      const values = {
        start_time: localToIso(startTime),
        rink_id: rinkId || null,
        location: (location || '').trim() || null,
        live_barn_venue_id: (liveBarn || '').trim() || null,
        youtube_url: (stream || '').trim() || null,
      };
      if (teams) {
        values.home_team_id = homeId || null;
        values.away_team_id = awayId || null;
      }
      await onSave(values);
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Could not save the game.');
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm('Delete this game? This cannot be undone.')) return;
    setErr(null);
    setBusy(true);
    try {
      await onDelete();
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Could not delete the game.');
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: 20, fontFamily: 'Barlow, sans-serif', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.ice }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.steel, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <Field label="Date & Time">
          <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Rink">
          <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} style={inputStyle}>
            <option value="">— Pick a rink —</option>
            {rinks.map((r) => (
              <option key={r.id} value={r.id}>{[r.sub_rink, r.name].filter(Boolean).join(' · ')}</option>
            ))}
          </select>
        </Field>

        <Field label="Location (optional)">
          <input value={location} onChange={(e) => setLocation(e.target.value)} style={inputStyle} placeholder="Free-text note — used when the rink isn't in the list" />
        </Field>

        <Field label="LiveBarn Venue ID (optional override)">
          <input value={liveBarn} onChange={(e) => setLiveBarn(e.target.value)} style={inputStyle} placeholder={pickedRink?.live_barn_venue_id || 'e.g. 12345'} />
        </Field>

        <Field label="Stream URL (YouTube / Twitch / Facebook · optional)">
          <input value={stream} onChange={(e) => setStream(e.target.value)} style={inputStyle} placeholder={pickedRink?.youtube_url || 'https://youtube.com/@yourleague/live'} />
        </Field>

        {teams && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Home">
              <select value={homeId} onChange={(e) => setHomeId(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Away">
              <select value={awayId} onChange={(e) => setAwayId(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
        )}

        {err && <div style={{ color: C.red, fontSize: 12, margin: '4px 0 12px' }}>{err}</div>}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          {onDelete ? (
            <button onClick={handleDelete} disabled={busy} style={{ background: 'none', border: `0.5px solid ${C.red}`, color: C.red, borderRadius: 999, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>Delete</button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} style={{ background: 'none', border: `0.5px solid ${C.border}`, color: C.ice, borderRadius: 999, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>Cancel</button>
            <button onClick={handleSave} disabled={busy} style={{ background: C.blue, border: 'none', color: '#fff', borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
