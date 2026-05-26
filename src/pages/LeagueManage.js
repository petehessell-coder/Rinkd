import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DateTimePicker from '../components/DateTimePicker';
import { getLeague, getLeagueTeams, getLeagueGames, getLeagueStandings, updateLeague, addLeagueTeam, removeLeagueTeam, addLeagueGame, linkLeagueTeam, getUserLeagueRole } from '../lib/leagues';
import { getLeagueRegistrations, updateRegistrationStatus, approveRegistration } from '../lib/registrations';
import { generatePlayoffRoundOne, generatePlayoffNextRound, SUPPORTED_BRACKET_SIZES } from '../lib/leaguePlayoffGenerator';
import { listRinks } from '../lib/rinks';
import { supabase } from '../lib/supabase';
import { sendLeagueInvite } from '../lib/invites';
import ScheduleBuilderModal from '../components/ScheduleBuilderModal';
import { rescheduleGame, deleteLeagueGame, bulkInsertLeagueGames } from '../lib/scheduleBuilder';
import { generateLeagueSchedule } from '../lib/leagueScheduleGenerator';
import { uploadMedia } from '../lib/posts';
import { classifyImage } from '../lib/imageModeration';
import { assignTeamManagerByInput } from '../lib/leagueTeamManagers';

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

// Format a Date for <input type="datetime-local"> (local time, no tz suffix)
function toDateTimeLocal(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Derive team_id → rink_id from existing games. Used by Schedule Builder to
// default the home team's rink on newly-generated games.
function rinkByTeamMap(games) {
  const map = {};
  for (const g of games || []) {
    if (g.home_team_id && g.rink_id && !map[g.home_team_id]) {
      map[g.home_team_id] = g.rink_id;
    }
  }
  return map;
}
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

// ── MANAGE ────────────────────────────────────────────────────
// (Inline CreateLeague stripped May 19, 2026 — Phase 1 of the league-parity
//  build ships a real 4-step wizard at /league/create → src/pages/LeagueCreate.js.
//  LeagueManage now only handles /league/:id/manage.)
function ManageLeague({ id, navigate }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [rinks, setRinks] = useState([]);
  // Standings drives the Playoffs tab — used to seed round-1 bracket games.
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Teams');
  const [error, setError] = useState(null);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [registrations, setRegistrations] = useState([]);
  const [showScheduleBuilder, setShowScheduleBuilder] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [gameForm, setGameForm] = useState({ home_team_id: '', away_team_id: '', rink_id: '', location: '', start_time: '', live_barn_venue_id: '', youtube_url: '' });
  const [unlinkedEmail, setUnlinkedEmail] = useState('');
  const [linkingTeam, setLinkingTeam] = useState(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState([]);
  // Per-team-row "assign manager" inline form state. One row open at a time;
  // assignInput is the handle/email being typed; assignBusy guards a
  // double-click during the RPC roundtrip.
  const [assigningTeamId, setAssigningTeamId] = useState(null);
  const [assignInput, setAssignInput] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignFlash, setAssignFlash] = useState(null); // { kind: 'ok'|'err', text }

  const handleAssignManager = async (lt) => {
    if (!lt?.team_id) {
      setAssignFlash({ kind: 'err', text: 'Link the team to Rinkd first (see "Link team" above).' });
      return;
    }
    setAssignBusy(true);
    setAssignFlash(null);
    const result = await assignTeamManagerByInput({
      leagueId: id,
      teamId: lt.team_id,
      input: assignInput,
      leagueName: league?.name,
      teamName: lt.team?.name || lt.team_name,
      invitedBy: league?.commissioner?.name || null,
    });
    setAssignBusy(false);
    if (result.status === 'assigned') {
      setAssignFlash({ kind: 'ok', text: `Manager set: ${result.profile.name || '@' + result.profile.handle}` });
      setAssignInput('');
      setAssigningTeamId(null);
      await load();
    } else if (result.status === 'invited') {
      // No Rinkd account yet — magic-link email sent. Don't refresh
      // (manager state hasn't changed yet); show the success flash and
      // keep the row expanded so the commissioner sees confirmation.
      setAssignFlash({ kind: 'ok', text: `Invite emailed to ${result.email}. They'll be set up as manager once they sign up + click the link.` });
      setAssignInput('');
    } else if (result.status === 'needs_email') {
      setAssignFlash({ kind: 'err', text: `No Rinkd account for "@${result.handle}". Enter their email instead and we'll send an invite.` });
    } else {
      setAssignFlash({ kind: 'err', text: result.message || 'Could not assign manager.' });
    }
  };

  const load = useCallback(async () => {
    try {
      // Fetch rinks alongside league/teams/games so the single-game form can
      // attach a real rink_id (and the rink shows up on the game cards via the
      // rinks join in getLeagueGames). listRinks() is small and cheap.
      const [l, t, g, r, s, role, regs] = await Promise.all([
        getLeague(id), getLeagueTeams(id), getLeagueGames(id),
        listRinks().catch(() => []),
        getLeagueStandings(id).catch(() => []),
        getUserLeagueRole(id).catch(() => null),
        getLeagueRegistrations(id).catch(() => []),
      ]);
      setLeague(l); setTeams(t); setGames(g); setRinks(r || []); setStandings(s || []);
      setIsCommissioner(role === 'commissioner');
      setRegistrations(regs || []);
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
      // Send league invite to team manager
      const { data: mgr } = await supabase
        .from('profiles')
        .select('email, name')
        .eq('id', team.manager_id || '')
        .maybeSingle();
      if (mgr?.email) {
        await sendLeagueInvite({ to_email: mgr.email, to_name: mgr.name, league_name: league?.name, league_id: id, division: league?.division, season: league?.season });
      }
    } catch(e) { setError(e.message); }
  };

  const handleAddUnlinkedTeam = async () => {
    if (!teamSearch.trim()) { setError('Enter a team name first'); return; }
    try {
      // Use the create_league_team RPC instead of bare addLeagueTeam so the
      // new team gets a real public.teams row (manager_id NULL = unclaimed)
      // alongside the public.league_teams link. Without this, league-added
      // teams never surfaced on /teams and couldn't have a manager / roster.
      // The RPC is SECURITY DEFINER + gated on is_league_commissioner.
      const teamName = teamSearch.trim();
      const initials = teamName.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();
      const { error: rpcErr } = await supabase.rpc('create_league_team', {
        p_league_id: id,
        p_team_name: teamName,
        p_logo_color: DEFAULT_TEAM_COLOR,
        p_logo_initials: initials,
        p_division: '',
      });
      if (rpcErr) throw rpcErr;
      if (unlinkedEmail.trim()) {
        await sendLeagueInvite({ to_email: unlinkedEmail.trim(), league_name: league?.name, league_id: id, division: league?.division, season: league?.season });
      }
      setTeamSearch(''); setUnlinkedEmail(''); setSearchResults([]);
      await load();
    } catch(e) { setError(e.message); }
  };



  const handleAddGame = async () => {
    if (!gameForm.home_team_id || !gameForm.away_team_id || !gameForm.start_time) { setError('Home team, away team, and time required'); return; }
    try {
      // Pass rink_id when one is picked. If the rink has a LiveBarn venue ID,
      // inherit it so the schedule cards show the Watch-on-LiveBarn pill
      // without the director having to type the venue ID twice. Manual
      // venue_id input still wins if filled in.
      const rink = rinks.find(r => r.id === gameForm.rink_id);
      const live_barn_venue_id = (gameForm.live_barn_venue_id || '').trim() || rink?.live_barn_venue_id || null;
      // Per-game stream URL override; falls back to the rink default if
      // present. Generic enough for YouTube / Twitch / Facebook etc. —
      // detection happens at render time via lib/streamUrl.
      const youtube_url = (gameForm.youtube_url || '').trim() || rink?.youtube_url || null;
      await addLeagueGame({
        league_id: id,
        home_team_id: gameForm.home_team_id,
        away_team_id: gameForm.away_team_id,
        rink_id: gameForm.rink_id || null,
        location: gameForm.location || null,
        start_time: gameForm.start_time,
        live_barn_venue_id,
        youtube_url,
      });
      setGameForm(p => ({ ...p, rink_id: '', location: '', start_time: '', live_barn_venue_id: '', youtube_url: '' }));
      await load();
    } catch(e) { setError(e.message); }
  };

  const MANAGE_TABS = ['Teams', 'Schedule', 'Playoffs', ...(isCommissioner ? ['Registrations'] : []), 'Settings'];

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
        {league && league.is_activated === false && (
          <div style={{ background: 'rgba(245,158,11,0.12)', border: '0.5px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 18 }}>🔒</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>Activation pending</div>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.65)', marginTop: 4, lineHeight: 1.5 }}>
                You can set up teams, schedule, and bracket now. Live scoring + auto-recap pushes are locked until Rinkd activates this league. Email <a href="mailto:hello@rinkd.app?subject=League Activation Request" style={{ color: '#F59E0B' }}>hello@rinkd.app</a> to activate, or see <a href="/pricing" style={{ color: '#F59E0B' }}>pricing</a>.
              </div>
            </div>
          </div>
        )}
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
              <input style={{width:'100%',background:'#07111F',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:8,padding:'10px 12px',color:'#F4F7FA',fontFamily:'Barlow,sans-serif',fontSize:14,outline:'none',marginBottom:8}} type='email' value={unlinkedEmail} onChange={e => setUnlinkedEmail(e.target.value)} placeholder='Manager email (optional — sends league invite)' />
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
                const manager = lt.team?.manager;
                const isClaimed = !!lt.team?.manager_id;
                const isAssigning = assigningTeamId === lt.id;
                return (
                  <div key={lt.id} style={{ borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 12, color: '#fff', flexShrink: 0 }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{name}</div>
                        {!isLinked && <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700, marginTop: 2 }}>No Rinkd page · <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setLinkingTeam(lt)}>Link team</span></div>}
                        {isLinked && !isClaimed && <div style={{ fontSize: 10, color: '#F59E0B', marginTop: 2, fontWeight: 700 }}>Unclaimed — no manager assigned</div>}
                        {isLinked && isClaimed && (
                          <div style={{ fontSize: 10, color: '#22C55E', marginTop: 2 }}>
                            ✓ Manager: {manager ? (manager.name || ('@' + manager.handle)) : '<assigned>'}
                          </div>
                        )}
                      </div>
                      {isLinked && (
                        <button onClick={() => { setAssigningTeamId(isAssigning ? null : lt.id); setAssignInput(''); setAssignFlash(null); }}
                          style={{ background: 'rgba(46,91,140,0.25)', border: `0.5px solid ${C.border}`, color: C.steel, borderRadius: 999, padding: '5px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap' }}
                          title={isClaimed ? 'Add a co-manager' : 'Assign a manager to this team'}>
                          {isAssigning ? 'Cancel' : (isClaimed ? '+ Co-manager' : '+ Manager')}
                        </button>
                      )}
                      <button onClick={() => removeLeagueTeam(lt.id).then(load)}
                        style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.2)', cursor: 'pointer', fontSize: 16 }}
                        onMouseEnter={e => e.currentTarget.style.color = C.red}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.2)'}>✕</button>
                    </div>
                    {isAssigning && (
                      <div style={{ padding: '0 14px 12px 56px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input style={{ ...inputStyle, flex: 1 }}
                            placeholder="@handle or email"
                            value={assignInput}
                            onChange={e => setAssignInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !assignBusy && handleAssignManager(lt)}
                            autoFocus />
                          <button onClick={() => handleAssignManager(lt)} disabled={assignBusy || !assignInput.trim()}
                            style={{ background: assignBusy || !assignInput.trim() ? C.border : C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '0 14px', fontSize: 12, fontWeight: 700, cursor: assignBusy || !assignInput.trim() ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>
                            {assignBusy ? '…' : 'Assign'}
                          </button>
                        </div>
                        {assignFlash && (
                          <div style={{ fontSize: 11, color: assignFlash.kind === 'ok' ? '#22C55E' : '#E26B6B' }}>
                            {assignFlash.text}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.4)' }}>
                          They need a Rinkd account first. {isClaimed
                            ? "Adding a co-manager doesn't change the founding manager — both can manage the roster."
                            : 'They become the founding manager of this team.'}
                        </div>
                      </div>
                    )}
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
            <SecLabel>⚡ Smart Generator — Target Games Per Team</SecLabel>
            <Card>
              <SmartScheduleGenerator
                leagueId={id}
                teams={teams}
                rinks={rinks}
                onPublished={async () => { await load(); }}
              />
            </Card>

            <SecLabel>Advanced — Single/Double Round-Robin Wizard</SecLabel>
            <Card>
              <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 12 }}>
                Need finer control? The advanced builder does single/double
                round-robin with explicit rink-by-team mapping + double-booking
                conflict detection.
              </div>
              <button onClick={() => setShowScheduleBuilder(true)}
                disabled={!teams || teams.length < 2}
                style={{ padding: '11px 18px', borderRadius: 999, background: teams.length < 2 ? C.border : C.blue, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: teams.length < 2 ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📅</span>
                <span>Open advanced builder</span>
              </button>
            </Card>

            <SecLabel>Add Single Game</SecLabel>
            <Card>
              <Field label="Home Team">
                <select style={inputStyle} value={gameForm.home_team_id} onChange={e => setGameForm(p => ({ ...p, home_team_id: e.target.value }))}>
                  <option value="">Select home team</option>
                  {teams.map(lt => <option key={lt.id} value={lt.id}>{lt.team?.name || lt.team_name}</option>)}
                </select>
              </Field>
              <Field label="Away Team">
                <select style={inputStyle} value={gameForm.away_team_id} onChange={e => setGameForm(p => ({ ...p, away_team_id: e.target.value }))}>
                  <option value="">Select away team</option>
                  {teams.map(lt => <option key={lt.id} value={lt.id}>{lt.team?.name || lt.team_name}</option>)}
                </select>
              </Field>
              <Field label="Rink">
                <select style={inputStyle} value={gameForm.rink_id} onChange={e => setGameForm(p => ({ ...p, rink_id: e.target.value }))}>
                  <option value="">— Pick a rink (recommended) —</option>
                  {rinks.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.sub_rink ? ` · ${r.sub_rink}` : ''}
                    </option>
                  ))}
                </select>
                {rinks.length === 0 && (
                  <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 4 }}>
                    No rinks yet — add them in <strong>/admin → Rinks</strong> so games can link to a venue (powers map links and LiveBarn streams).
                  </div>
                )}
              </Field>
              <Field label="Location (optional)"><input style={inputStyle} value={gameForm.location} onChange={e => setGameForm(p => ({ ...p, location: e.target.value }))} placeholder="Free-text note — only used when the rink isn't in the list" /></Field>
              <Field label="LiveBarn Venue ID (optional override)"><input style={inputStyle} value={gameForm.live_barn_venue_id} onChange={e => setGameForm(p => ({ ...p, live_barn_venue_id: e.target.value }))} placeholder={(rinks.find(r => r.id === gameForm.rink_id)?.live_barn_venue_id) || 'e.g. 12345'} /></Field>
              <Field label="Stream URL (YouTube / Twitch / Facebook · optional)"><input style={inputStyle} value={gameForm.youtube_url} onChange={e => setGameForm(p => ({ ...p, youtube_url: e.target.value }))} placeholder={(rinks.find(r => r.id === gameForm.rink_id)?.youtube_url) || 'https://youtube.com/@kanataoldtimers/live'} /></Field>
              <Field label="Date & Time"><DateTimePicker value={gameForm.start_time} onChange={v => setGameForm(p => ({ ...p, start_time: v }))} placeholder="Select date & time" /></Field>
              <Btn onClick={handleAddGame}>+ Add Game</Btn>
            </Card>

            <SecLabel>Schedule ({games.length} games)</SecLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {games.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No games yet — try Generate Schedule above</div>}
              {games.map(g => {
                const home = g.home_lt?.team?.name || g.home_lt?.team_name;
                const away = g.away_lt?.team?.name || g.away_lt?.team_name;
                const date = new Date(g.start_time);
                const isFinal = g.status === 'final';
                return (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <input type="datetime-local"
                      disabled={isFinal}
                      value={toDateTimeLocal(date)}
                      onChange={async (e) => {
                        const iso = new Date(e.target.value).toISOString();
                        await rescheduleGame(g.id, { start_time: iso });
                        await load();
                      }}
                      style={{ flex: '0 0 180px', background:'#07111F', border:`0.5px solid ${C.border}`, borderRadius:6, padding:'6px 8px', color:isFinal ? C.steel : C.ice, fontFamily:'Barlow, sans-serif', fontSize:12, outline:'none', opacity: isFinal ? 0.6 : 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {home || '?'} <span style={{ color: 'rgba(244,247,250,0.4)' }}>vs.</span> {away || '?'}
                      </div>
                      {g.rink?.name && <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 1 }}>{g.rink.sub_rink ? `${g.rink.sub_rink} · ` : ''}{g.rink.name}</div>}
                    </div>
                    {isFinal && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)' }}>FINAL</span>}
                    {!isFinal && (
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete this game (${home || '?'} vs. ${away || '?'})?`)) return;
                          await deleteLeagueGame(g.id);
                          await load();
                        }}
                        style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.4)', fontSize: 14, cursor: 'pointer', padding: 4 }}
                        title="Delete game">
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* PLAYOFFS — Phase 3b */}
        {activeTab === 'Playoffs' && (
          <PlayoffsTab
            leagueId={id}
            teams={teams}
            standings={standings}
            games={games}
            rinks={rinks}
            onPublished={async () => { await load(); }}
          />
        )}

        {showScheduleBuilder && (
          <ScheduleBuilderModal
            leagueId={id}
            leagueTeams={teams}
            rinkByTeam={rinkByTeamMap(games)}
            onClose={() => setShowScheduleBuilder(false)}
            onPublished={async () => { setShowScheduleBuilder(false); await load(); }}
          />
        )}

        {/* SETTINGS */}
        {activeTab === 'Registrations' && league && isCommissioner && (
          <RegistrationsTab leagueId={id} league={league} registrations={registrations} onChanged={load} />
        )}

        {activeTab === 'Settings' && league && (
          <LeagueSettings league={league} onSave={async (updates) => { await updateLeague(id, updates); await load(); }} />
        )}
      </div>
    </div>
  );
}

// ── PLAYOFFS TAB ───────────────────────────────────────────────
// Phase 3b of the league-parity build. Single-round-at-a-time bracket
// generator. Because league_games.home_team_id / away_team_id are NOT
// NULL (unlike tournaments.games which allows TBD placeholders), we
// only emit games once their teams are resolved:
//   - Round 1: seed from standings (top N teams, standard 1v8 / 4v5 / 3v6 / 2v7 etc.)
//   - Round 2+: pair winners from the prior round; bronze game pairs the
//     two losing semifinalists when that round was 'semifinal'.
//
// Both flows share the same scheduling form (start date / days-of-week /
// games-per-day / rink / first puck / spacing) and write through
// bulkInsertLeagueGames with phase='playoffs' + round='quarterfinal' |
// 'semifinal' | 'final' | 'bronze'.
function PlayoffsTab({ leagueId, teams, standings, games, rinks, onPublished }) {
  const today = new Date().toISOString().slice(0, 10);
  const [bracketSize, setBracketSize] = useState(() => {
    // Pick the largest supported size that fits the team count.
    const N = teams?.length || 0;
    if (N >= 8) return 8;
    if (N >= 4) return 4;
    if (N >= 2) return 2;
    return 4;
  });
  const [form, setForm] = useState({
    startDate: today,
    daysOfWeek: [0],
    gamesPerDay: 2,
    rinkId: '',
    firstPuckHour: 18,
    firstPuckMinute: 0,
    gameBlockMinutes: 75,
    includeBronze: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const toggleDay = (d) => set('daysOfWeek',
    form.daysOfWeek.includes(d)
      ? form.daysOfWeek.filter((x) => x !== d)
      : [...form.daysOfWeek, d].sort()
  );

  // Existing playoff games on this league, grouped by round.
  const playoffGames = useMemo(() => (games || []).filter((g) => g.phase === 'playoffs'), [games]);
  const byRound = useMemo(() => {
    const map = {};
    for (const g of playoffGames) {
      const r = g.round || 'unknown';
      (map[r] = map[r] || []).push(g);
    }
    return map;
  }, [playoffGames]);

  // Find the most-recently-finalized round so the "Generate next round"
  // button can pre-fill the winners.
  const ROUND_ORDER = ['quarterfinal', 'semifinal', 'final'];
  const lastFinalRound = useMemo(() => {
    for (let i = ROUND_ORDER.length - 1; i >= 0; i--) {
      const r = ROUND_ORDER[i];
      const rGames = byRound[r] || [];
      if (rGames.length > 0 && rGames.every((g) => g.status === 'final')) return r;
    }
    return null;
  }, [byRound]);

  const hasRound1 = !!byRound[firstRoundLabelFromSize(bracketSize)];

  // Round 1 generator
  const round1Preview = useMemo(() => {
    if (hasRound1) return null;
    return generatePlayoffRoundOne({
      standings,
      bracketSize,
      startDate: form.startDate,
      daysOfWeek: form.daysOfWeek,
      gamesPerDay: form.gamesPerDay,
      rinkId: form.rinkId || null,
      firstPuckHour: form.firstPuckHour,
      firstPuckMinute: form.firstPuckMinute,
      gameBlockMinutes: form.gameBlockMinutes,
    });
  }, [standings, bracketSize, form, hasRound1]);

  // Next round generator (round 2+) — uses last finalized round as input.
  const nextRoundPreview = useMemo(() => {
    if (!lastFinalRound) return null;
    const prev = (byRound[lastFinalRound] || []).slice().sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    return generatePlayoffNextRound({
      previousRound: prev,
      bracketSize,
      includeBronze: form.includeBronze,
      startDate: form.startDate,
      daysOfWeek: form.daysOfWeek,
      gamesPerDay: form.gamesPerDay,
      rinkId: form.rinkId || null,
      firstPuckHour: form.firstPuckHour,
      firstPuckMinute: form.firstPuckMinute,
      gameBlockMinutes: form.gameBlockMinutes,
    });
  }, [byRound, lastFinalRound, bracketSize, form]);

  const handleGenerate = async (rows, errorOverride) => {
    if (busy || !rows || rows.length === 0) return;
    setBusy(true);
    setError(errorOverride || null);
    const { error: insertErr } = await bulkInsertLeagueGames(leagueId, rows);
    setBusy(false);
    if (insertErr) { setError(insertErr.message || 'Insert failed.'); return; }
    await onPublished?.();
  };

  const teamNameByLtId = useMemo(() => {
    const m = {};
    for (const lt of teams || []) m[lt.id] = lt.team?.name || lt.team_name || '—';
    return m;
  }, [teams]);

  if ((teams?.length || 0) < 2) {
    return (
      <Card>
        <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6 }}>
          Add at least 2 teams to set up a playoff bracket. The Playoffs tab needs final standings so it can seed round 1 from the top N teams.
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Bracket / scheduling form */}
      <SecLabel>🏆 Generate Playoff Bracket</SecLabel>
      <Card>
        <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 12 }}>
          {hasRound1
            ? 'Round 1 is on the books. Finalize all round-1 games, then come back here to generate the next round from the winners.'
            : 'Pick how many teams advance from the standings. Higher seed gets home ice. Game times stagger from your start date / days-of-week.'}
        </div>
        <Row2>
          <Field label="Bracket Size">
            <select style={inputStyle} value={bracketSize}
              onChange={(e) => setBracketSize(parseInt(e.target.value, 10))}>
              {SUPPORTED_BRACKET_SIZES.map((n) => (
                <option key={n} value={n} disabled={n > (teams?.length || 0)}>
                  {n} teams{n > (teams?.length || 0) ? ' — not enough teams' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start Date">
            <input style={inputStyle} type="date" value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)} />
          </Field>
        </Row2>

        <Field label="Game Days">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DAY_NAMES.map((name, d) => {
              const on = form.daysOfWeek.includes(d);
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  style={{
                    background: on ? C.red : 'rgba(46,91,140,0.18)',
                    border: `0.5px solid ${on ? C.red : C.border}`,
                    color: on ? '#fff' : C.steel,
                    borderRadius: 999, padding: '6px 12px',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'Barlow, sans-serif',
                  }}>
                  {name}
                </button>
              );
            })}
          </div>
        </Field>

        <Row2>
          <Field label="Games Per Day">
            <input style={inputStyle} type="number" min={1} max={20}
              value={form.gamesPerDay}
              onChange={(e) => set('gamesPerDay', Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </Field>
          <Field label="Rink (optional)">
            <select style={inputStyle} value={form.rinkId} onChange={(e) => set('rinkId', e.target.value)}>
              <option value="">— No rink —</option>
              {rinks.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.sub_rink ? ` · ${r.sub_rink}` : ''}</option>
              ))}
            </select>
          </Field>
        </Row2>

        <Row2>
          <Field label="First Puck (24h)">
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...inputStyle, flex: 1 }} type="number" min={0} max={23}
                value={form.firstPuckHour}
                onChange={(e) => set('firstPuckHour', Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))} />
              <input style={{ ...inputStyle, flex: 1 }} type="number" min={0} max={59} step={5}
                value={form.firstPuckMinute}
                onChange={(e) => set('firstPuckMinute', Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))} />
            </div>
          </Field>
          <Field label="Minutes Between Games">
            <input style={inputStyle} type="number" min={30} max={300} step={5}
              value={form.gameBlockMinutes}
              onChange={(e) => set('gameBlockMinutes', Math.max(30, parseInt(e.target.value, 10) || 30))} />
          </Field>
        </Row2>

        {/* Round 1 path */}
        {!hasRound1 && round1Preview && (
          <div style={{ background: 'rgba(46,91,140,0.15)', border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginTop: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 6 }}>
              Round 1 preview — {round1Preview.label || '—'}
            </div>
            {round1Preview.error === 'not_enough_teams' && (
              <div style={{ fontSize: 13, color: '#E26B6B' }}>Only {standings.length} teams have a standings rank — need at least {bracketSize}.</div>
            )}
            {round1Preview.error === 'calendar_exhausted' && (
              <div style={{ fontSize: 13, color: '#E26B6B' }}>Calendar full — try more days-of-week or more games-per-day.</div>
            )}
            {!round1Preview.error && round1Preview.rows.length > 0 && (
              <div style={{ fontSize: 13, color: C.ice, lineHeight: 1.7 }}>
                {round1Preview.rows.map((r, i) => {
                  const homeName = teamNameByLtId[r.home_team_id] || '—';
                  const awayName = teamNameByLtId[r.away_team_id] || '—';
                  const t = new Date(r.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                  return (
                    <div key={i}>
                      <strong>{homeName}</strong> vs. <strong>{awayName}</strong>
                      <span style={{ color: C.steel }}> — {t}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={() => handleGenerate(round1Preview.rows)}
              disabled={busy || round1Preview.error || round1Preview.rows.length === 0}
              style={{
                marginTop: 10, padding: '10px 16px', borderRadius: 999,
                background: busy || round1Preview.error || round1Preview.rows.length === 0 ? C.border : C.red,
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: busy || round1Preview.error || round1Preview.rows.length === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'Barlow, sans-serif',
              }}>
              {busy ? 'Generating…' : `🏆 Generate ${round1Preview.label || 'round 1'} (${round1Preview.rows.length} games)`}
            </button>
          </div>
        )}

        {/* Next round path */}
        {hasRound1 && lastFinalRound && (
          <div style={{ background: 'rgba(46,91,140,0.15)', border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginTop: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 6 }}>
              Next round preview — from finalized {lastFinalRound}
            </div>
            {nextRoundPreview?.error === 'tournament_complete' && (
              <div style={{ fontSize: 13, color: C.steel }}>Final has been played — bracket complete.</div>
            )}
            {nextRoundPreview?.error === 'incomplete_winners' && (
              <div style={{ fontSize: 13, color: '#E26B6B' }}>Some {lastFinalRound} games ended in a tie or have no clear winner — fix the scores before generating next round.</div>
            )}
            {nextRoundPreview?.error === 'calendar_exhausted' && (
              <div style={{ fontSize: 13, color: '#E26B6B' }}>Calendar full — try more days-of-week or more games-per-day.</div>
            )}
            {!nextRoundPreview?.error && nextRoundPreview?.rows?.length > 0 && (
              <>
                {lastFinalRound === 'semifinal' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.steel, marginBottom: 6 }}>
                    <input type="checkbox" checked={form.includeBronze} onChange={(e) => set('includeBronze', e.target.checked)} />
                    Also generate bronze-medal game (losers of semis)
                  </label>
                )}
                <div style={{ fontSize: 13, color: C.ice, lineHeight: 1.7 }}>
                  {nextRoundPreview.rows.map((r, i) => {
                    const homeName = teamNameByLtId[r.home_team_id] || '—';
                    const awayName = teamNameByLtId[r.away_team_id] || '—';
                    const t = new Date(r.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                    return (
                      <div key={i}>
                        <span style={{ display: 'inline-block', minWidth: 60, fontSize: 10, fontWeight: 700, padding: '1px 6px', marginRight: 6, borderRadius: 4, background: r.round === 'final' ? 'rgba(245,158,11,0.2)' : r.round === 'bronze' ? 'rgba(180,83,9,0.2)' : 'rgba(46,91,140,0.3)', color: r.round === 'final' ? '#F59E0B' : r.round === 'bronze' ? '#B45309' : C.steel, textAlign: 'center' }}>
                          {(r.round || '').toUpperCase()}
                        </span>
                        <strong>{homeName}</strong> vs. <strong>{awayName}</strong>
                        <span style={{ color: C.steel }}> — {t}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <button onClick={() => handleGenerate(nextRoundPreview?.rows)}
              disabled={busy || !nextRoundPreview || nextRoundPreview.error || (nextRoundPreview.rows?.length || 0) === 0}
              style={{
                marginTop: 10, padding: '10px 16px', borderRadius: 999,
                background: busy || !nextRoundPreview || nextRoundPreview.error || (nextRoundPreview.rows?.length || 0) === 0 ? C.border : C.red,
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: busy || !nextRoundPreview || nextRoundPreview.error || (nextRoundPreview.rows?.length || 0) === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'Barlow, sans-serif',
              }}>
              {busy ? 'Generating…' : `🏆 Generate ${nextRoundPreview?.label || 'next round'} (${nextRoundPreview?.rows?.length || 0} games)`}
            </button>
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '8px 12px', marginTop: 10, fontSize: 12, color: C.red }}>
            {error}
          </div>
        )}
      </Card>

      {/* Standings preview — which teams would seed which slots */}
      <SecLabel>Top {bracketSize} from Standings (Seeding)</SecLabel>
      <Card>
        {standings.length === 0 ? (
          <div style={{ fontSize: 13, color: C.steel }}>No regular-season standings yet — finalize at least one game so the table populates.</div>
        ) : (
          <div>
            {standings.slice(0, bracketSize).map((row, i) => (
              <div key={row.lt_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < bracketSize - 1 ? '0.5px solid rgba(244,247,250,0.06)' : 'none' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: i === 0 ? C.red : 'rgba(46,91,140,0.4)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ice }}>{row.team_name}</span>
                <span style={{ fontSize: 11, color: C.steel }}>{row.wins}-{row.losses}-{row.ties} · {row.pts} pts</span>
              </div>
            ))}
            {standings.length < bracketSize && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#E26B6B' }}>
                Only {standings.length} teams have a standings rank — need {bracketSize} for this bracket size.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Current bracket — what's already on the books */}
      {playoffGames.length > 0 && (
        <>
          <SecLabel>Current Bracket ({playoffGames.length} games)</SecLabel>
          <Card>
            {ROUND_ORDER.concat(['bronze']).map((r) => {
              const list = (byRound[r] || []).slice().sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
              if (list.length === 0) return null;
              return (
                <div key={r} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 4 }}>
                    {r === 'quarterfinal' ? 'Quarterfinals' : r === 'semifinal' ? 'Semifinals' : r === 'final' ? 'Final' : r === 'bronze' ? 'Bronze' : r}
                  </div>
                  {list.map((g) => {
                    const homeName = g.home_lt?.team?.name || g.home_lt?.team_name || teamNameByLtId[g.home_team_id] || '—';
                    const awayName = g.away_lt?.team?.name || g.away_lt?.team_name || teamNameByLtId[g.away_team_id] || '—';
                    const isFinal = g.status === 'final';
                    const t = new Date(g.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                    return (
                      <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
                        <span style={{ flex: 1, color: C.ice }}>
                          <strong>{homeName}</strong> <span style={{ color: C.steel }}>vs.</span> <strong>{awayName}</strong>
                          {isFinal && <span style={{ marginLeft: 8, fontSize: 12, color: C.steel }}>· {g.home_score}–{g.away_score}</span>}
                        </span>
                        <span style={{ fontSize: 11, color: C.steel, whiteSpace: 'nowrap' }}>{t}</span>
                        {isFinal && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.5)' }}>FINAL</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Card>
        </>
      )}
    </>
  );
}

function firstRoundLabelFromSize(n) {
  if (n === 8) return 'quarterfinal';
  if (n === 4) return 'semifinal';
  if (n === 2) return 'final';
  return null;
}

// ── SMART SCHEDULE GENERATOR ───────────────────────────────────
// Phase 3 of the league-parity build. "Option B" UX from Pete's May 19
// decision: commissioner picks a TARGET games per team; the generator
// computes the round-robin meetings + slots them onto a calendar built
// from days-of-week + games-per-day. Live preview re-runs the generator
// on every form change (no DB hit) so the commissioner sees the actual
// games-per-team / total-games / end-date before committing.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function SmartScheduleGenerator({ leagueId, teams, rinks, onPublished }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    targetGamesPerTeam: 20,
    startDate: today,
    daysOfWeek: [0],            // Sun by default; commissioner toggles chips
    gamesPerDay: 1,
    rinkId: '',
    firstPuckHour: 18,
    firstPuckMinute: 0,
    gameBlockMinutes: 75,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmExisting, setConfirmExisting] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const toggleDay = (d) => set('daysOfWeek',
    form.daysOfWeek.includes(d)
      ? form.daysOfWeek.filter((x) => x !== d)
      : [...form.daysOfWeek, d].sort()
  );

  // Live preview — pure function, no DB. Re-runs on every form change.
  const preview = useMemo(() => {
    if (!teams || teams.length < 2) return null;
    return generateLeagueSchedule({
      teams,
      targetGamesPerTeam: form.targetGamesPerTeam,
      startDate: form.startDate,
      daysOfWeek: form.daysOfWeek,
      gamesPerDay: form.gamesPerDay,
      rinkId: form.rinkId || null,
      firstPuckHour: form.firstPuckHour,
      firstPuckMinute: form.firstPuckMinute,
      gameBlockMinutes: form.gameBlockMinutes,
    });
  }, [teams, form]);

  const handleGenerate = async () => {
    if (busy) return;
    setError(null);
    if (!preview || preview.shape.totalGames === 0) {
      setError('Need at least 2 teams and a positive target.');
      return;
    }
    if (preview.error === 'calendar_exhausted') {
      setError('The chosen days-of-week + start date don\'t fit the schedule within 3 years. Pick more days per week or fewer target games.');
      return;
    }
    if (!confirmExisting) {
      // Soft warning. The bulk insert doesn't dedupe — re-generating
      // doubles the schedule. Force a one-tap confirm before we touch the
      // DB so a commissioner doesn't accidentally double their season.
      setConfirmExisting(true);
      return;
    }
    setBusy(true);
    const { error: insertErr } = await bulkInsertLeagueGames(leagueId, preview.rows);
    setBusy(false);
    if (insertErr) {
      setError(insertErr.message || 'Insert failed.');
      return;
    }
    setConfirmExisting(false);
    await onPublished?.();
  };

  const lastSlotLabel = preview?.lastSlotDate
    ? new Date(preview.lastSlotDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <div>
      <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 12 }}>
        Type the games you want each team to play. We compute the round-robin meetings, balance home/away, and lay them out on the days you pick. Edit any game by hand after generating.
      </div>

      <Row2>
        <Field label="Target Games Per Team">
          <input style={inputStyle} type="number" min={1} max={200}
            value={form.targetGamesPerTeam}
            onChange={(e) => set('targetGamesPerTeam', Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </Field>
        <Field label="Start Date">
          <input style={inputStyle} type="date" value={form.startDate}
            onChange={(e) => set('startDate', e.target.value)} />
        </Field>
      </Row2>

      <Field label="Game Days">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DAY_NAMES.map((name, d) => {
            const on = form.daysOfWeek.includes(d);
            return (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                style={{
                  background: on ? C.red : 'rgba(46,91,140,0.18)',
                  border: `0.5px solid ${on ? C.red : C.border}`,
                  color: on ? '#fff' : C.steel,
                  borderRadius: 999, padding: '6px 12px',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'Barlow, sans-serif',
                }}>
                {name}
              </button>
            );
          })}
        </div>
      </Field>

      <Row2>
        <Field label="Games Per Day">
          <input style={inputStyle} type="number" min={1} max={20}
            value={form.gamesPerDay}
            onChange={(e) => set('gamesPerDay', Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </Field>
        <Field label="Rink (optional)">
          <select style={inputStyle} value={form.rinkId} onChange={(e) => set('rinkId', e.target.value)}>
            <option value="">— No rink (add per game) —</option>
            {rinks.map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.sub_rink ? ` · ${r.sub_rink}` : ''}</option>
            ))}
          </select>
        </Field>
      </Row2>

      <Row2>
        <Field label="First Puck (24h)">
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={{ ...inputStyle, flex: 1 }} type="number" min={0} max={23}
              value={form.firstPuckHour}
              onChange={(e) => set('firstPuckHour', Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))} />
            <input style={{ ...inputStyle, flex: 1 }} type="number" min={0} max={59} step={5}
              value={form.firstPuckMinute}
              onChange={(e) => set('firstPuckMinute', Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))} />
          </div>
        </Field>
        <Field label="Minutes Between Games">
          <input style={inputStyle} type="number" min={30} max={300} step={5}
            value={form.gameBlockMinutes}
            onChange={(e) => set('gameBlockMinutes', Math.max(30, parseInt(e.target.value, 10) || 30))} />
        </Field>
      </Row2>

      {/* Live preview */}
      <div style={{ background: 'rgba(46,91,140,0.15)', border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginTop: 6, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 6 }}>
          Preview
        </div>
        {!teams || teams.length < 2 ? (
          <div style={{ fontSize: 13, color: C.steel }}>Add at least 2 teams to preview the schedule.</div>
        ) : preview?.shape?.totalGames === 0 ? (
          <div style={{ fontSize: 13, color: C.steel }}>Set a target above to preview.</div>
        ) : preview?.error === 'calendar_exhausted' ? (
          <div style={{ fontSize: 13, color: '#E26B6B' }}>
            Calendar full — try more days-of-week or more games-per-day.
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.ice, lineHeight: 1.55 }}>
            <strong>{preview.shape.totalGames}</strong> games across <strong>{teams.length}</strong> teams.<br/>
            Each team plays each opponent <strong>{preview.shape.meetingsPerPair}×</strong> = <strong>{preview.shape.gamesPerTeam} games per team</strong>.<br/>
            Last game: <strong>{lastSlotLabel}</strong>.
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}

      <button onClick={handleGenerate} disabled={busy || !preview || preview.shape.totalGames === 0}
        style={{
          padding: '11px 18px', borderRadius: 999,
          background: busy || !preview || preview.shape.totalGames === 0 ? C.border : C.red,
          border: 'none', color: '#fff', fontSize: 14, fontWeight: 700,
          cursor: busy || !preview || preview.shape.totalGames === 0 ? 'not-allowed' : 'pointer',
          fontFamily: 'Barlow, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
        <span style={{ fontSize: 16 }}>⚡</span>
        <span>
          {busy ? 'Generating…' : confirmExisting ? `Confirm — insert ${preview?.shape?.totalGames || 0} games` : 'Generate Schedule'}
        </span>
      </button>
      {confirmExisting && !busy && (
        <button onClick={() => setConfirmExisting(false)}
          style={{ marginLeft: 8, background: 'transparent', border: 'none', color: C.steel, fontSize: 12, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
          Cancel
        </button>
      )}
    </div>
  );
}

// --- Registrations tab: config (open/fee/deadline/cap/link) + submissions list ---
const REG_STATUS = {
  pending:     { label: 'Pending',     color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  approved:    { label: 'Approved',    color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
  waitlisted:  { label: 'Waitlisted',  color: '#8BA3BE', bg: 'rgba(139,163,190,0.15)' },
  rejected:    { label: 'Rejected',    color: '#D72638', bg: 'rgba(215,38,56,0.15)' },
};
const REG_GROUPS = [['pending', 'Pending'], ['approved', 'Approved'], ['waitlisted', 'Waitlisted'], ['rejected', 'Rejected']];

function RegistrationsTab({ leagueId, league, registrations, onChanged }) {
  const [open, setOpen] = useState(!!league.registration_open);
  const [feeDollars, setFeeDollars] = useState(league.registration_fee_cents ? String(league.registration_fee_cents / 100) : '');
  const [deadline, setDeadline] = useState(league.registration_deadline || '');
  const [maxTeams, setMaxTeams] = useState(league.max_teams != null ? String(league.max_teams) : '');
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgFlash, setCfgFlash] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const regLink = `${window.location.origin}/league/${leagueId}/register`;

  const saveConfig = async () => {
    setSavingCfg(true); setCfgFlash(null);
    try {
      await updateLeague(leagueId, {
        registration_open: open,
        registration_fee_cents: Math.max(0, Math.round((parseFloat(feeDollars) || 0) * 100)),
        registration_deadline: deadline || null,
        max_teams: maxTeams.trim() === '' ? null : Math.max(0, parseInt(maxTeams, 10) || 0),
      });
      setCfgFlash({ kind: 'ok', text: 'Saved.' });
      await onChanged();
    } catch (e) {
      setCfgFlash({ kind: 'err', text: e.message || 'Could not save settings.' });
    } finally { setSavingCfg(false); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(regLink); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked — link is shown below for manual copy */ }
  };

  const act = async (reg, action) => {
    setBusyId(reg.id);
    try {
      if (action === 'approve') await approveRegistration(reg.id);
      else await updateRegistrationStatus(reg.id, action); // 'rejected' | 'waitlisted'
      await onChanged();
    } catch (e) { alert(e.message || 'Action failed.'); }
    finally { setBusyId(null); }
  };

  const exportCsv = () => {
    const head = ['Team', 'Contact', 'Email', 'Status', 'Fee ($)', 'Paid At', 'Registered'];
    const rows = registrations.map(r => [
      r.team_name, r.contact_name, r.contact_email, r.status,
      r.fee_cents != null ? (r.fee_cents / 100).toFixed(2) : '',
      r.paid_at ? new Date(r.paid_at).toISOString() : '',
      r.created_at ? new Date(r.created_at).toISOString() : '',
    ]);
    const csv = [head, ...rows]
      .map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(league.name || 'league').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_registrations.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionsFor = (status) => {
    if (status === 'pending') return [['approve', 'Approve'], ['waitlisted', 'Waitlist'], ['rejected', 'Reject']];
    if (status === 'waitlisted') return [['approve', 'Approve'], ['rejected', 'Reject']];
    if (status === 'rejected') return [['approve', 'Approve']];
    return []; // approved is terminal here (team already created)
  };

  const btn = (kind) => ({
    fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
    fontFamily: 'Barlow, sans-serif', border: '0.5px solid',
    ...(kind === 'approve'
      ? { background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.5)', color: '#22C55E' }
      : kind === 'rejected'
        ? { background: 'transparent', borderColor: 'rgba(215,38,56,0.45)', color: '#E26B6B' }
        : { background: 'transparent', borderColor: C.border, color: C.steel }),
  });

  return (
    <>
      {/* --- Registration settings --- */}
      <SecLabel>Registration Settings</SecLabel>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Registration {open ? 'Open' : 'Closed'}</div>
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginTop: 2 }}>Teams can submit via your link only while open.</div>
          </div>
          <button onClick={() => setOpen(o => !o)} aria-label="Toggle registration open"
            style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: open ? '#22C55E' : 'rgba(139,163,190,0.35)', transition: 'background 0.15s', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 3, left: open ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
          </button>
        </div>
        <Row2>
          <Field label="Entry Fee (USD)">
            <input style={inputStyle} type="number" min={0} step="0.01" value={feeDollars}
              onChange={e => setFeeDollars(e.target.value)} placeholder="0.00 (free)" />
          </Field>
          <Field label="Max Teams (optional)">
            <input style={inputStyle} type="number" min={0} value={maxTeams}
              onChange={e => setMaxTeams(e.target.value)} placeholder="No cap" />
          </Field>
        </Row2>
        <Field label="Registration Deadline (optional)">
          <DateTimePicker value={deadline} onChange={setDeadline} placeholder="No deadline" />
        </Field>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={saveConfig} disabled={savingCfg}
            style={{ flex: 1, minWidth: 120, padding: 11, background: savingCfg ? 'rgba(215,38,56,0.5)' : C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 14, fontWeight: 700, cursor: savingCfg ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>
            {savingCfg ? 'Saving…' : 'Save Settings'}
          </button>
          <button onClick={copyLink}
            style={{ padding: '11px 16px', background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 999, color: copied ? '#22C55E' : C.ice, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
            {copied ? '✓ Copied' : '🔗 Copy Link'}
          </button>
        </div>
        {cfgFlash && <div style={{ marginTop: 10, fontSize: 12, color: cfgFlash.kind === 'ok' ? '#22C55E' : C.red }}>{cfgFlash.text}</div>}
        <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(244,247,250,0.4)', wordBreak: 'break-all' }}>{regLink}</div>
      </Card>

      {/* --- Submissions --- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <SecLabel>Registrations ({registrations.length})</SecLabel>
        {registrations.length > 0 && (
          <button onClick={exportCsv}
            style={{ fontSize: 12, fontWeight: 700, color: C.steel, background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
            ⬇ Export CSV
          </button>
        )}
      </div>

      {registrations.length === 0 && (
        <Card><div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', textAlign: 'center', padding: '8px 0' }}>No registrations yet. Share your link to start collecting teams.</div></Card>
      )}

      {REG_GROUPS.map(([status, title]) => {
        const rows = registrations.filter(r => r.status === status);
        if (rows.length === 0) return null;
        const meta = REG_STATUS[status];
        return (
          <div key={status} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: meta.color, margin: '6px 0 6px' }}>{title} · {rows.length}</div>
            {rows.map(r => (
              <div key={r.id} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.ice }}>{r.team_name}</div>
                    <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.55)', marginTop: 2 }}>{r.contact_name} · {r.contact_email}</div>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.45)', marginTop: 4 }}>
                      {r.paid_at
                        ? <span style={{ color: '#22C55E' }}>✓ Paid {new Date(r.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        : (r.fee_cents > 0 ? <span>Unpaid</span> : <span>No fee</span>)}
                      {r.fee_cents != null && r.fee_cents > 0 && <span> · ${(r.fee_cents / 100).toFixed(2)}</span>}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: meta.bg, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{meta.label}</span>
                </div>
                {actionsFor(r.status).length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {actionsFor(r.status).map(([action, lbl]) => (
                      <button key={action} disabled={busyId === r.id} onClick={() => act(r, action)} style={btn(action)}>
                        {busyId === r.id ? '…' : lbl}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function LeagueSettings({ league, onSave }) {
  const [form, setForm] = useState({
    name: league.name,
    division: league.division || '',
    level: league.level || '',
    location: league.location || '',
    season: league.season || '',
    logo_color: league.logo_color || C.blue,
    logo_initials: league.logo_initials || '',
    logo_url: league.logo_url || '',
    status: league.status,
    settings: league.settings || {},
  });
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Mirror the team / tournament / LeagueCreate logo upload flow: 5MB cap
  // → classifyImage() NSFW pre-check → uploadMedia → returns public URL
  // into form state → persists on Save Changes. The league hasn't been
  // re-saved yet at this point so a Cancel reload still keeps the old
  // logo until the commissioner explicitly commits.
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(`Logo is ${(file.size / 1024 / 1024).toFixed(1)}MB — max 5MB.`);
      e.target.value = '';
      return;
    }
    const verdict = await classifyImage(file);
    if (!verdict.ok) {
      alert("Looks like this image may violate Rinkd's community guidelines. Try a different one.");
      e.target.value = '';
      return;
    }
    setUploadingLogo(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { url, error: upErr } = await uploadMedia(file, user.id);
    setUploadingLogo(false);
    if (upErr || !url) { alert('Upload failed. Try again.'); return; }
    set('logo_url', url);
  };

  const initials = form.logo_initials || form.name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();

  return (
    <>
      <SecLabel>League Settings</SecLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 10,
          background: form.logo_url ? `url(${form.logo_url}) center/cover, ${form.logo_color}` : form.logo_color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: '#fff',
          flexShrink: 0,
        }}>
          {!form.logo_url && (initials || '?')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ cursor: 'pointer', fontSize: 11, color: '#9BB5D6', padding: '5px 12px', borderRadius: 999, background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)' }}>
              {uploadingLogo ? 'Uploading…' : form.logo_url ? '📷 Replace logo' : '📷 Upload logo'}
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} disabled={uploadingLogo} />
            </label>
            {form.logo_url && (
              <button type="button" onClick={() => set('logo_url', '')} style={{ background: 'transparent', border: 'none', color: '#E26B6B', fontSize: 11, cursor: 'pointer', padding: 0 }}>Remove</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {form.logo_url ? 'Fallback color' : 'Color'}
            </span>
            {LOGO_COLORS.map(col => <div key={col} onClick={() => set('logo_color', col)} style={{ width: 22, height: 22, borderRadius: '50%', background: col, cursor: 'pointer', border: form.logo_color === col ? '2px solid #fff' : '2px solid transparent' }} />)}
          </div>
        </div>
      </div>
      <Card>
        <Field label="League Name"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Logo Initials (used when no logo image is set)"><input style={inputStyle} value={form.logo_initials} onChange={e => set('logo_initials', e.target.value.toUpperCase().slice(0, 3))} maxLength={3} placeholder="Auto from name" /></Field>
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
      <button onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} disabled={saving || uploadingLogo}
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
  // /league/create now routes to <LeagueCreate /> directly in App.js — this
  // page only handles the /league/:id/manage flow. The defensive redirect
  // catches any stale links that still hit /league/create through this
  // component (shouldn't be reachable via App.js routing).
  if (!id || id === 'create') { navigate('/league/create', { replace: true }); return null; }
  return <Layout profile={profile}><ManageLeague id={id} navigate={navigate} /></Layout>;
}
