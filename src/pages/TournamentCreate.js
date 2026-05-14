import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from '../components/DatePicker';
import DateTimePicker from '../components/DateTimePicker';
import { supabase } from '../lib/supabase';
import { addScorerByInput } from '../lib/tournamentScorers';
import Layout from '../components/Layout';

const COLORS = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

const DEFAULT_SETTINGS = {
  period_length_minutes: 15,
  period_type: 'stop',
  num_periods: 3,
  points_win: 2,
  points_tie: 1,
  points_loss: 0,
  shootout_win_points: 2,
  max_goal_differential: 5,
  allow_ties: true,
  shootout_pool: false,
  shootout_bracket: true,
  advancement_per_pool: 2,
  tiebreakers: ['head_to_head','goal_diff','goals_for','goals_against','penalty_minutes','coin_toss'],
};

const TIEBREAKER_LABELS = {
  head_to_head: 'Head-to-head result',
  goal_diff: 'Goal differential',
  goals_for: 'Goals for',
  goals_against: 'Goals against (fewest)',
  penalty_minutes: 'Penalty minutes (fewest)',
  coin_toss: 'Coin toss — Tournament Director',
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

function Input({ value, onChange, placeholder, type = 'text' }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
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
        {loading ? 'Publishing...' : nextLabel}
      </button>
    </div>
  );
}

// Period length 1–20
const periodOptions = Array.from({length:20},(_,i)=>({value:i+1,label:`${i+1} min`}));
// Points 0–4
const pointOptions = Array.from({length:5},(_,i)=>({value:i,label:`${i} pt${i!==1?'s':''}`}));
// Max goal differential — "No limit" + a full 1–10 range (BLPA runs a 6)
const goalDiffOptions = [{value:'none',label:'No limit'}, ...Array.from({length:10},(_,i)=>({value:i+1,label:String(i+1)}))];

function Step1({ data, onChange, onNext }) {
  return (
    <>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 4 }}>Create Tournament</div>
      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Step 1 of 4 — Basics</div>
      <Card>
        <Field label="Tournament Name">
          <Input value={data.name} onChange={v => onChange('name', v)} placeholder="e.g. Lakewood Classic" />
        </Field>
        <Field label="Division">
          <Input value={data.division} onChange={v => onChange('division', v)} placeholder="e.g. 12U AAA, Bantam AA, Adult Rec..." />
        </Field>
        <Row2>
          <Field label="Start Date">
            <DatePicker value={data.start_date} onChange={v => onChange('start_date', v)} placeholder="Start date" />
          </Field>
          <Field label="End Date">
            <DatePicker value={data.end_date} onChange={v => onChange('end_date', v)} placeholder="End date" />
          </Field>
        </Row2>
        <Field label="Venue / Facility">
          <Input value={data.venue_name} onChange={v => onChange('venue_name', v)} placeholder="e.g. Lakewood Ice Complex" />
        </Field>
        <Field label="Address">
          <Input value={data.venue_address} onChange={v => onChange('venue_address', v)} placeholder="Street address" />
        </Field>
      </Card>
      <BtnRow onNext={onNext} nextLabel="Next — Format & Rules →" />
    </>
  );
}

function Step2({ data, onChange, onBack, onNext }) {
  const s = data.settings;
  const set = (key, val) => onChange('settings', { ...s, [key]: val });

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
              options={[{value:2,label:'2 periods'},{value:3,label:'3 periods'}]} />
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
        <Toggle value={s.allow_ties} onChange={v => set('allow_ties', v)} label="Allow ties in pool play" sub="Games can end in a draw" />
        <Toggle value={s.shootout_pool} onChange={v => set('shootout_pool', v)} label="Shootout in pool play" sub="Tied games go to shootout" />
        <Toggle value={s.shootout_bracket} onChange={v => set('shootout_bracket', v)} label="Shootout in bracket" sub="No ties allowed in bracket games" />
      </Card>

      <BtnRow onBack={onBack} onNext={onNext} nextLabel="Next — Teams & Pools →" />
    </>
  );
}

function Step3({ data, onChange, onBack, onNext }) {
  const [newTeam, setNewTeam] = useState('');
  const [newPool, setNewPool] = useState('A');
  const numPools = data.num_pools || 2;
  const poolNames = data.pool_names || ['A','B'];

  const addTeam = () => {
    if (!newTeam.trim()) return;
    onChange('teams', [...(data.teams||[]), { name: newTeam.trim(), pool: newPool }]);
    setNewTeam('');
  };

  const removeTeam = i => {
    const t = [...(data.teams||[])]; t.splice(i,1); onChange('teams', t);
  };

  const updatePoolName = (i, val) => {
    const names = [...poolNames]; names[i] = val; onChange('pool_names', names);
  };

  const poolColors = ['rgba(215,38,56,0.2)','rgba(46,91,140,0.3)','rgba(34,197,94,0.2)','rgba(245,158,11,0.2)'];
  const poolTextColors = ['#D72638','#8BA3BE','#22C55E','#F59E0B'];

  return (
    <>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 4 }}>Teams & Pools</div>
      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Step 3 of 4</div>

      <SectionLabel>Pool Settings</SectionLabel>
      <Card>
        <Row2>
          <Field label="Number of Pools">
            <Select value={numPools} onChange={v => { onChange('num_pools', parseInt(v)); onChange('pool_names', Array.from({length:parseInt(v)},(_,i)=>poolNames[i]||String.fromCharCode(65+i))); }}
              options={[{value:1,label:'1 pool'},{value:2,label:'2 pools'},{value:3,label:'3 pools'},{value:4,label:'4 pools'}]} />
          </Field>
          <Field label="Teams advance per pool">
            <Select value={data.settings.advancement_per_pool} onChange={v => onChange('settings', {...data.settings, advancement_per_pool: parseInt(v)})}
              options={[{value:1,label:'1 team'},{value:2,label:'2 teams'},{value:3,label:'3 teams'}]} />
          </Field>
        </Row2>
        <Row2>
          {Array.from({length: numPools}, (_, i) => (
            <Field key={i} label={`Pool ${i+1} Name`}>
              <Input value={poolNames[i]||''} onChange={v => updatePoolName(i, v)} placeholder={String.fromCharCode(65+i)} />
            </Field>
          ))}
        </Row2>
      </Card>

      <SectionLabel>Teams ({(data.teams||[]).length})</SectionLabel>
      <Card>
        {(data.teams||[]).map((t, i) => {
          const pi = poolNames.indexOf(t.pool);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: poolColors[pi]||poolColors[0], color: poolTextColors[pi]||poolTextColors[0], letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>POOL {t.pool}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>{t.name}</span>
              <button onClick={() => removeTeam(i)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={newTeam} onChange={e => setNewTeam(e.target.value)} onKeyDown={e => e.key==='Enter'&&addTeam()}
            placeholder="Team name" style={{ flex: 1, ...inputStyle }} />
          <select value={newPool} onChange={e => setNewPool(e.target.value)} style={{ ...selectStyle, width: 'auto' }}>
            {poolNames.map(p => <option key={p} value={p}>Pool {p}</option>)}
          </select>
          <button onClick={addTeam} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add</button>
        </div>
      </Card>

      <BtnRow onBack={onBack} onNext={onNext} nextLabel="Next — Schedule →" />
    </>
  );
}

function Step4({ data, onChange, onBack, onSubmit, loading }) {
  const [newRink, setNewRink] = useState({ name: '', sub_rink: '', live_barn_venue_id: '' });
  const [newGame, setNewGame] = useState({ home: '', away: '', rink: '', time: '' });
  const [scorekeeperEmail, setScorekeeperEmail] = useState('');

  const addRink = () => {
    if (!newRink.sub_rink.trim() && !newRink.name.trim()) return;
    onChange('rinks', [...(data.rinks||[]), { ...newRink }]);
    setNewRink({ name: '', sub_rink: '', live_barn_venue_id: '' });
  };

  const removeRink = i => { const r=[...(data.rinks||[])]; r.splice(i,1); onChange('rinks',r); };

  const addGame = () => {
    if (!newGame.home || !newGame.away || !newGame.time) return;
    onChange('games', [...(data.games||[]), { ...newGame }]);
    setNewGame({ home: '', away: '', rink: data.rinks?.[0]?.sub_rink||'', time: '' });
  };

  const removeGame = i => { const g=[...(data.games||[])]; g.splice(i,1); onChange('games',g); };

  const addScorekeeper = () => {
    if (!scorekeeperEmail.trim()) return;
    onChange('scorekeepers', [...(data.scorekeepers||[]), scorekeeperEmail.trim()]);
    setScorekeeperEmail('');
  };

  const teams = (data.teams||[]).map(t => t.name);

  return (
    <>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, marginBottom: 4 }}>Schedule & Publish</div>
      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Step 4 of 4</div>

      <SectionLabel>Rinks</SectionLabel>
      <Card>
        {(data.rinks||[]).map((r,i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>{r.sub_rink||r.name}</div>
              {r.live_barn_venue_id
                ? <div style={{ fontSize: 11, color: '#D72638', fontWeight: 600 }}>LiveBarn: {r.live_barn_venue_id}</div>
                : <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)' }}>No LiveBarn</div>}
            </div>
            <button onClick={() => removeRink(i)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <Row2>
            <input value={newRink.name} onChange={e => setNewRink({...newRink, name: e.target.value})} placeholder="Facility name" style={inputStyle} />
            <input value={newRink.sub_rink} onChange={e => setNewRink({...newRink, sub_rink: e.target.value})} placeholder="Rink name (e.g. Rink 1)" style={inputStyle} />
          </Row2>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newRink.live_barn_venue_id} onChange={e => setNewRink({...newRink, live_barn_venue_id: e.target.value})} placeholder="LiveBarn venue ID (optional)" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={addRink} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add</button>
          </div>
        </div>
      </Card>

      <SectionLabel>Games ({(data.games||[]).length})</SectionLabel>
      <Card>
        {(data.games||[]).map((g,i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)', fontSize: 12 }}>
            <span style={{ background: 'rgba(46,91,140,0.25)', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: 'rgba(244,247,250,0.7)', whiteSpace: 'nowrap' }}>
              {g.time ? new Date(g.time).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—'}
            </span>
            <span style={{ flex: 1, fontWeight: 600 }}>{g.home}</span>
            <span style={{ color: 'rgba(244,247,250,0.3)', fontSize: 11 }}>vs</span>
            <span style={{ flex: 1, fontWeight: 600, textAlign: 'right' }}>{g.away}</span>
            <span style={{ fontSize: 10, color: 'rgba(244,247,250,0.3)', marginLeft: 4 }}>{g.rink}</span>
            <button onClick={() => removeGame(i)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
            <select value={newGame.home} onChange={e => setNewGame({...newGame, home: e.target.value})} style={{ ...selectStyle }}>
              <option value="">Home team</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ color: 'rgba(244,247,250,0.3)', fontSize: 11, textAlign: 'center' }}>vs</span>
            <select value={newGame.away} onChange={e => setNewGame({...newGame, away: e.target.value})} style={{ ...selectStyle }}>
              <option value="">Away team</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
            <DateTimePicker value={newGame.time} onChange={v => setNewGame({...newGame, time: v})} placeholder="Date & time" />
            <select value={newGame.rink} onChange={e => setNewGame({...newGame, rink: e.target.value})} style={{ ...selectStyle }}>
              <option value="">Select rink</option>
              {(data.rinks||[]).map(r => <option key={r.sub_rink||r.name} value={r.sub_rink||r.name}>{r.sub_rink||r.name}</option>)}
            </select>
            <button onClick={addGame} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add</button>
          </div>
        </div>
      </Card>

      <SectionLabel>Scorekeepers</SectionLabel>
      <Card>
        <Field label="Invite by Rinkd handle or email">
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={scorekeeperEmail} onChange={e => setScorekeeperEmail(e.target.value)}
              onKeyDown={e => e.key==='Enter'&&addScorekeeper()}
              placeholder="@handle or email" style={{ flex: 1, ...inputStyle }} />
            <button onClick={addScorekeeper} style={{ background: COLORS.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Invite</button>
          </div>
        </Field>
        {(data.scorekeepers||[]).map((s,i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: 'rgba(244,247,250,0.6)' }}>
            <span>{s}</span>
            <button onClick={() => { const sc=[...(data.scorekeepers||[])]; sc.splice(i,1); onChange('scorekeepers',sc); }} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer' }}>✕</button>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.35)', marginTop: 8 }}>They'll get access to the scorer view for this tournament only</div>
      </Card>

      <BtnRow onBack={onBack} onNext={onSubmit} nextLabel="🚀 Publish Tournament" loading={loading} />
    </>
  );
}

export default function TournamentCreate({ profile }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [data, setData] = useState({
    name: '', division: '', start_date: '', end_date: '',
    venue_name: '', venue_address: '',
    settings: { ...DEFAULT_SETTINGS },
    num_pools: 2, pool_names: ['A','B'],
    teams: [], rinks: [], games: [], scorekeepers: [],
  });

  const onChange = (key, val) => setData(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Create rinks
      const rinkMap = {};
      for (const r of data.rinks) {
        const { data: rinkRow, error: re } = await supabase.from('rinks')
          .insert({ name: r.name || data.venue_name, sub_rink: r.sub_rink || null, address: data.venue_address, live_barn_venue_id: r.live_barn_venue_id || null })
          .select().single();
        if (re) throw re;
        rinkMap[r.sub_rink || r.name] = rinkRow.id;
      }

      // 2. Create tournament
      const { data: t, error: te } = await supabase.from('tournaments')
        .insert({
          name: data.name, division: data.division,
          start_date: data.start_date, end_date: data.end_date,
          director_id: user.id, status: 'active',
          settings: { ...data.settings, venue_name: data.venue_name, venue_address: data.venue_address, pool_names: data.pool_names },
        }).select().single();
      if (te) throw te;

      // 3. Director role
      await supabase.from('tournament_roles').insert({ tournament_id: t.id, user_id: user.id, role: 'director' });

      // 3b. Scorer roles — resolve each collected scorekeeper handle/email to a
      // Rinkd account and grant the 'scorer' role; email a sign-up invite to
      // anyone without an account yet. Best-effort: a failure here never blocks
      // tournament creation — the director can review and fix everything from
      // the Scorers tab on the manage page.
      for (const sk of (data.scorekeepers || [])) {
        try {
          await addScorerByInput({
            tournamentId: t.id,
            tournamentName: data.name,
            input: sk,
            invitedBy: profile?.name || null,
          });
        } catch (_) { /* non-fatal */ }
      }

      // 4. Create teams
      const teamMap = {};
      for (const team of data.teams) {
        const { data: teamRow, error: tme } = await supabase.from('tournament_teams')
          .insert({ tournament_id: t.id, team_name: team.name, pool: team.pool })
          .select().single();
        if (tme) throw tme;
        teamMap[team.name] = teamRow.id;
      }

      // 5. Create games
      for (const g of data.games) {
        if (!teamMap[g.home] || !teamMap[g.away]) continue;
        await supabase.from('games').insert({
          tournament_id: t.id,
          home_team_id: teamMap[g.home],
          away_team_id: teamMap[g.away],
          rink_id: rinkMap[g.rink] || null,
          start_time: g.time,
          status: 'scheduled', round: 'pool',
        });
      }

      navigate('/tournament/' + t.id);
    } catch(e) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <Layout profile={profile}>
      <div style={{ background: '#07111F', minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: '#F4F7FA', maxWidth: 600, margin: '0 auto' }}>
        <Progress step={step} />
        {error && <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#D72638' }}>{error}</div>}
        {step===1 && <Step1 data={data} onChange={onChange} onNext={() => setStep(2)} />}
        {step===2 && <Step2 data={data} onChange={onChange} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step===3 && <Step3 data={data} onChange={onChange} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
        {step===4 && <Step4 data={data} onChange={onChange} onBack={() => setStep(3)} onSubmit={handleSubmit} loading={loading} />}
      </div>
    </Layout>
  );
}
