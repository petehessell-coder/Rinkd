import React, { useState, useMemo } from 'react';
import {
  generateRoundRobin, expandFixturesToGames,
  detectScheduleConflicts, bulkInsertLeagueGames,
} from '../lib/scheduleBuilder';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C', amber: '#F59E0B', green: '#22C55E',
};

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/**
 * Wizard for generating a full season of league games in a single click.
 *
 * Inputs: start date, day of week, game time, format (single/double round-robin),
 * minutes-between-games-in-same-round.
 *
 * Output: previewed games → conflict scan → bulk insert.
 *
 * Each home team's `rink_id` defaults to their home rink (we read it off the
 * `teams.home_rink` text + a rinks-by-name lookup is too brittle; instead we
 * read `home_rink_id` from a teams join. For demo data, the caller passes
 * `rinkByTeam` — a map from team_id → rink_id, derived from existing games).
 */
export default function ScheduleBuilderModal({
  leagueId, leagueTeams, rinkByTeam, defaultStartDate, onClose, onPublished,
}) {
  // Wizard form state
  const today = new Date();
  const [form, setForm] = useState({
    startDate: defaultStartDate || today.toISOString().slice(0, 10),
    dayOfWeek: 6,             // Saturday
    gameTime: '20:00',         // 8pm
    format: 'double',          // single | double
    slotMinutes: 60,           // stagger games within a round
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const [proposed, setProposed] = useState(null); // generated, not yet saved
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const teamById = useMemo(() => {
    const m = new Map();
    for (const t of (leagueTeams || [])) m.set(t.id, t);
    return m;
  }, [leagueTeams]);

  const handleGenerate = () => {
    setError(null);
    setResult(null);
    if (!leagueTeams || leagueTeams.length < 2) {
      setError('Add at least 2 teams to the league before generating a schedule.');
      return;
    }
    const fixtures = generateRoundRobin(leagueTeams, form.format);
    const games = expandFixturesToGames({
      fixtures,
      startDate: form.startDate,
      gameTime: form.gameTime,
      dayOfWeek: form.dayOfWeek,
      slotMinutes: form.slotMinutes,
      getRinkIdForTeam: (t) => rinkByTeam?.[t.id] || null,
    });
    // assign temporary keys so conflict detection can reference rows by index
    const keyed = games.map((g, i) => ({ ...g, _key: 'g' + i }));
    const conflicts = detectScheduleConflicts(keyed);
    setProposed({ games: keyed, conflicts });
  };

  const handlePublish = async () => {
    if (!proposed) return;
    setSubmitting(true);
    setError(null);
    const { data, error } = await bulkInsertLeagueGames(leagueId, proposed.games);
    setSubmitting(false);
    if (error) { setError(error.message); return; }
    setResult({ inserted: data?.length || 0 });
    if (onPublished) onPublished();
  };

  // Inline edit of one proposed game's date/time
  const updateProposed = (key, patch) => {
    setProposed(p => {
      const next = p.games.map(g => g._key === key ? { ...g, ...patch } : g);
      return { games: next, conflicts: detectScheduleConflicts(next) };
    });
  };

  const conflictMap = useMemo(() => {
    const m = {};
    for (const c of proposed?.conflicts || []) for (const k of c.gameIds) m[k] = c;
    return m;
  }, [proposed]);

  const teamName = (id) => {
    const t = teamById.get(id);
    return t?.team?.name || t?.team_name || '?';
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 400,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 14,
                 maxWidth: 720, width: '100%', maxHeight: '92vh', overflowY: 'auto',
                 padding: '22px 24px', fontFamily: "'Barlow', sans-serif", color: B.ice }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase' }}>
            Generate Season Schedule
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: B.steel, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: B.steel, lineHeight: 1.6, marginBottom: 16 }}>
          Pick a weekly slot and a format. We'll generate every matchup, slot it onto the calendar,
          and warn you about any rink double-bookings or short turnarounds before you publish.
        </p>

        {/* Wizard inputs */}
        <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <Field label="Start date">
            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Game day">
            <select value={form.dayOfWeek} onChange={e => set('dayOfWeek', parseInt(e.target.value, 10))} style={inputStyle}>
              {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </Field>
          <Field label="First game time">
            <input type="time" value={form.gameTime} onChange={e => set('gameTime', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Format">
            <select value={form.format} onChange={e => set('format', e.target.value)} style={inputStyle}>
              <option value="single">Single round-robin</option>
              <option value="double">Double round-robin (home + away)</option>
            </select>
          </Field>
          <Field label="Stagger (min)">
            <select value={form.slotMinutes} onChange={e => set('slotMinutes', parseInt(e.target.value, 10))} style={inputStyle}>
              <option value={0}>All at same time</option>
              <option value={60}>60 min apart</option>
              <option value={90}>90 min apart</option>
              <option value={120}>2 hrs apart</option>
            </select>
          </Field>
        </div>

        <button onClick={handleGenerate}
          style={{ width: '100%', padding: 11, borderRadius: 999, background: B.red, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>
          {proposed ? 'Regenerate' : 'Generate Schedule'}
        </button>

        {error && (
          <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13, color: B.red }}>
            {error}
          </div>
        )}

        {/* Preview */}
        {proposed && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
                Preview · {proposed.games.length} games
              </div>
              {proposed.conflicts.length > 0 && (
                <div style={{ fontSize: 11, color: B.amber }}>
                  ⚠ {proposed.conflicts.length} conflict{proposed.conflicts.length === 1 ? '' : 's'} — review below
                </div>
              )}
            </div>

            <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 12, maxHeight: 360, overflowY: 'auto' }}>
              {proposed.games.map(g => {
                const date = new Date(g.start_time);
                const conflict = conflictMap[g._key];
                return (
                  <div key={g._key} style={{
                    padding: '10px 12px',
                    borderBottom: `0.5px solid rgba(244,247,250,0.06)`,
                    background: conflict ? 'rgba(245,158,11,0.08)' : 'transparent',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="datetime-local"
                        value={toLocalInputValue(date)}
                        onChange={e => updateProposed(g._key, { start_time: localInputToISO(e.target.value) })}
                        style={{ ...inputStyle, flex: '0 0 220px', fontSize: 12, padding: '6px 8px' }} />
                      <div style={{ flex: 1, fontSize: 13, color: B.ice, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <strong style={{ color: B.ice }}>{teamName(g.home_team_id)}</strong>
                        <span style={{ color: B.steel }}> vs. </span>
                        <strong style={{ color: B.ice }}>{teamName(g.away_team_id)}</strong>
                        {g.round && <span style={{ marginLeft: 8, fontSize: 10, color: B.steel }}>R{g.round}</span>}
                      </div>
                    </div>
                    {conflict && (
                      <div style={{ marginTop: 4, fontSize: 11, color: B.amber }}>
                        ⚠ {conflict.type === 'rink_double_book' ? 'Same rink double-book' : 'Team plays again soon'} — {conflict.message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} disabled={submitting}
                style={{ flex: 1, padding: 11, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handlePublish} disabled={submitting || result}
                style={{ flex: 2, padding: 11, borderRadius: 999, background: result ? B.green : B.red, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: submitting ? 0.7 : 1 }}>
                {submitting ? 'Publishing…'
                  : result ? `✓ Published ${result.inserted} games`
                  : `Publish ${proposed.games.length} games`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: B.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, fontFamily: "'Barlow Condensed', sans-serif" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', background: '#07111F', border: `1px solid ${B.border}`,
  borderRadius: 8, padding: '8px 10px', color: B.ice,
  fontFamily: "'Barlow', sans-serif", fontSize: 13, outline: 'none',
};

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToISO(v) {
  // datetime-local has no timezone; interpret as local time and convert to ISO
  return v ? new Date(v).toISOString() : v;
}
