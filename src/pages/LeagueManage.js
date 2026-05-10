import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DateTimePicker from '../components/DateTimePicker';
import { getLeague, getLeagueTeams, getLeagueGames, createLeague, updateLeague, addLeagueTeam, removeLeagueTeam, addLeagueGame, linkLeagueTeam } from '../lib/leagues';
import { supabase } from '../lib/supabase';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };
const inputStyle = { width:'100%', background:'#07111F', border:`0.5px solid ${C.border}`, borderRadius:8, padding:'10px 12px', color:C.ice, fontFamily:'Barlow, sans-serif', fontSize:14, outline:'none' };
const LOGO_COLORS = ['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9','#EC4899','#0B1F3A'];
const DEFAULT_TEAM_COLOR = '#2E5B8C';

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Row2({ children }) { return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>; }
function Card({ children }) { return <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>{children}</div>; }
function SecLabel({ children }) { return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{children}</div>; }

function Btn({ onClick, children, disabled, variant = 'primary' }) {
  const bg = variant === 'primary' ? C.red : 'rgba(46,91,140,0.25)';
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: bg, color: C.ice, border: 'none', borderRadius: 999, padding: '10px 18px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, transition: 'all 0.15s' }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}}
      onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.color = C.ice; }}>
      {children}
    </button>
  );
}

// ── CREATE ────────────────────────────────────────────────────
function CreateLeague({ navigate }) {
  const [form, setForm] = useState({ name: '', division: '', level: '', location: '', season: '', logo_color: '#2E5B8C', logo_initials: '', settings: { points_win: 2, points_tie: 1, points_loss: 0 } });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const initials = form.logo_initials || form.name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();

  const handleCreate = async () => {
    if (!form.name.trim()) { setError('League name is required'); return; }
    setSaving(true); setError(null);
    try {
      const league = await createLeague(form);
      navigate('/league/' + league.id + '/manage');
    } catch(e) { setError(e.message); setSaving(false); }
  };

  return (
    <div style={{ background: C.dark, minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: C.ice, maxWidth: 520, margin: '0 auto' }}>
      <button onClick={() => navigate('/leagues')} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.5)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginBottom: 16 }}>← Leagues</button>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, marginBottom: 4 }}>Create League</div>
      <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Season-long competition · Real-time standings</div>
      {error && <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: C.red }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: form.logo_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, color: '#fff' }}>{initials || '?'}</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Logo Color</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LOGO_COLORS.map(col => <div key={col} onClick={() => set('logo_color', col)} style={{ width: 24, height: 24, borderRadius: '50%', background: col, cursor: 'pointer', border: form.logo_color === col ? '2px solid #fff' : '2px solid transparent' }} />)}
          </div>
        </div>
      </div>

      <Card>
        <Field label="League Name *"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Chicago Hockey League" /></Field>
        <Field label="Logo Initials"><input style={inputStyle} value={form.logo_initials} onChange={e => set('logo_initials', e.target.value.toUpperCase().slice(0, 3))} placeholder="Auto from name" maxLength={3} /></Field>
        <Row2>
          <Field label="Division"><input style={inputStyle} value={form.division} onChange={e => set('division', e.target.value)} placeholder="e.g. 14U AA" /></Field>
          <Field label="Level"><input style={inputStyle} value={form.level} onChange={e => set('level', e.target.value)} placeholder="e.g. AAA, Rec" /></Field>
        </Row2>
        <Row2>
          <Field label="Location"><input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Chicago, IL" /></Field>
          <Field label="Season"><input style={inputStyle} value={form.season} onChange={e => set('season', e.target.value)} placeholder="e.g. Fall 2026" /></Field>
        </Row2>
      </Card>

      <SecLabel>Point System</SecLabel>
      <Card>
        <Row2>
          <Field label="Win"><select style={inputStyle} value={form.settings.points_win} onChange={e => set('settings', {...form.settings, points_win: parseInt(e.target.value)})}>{[0,1,2,3].map(n => <option key={n} value={n}>{n} pts</option>)}</select></Field>
          <Field label="Tie"><select style={inputStyle} value={form.settings.points_tie} onChange={e => set('settings', {...form.settings, points_tie: parseInt(e.target.value)})}>{[0,1,2].map(n => <option key={n} value={n}>{n} pt{n!==1?'s':''}</option>)}</select></Field>
        </Row2>
        <Field label="Loss"><select style={inputStyle} value={form.settings.points_loss} onChange={e => set('settings', {...form.settings, points_loss: parseInt(e.target.value)})}>{[0,1].map(n => <option key={n} value={n}>{n} pts</option>)}</select></Field>
      </Card>

      <button onClick={handleCreate} disabled={saving}
        style={{ width: '100%', padding: 14, background: C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', opacity: saving ? 0.7 : 1, transition: 'all 0.15s' }}
        onMouseEnter={e => { if (!saving) { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}}
        onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
        {saving ? 'Creating...' : '🏆 Create League'}
      </button>
    </div>
  );
}

// ── MANAGE ────────────────────────────────────────────────────
function ManageLeague({ id, navigate }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Teams');
  const [error, setError] = useState(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [gameForm, setGameForm] = useState({ home_team_id: '', away_team_id: '', location: '', start_time: '' });
  const [linkingTeam, setLinkingTeam] = useState(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState([]);

  const load = useCallback(async () => {
    try {
      const [l, t, g] = await Promise.all([getLeague(id), getLeagueTeams(id), getLeagueGames(id)]);
      setLeague(l); setTeams(t); setGames(g);
      if (t.length >= 2) setGameForm(p => ({ ...p, home_team_id: t[0].id, away_team_id: t[1].id }));
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!teamSearch.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('teams').select('id, name, logo_color, logo_initials').ilike('name', `%${teamSearch}%`).limit(5);
      setSearchResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [teamSearch]);

  useEffect(() => {
    if (!linkSearch.trim()) { setLinkResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('teams').select('id, name, logo_color, logo_initials').ilike('name', `%${linkSearch}%`).limit(5);
      setLinkResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [linkSearch]);

  const handleAddLinkedTeam = async (team) => {
    try {
      await addLeagueTeam(id, { teamId: team.id, teamName: team.name, logoColor: team.logo_color, logoInitials: team.logo_initials });
      setTeamSearch(''); setSearchResults([]);
      await load();
    } catch(e) { setError(e.message); }
  };

  const handleAddUnlinkedTeam = async () => {
    if (!teamSearch.trim()) { setError('Enter a team name first'); return; }
    try {
      await addLeagueTeam(id, { teamName: teamSearch.trim(), logoColor: DEFAULT_TEAM_COLOR, logoInitials: teamSearch.trim().split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase() });
      setTeamSearch(''); setSearchResults([]);
      await load();
    } catch(e) { setError(e.message); }
  };



  const handleAddGame = async () => {
    if (!gameForm.home_team_id || !gameForm.away_team_id || !gameForm.start_time) { setError('Home team, away team, and time required'); return; }
    try {
      await addLeagueGame({ league_id: id, ...gameForm });
      setGameForm(p => ({ ...p, location: '', start_time: '' }));
      await load();
    } catch(e) { setError(e.message); }
  };

  const MANAGE_TABS = ['Teams', 'Schedule', 'Settings'];

  if (loading) return <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Loading...</div>;

  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>
      <div style={{ background: C.navy, padding: '14px 16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => navigate('/league/' + id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← {league?.name}</button>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>MANAGE LEAGUE</div>
        <div style={{ width: 80 }} />
      </div>

      <div style={{ display: 'flex', background: C.navy, borderBottom: '2px solid rgba(46,91,140,0.3)' }}>
        {MANAGE_TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ fontSize: 13, fontWeight: 700, padding: '10px 16px', color: '#FFFFFF', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '3px solid #D72638' : '3px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', opacity: activeTab === tab ? 1 : 0.5, transition: 'opacity 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.opacity = activeTab === tab ? '1' : '0.5'; }}>
            {tab}
          </button>
        ))}
      </div>

      <div style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
        {error && <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>}

        {/* TEAMS */}
        {/* TEAMS */}
        {activeTab === 'Teams' && (
          <>
            <SecLabel>Add Team</SecLabel>
            <Card>
              <Field label="Team Name *">
                <input style={inputStyle} value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                  placeholder="Type a team name..." />
              </Field>
              {searchResults.length > 0 && (
                <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(244,247,250,0.35)', padding: '6px 12px', letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(46,91,140,0.15)' }}>Rinkd Teams — click to add & link</div>
                  {searchResults.map(t => (
                    <div key={t.id} onClick={() => handleAddLinkedTeam(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(46,91,140,0.2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ width: 28, height: 28, borderRadius: 5, background: t.logo_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 11, color: '#fff' }}>
                        {t.logo_initials || t.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ice }}>{t.name}</span>
                      <span style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)' }}>+ Link</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: '0.5px', background: 'rgba(244,247,250,0.1)' }} />
                <span style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)' }}>or add without a Rinkd page</span>
                <div style={{ flex: 1, height: '0.5px', background: 'rgba(244,247,250,0.1)' }} />
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={handleAddUnlinkedTeam}
                  style={{ background: 'rgba(46,91,140,0.2)', border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '9px 16px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.2)'; e.currentTarget.style.color = C.ice; }}>
                  + Add "{teamSearch || 'Team'}"
                </button>
              </div>
            </Card>

            <SecLabel>League Teams ({teams.length})</SecLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
              {teams.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No teams yet — add above</div>}
              {teams.map(lt => {
                const name = lt.team?.name || lt.team_name || 'Unknown';
                const color = lt.team?.logo_color || lt.logo_color || C.blue;
                const initials = lt.team?.logo_initials || lt.logo_initials || name.slice(0, 2).toUpperCase();
                const isLinked = !!lt.team_id;
                return (
                  <div key={lt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 6, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 12, color: '#fff', flexShrink: 0 }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{name}</div>
                      {!isLinked && <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700, marginTop: 2 }}>No Rinkd page · <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setLinkingTeam(lt)}>Link team</span></div>}
                      {isLinked && <div style={{ fontSize: 10, color: '#22C55E', marginTop: 2 }}>✓ Linked to Rinkd</div>}
                    </div>
                    <button onClick={() => removeLeagueTeam(lt.id).then(load)}
                      style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.2)', cursor: 'pointer', fontSize: 16 }}
                      onMouseEnter={e => e.currentTarget.style.color = C.red}
                      onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.2)'}>✕</button>
                  </div>
                );
              })}
            </div>

            {/* Link team modal */}
            {linkingTeam && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <div style={{ background: C.navy, borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 480, borderTop: `0.5px solid ${C.border}` }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: C.ice, marginBottom: 4 }}>Link to Rinkd Team</div>
                  <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.4)', marginBottom: 14 }}>Search for the team's Rinkd page to link stats and roster</div>
                  <input style={inputStyle} value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Search team name..." autoFocus />
                  {linkResults.length > 0 && (
                    <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
                      {linkResults.map(t => (
                        <div key={t.id} onClick={async () => { await linkLeagueTeam(linkingTeam.id, t.id); setLinkingTeam(null); setLinkSearch(''); setLinkResults([]); await load(); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(46,91,140,0.2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ width: 28, height: 28, borderRadius: 5, background: t.logo_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 11, color: '#fff' }}>
                            {t.logo_initials || t.name.slice(0, 2).toUpperCase()}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{t.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button onClick={() => { setLinkingTeam(null); setLinkSearch(''); setLinkResults([]); }}
                      style={{ flex: 1, padding: 12, background: 'rgba(244,247,250,0.08)', border: 'none', borderRadius: 999, color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'Schedule' && (
          <>
            <SecLabel>Add Game</SecLabel>
            <Card>
              <Field label="Home Team">
                <select style={inputStyle} value={gameForm.home_team_id} onChange={e => setGameForm(p => ({ ...p, home_team_id: e.target.value }))}>
                  <option value="">Select home team</option>
                  {teams.map(lt => <option key={lt.id} value={lt.id}>{lt.team?.name}</option>)}
                </select>
              </Field>
              <Field label="Away Team">
                <select style={inputStyle} value={gameForm.away_team_id} onChange={e => setGameForm(p => ({ ...p, away_team_id: e.target.value }))}>
                  <option value="">Select away team</option>
                  {teams.map(lt => <option key={lt.id} value={lt.id}>{lt.team?.name}</option>)}
                </select>
              </Field>
              <Field label="Location"><input style={inputStyle} value={gameForm.location} onChange={e => setGameForm(p => ({ ...p, location: e.target.value }))} placeholder="Rink / arena name" /></Field>
              <Field label="Date & Time"><DateTimePicker value={gameForm.start_time} onChange={v => setGameForm(p => ({ ...p, start_time: v }))} placeholder="Select date & time" /></Field>
              <Btn onClick={handleAddGame}>+ Add Game</Btn>
            </Card>

            <SecLabel>Schedule ({games.length} games)</SecLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {games.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No games yet</div>}
              {games.map(g => {
                const home = g.home_lt?.team;
                const away = g.away_lt?.team;
                const date = new Date(g.start_time);
                return (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', width: 44, flexShrink: 0 }}>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{home?.name} vs. {away?.name}</div>
                      {g.location && <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 1 }}>{g.location}</div>}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)' }}>{date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* SETTINGS */}
        {activeTab === 'Settings' && league && (
          <LeagueSettings league={league} onSave={async (updates) => { await updateLeague(id, updates); await load(); }} />
        )}
      </div>
    </div>
  );
}

function LeagueSettings({ league, onSave }) {
  const [form, setForm] = useState({ name: league.name, division: league.division || '', level: league.level || '', location: league.location || '', season: league.season || '', logo_color: league.logo_color || C.blue, logo_initials: league.logo_initials || '', status: league.status, settings: league.settings || {} });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <>
      <SecLabel>League Settings</SecLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 10, background: form.logo_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: '#fff' }}>
          {form.logo_initials || form.name.split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase()}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LOGO_COLORS.map(col => <div key={col} onClick={() => set('logo_color', col)} style={{ width: 22, height: 22, borderRadius: '50%', background: col, cursor: 'pointer', border: form.logo_color === col ? '2px solid #fff' : '2px solid transparent' }} />)}
        </div>
      </div>
      <Card>
        <Field label="League Name"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
        <Row2>
          <Field label="Division"><input style={inputStyle} value={form.division} onChange={e => set('division', e.target.value)} /></Field>
          <Field label="Season"><input style={inputStyle} value={form.season} onChange={e => set('season', e.target.value)} /></Field>
        </Row2>
        <Row2>
          <Field label="Location"><input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} /></Field>
          <Field label="Status">
            <select style={inputStyle} value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
            </select>
          </Field>
        </Row2>
      </Card>
      <button onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} disabled={saving}
        style={{ width: '100%', padding: 13, background: C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', opacity: saving ? 0.7 : 1, transition: 'all 0.15s' }}
        onMouseEnter={e => { if (!saving) { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}}
        onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </>
  );
}

export default function LeagueManage({ profile }) {
  const { id } = useParams();
  const navigate = useNavigate();
  if (!id || id === 'create') return <Layout profile={profile}><CreateLeague navigate={navigate} /></Layout>;
  return <Layout profile={profile}><ManageLeague id={id} navigate={navigate} /></Layout>;
}
