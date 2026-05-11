import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Scoresheet from '../components/Scoresheet';
import { supabase } from '../lib/supabase';

const C = {
  dark: '#07111F', navy: '#0B1F3A', blue: '#2E5B8C',
  red: '#D72638', ice: '#F4F7FA', card: '#0f2847',
  border: 'rgba(46,91,140,0.4)',
};

const inputStyle = { width: '100%', background: '#07111F', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 8, padding: '10px 12px', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none' };
const selectStyle = { ...inputStyle };

const PENALTIES = {
  'Minor (2 min)': ['Boarding','Charging','Cross-Checking','Elbowing','High-Sticking','Holding','Hooking','Interference','Roughing','Slashing','Tripping','Too Many Men','Delay of Game'],
  'Double Minor (4 min)': ['High-Sticking (draw blood)'],
  'Major (5 min)': ['Fighting','Checking from Behind','Spearing','Butt-Ending','Attempt to Injure'],
  'Game Misconduct': ['Game Misconduct'],
  'Match Penalty': ['Match Penalty'],
};
const PENALTY_DURATIONS = { 'Minor (2 min)': 2, 'Double Minor (4 min)': 4, 'Major (5 min)': 5, 'Game Misconduct': 5, 'Match Penalty': 5 };

function SecLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{children}</div>;
}

function AddBtn({ onClick, children }) {
  return (
    <button onClick={onClick}
      style={{ width: '100%', padding: 10, background: 'rgba(46,91,140,0.15)', border: '0.5px dashed rgba(46,91,140,0.5)', borderRadius: 8, color: '#F4F7FA', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.borderStyle = 'solid'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.15)'; e.currentTarget.style.color = '#F4F7FA'; e.currentTarget.style.borderStyle = 'dashed'; }}>
      {children}
    </button>
  );
}

function ScoreBtn({ onClick, children, variant = 'minus' }) {
  const bg = variant === 'plus' ? C.red : 'rgba(244,247,250,0.08)';
  return (
    <button onClick={onClick}
      style={{ width: 44, height: 44, background: bg, border: 'none', borderRadius: 8, color: '#F4F7FA', fontSize: 22, cursor: 'pointer', fontWeight: 700, transition: 'all 0.15s', flexShrink: 0 }}
      onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
      onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.color = '#F4F7FA'; }}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, onSave, saveLabel = 'Save', children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: C.navy, borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 480, borderTop: '0.5px solid rgba(46,91,140,0.4)' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: '#F4F7FA', marginBottom: 16 }}>{title}</div>
        {children}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: 12, background: 'rgba(244,247,250,0.08)', border: 'none', borderRadius: 999, color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', fontSize: 14, cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(244,247,250,0.08)'; e.currentTarget.style.color = '#F4F7FA'; }}>Cancel</button>
          <button onClick={onSave}
            style={{ flex: 2, padding: 12, background: C.red, border: 'none', borderRadius: 999, color: '#fff', fontFamily: 'Barlow, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

function MField({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Row2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}

export default function ScorerView() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLeague = searchParams.get('type') === 'league';
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [period, setPeriod] = useState(1);
  const [status, setStatus] = useState('scheduled');
  const [goals, setGoals] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [shots, setShots] = useState({});
  const [goalieChanges, setGoalieChanges] = useState([]);
  const [goalModal, setGoalModal] = useState(false);
  const [penaltyModal, setPenaltyModal] = useState(false);
  const [goalieModal, setGoalieModal] = useState(null);
  const [showScoresheet, setShowScoresheet] = useState(false);
  const [goalForm, setGoalForm] = useState({ team_id: '', scorer_number: '', assist1_number: '', assist2_number: '', period: 1, time_in_period: '', is_shootout: false });
  const [penaltyForm, setPenaltyForm] = useState({ team_id: '', player_number: '', severity: 'Minor (2 min)', penalty_type: 'Hooking', period: 1, time_in_period: '' });
  const [goalieForm, setGoalieForm] = useState({ goalie_out_number: '', goalie_in_number: '', period: 1, time_in_period: '' });

  const load = useCallback(async () => {
    const { data: g } = isLeague
      ? await supabase.from('league_games')
          .select('*, home_team:league_teams!home_team_id(id, team_name, team:teams(id,name)), away_team:league_teams!away_team_id(id, team_name, team:teams(id,name)), rink:rinks(name,sub_rink), league:leagues(name)')
          .eq('id', gameId).single()
      : await supabase.from('games')
          .select('*, home_team:tournament_teams!home_team_id(id,team_name), away_team:tournament_teams!away_team_id(id,team_name), rink:rinks(name,sub_rink), tournament:tournaments(name)')
          .eq('id', gameId).single();
    if (!g) { navigate(-1); return; }
    setGame(g);
    setHomeScore(g.home_score || 0);
    setAwayScore(g.away_score || 0);
    setPeriod(g.period || 1);
    setStatus(g.status || 'scheduled');
    setGoalForm(prev => ({ ...prev, team_id: g.home_team?.id || '', period: g.period || 1 }));
    setPenaltyForm(prev => ({ ...prev, team_id: g.home_team?.id || '', period: g.period || 1 }));
    const [{ data: gl }, { data: pl }, { data: sl }, { data: gc }] = await Promise.all([
      supabase.from('game_goals').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
      supabase.from('game_penalties').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
      supabase.from('game_shots').select('*').eq('game_id', gameId),
      supabase.from('game_goalie_changes').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
    ]);
    setGoals(gl || []);
    setPenalties(pl || []);
    const shotMap = {};
    (sl || []).forEach(s => { shotMap[s.team_id] = (shotMap[s.team_id] || 0) + s.count; });
    setShots(shotMap);
    setGoalieChanges(gc || []);
    setLoading(false);
  }, [gameId, navigate]);

  useEffect(() => { load(); }, [load]);

  const updateScore = async (hs, as, p, st) => {
    setSaving(true);
    await supabase.from(isLeague ? 'league_games' : 'games').update({ home_score: hs, away_score: as, period: p, status: st }).eq('id', gameId);
    setSaving(false);
  };

  const changeScore = (team, delta) => {
    const hs = team === 'home' ? Math.max(0, homeScore + delta) : homeScore;
    const as = team === 'away' ? Math.max(0, awayScore + delta) : awayScore;
    setHomeScore(hs); setAwayScore(as);
    const newStatus = status === 'scheduled' ? 'live' : status;
    if (status === 'scheduled') setStatus('live');
    updateScore(hs, as, period, newStatus);
  };

  const changePeriod = async (p) => {
    const newStatus = p === 'final' ? 'final' : 'live';
    const newPeriod = p === 'final' ? period : parseInt(p);
    setPeriod(newPeriod); setStatus(newStatus);
    await updateScore(homeScore, awayScore, newPeriod, newStatus);
  };

  const changeShots = async (teamId, delta) => {
    const current = shots[teamId] || 0;
    const newCount = Math.max(0, current + delta);
    setShots(prev => ({ ...prev, [teamId]: newCount }));
    await supabase.from('game_shots').upsert({ game_id: gameId, team_id: teamId, period, count: newCount }, { onConflict: 'game_id,team_id,period' });
  };

  const saveGoal = async () => {
    if (!goalForm.team_id) return;
    const { data } = await supabase.from('game_goals').insert({
      game_id: gameId, team_id: goalForm.team_id,
      scorer_number: goalForm.scorer_number ? parseInt(goalForm.scorer_number) : null,
      assist1_number: goalForm.assist1_number ? parseInt(goalForm.assist1_number) : null,
      assist2_number: goalForm.assist2_number ? parseInt(goalForm.assist2_number) : null,
      period: goalForm.period, time_in_period: goalForm.time_in_period || null,
      is_shootout: goalForm.is_shootout,
    }).select().single();
    if (data) {
      setGoals(prev => [data, ...prev]);
      if (goalForm.team_id === game.home_team?.id) changeScore('home', 1);
      else changeScore('away', 1);
    }
    setGoalModal(false);
    setGoalForm(prev => ({ ...prev, scorer_number: '', assist1_number: '', assist2_number: '', time_in_period: '' }));
  };

  const savePenalty = async () => {
    if (!penaltyForm.team_id) return;
    const { data } = await supabase.from('game_penalties').insert({
      game_id: gameId, team_id: penaltyForm.team_id,
      player_number: penaltyForm.player_number ? parseInt(penaltyForm.player_number) : null,
      penalty_type: penaltyForm.penalty_type, severity: penaltyForm.severity,
      duration_minutes: PENALTY_DURATIONS[penaltyForm.severity] || 2,
      period: penaltyForm.period, time_in_period: penaltyForm.time_in_period || null,
    }).select().single();
    if (data) setPenalties(prev => [data, ...prev]);
    setPenaltyModal(false);
    setPenaltyForm(prev => ({ ...prev, player_number: '', time_in_period: '' }));
  };

  const saveGoalie = async () => {
    if (!goalieModal) return;
    const { data } = await supabase.from('game_goalie_changes').insert({
      game_id: gameId, team_id: goalieModal,
      goalie_out_number: goalieForm.goalie_out_number ? parseInt(goalieForm.goalie_out_number) : null,
      goalie_in_number: goalieForm.goalie_in_number ? parseInt(goalieForm.goalie_in_number) : null,
      period: goalieForm.period, time_in_period: goalieForm.time_in_period || null,
    }).select().single();
    if (data) setGoalieChanges(prev => [data, ...prev]);
    setGoalieModal(null);
    setGoalieForm({ goalie_out_number: '', goalie_in_number: '', period, time_in_period: '' });
  };

  const deleteGoal = async (id) => {
    await supabase.from('game_goals').delete().eq('id', id);
    setGoals(prev => prev.filter(g => g.id !== id));
  };

  const deletePenalty = async (id) => {
    await supabase.from('game_penalties').delete().eq('id', id);
    setPenalties(prev => prev.filter(p => p.id !== id));
  };

  if (loading) return <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif' }}>Loading game...</div>;

  // League games nest team under league_team
  const homeTeam = isLeague
    ? { id: game.home_team?.id, team_name: game.home_team?.team?.name || game.home_team?.team_name }
    : game.home_team;
  const awayTeamRaw = isLeague
    ? { id: game.away_team?.id, team_name: game.away_team?.team?.name || game.away_team?.team_name }
    : game.away_team;
  const awayTeam = isLeague ? awayTeamRaw : game.away_team;
  const periodLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p === 4 ? 'OT' : 'SO';
  const severityColor = (s) => s.includes('Major') || s.includes('Match') ? C.red : '#F59E0B';
  const teamName = (id) => id === homeTeam?.id ? homeTeam?.team_name : awayTeam?.team_name;

  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: '#F4F7FA', maxWidth: 480, margin: '0 auto', paddingBottom: 40 }}>

      {/* HEADER */}
      <div style={{ background: C.navy, padding: '14px 16px', borderBottom: '0.5px solid rgba(46,91,140,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← Games</button>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 15, color: '#F4F7FA' }}>{homeTeam?.team_name} vs {awayTeam?.team_name}</div>
          <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{game.rink?.sub_rink} · {isLeague ? game.league?.name : game.tournament?.name}</div>
        </div>
        <span style={{ background: status === 'live' ? 'rgba(215,38,56,0.15)' : status === 'final' ? 'rgba(244,247,250,0.08)' : 'rgba(46,91,140,0.3)', color: status === 'live' ? C.red : status === 'final' ? 'rgba(244,247,250,0.5)' : '#F4F7FA', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
          {status === 'live' ? '● LIVE' : status === 'final' ? 'FINAL' : 'SCHEDULED'}
        </span>
      </div>

      <div style={{ padding: 16 }}>

        {/* SCORE + GOAL LOG — combined card */}
        <SecLabel>Score & Goals {saving && <span style={{ color: 'rgba(244,247,250,0.3)', fontWeight: 400, textTransform: 'none', fontSize: 10 }}>saving...</span>}</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>

          {/* Score section */}
          <div style={{ padding: '14px 16px', borderBottom: '0.5px solid rgba(46,91,140,0.3)' }}>
            {[[homeTeam, homeScore, 'home'], [awayTeam, awayScore, 'away']].map(([team, score, side], i) => (
              <div key={side} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: i > 0 ? '0.5px solid rgba(244,247,250,0.07)' : 'none', marginTop: i > 0 ? 6 : 0, paddingTop: i > 0 ? 12 : 6 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#F4F7FA', flex: 1 }}>{team?.team_name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ScoreBtn onClick={() => changeScore(side, -1)} variant="minus">−</ScoreBtn>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 44, color: '#F4F7FA', width: 56, textAlign: 'center', lineHeight: 1 }}>{score}</div>
                  <ScoreBtn onClick={() => changeScore(side, 1)} variant="plus">+</ScoreBtn>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.25)', textAlign: 'center', marginTop: 8 }}>Score updates automatically when goals are logged · use +/− to correct</div>
          </div>

          {/* Goal log section */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Goal Log ({goals.length})</div>
            {goals.length === 0 && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center', padding: '8px 0' }}>No goals logged yet</div>}
            {goals.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: g.team_id === homeTeam?.id ? '#1a4a7a' : '#6b1520', flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>
                    {g.scorer_number ? `#${g.scorer_number}` : 'Unknown'}
                    {g.assist1_number ? ` — assist: #${g.assist1_number}` : ' — unassisted'}
                    {g.assist2_number ? `, #${g.assist2_number}` : ''}
                    {g.is_shootout ? ' (SO)' : ''}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{teamName(g.team_id)} · {periodLabel(g.period)}{g.time_in_period ? ` · ${g.time_in_period}` : ''}</div>
                </div>
                <button onClick={() => deleteGoal(g.id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.2)', cursor: 'pointer', fontSize: 14 }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.2)'}>✕</button>
              </div>
            ))}
            <AddBtn onClick={() => { setGoalForm(prev => ({ ...prev, period })); setGoalModal(true); }}>+ Log Goal</AddBtn>
          </div>
        </div>

        {/* PERIOD */}
        <SecLabel>Period</SecLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6, marginBottom: 16 }}>
          {[['1','1st'],['2','2nd'],['3','3rd'],['4','OT'],['5','SO'],['final','Final']].map(([val, label]) => {
            const isActive = val === 'final' ? status === 'final' : parseInt(val) === period && status !== 'final';
            const isFinal = val === 'final';
            return (
              <button key={val} onClick={() => changePeriod(val)}
                style={{ padding: '9px 0', border: `0.5px solid ${isActive ? (isFinal ? 'rgba(215,38,56,0.35)' : C.blue) : C.border}`, borderRadius: 8, background: isActive ? (isFinal ? 'rgba(215,38,56,0.15)' : C.blue) : 'rgba(46,91,140,0.1)', color: isActive ? (isFinal ? C.red : '#F4F7FA') : '#F4F7FA', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', opacity: isActive ? 1 : 0.5, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? (isFinal ? 'rgba(215,38,56,0.15)' : C.blue) : 'rgba(46,91,140,0.1)'; e.currentTarget.style.color = isActive ? (isFinal ? C.red : '#F4F7FA') : '#F4F7FA'; e.currentTarget.style.opacity = isActive ? '1' : '0.5'; }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* SHOTS */}
        <SecLabel>Shots on Goal</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          {[homeTeam, awayTeam].map((team, i) => (
            <div key={team?.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i > 0 ? '0.5px solid rgba(244,247,250,0.07)' : 'none' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#F4F7FA', flex: 1 }}>{team?.team_name}</span>
              <button onClick={() => changeShots(team?.id, -1)} style={{ width: 36, height: 36, background: 'rgba(244,247,250,0.08)', border: 'none', borderRadius: 8, color: '#F4F7FA', fontSize: 18, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(244,247,250,0.08)'; e.currentTarget.style.color = '#F4F7FA'; }}>−</button>
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 32, color: '#F4F7FA', width: 48, textAlign: 'center' }}>{shots[team?.id] || 0}</span>
              <button onClick={() => changeShots(team?.id, 1)} style={{ width: 44, height: 44, background: C.blue, border: 'none', borderRadius: 8, color: '#F4F7FA', fontSize: 22, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.blue; e.currentTarget.style.color = '#F4F7FA'; }}>+</button>
            </div>
          ))}
        </div>

        {/* PENALTIES */}
        <SecLabel>Penalties ({penalties.length})</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          {penalties.length === 0 && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center', padding: '8px 0' }}>No penalties logged yet</div>}
          {penalties.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap', marginTop: 2, background: `${severityColor(p.severity)}22`, color: severityColor(p.severity) }}>
                {p.severity.includes('Major') || p.severity.includes('Match') ? 'MAJOR' : p.severity.includes('Double') ? 'DBL MIN' : 'MINOR'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>{p.player_number ? `#${p.player_number} ` : ''}{teamName(p.team_id)} — {p.penalty_type}</div>
                <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{periodLabel(p.period)}{p.time_in_period ? ` · ${p.time_in_period}` : ''} · {p.duration_minutes} min</div>
              </div>
              <button onClick={() => deletePenalty(p.id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.2)', cursor: 'pointer', fontSize: 14 }}
                onMouseEnter={e => e.currentTarget.style.color = C.red}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.2)'}>✕</button>
            </div>
          ))}
          <AddBtn onClick={() => { setPenaltyForm(prev => ({ ...prev, period })); setPenaltyModal(true); }}>+ Add Penalty</AddBtn>
        </div>

        {/* GOALIE CHANGES */}
        <SecLabel>Goalie Changes</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          {[homeTeam, awayTeam].map((team, ti) => (
            <div key={team?.id}>
              {ti > 0 && <div style={{ height: '0.5px', background: 'rgba(244,247,250,0.06)', margin: '12px 0' }} />}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(244,247,250,0.35)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{team?.team_name}</div>
              {goalieChanges.filter(g => g.team_id === team?.id).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>{c.goalie_out_number ? `#${c.goalie_out_number}` : '?'} → {c.goalie_in_number ? `#${c.goalie_in_number}` : '?'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{periodLabel(c.period)}{c.time_in_period ? ` · ${c.time_in_period}` : ''}</div>
                  </div>
                </div>
              ))}
              <AddBtn onClick={() => { setGoalieForm({ goalie_out_number: '', goalie_in_number: '', period, time_in_period: '' }); setGoalieModal(team?.id); }}>+ Log Change — {team?.team_name}</AddBtn>
            </div>
          ))}
        </div>

        {/* FINALIZE */}
        {status === 'final' && (
          <button onClick={() => setShowScoresheet(true)}
            style={{ width: '100%', padding: 14, background: '#2E5B8C', border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginTop: 10, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2E5B8C'; e.currentTarget.style.color = '#fff'; }}>
            📄 Generate Official Scoresheet
          </button>
        )}
        {status !== 'final'
          ? <button onClick={() => changePeriod('final')}
              style={{ width: '100%', padding: 14, background: C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginTop: 4, transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
              🏒 Finalize Game
            </button>
          : <div style={{ textAlign: 'center', padding: 14, background: 'rgba(215,38,56,0.1)', border: '0.5px solid rgba(215,38,56,0.3)', borderRadius: 999, fontSize: 14, fontWeight: 700, color: C.red }}>✓ Game Finalized — Standings Updated</div>
        }
      </div>

      {showScoresheet && (
        <Scoresheet
          game={game}
          goals={goals}
          penalties={penalties}
          shots={shots}
          goalieChanges={goalieChanges}
          isLeague={isLeague}
          onClose={() => setShowScoresheet(false)}
        />
      )}

      {/* GOAL MODAL */}
      {goalModal && (
        <Modal title="Log Goal" onClose={() => setGoalModal(false)} onSave={saveGoal} saveLabel="Save Goal">
          <MField label="Team">
            <select style={selectStyle} value={goalForm.team_id} onChange={e => setGoalForm(p => ({ ...p, team_id: e.target.value }))}>
              <option value={homeTeam?.id}>{homeTeam?.team_name}</option>
              <option value={awayTeam?.id}>{awayTeam?.team_name}</option>
            </select>
          </MField>
          <Row2>
            <MField label="Scorer #"><input style={inputStyle} type="number" placeholder="Jersey #" value={goalForm.scorer_number} onChange={e => setGoalForm(p => ({ ...p, scorer_number: e.target.value }))} /></MField>
            <MField label="Assist 1 #"><input style={inputStyle} type="number" placeholder="Optional" value={goalForm.assist1_number} onChange={e => setGoalForm(p => ({ ...p, assist1_number: e.target.value }))} /></MField>
          </Row2>
          <Row2>
            <MField label="Assist 2 #"><input style={inputStyle} type="number" placeholder="Optional" value={goalForm.assist2_number} onChange={e => setGoalForm(p => ({ ...p, assist2_number: e.target.value }))} /></MField>
            <MField label="Time (mm:ss)"><input style={inputStyle} placeholder="e.g. 8:42" value={goalForm.time_in_period} onChange={e => setGoalForm(p => ({ ...p, time_in_period: e.target.value }))} /></MField>
          </Row2>
          <Row2>
            <MField label="Period">
              <select style={selectStyle} value={goalForm.period} onChange={e => setGoalForm(p => ({ ...p, period: parseInt(e.target.value) }))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n === 4 ? 'OT' : n === 5 ? 'SO' : n === 1 ? '1st' : n === 2 ? '2nd' : '3rd'}</option>)}
              </select>
            </MField>
            <MField label="Shootout?">
              <select style={selectStyle} value={goalForm.is_shootout ? 'yes' : 'no'} onChange={e => setGoalForm(p => ({ ...p, is_shootout: e.target.value === 'yes' }))}>
                <option value="no">No</option>
                <option value="yes">Yes (SO)</option>
              </select>
            </MField>
          </Row2>
        </Modal>
      )}

      {/* PENALTY MODAL */}
      {penaltyModal && (
        <Modal title="Add Penalty" onClose={() => setPenaltyModal(false)} onSave={savePenalty} saveLabel="Save Penalty">
          <MField label="Team">
            <select style={selectStyle} value={penaltyForm.team_id} onChange={e => setPenaltyForm(p => ({ ...p, team_id: e.target.value }))}>
              <option value={homeTeam?.id}>{homeTeam?.team_name}</option>
              <option value={awayTeam?.id}>{awayTeam?.team_name}</option>
            </select>
          </MField>
          <Row2>
            <MField label="Player #"><input style={inputStyle} type="number" placeholder="Jersey #" value={penaltyForm.player_number} onChange={e => setPenaltyForm(p => ({ ...p, player_number: e.target.value }))} /></MField>
            <MField label="Time (mm:ss)"><input style={inputStyle} placeholder="e.g. 11:20" value={penaltyForm.time_in_period} onChange={e => setPenaltyForm(p => ({ ...p, time_in_period: e.target.value }))} /></MField>
          </Row2>
          <MField label="Severity">
            <select style={selectStyle} value={penaltyForm.severity} onChange={e => setPenaltyForm(p => ({ ...p, severity: e.target.value, penalty_type: PENALTIES[e.target.value]?.[0] || '' }))}>
              {Object.keys(PENALTIES).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </MField>
          <MField label="Penalty">
            <select style={selectStyle} value={penaltyForm.penalty_type} onChange={e => setPenaltyForm(p => ({ ...p, penalty_type: e.target.value }))}>
              {(PENALTIES[penaltyForm.severity] || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}
            </select>
          </MField>
          <MField label="Period">
            <select style={selectStyle} value={penaltyForm.period} onChange={e => setPenaltyForm(p => ({ ...p, period: parseInt(e.target.value) }))}>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n === 4 ? 'OT' : n === 5 ? 'SO' : n === 1 ? '1st' : n === 2 ? '2nd' : '3rd'}</option>)}
            </select>
          </MField>
        </Modal>
      )}

      {/* GOALIE MODAL */}
      {goalieModal && (
        <Modal title={`Goalie Change — ${teamName(goalieModal)}`} onClose={() => setGoalieModal(null)} onSave={saveGoalie} saveLabel="Save Change">
          <Row2>
            <MField label="Out #"><input style={inputStyle} type="number" placeholder="Jersey #" value={goalieForm.goalie_out_number} onChange={e => setGoalieForm(p => ({ ...p, goalie_out_number: e.target.value }))} /></MField>
            <MField label="In #"><input style={inputStyle} type="number" placeholder="Jersey #" value={goalieForm.goalie_in_number} onChange={e => setGoalieForm(p => ({ ...p, goalie_in_number: e.target.value }))} /></MField>
          </Row2>
          <Row2>
            <MField label="Time (mm:ss)"><input style={inputStyle} placeholder="e.g. 10:00" value={goalieForm.time_in_period} onChange={e => setGoalieForm(p => ({ ...p, time_in_period: e.target.value }))} /></MField>
            <MField label="Period">
              <select style={selectStyle} value={goalieForm.period} onChange={e => setGoalieForm(p => ({ ...p, period: parseInt(e.target.value) }))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n === 4 ? 'OT' : n === 5 ? 'SO' : n === 1 ? '1st' : n === 2 ? '2nd' : '3rd'}</option>)}
              </select>
            </MField>
          </Row2>
        </Modal>
      )}

    </div>
  );
}
