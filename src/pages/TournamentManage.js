import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getTournament } from '../lib/tournaments';
import {
  listTeams, createTeam, updateTeam, deleteTeam,
  listGames, updateGame, deleteGame,
  generatePoolSchedule,
  loadPoolQualifiers, createBracketGame,
  updateTournament,
} from '../lib/tournamentManage';
import { listRinks } from '../lib/rinks';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  green: '#22C55E', amber: '#F59E0B',
};

const TABS = ['Teams', 'Schedule', 'Bracket', 'Settings'];

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: C.navy, border: `1px solid ${C.border}`,
  color: C.ice, padding: '9px 11px', borderRadius: 8,
  fontSize: 13, fontFamily: 'Barlow, sans-serif', outline: 'none',
};
const labelStyle = { fontSize: 10, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4, display: 'block' };
const btnPrimary = { background: C.red, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 999, cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' };
const btnGhost = { background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif' };

function fmtDateTime(iso) {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TournamentManagePage({ currentUser, profile }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [rinks, setRinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Teams');
  const [error, setError] = useState(null);

  const isDirector = tournament && currentUser && tournament.director_id === currentUser.id;

  const load = async () => {
    try {
      const t = await getTournament(id);
      setTournament(t);
      const [{ data: ts }, { data: gs }, { data: rk }] = await Promise.all([
        listTeams(id),
        listGames(id),
        listRinks().catch(() => ({ data: [] })),
      ]);
      setTeams(ts); setGames(gs); setRinks(rk || []);
    } catch (e) {
      setError(e.message || 'Failed to load tournament');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>Loading…</div>
    </Layout>
  );
  if (error || !tournament) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12 }}>
        <div>{error || 'Tournament not found'}</div>
        <button onClick={() => navigate('/tournaments')} style={btnPrimary}>Back</button>
      </div>
    </Layout>
  );
  if (!isDirector) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div>Only the tournament director can manage this event.</div>
        <button onClick={() => navigate(`/tournament/${id}`)} style={btnPrimary}>View Tournament</button>
      </div>
    </Layout>
  );

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '20px 16px 80px' }}>
          {/* Header */}
          <button onClick={() => navigate(`/tournament/${id}`)} style={{ background: 'transparent', color: C.steel, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>← {tournament.name}</button>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase' }}>
            Manage Tournament
          </div>
          <div style={{ fontSize: 13, color: C.steel, marginBottom: 18 }}>{tournament.name} · {tournament.division}</div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 18, overflowX: 'auto' }}>
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                style={{ background: 'transparent', color: tab === t ? C.ice : C.steel, border: 'none', padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 500, borderBottom: tab === t ? `3px solid ${C.red}` : '3px solid transparent', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap' }}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'Teams' && <TeamsTab tournamentId={id} teams={teams} reload={load} />}
          {tab === 'Schedule' && <ScheduleTab tournamentId={id} tournament={tournament} teams={teams} games={games} rinks={rinks} reload={load} />}
          {tab === 'Bracket' && <BracketTab tournamentId={id} tournament={tournament} teams={teams} games={games} rinks={rinks} reload={load} />}
          {tab === 'Settings' && <SettingsTab tournament={tournament} reload={load} />}
        </div>
      </div>
    </Layout>
  );
}

// ====================== TEAMS TAB ======================
function TeamsTab({ tournamentId, teams, reload }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const pools = useMemo(() => {
    const set = new Set(teams.map((t) => t.pool).filter(Boolean));
    return Array.from(set).sort();
  }, [teams]);

  const byPool = useMemo(() => {
    const m = {};
    for (const t of teams) {
      const k = t.pool || '— No pool —';
      if (!m[k]) m[k] = [];
      m[k].push(t);
    }
    return m;
  }, [teams]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.steel }}>
          {teams.length} team{teams.length === 1 ? '' : 's'} · {pools.length} pool{pools.length === 1 ? '' : 's'}
        </div>
        <button onClick={() => setAdding(true)} style={btnPrimary}>+ Add Team</button>
      </div>

      {adding && <TeamForm tournamentId={tournamentId} pools={pools} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}

      {teams.length === 0 && !adding && (
        <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏒</div>
          No teams yet. Add the first one above.
        </div>
      )}

      {Object.entries(byPool).map(([pool, list]) => (
        <div key={pool} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>{pool}</div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {list.map((t, i) => editingId === t.id ? (
              <div key={t.id} style={{ padding: 12, borderTop: i ? `1px solid rgba(46,91,140,0.25)` : 'none' }}>
                <TeamForm tournamentId={tournamentId} pools={pools} team={t} onDone={() => { setEditingId(null); reload(); }} onCancel={() => setEditingId(null)} />
              </div>
            ) : (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? `1px solid rgba(46,91,140,0.25)` : 'none', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: t.logo_url ? `url(${t.logo_url}) center/cover` : C.navy, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff' }}>
                  {!t.logo_url && (t.team_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{t.team_name}{t.seed ? ` · #${t.seed}` : ''}</div>
                  <div style={{ fontSize: 12, color: C.steel }}>{t.contact_email || '—'}</div>
                </div>
                <button onClick={() => setEditingId(t.id)} style={btnGhost}>Edit</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamForm({ tournamentId, team, pools, onDone, onCancel }) {
  const [teamName, setTeamName] = useState(team?.team_name || '');
  const [pool, setPool] = useState(team?.pool || (pools[0] || ''));
  const [seed, setSeed] = useState(team?.seed || '');
  const [contactEmail, setContactEmail] = useState(team?.contact_email || '');
  const [logoUrl, setLogoUrl] = useState(team?.logo_url || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!teamName.trim()) return alert('Team name is required');
    setBusy(true);
    const fields = { teamName, pool, seed, contactEmail, logoUrl };
    const res = team ? await updateTeam(team.id, fields) : await createTeam(tournamentId, fields);
    setBusy(false);
    if (res.error) return alert('Save failed: ' + res.error.message);
    onDone();
  };

  const remove = async () => {
    if (!team) return;
    if (!window.confirm(`Delete "${team.team_name}"? This cannot be undone.`)) return;
    const { error } = await deleteTeam(team.id);
    if (error) return alert('Delete failed: ' + error.message);
    onDone();
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Team Name</label>
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Beer Necessities" style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>Pool</label>
          <input value={pool} onChange={(e) => setPool(e.target.value)} placeholder="A / B / C…" style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>Seed</label>
          <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="1" style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>Contact Email</label>
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="captain@team.com" style={inputStyle}/>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Logo URL (optional)</label>
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" style={inputStyle}/>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>{team && <button onClick={remove} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Delete</button>}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? 'Saving…' : team ? 'Save' : 'Add Team'}</button>
        </div>
      </div>
    </div>
  );
}

// ====================== SCHEDULE TAB ======================
function ScheduleTab({ tournamentId, tournament, teams, games, rinks, reload }) {
  const [showGen, setShowGen] = useState(false);
  const [genStart, setGenStart] = useState('');
  const [genMinutes, setGenMinutes] = useState(60);
  const [genRinkId, setGenRinkId] = useState('');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const poolGames = games.filter((g) => (g.round || 'pool') === 'pool');

  const handleGenerate = async () => {
    if (!genStart) return alert('Pick a start time');
    setBusy(true);
    const { inserted, error } = await generatePoolSchedule(tournamentId, {
      startDate: genStart,
      gameMinutes: parseInt(genMinutes, 10) || 60,
      rinkId: genRinkId || null,
      replaceExisting: replace,
    });
    setBusy(false);
    if (error) return alert('Generate failed: ' + error.message);
    alert(`Generated ${inserted} pool games.`);
    setShowGen(false); reload();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.steel }}>{poolGames.length} pool game{poolGames.length === 1 ? '' : 's'}</div>
        <button onClick={() => setShowGen((v) => !v)} style={btnPrimary}>⚡ Generate Pool Schedule</button>
      </div>

      {showGen && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, marginBottom: 10, textTransform: 'uppercase' }}>
            Round-Robin Generator
          </div>
          <div style={{ fontSize: 12, color: C.steel, marginBottom: 12, lineHeight: 1.5 }}>
            Every team plays every other team within its pool exactly once. Games are stacked back-to-back at the interval below.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>First Game</label>
              <input type="datetime-local" value={genStart} onChange={(e) => setGenStart(e.target.value)} style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Game length (min)</label>
              <input type="number" value={genMinutes} onChange={(e) => setGenMinutes(e.target.value)} style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Default Rink</label>
              <select value={genRinkId} onChange={(e) => setGenRinkId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {rinks.map((r) => <option key={r.id} value={r.id}>{[r.sub_rink, r.name].filter(Boolean).join(' · ')}</option>)}
              </select>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ice, marginBottom: 12 }}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace existing pool games (keeps bracket games intact)
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowGen(false)} style={btnGhost}>Cancel</button>
            <button onClick={handleGenerate} disabled={busy} style={btnPrimary}>{busy ? 'Generating…' : 'Generate'}</button>
          </div>
        </div>
      )}

      {poolGames.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
          No pool games yet. Generate a round-robin or add games manually.
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {poolGames.map((g, i) => editingId === g.id ? (
            <GameEditRow key={g.id} game={g} rinks={rinks} teams={teams}
              onDone={() => { setEditingId(null); reload(); }} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? `1px solid rgba(46,91,140,0.25)` : 'none', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                  {g.home_team?.team_name || '?'} vs. {g.away_team?.team_name || '?'}
                  {g.home_team?.pool && <span style={{ marginLeft: 6, fontSize: 10, color: C.red, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Pool {g.home_team.pool}</span>}
                </div>
                <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>
                  {fmtDateTime(g.start_time)}
                  {g.rink ? ` · ${[g.rink.sub_rink, g.rink.name].filter(Boolean).join(' · ')}` : ''}
                </div>
              </div>
              <button onClick={() => setEditingId(g.id)} style={btnGhost}>Edit</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GameEditRow({ game, rinks, teams, onDone, onCancel }) {
  const [startTime, setStartTime] = useState(toLocalInput(game.start_time));
  const [rinkId, setRinkId] = useState(game.rink_id || '');
  const [homeId, setHomeId] = useState(game.home_team_id || '');
  const [awayId, setAwayId] = useState(game.away_team_id || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const { error } = await updateGame(game.id, {
      startTime: startTime ? new Date(startTime).toISOString() : null,
      rinkId, homeTeamId: homeId, awayTeamId: awayId,
    });
    setBusy(false);
    if (error) return alert('Save failed: ' + error.message);
    onDone();
  };
  const remove = async () => {
    if (!window.confirm('Delete this game?')) return;
    const { error } = await deleteGame(game.id);
    if (error) return alert('Delete failed: ' + error.message);
    onDone();
  };

  return (
    <div style={{ padding: 12, borderTop: '1px solid rgba(46,91,140,0.25)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={labelStyle}>Start</label>
          <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>Rink</label>
          <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {rinks.map((r) => <option key={r.id} value={r.id}>{[r.sub_rink, r.name].filter(Boolean).join(' · ')}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Home</label>
          <select value={homeId} onChange={(e) => setHomeId(e.target.value)} style={inputStyle}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Away</label>
          <select value={awayId} onChange={(e) => setAwayId(e.target.value)} style={inputStyle}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={remove} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Delete</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ====================== BRACKET TAB ======================
function BracketTab({ tournamentId, tournament, teams, games, rinks, reload }) {
  const advPerPool = tournament?.settings?.advancement_per_pool ?? 2;
  const bracketGames = games.filter((g) => (g.round || 'pool') !== 'pool');
  const [qualifiers, setQualifiers] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [round, setRound] = useState('quarterfinal');
  const [homeId, setHomeId] = useState('');
  const [awayId, setAwayId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [rinkId, setRinkId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const q = await loadPoolQualifiers(tournamentId, advPerPool);
      setQualifiers(q);
      setLoaded(true);
    })();
  }, [tournamentId, advPerPool, games.length]);

  const addBracketGame = async () => {
    if (!homeId || !awayId || homeId === awayId) return alert('Pick two different teams');
    if (!startTime) return alert('Pick a start time');
    setBusy(true);
    const { error } = await createBracketGame(tournamentId, {
      homeTeamId: homeId, awayTeamId: awayId, round,
      startTime: new Date(startTime).toISOString(),
      rinkId: rinkId || null,
    });
    setBusy(false);
    if (error) return alert('Failed: ' + error.message);
    setHomeId(''); setAwayId(''); setStartTime(''); setRinkId('');
    reload();
  };

  return (
    <div>
      {/* Qualifiers from pool play */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>
          Pool Qualifiers · Top {advPerPool} per pool
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '4px 0' }}>
          {!loaded ? (
            <div style={{ padding: 14, color: C.steel, fontSize: 13 }}>Loading standings…</div>
          ) : qualifiers.length === 0 ? (
            <div style={{ padding: 14, color: C.steel, fontSize: 13 }}>Bracket seeds lock in as pool games complete.</div>
          ) : qualifiers.map((q, i) => (
            <div key={q.team_id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none', gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: q.pool_rank === 1 ? C.red : C.blue, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{q.pool_rank}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{q.team_name}</div>
                <div style={{ fontSize: 11, color: C.steel }}>Pool {q.pool} · {q.wins}-{q.losses}-{q.ties} · {q.pts} pts</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add bracket game */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 18 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, marginBottom: 10, textTransform: 'uppercase' }}>
          Add Bracket Game
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Round</label>
            <select value={round} onChange={(e) => setRound(e.target.value)} style={inputStyle}>
              <option value="quarterfinal">Quarterfinal</option>
              <option value="semifinal">Semifinal</option>
              <option value="final">Final</option>
              <option value="consolation">Consolation</option>
              <option value="bronze">Bronze Medal</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Home</label>
            <select value={homeId} onChange={(e) => setHomeId(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}{t.pool ? ` (${t.pool})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Away</label>
            <select value={awayId} onChange={(e) => setAwayId(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}{t.pool ? ` (${t.pool})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Start</label>
            <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle}/>
          </div>
          <div>
            <label style={labelStyle}>Rink</label>
            <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {rinks.map((r) => <option key={r.id} value={r.id}>{[r.sub_rink, r.name].filter(Boolean).join(' · ')}</option>)}
            </select>
          </div>
        </div>
        <button onClick={addBracketGame} disabled={busy} style={btnPrimary}>
          {busy ? 'Adding…' : '+ Add Bracket Game'}
        </button>
      </div>

      {/* Existing bracket games */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>
        Bracket Games ({bracketGames.length})
      </div>
      {bracketGames.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: 24, fontSize: 13 }}>No bracket games yet.</div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {bracketGames.map((g, i) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.red, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>{g.round}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{g.home_team?.team_name || '?'} vs. {g.away_team?.team_name || '?'}</div>
                <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>{fmtDateTime(g.start_time)}</div>
              </div>
              <button onClick={async () => {
                if (!window.confirm('Delete this bracket game?')) return;
                const { error } = await deleteGame(g.id);
                if (error) return alert('Delete failed: ' + error.message);
                reload();
              }} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ====================== SETTINGS TAB ======================
function SettingsTab({ tournament, reload }) {
  const [name, setName] = useState(tournament.name || '');
  const [division, setDivision] = useState(tournament.division || '');
  const [startDate, setStartDate] = useState(tournament.start_date || '');
  const [endDate, setEndDate] = useState(tournament.end_date || '');
  const [status, setStatus] = useState(tournament.status || 'upcoming');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const { error } = await updateTournament(tournament.id, { name, division, startDate, endDate, status });
    setBusy(false);
    if (error) return alert('Save failed: ' + error.message);
    reload();
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>Division</label>
          <input value={division} onChange={(e) => setDivision(e.target.value)} style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="complete">Complete</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Start Date</label>
          <input type="date" value={startDate || ''} onChange={(e) => setStartDate(e.target.value)} style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>End Date</label>
          <input type="date" value={endDate || ''} onChange={(e) => setEndDate(e.target.value)} style={inputStyle}/>
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? 'Saving…' : 'Save Settings'}</button>
      </div>
    </div>
  );
}
