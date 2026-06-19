import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from '../components/DatePicker';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';
import { createLeague } from '../lib/leagues';
import { addCommissionerByInput } from '../lib/leagueCommissioners';
import { addScorerByInput } from '../lib/leagueScorers';
import { uploadMedia } from '../lib/posts';
import { classifyImage } from '../lib/imageModeration';

// Phase 1 of the league-parity build (May 19, 2026 plan;
// see ~/Downloads/rinkd_v4/LEAGUE_PARITY_PHASE_1_BUILD.md).
//
// Mirrors TournamentCreate.js — same 4-step shape, same cleanup-on-failure
// invariant, same UI primitives. Differences vs tournaments:
//   - Step 3 uses free-text "divisions" instead of pools (default: one
//     league-wide division, optional add more).
//   - Step 4 surfaces commissioners + scorers (the league analog of
//     directors + scorers on the tournament side).
//   - Step 1 + Step 2 introduce the new league columns: start_date,
//     end_date, venue_name, venue_address, accent_color, logo_url.
//   - Phase 1 ships ONE format preset (`classic_league`). More presets
//     land in Phase 3 with the schedule generator.
//
// Rinks + games are intentionally NOT created here — LeagueManage already
// has a Schedule tab with rink + game builders. The wizard's job is to
// stand up the league shell + initial team roster; commissioners then
// run the season from /league/:id/manage.

const COLORS = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

const LOGO_COLORS = ['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9','#EC4899','#0B1F3A'];

const DEFAULT_SETTINGS = {
  period_length_minutes: 12,
  period_type: 'stop',
  num_periods: 3,
  points_win: 2,
  points_tie: 1,
  points_loss: 0,
  shootout_win_points: 2,
  max_goal_differential: 6,
  allow_ties: true,
  shootout_regular_season: false,
  shootout_playoffs: true,
  tiebreakers: ['head_to_head','goal_diff','goals_for','goals_against','penalty_minutes'],
};

const TIEBREAKER_LABELS = {
  head_to_head: 'Head-to-head result',
  goal_quotient: 'Goal quotient (GF ÷ GA)',
  goal_diff: 'Goal differential',
  goals_for: 'Goals for',
  goals_against: 'Goals against (fewest)',
  period_points: 'Period points',
  penalty_minutes: 'Penalty minutes (fewest)',
};

// Phase 3 expands the preset library. Each preset drops a full settings
// object into the wizard; every field below stays editable afterward.
// Adding a new preset is pure data — no logic changes anywhere else.
const FORMAT_PRESETS = {
  classic_league: {
    label: 'Classic League',
    sub: 'Single round-robin · 3×12 · 6-goal mercy · ties allowed',
    settings: { ...DEFAULT_SETTINGS },
  },
  beer_league_no_ties: {
    label: 'Beer League (No Ties)',
    sub: '3×17 run-time · SO in regular season · no mercy',
    settings: {
      ...DEFAULT_SETTINGS,
      period_length_minutes: 17,
      period_type: 'running',
      num_periods: 3,
      max_goal_differential: null,
      allow_ties: false,
      shootout_regular_season: true,
      shootout_playoffs: true,
    },
  },
  high_school_style: {
    label: 'High School Style',
    sub: '3×15 stop · 7-goal mercy · OT/SO in playoffs',
    settings: {
      ...DEFAULT_SETTINGS,
      period_length_minutes: 15,
      period_type: 'stop',
      num_periods: 3,
      max_goal_differential: 7,
      allow_ties: true,
      shootout_regular_season: false,
      shootout_playoffs: true,
    },
  },
  youth_short_game: {
    label: 'Youth — Short Game',
    sub: '2×20 run-time · 8-goal mercy · ties allowed',
    settings: {
      ...DEFAULT_SETTINGS,
      period_length_minutes: 20,
      period_type: 'running',
      num_periods: 2,
      max_goal_differential: 8,
      allow_ties: true,
      shootout_regular_season: false,
      shootout_playoffs: false,
    },
  },
};

const inputStyle = { width: '100%', background: '#07111F', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 8, padding: '10px 12px', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none' };
const selectStyle = { ...inputStyle };

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', maxLength }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength}
    style={inputStyle}
    onFocus={e => e.target.style.borderColor = '#2E5B8C'}
    onBlur={e => e.target.style.borderColor = 'rgba(46,91,140,0.5)'} />;
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ value, onChange, label, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
      <div>
        <div style={{ fontSize: 13, color: '#F4F7FA' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div onClick={() => onChange(!value)} style={{ width: 36, height: 20, background: value ? '#2E5B8C' : 'rgba(244,247,250,0.15)', borderRadius: 20, position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s' }}>
        <div style={{ width: 14, height: 14, background: '#fff', borderRadius: '50%', position: 'absolute', top: 3, transition: 'left 0.15s', left: value ? 19 : 3 }} />
      </div>
    </div>
  );
}

function Card({ children }) {
  return <div style={{ background: COLORS.card, border: `0.5px solid ${COLORS.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 12 }}>{children}</div>;
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{children}</div>;
}

function Row2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

function Progress({ step }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{ height: 4, flex: 1, borderRadius: 4, background: i < step ? COLORS.red : i === step ? COLORS.blue : 'rgba(244,247,250,0.1)', transition: 'background 0.2s' }} />
      ))}
    </div>
  );
}

function BtnRow({ onBack, onNext, nextLabel = 'Next →', loading = false }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
      {onBack && <button onClick={onBack} style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.6)', border: 'none', borderRadius: 999, padding: '12px 20px', fontFamily: 'Barlow, sans-serif', fontSize: 14, cursor: 'pointer' }}>← Back</button>}
      <button onClick={onNext} disabled={loading}
        style={{ flex: 1, background: COLORS.red, color: '#fff', border: 'none', borderRadius: 999, padding: 12, fontFamily: 'Barlow, sans-serif', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
        {loading ? 'Publishing…' : nextLabel}
      </button>
    </div>
  );
}

const periodOptions = Array.from({length:60},(_,i)=>({value:i+1,label:`${i+1} min`}));
const pointOptions  = Array.from({length:5}, (_,i)=>({value:i,label:`${i} pt${i!==1?'s':''}`}));
const goalDiffOptions = [{value:'none',label:'No limit'}, ...Array.from({length:10},(_,i)=>({value:i+1,label:String(i+1)}))];

function Step1({ data, onChange, onNext }) {
  const [uploading, setUploading] = useState(false);
  const initials = data.logo_initials || (data.name || '').split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(`That logo's ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 5 MB and upload again.`);
      e.target.value = '';
      return;
    }
    const verdict = await classifyImage(file);
    if (!verdict.ok) {
      alert("That image doesn't pass our community guidelines — pick a different one.");
      e.target.value = '';
      return;
    }
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { url, error: upErr } = await uploadMedia(file, user.id);
    setUploading(false);
    if (upErr || !url) { alert("That upload didn't go through — check your connection and try again."); return; }
    onChange('logo_url', url);
  };

  return (
    <>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 4 }}>Create League</div>
      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Step 1 of 4 — Basics</div>

      {/* Logo preview + upload — mirrors team / tournament pattern */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: data.logo_url ? `url(${data.logo_url}) center/cover, ${data.logo_color}` : data.logo_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, color: '#fff' }}>
          {!data.logo_url && (initials || '?')}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Logo</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ cursor: 'pointer', fontSize: 11, color: '#9BB5D6', padding: '4px 10px', borderRadius: 999, background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)' }}>
              {uploading ? 'Uploading…' : data.logo_url ? '📷 Replace' : '📷 Upload'}
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} disabled={uploading} />
            </label>
            {data.logo_url && (
              <button type="button" onClick={() => onChange('logo_url', '')} style={{ background: 'transparent', border: 'none', color: '#E26B6B', fontSize: 11, cursor: 'pointer', padding: 0 }}>Remove</button>
            )}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 12, marginBottom: 6 }}>{data.logo_url ? 'Fallback Color' : 'Logo Color'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LOGO_COLORS.map(col => (
              <div key={col} onClick={() => onChange('logo_color', col)}
                style={{ width: 24, height: 24, borderRadius: '50%', background: col, cursor: 'pointer', border: data.logo_color === col ? '2px solid #fff' : '2px solid transparent', transition: 'border 0.15s' }} />
            ))}
          </div>
        </div>
      </div>

      <Card>
        <Field label="League Name *">
          <Input value={data.name} onChange={v => onChange('name', v)} placeholder="e.g. Chicago Hockey League" />
        </Field>
        <Field label="Logo Initials">
          <Input value={data.logo_initials} onChange={v => onChange('logo_initials', v.toUpperCase().slice(0, 3))} placeholder="Auto from name" maxLength={3} />
        </Field>
        <Row2>
          <Field label="Division">
            <Input value={data.division} onChange={v => onChange('division', v)} placeholder="e.g. 14U AA" />
          </Field>
          <Field label="Level">
            <Input value={data.level} onChange={v => onChange('level', v)} placeholder="e.g. AAA, Rec" />
          </Field>
        </Row2>
        <Row2>
          <Field label="Location">
            <Input value={data.location} onChange={v => onChange('location', v)} placeholder="e.g. Chicago, IL" />
          </Field>
          <Field label="Season">
            <Input value={data.season} onChange={v => onChange('season', v)} placeholder="e.g. Fall 2026" />
          </Field>
        </Row2>
        <Row2>
          <Field label="Start Date">
            <DatePicker value={data.start_date} onChange={v => onChange('start_date', v)} placeholder="Start date" />
          </Field>
          <Field label="End Date">
            <DatePicker value={data.end_date} onChange={v => onChange('end_date', v)} placeholder="End date" />
          </Field>
        </Row2>
        <Field label="Venue / Facility">
          <Input value={data.venue_name} onChange={v => onChange('venue_name', v)} placeholder="e.g. Oak Park Ice Arena" />
        </Field>
        <Field label="Address">
          <Input value={data.venue_address} onChange={v => onChange('venue_address', v)} placeholder="Street address" />
        </Field>
        <Field label="Accent Color">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {LOGO_COLORS.map(col => (
              <div key={col} onClick={() => onChange('accent_color', col)}
                style={{ width: 28, height: 28, borderRadius: '50%', background: col, cursor: 'pointer', border: data.accent_color === col ? '2px solid #fff' : '2px solid transparent', transition: 'border 0.15s' }} />
            ))}
            <span style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginLeft: 4 }}>Used on standings rank chips</span>
          </div>
        </Field>
      </Card>

      <BtnRow onNext={onNext} nextLabel="Next — Format & Rules →" />
    </>
  );
}

function Step2({ data, onChange, onBack, onNext }) {
  const s = data.settings;
  const set = (key, val) => onChange('settings', { ...s, [key]: val });
  const applyPreset = (key) => onChange('settings', { ...FORMAT_PRESETS[key].settings });

  const moveTb = (from, to) => {
    const tb = [...s.tiebreakers];
    const [item] = tb.splice(from, 1);
    tb.splice(to, 0, item);
    set('tiebreakers', tb);
  };

  return (
    <>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 4 }}>Format & Rules</div>
      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Step 2 of 4 — Shown on the public Info tab</div>

      <SectionLabel>Start from a Preset</SectionLabel>
      <Card>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginBottom: 10, lineHeight: 1.5 }}>
          Drops in a full format. Everything below stays editable.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(FORMAT_PRESETS).map(([key, preset]) => (
            <button key={key} onClick={() => applyPreset(key)}
              style={{ flex: '1 1 200px', textAlign: 'left', background: 'rgba(46,91,140,0.15)', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F4F7FA' }}>{preset.label}</div>
              <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.45)', marginTop: 2 }}>{preset.sub}</div>
            </button>
          ))}
        </div>
      </Card>

      <SectionLabel>Game Format</SectionLabel>
      <Card>
        <Row2>
          <Field label="Period Length">
            <Select value={s.period_length_minutes} onChange={v => set('period_length_minutes', parseInt(v))} options={periodOptions} />
          </Field>
          <Field label="Period Type">
            <Select value={s.period_type} onChange={v => set('period_type', v)}
              options={[{value:'stop',label:'Stop time'},{value:'running',label:'Running time'}]} />
          </Field>
        </Row2>
        <Row2>
          <Field label="Periods per Game">
            <Select value={s.num_periods} onChange={v => set('num_periods', parseInt(v))}
              options={[{value:1,label:'1 period'},{value:2,label:'2 periods'},{value:3,label:'3 periods'}]} />
          </Field>
          <Field label="Max Goal Diff">
            <Select value={s.max_goal_differential ?? 'none'} onChange={v => set('max_goal_differential', v==='none'?null:parseInt(v))}
              options={goalDiffOptions} />
          </Field>
        </Row2>
      </Card>

      <SectionLabel>Point System</SectionLabel>
      <Card>
        <Row2>
          <Field label="Win"><Select value={s.points_win} onChange={v => set('points_win', parseInt(v))} options={pointOptions} /></Field>
          <Field label="Tie"><Select value={s.points_tie} onChange={v => set('points_tie', parseInt(v))} options={pointOptions} /></Field>
        </Row2>
        <Row2>
          <Field label="Loss"><Select value={s.points_loss} onChange={v => set('points_loss', parseInt(v))} options={pointOptions} /></Field>
          <Field label="OT/SO Win"><Select value={s.shootout_win_points} onChange={v => set('shootout_win_points', parseInt(v))} options={pointOptions} /></Field>
        </Row2>
      </Card>

      <SectionLabel>Tiebreakers — tap arrows to reorder</SectionLabel>
      <Card>
        {s.tiebreakers.map((key, i) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < s.tiebreakers.length-1 ? '0.5px solid rgba(244,247,250,0.06)' : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button onClick={() => i > 0 && moveTb(i, i-1)} style={{ background: 'none', border: 'none', color: i>0?'rgba(244,247,250,0.4)':'rgba(244,247,250,0.1)', cursor: i>0?'pointer':'default', fontSize: 12, padding: '0 4px' }}>▲</button>
              <button onClick={() => i < s.tiebreakers.length-1 && moveTb(i, i+1)} style={{ background: 'none', border: 'none', color: i<s.tiebreakers.length-1?'rgba(244,247,250,0.4)':'rgba(244,247,250,0.1)', cursor: i<s.tiebreakers.length-1?'pointer':'default', fontSize: 12, padding: '0 4px' }}>▼</button>
            </div>
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(46,91,140,0.4)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(244,247,250,0.6)', flexShrink: 0 }}>{i+1}</span>
            <span style={{ fontSize: 13, color: '#F4F7FA' }}>{TIEBREAKER_LABELS[key]}</span>
          </div>
        ))}
      </Card>

      <SectionLabel>Options</SectionLabel>
      <Card>
        <Toggle value={s.allow_ties} onChange={v => set('allow_ties', v)} label="Allow ties in regular season" sub="Regular-season games can end in a draw" />
        <Toggle value={s.shootout_regular_season} onChange={v => set('shootout_regular_season', v)} label="Shootout in regular season" sub="Tied games go to shootout" />
        <Toggle value={s.shootout_playoffs} onChange={v => set('shootout_playoffs', v)} label="Shootout in playoffs" sub="No ties allowed in playoff games (Phase 3 unlocks the bracket)" />
      </Card>

      <BtnRow onBack={onBack} onNext={onNext} nextLabel="Next — Divisions & Teams →" />
    </>
  );
}

function Step3({ data, onChange, onBack, onNext }) {
  const [newTeam, setNewTeam] = useState('');
  const [newTeamDivision, setNewTeamDivision] = useState('');
  const [newDivision, setNewDivision] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const searchTimer = useRef(null);

  const divisions = data.divisions || [];

  const onSearchChange = (val) => {
    setNewTeam(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!val.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const { data: rows } = await supabase
        .from('teams')
        .select('id, name, logo_color, logo_initials, logo_url')
        .ilike('name', `%${val}%`)
        .limit(5);
      setSearchResults(rows || []);
    }, 300);
  };

  const addExistingTeam = (team) => {
    onChange('teams', [...(data.teams || []), {
      name: team.name,
      team_id: team.id,
      logo_color: team.logo_color,
      logo_initials: team.logo_initials,
      logo_url: team.logo_url,
      division: newTeamDivision || (divisions[0] || ''),
    }]);
    setNewTeam(''); setSearchResults([]);
  };

  const addUnlinkedTeam = () => {
    if (!newTeam.trim()) return;
    const name = newTeam.trim();
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();
    onChange('teams', [...(data.teams || []), {
      name,
      team_id: null,
      logo_color: '#2E5B8C',
      logo_initials: initials,
      logo_url: null,
      division: newTeamDivision || (divisions[0] || ''),
    }]);
    setNewTeam(''); setSearchResults([]);
  };

  const removeTeam = i => {
    const t = [...(data.teams || [])]; t.splice(i,1); onChange('teams', t);
  };

  const addDivision = () => {
    const v = newDivision.trim();
    if (!v) return;
    if (divisions.includes(v)) { setNewDivision(''); return; }
    onChange('divisions', [...divisions, v]);
    setNewDivision('');
  };

  const removeDivision = i => {
    const d = [...divisions]; const dropped = d.splice(i,1)[0];
    onChange('divisions', d);
    // Strip the dropped division from any teams that were on it.
    onChange('teams', (data.teams || []).map(t => t.division === dropped ? { ...t, division: '' } : t));
  };

  return (
    <>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 4 }}>Divisions & Teams</div>
      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Step 3 of 4</div>

      <SectionLabel>Divisions ({divisions.length})</SectionLabel>
      <Card>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginBottom: 10, lineHeight: 1.5 }}>
          Optional. If left blank, every team plays in one league-wide standings group. Add multiple divisions (e.g. "A", "B", "C") to split standings + scheduling.
        </div>
        {divisions.map((d, i) => (
          <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: 'rgba(46,91,140,0.3)', color: '#8BA3BE', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{d}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => removeDivision(i)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={newDivision} onChange={e => setNewDivision(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDivision()}
            placeholder="e.g. A Division" style={{ flex: 1, ...inputStyle }} />
          <button onClick={addDivision} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add</button>
        </div>
      </Card>

      <SectionLabel>Teams ({(data.teams || []).length})</SectionLabel>
      <Card>
        {(data.teams || []).map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: t.logo_url ? `url(${t.logo_url}) center/cover, ${t.logo_color}` : t.logo_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff', flexShrink: 0 }}>
              {!t.logo_url && (t.logo_initials || '?')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>{t.name}</div>
              {t.division && <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.4)' }}>{t.division}</div>}
            </div>
            {!t.team_id && <span style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', letterSpacing: '0.05em' }}>UNLINKED</span>}
            <button onClick={() => removeTeam(i)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={newTeam} onChange={e => onSearchChange(e.target.value)} placeholder="Search teams or type a name"
            style={{ flex: 1, ...inputStyle }} />
          {divisions.length > 0 && (
            <select value={newTeamDivision} onChange={e => setNewTeamDivision(e.target.value)} style={{ ...selectStyle, width: 'auto' }}>
              <option value="">— No division —</option>
              {divisions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <button onClick={addUnlinkedTeam} disabled={!newTeam.trim()} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: newTeam.trim() ? 'pointer' : 'not-allowed', opacity: newTeam.trim() ? 1 : 0.5 }}>Add new</button>
        </div>
        {searchResults.length > 0 && (
          <div style={{ marginTop: 8, background: 'rgba(46,91,140,0.12)', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 8 }}>
            {searchResults.map(t => (
              <div key={t.id} onClick={() => addExistingTeam(t)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                <div style={{ width: 26, height: 26, borderRadius: 5, background: t.logo_url ? `url(${t.logo_url}) center/cover, ${t.logo_color}` : t.logo_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 11, color: '#fff' }}>
                  {!t.logo_url && (t.logo_initials || '?')}
                </div>
                <span style={{ fontSize: 13, color: '#F4F7FA' }}>{t.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9BB5D6' }}>+ Add</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BtnRow onBack={onBack} onNext={onNext} nextLabel="Next — Commissioners & Scorers →" />
    </>
  );
}

function Step4({ data, onChange, onBack, onSubmit, loading }) {
  const [commInput, setCommInput] = useState('');
  const [scorerInput, setScorerInput] = useState('');

  const addCommissioner = () => {
    if (!commInput.trim()) return;
    onChange('commissioners', [...(data.commissioners || []), commInput.trim()]);
    setCommInput('');
  };
  const addScorer = () => {
    if (!scorerInput.trim()) return;
    onChange('scorers', [...(data.scorers || []), scorerInput.trim()]);
    setScorerInput('');
  };

  return (
    <>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 4 }}>Commissioners & Scorers</div>
      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Step 4 of 4 — Both are optional; you'll be the founding commissioner</div>

      <SectionLabel>Additional Commissioners</SectionLabel>
      <Card>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginBottom: 10, lineHeight: 1.5 }}>
          Co-commissioners can edit teams, schedules, and standings — same powers as you. Must already have a Rinkd account.
        </div>
        {(data.commissioners || []).map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: 'rgba(244,247,250,0.6)' }}>
            <span>{c}</span>
            <button onClick={() => { const arr=[...(data.commissioners||[])]; arr.splice(i,1); onChange('commissioners', arr); }} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer' }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={commInput} onChange={e => setCommInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCommissioner()}
            placeholder="@handle or email" style={{ flex: 1, ...inputStyle }} />
          <button onClick={addCommissioner} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add</button>
        </div>
      </Card>

      <SectionLabel>Scorers</SectionLabel>
      <Card>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginBottom: 10, lineHeight: 1.5 }}>
          Scorers can record goals + penalties on league games via ScorerView. Invite by handle (Rinkd account) or email (sign-up invite).
        </div>
        {(data.scorers || []).map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: 'rgba(244,247,250,0.6)' }}>
            <span>{s}</span>
            <button onClick={() => { const arr=[...(data.scorers||[])]; arr.splice(i,1); onChange('scorers', arr); }} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer' }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={scorerInput} onChange={e => setScorerInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addScorer()}
            placeholder="@handle or email" style={{ flex: 1, ...inputStyle }} />
          <button onClick={addScorer} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add</button>
        </div>
      </Card>

      <BtnRow onBack={onBack} onNext={onSubmit} nextLabel="🏆 Publish League" loading={loading} />
    </>
  );
}

export default function LeagueCreate({ profile }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const createdLeagueId = useRef(null);

  const [data, setData] = useState({
    name: '', division: '', level: '', location: '', season: '',
    start_date: '', end_date: '',
    venue_name: '', venue_address: '',
    logo_color: '#2E5B8C', logo_initials: '', logo_url: '',
    accent_color: '#D72638',
    settings: { ...DEFAULT_SETTINGS },
    divisions: [],
    teams: [],
    commissioners: [],
    scorers: [],
  });

  const onChange = (key, val) => setData(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async () => {
    if (loading) return;
    if (!data.name.trim()) { setError('Add a league name to publish.'); setStep(1); return; }
    setLoading(true);
    setError(null);
    let leagueRow = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Your session timed out — sign in again to publish.');

      // 1. Create the league. Embeds extra wizard data (divisions list) into
      //    settings so LeagueManage can render them without a schema change.
      const settingsWithDivisions = { ...data.settings, divisions: data.divisions };
      const league = await createLeague({
        name: data.name.trim(),
        division: data.division,
        level: data.level,
        location: data.location,
        season: data.season,
        start_date: data.start_date,
        end_date: data.end_date,
        venue_name: data.venue_name,
        venue_address: data.venue_address,
        logo_color: data.logo_color,
        logo_initials: data.logo_initials,
        logo_url: data.logo_url,
        accent_color: data.accent_color,
        settings: settingsWithDivisions,
      });
      leagueRow = league;
      createdLeagueId.current = league.id;

      // 2. Add additional commissioners (best-effort — founder can fix from
      //    LeagueManage later if any fail). The founder is already implicitly
      //    a commissioner via leagues.commissioner_id; no league_roles row
      //    needed (is_league_commissioner checks both paths).
      for (const c of (data.commissioners || [])) {
        try { await addCommissionerByInput({ leagueId: league.id, input: c }); }
        catch (_) { /* non-fatal */ }
      }

      // 3. Add scorers (best-effort, mirror of step 2).
      for (const sc of (data.scorers || [])) {
        try {
          await addScorerByInput({
            leagueId: league.id,
            leagueName: data.name,
            input: sc,
            invitedBy: profile?.name || null,
          });
        } catch (_) { /* non-fatal */ }
      }

      // 4. Add teams. Batch insert to avoid the N+1 wizard anti-pattern
      //    flagged in the Phase 1 doc.
      if ((data.teams || []).length) {
        const rows = data.teams.map(t => ({
          league_id: league.id,
          team_id: t.team_id || null,
          team_name: t.name,
          logo_color: t.logo_color,
          logo_initials: t.logo_initials,
          logo_url: t.logo_url || null,
          division: t.division || '',
        }));
        const { error: teamsErr } = await supabase.from('league_teams').insert(rows);
        if (teamsErr) throw teamsErr;
      }

      navigate('/league/' + league.id + '/manage');
    } catch (e) {
      // Cleanup on failure — deleting the league cascade-clears league_roles
      // + league_teams + league_games. Surface a hint if the cleanup itself
      // fails so a partial state doesn't haunt the user silently.
      let cleanupNote = '';
      if (leagueRow?.id) {
        const { error: delErr } = await supabase.from('leagues').delete().eq('id', leagueRow.id);
        if (delErr) {
          // eslint-disable-next-line no-console
          console.warn('[LeagueCreate] cleanup failed:', delErr);
          cleanupNote = ' (a half-built league may still exist — email hello@rinkd.app and we\'ll clear it)';
        }
        createdLeagueId.current = null;
      }
      setError(`Couldn't publish the league: ${e.message}.${cleanupNote} Give it another shot.`);
      setLoading(false);
    }
  };

  return (
    <Layout profile={profile}>
      <div style={{ background: '#07111F', minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: '#F4F7FA', maxWidth: 600, margin: '0 auto' }}>
        <button onClick={() => navigate('/leagues')} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.5)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginBottom: 16 }}>← Leagues</button>
        <Progress step={step} />
        {error && <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#D72638' }}>{error}</div>}
        {step === 1 && <Step1 data={data} onChange={onChange} onNext={() => { if (!data.name.trim()) { setError('Add a league name to continue.'); return; } setError(null); setStep(2); }} />}
        {step === 2 && <Step2 data={data} onChange={onChange} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <Step3 data={data} onChange={onChange} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
        {step === 4 && <Step4 data={data} onChange={onChange} onBack={() => setStep(3)} onSubmit={handleSubmit} loading={loading} />}
      </div>
    </Layout>
  );
}
