import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DateTimePicker from '../components/DateTimePicker';
import { getLeague, getLeagueTeams, getLeagueGames, getLeagueStandings, updateLeague, addLeagueTeam, removeLeagueTeam, addLeagueGame, updateLeagueGame, linkLeagueTeam, getUserLeagueRole } from '../lib/leagues';
import { listLeagueDivisions, createLeagueDivision, updateLeagueDivision, deleteLeagueDivision, reorderLeagueDivisions, assignLeagueTeamDivision } from '../lib/leagueDivisions';
import LeagueStaffManager from '../components/LeagueStaffManager';
import DivisionPicker from '../components/DivisionPicker';
import SponsorsManager from '../components/SponsorsManager';
import DataSyncAuthorization from '../components/DataSyncAuthorization';
import { listLeagueLinks, createLeagueLink, setLinkStatus, removeLeagueLink, listLeagueGameMaps, confirmMatch, ignoreMatch } from '../lib/gamesheet';
import { getLeagueRegistrations, updateRegistrationStatus, approveRegistration } from '../lib/registrations';
import { leaguePayoutsReady, startConnectOnboarding } from '../lib/stripeConnect';
import { generatePlayoffRoundOne, generatePlayoffNextRound, SUPPORTED_BRACKET_SIZES } from '../lib/leaguePlayoffGenerator';
import { listRinks } from '../lib/rinks';
import { supabase } from '../lib/supabase';
import { TeamLogo } from '../components/Logos';
import { sendLeagueInvite } from '../lib/invites';
import { getTeamContacts } from '../lib/teams';
import ScheduleBuilderModal from '../components/ScheduleBuilderModal';
import LeagueImportModal from '../components/LeagueImportModal';
import EditGameModal from '../components/EditGameModal';
import { deleteLeagueGame, bulkInsertLeagueGames } from '../lib/scheduleBuilder';
import { generateLeagueSchedule } from '../lib/leagueScheduleGenerator';
import { uploadMedia } from '../lib/posts';
import { classifyImage } from '../lib/imageModeration';
import { assignTeamManagerByInput } from '../lib/leagueTeamManagers';
import { createLeagueSubPools } from '../lib/subPools';

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
  // LEAGUE-DIV-1 M3 — divisions + the active scope. selectedDivisionId is set
  // even for single-division leagues (to the one "Main" division) so newly
  // added teams always land in a division.
  const [divisions, setDivisions] = useState([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState(null);
  const [newDivisionName, setNewDivisionName] = useState('');
  const [divBusy, setDivBusy] = useState(false);
  const [showScheduleBuilder, setShowScheduleBuilder] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editGameId, setEditGameId] = useState(null);
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
      setAssignFlash({ kind: 'err', text: 'Link this team to a Rinkd page first — use "Link team" above, then assign a manager.' });
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
      setAssignFlash({ kind: 'err', text: result.message || "Couldn't assign that manager — double-check the handle or email and try again." });
    }
  };

  const load = useCallback(async () => {
    try {
      // Fetch rinks alongside league/teams/games so the single-game form can
      // attach a real rink_id (and the rink shows up on the game cards via the
      // rinks join in getLeagueGames). listRinks() is small and cheap.
      const [l, t, g, r, s, role, regs, dv] = await Promise.all([
        getLeague(id), getLeagueTeams(id), getLeagueGames(id),
        listRinks().catch(() => []),
        getLeagueStandings(id).catch(() => []),
        getUserLeagueRole(id).catch(() => null),
        getLeagueRegistrations(id).catch(() => []),
        listLeagueDivisions(id).catch(() => []),
      ]);
      setLeague(l); setTeams(t); setGames(g); setRinks(r || []); setStandings(s || []);
      setIsCommissioner(role === 'commissioner');
      setRegistrations(regs || []);
      setDivisions(dv || []);
      // Keep the scope valid; default to the first division (works for single-
      // division leagues too — new teams then land in the "Main" division).
      setSelectedDivisionId(prev => (prev && (dv || []).some(d => d.id === prev)) ? prev : ((dv || [])[0]?.id || null));
      if (t.length >= 2) setGameForm(p => ({ ...p, home_team_id: t[0].id, away_team_id: t[1].id }));
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!teamSearch.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('teams').select('id, name, logo_color, logo_initials, logo_url').ilike('name', `%${teamSearch}%`).limit(5);
      setSearchResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [teamSearch]);

  useEffect(() => {
    if (!linkSearch.trim()) { setLinkResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('teams').select('id, name, logo_color, logo_initials, logo_url').ilike('name', `%${linkSearch}%`).limit(5);
      setLinkResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [linkSearch]);

  const handleAddLinkedTeam = async (team) => {
    try {
      await addLeagueTeam(id, { teamId: team.id, teamName: team.name, logoColor: team.logo_color, logoInitials: team.logo_initials, divisionId: selectedDivisionId });
      setTeamSearch(''); setSearchResults([]);
      await load();
      // Send league invite to the team manager. YOUTH-PRIVACY: profiles.email is
      // column-revoked — the commissioner is now an insider of this just-linked
      // team, so the manager's email comes from the insider-gated RPC; the name
      // is a granted column.
      if (team.manager_id) {
        const [{ data: mgrProfile }, contacts] = await Promise.all([
          supabase.from('profiles').select('name').eq('id', team.manager_id).maybeSingle(),
          getTeamContacts(team.id).catch(() => []),
        ]);
        const mgrEmail = (contacts || []).find(c => c.user_id === team.manager_id)?.account_email;
        if (mgrEmail) {
          await sendLeagueInvite({ to_email: mgrEmail, to_name: mgrProfile?.name, league_name: league?.name, league_id: id, division: league?.division, season: league?.season });
        }
      }
    } catch(e) { setError(e.message); }
  };

  const handleAddUnlinkedTeam = async () => {
    if (!teamSearch.trim()) { setError('Type a team name to add one.'); return; }
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
        p_division_id: selectedDivisionId,
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
    if (!gameForm.home_team_id || !gameForm.away_team_id || !gameForm.start_time) { setError('Pick both teams and a date & time to add the game.'); return; }
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
        division_id: selectedDivisionId,
      });
      setGameForm(p => ({ ...p, rink_id: '', location: '', start_time: '', live_barn_venue_id: '', youtube_url: '' }));
      await load();
    } catch(e) { setError(e.message); }
  };

  // ── LEAGUE-DIV-1 M3 — division management ──
  const handleAddDivision = async () => {
    const name = newDivisionName.trim();
    if (!name) { setError('Name the division to add it.'); return; }
    setDivBusy(true);
    try { await createLeagueDivision(id, name); setNewDivisionName(''); await load(); }
    catch (e) { setError(e.message); }
    finally { setDivBusy(false); }
  };
  const handleRenameDivision = async (divId, name) => {
    const nm = (name || '').trim();
    if (!nm) return;
    try { await updateLeagueDivision(divId, { name: nm }); await load(); }
    catch (e) { setError(e.message); }
  };
  const handleDeleteDivision = async (div) => {
    if (divisions.length <= 1) { setError('A league needs at least one division — add another before deleting this one.'); return; }
    const teamCount = teams.filter(t => t.division_id === div.id).length;
    const gameCount = games.filter(g => g.division_id === div.id).length;
    const ok = window.confirm(
      `Delete division "${div.name}"?\n\n` +
      `• ${teamCount} team${teamCount === 1 ? '' : 's'} will be removed from the league\n` +
      `• ${gameCount} game${gameCount === 1 ? '' : 's'} will be unassigned (kept, not deleted)\n\n` +
      `This can't be undone.`
    );
    if (!ok) return;
    try { await deleteLeagueDivision(div.id); if (selectedDivisionId === div.id) setSelectedDivisionId(null); await load(); }
    catch (e) { setError(e.message); }
  };
  const handleMoveDivision = async (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= divisions.length) return;
    const next = [...divisions];
    [next[index], next[j]] = [next[j], next[index]];
    try { await reorderLeagueDivisions(next.map(d => d.id)); await load(); }
    catch (e) { setError(e.message); }
  };
  const handleAssignTeamDivision = async (leagueTeamId, divId) => {
    try { await assignLeagueTeamDivision(leagueTeamId, divId); await load(); }
    catch (e) { setError(e.message); }
  };

  const multiDivision = divisions.length > 1;
  // Teams tab list scopes to the selected division when multi (the picker also
  // targets which division new teams are added to). Single-division: all teams.
  // P3 — sub pools are league_teams but NEVER playing teams: keep them out of
  // every list that feeds scheduling, playoffs, and the game pickers (the DB
  // trigger tr_block_sub_pool_scheduling is the backstop). They get their own
  // block on the Teams tab instead.
  const playTeams = teams.filter(t => !t.is_sub_pool);
  const allSubPools = teams.filter(t => t.is_sub_pool);
  const scopedTeamsList = multiDivision && selectedDivisionId ? playTeams.filter(t => t.division_id === selectedDivisionId) : playTeams;
  const scopedSubPools = multiDivision && selectedDivisionId ? allSubPools.filter(t => t.division_id === selectedDivisionId) : allSubPools;
  const scopedGamesList = multiDivision && selectedDivisionId ? games.filter(g => g.division_id === selectedDivisionId) : games;
  const scopedStandingsList = multiDivision && selectedDivisionId ? standings.filter(r => r.division_id === selectedDivisionId) : standings;
  // Operational tabs show for managers + commissioners (RLS gates the writes).
  // Registrations / Sponsors / Staff / Settings are commissioner-only
  // (billing, sponsor inventory, staff, delete).
  const MANAGE_TABS = ['Teams', 'Divisions', 'Schedule', 'Playoffs', ...(isCommissioner ? ['Registrations', 'Sponsors', 'Integrations', 'Staff', 'Settings'] : [])];

  if (loading) return <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Getting the ice ready.</div>;

  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>
      <div style={{ background: C.navy, padding: '14px 16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => navigate('/league/' + id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← {league?.name}</button>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>MANAGE LEAGUE</div>
        <div style={{ width: 80 }} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', background: C.navy, borderBottom: '2px solid rgba(46,91,140,0.3)' }}>
        {MANAGE_TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ fontSize: 13, fontWeight: 700, padding: '10px 16px', color: '#FFFFFF', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '3px solid #D72638' : '3px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', flexShrink: 0, opacity: activeTab === tab ? 1 : 0.5, transition: 'opacity 0.15s' }}
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
            {multiDivision && (
              <>
                <SecLabel>Division</SecLabel>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginBottom: 8 }}>New teams are added to this division, and the list below shows it. Use a team's dropdown to move it.</div>
                <DivisionPicker divisions={divisions} selectedId={selectedDivisionId} onSelect={setSelectedDivisionId} accent={C.red} />
              </>
            )}
            <SecLabel>📋 Bulk add — import from a spreadsheet</SecLabel>
            <Card>
              <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 12 }}>
                Got your teams (and schedule) in Excel or Google Sheets? Paste them in and stand up the whole league at once — fastest way to set up.
              </div>
              <button onClick={() => setShowImport(true)}
                style={{ padding: '11px 18px', borderRadius: 999, background: C.blue, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📋</span>
                <span>Import from spreadsheet</span>
              </button>
            </Card>

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
                      <TeamLogo team={t} size={28} radius={5} />
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

            <SecLabel>League Teams ({scopedTeamsList.length})</SecLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
              {scopedTeamsList.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No teams yet — add your first above.</div>}
              {scopedTeamsList.map(lt => {
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
                      {multiDivision && (
                        <select value={lt.division_id || ''} onChange={e => handleAssignTeamDivision(lt.id, e.target.value)}
                          title="Move team to division"
                          style={{ background: 'rgba(46,91,140,0.25)', border: `0.5px solid ${C.border}`, color: C.ice, borderRadius: 8, padding: '5px 8px', fontSize: 11, fontFamily: 'Barlow, sans-serif', cursor: 'pointer', maxWidth: 110 }}>
                          {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
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
            {/* P3 — SUB POOLS. A pool is a flagged league_team with a real
                backing team page (roster via join requests, feed, stats), but
                it can never be scheduled and never appears in standings. Two
                per division: skaters + goalies. */}
            <SecLabel>Sub Pools ({scopedSubPools.length})</SecLabel>
            <Card>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginBottom: 10, lineHeight: 1.5 }}>
                Pools hold the league's call-up list — players join the pool team like any other team.
                Coaches pull subs into a game night lineup from Set Lineup, and "Sub Needed" alerts push to the whole pool.
                Pools never appear in the schedule or standings.
              </div>
              {scopedSubPools.length === 0 && (
                <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.3)', padding: '4px 0 10px' }}>
                  No sub pools yet{multiDivision && selectedDivisionId ? ' for this division' : ''}.
                </div>
              )}
              {scopedSubPools.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                  <span style={{ fontSize: 16 }}>{p.sub_pool_kind === 'goalies' ? '🥅' : '🏒'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{p.team?.name || p.team_name}</div>
                    <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.4)', marginTop: 2, textTransform: 'capitalize' }}>{p.sub_pool_kind} pool</div>
                  </div>
                  {p.team_id && (
                    <button onClick={() => navigate(`/team/${p.team_id}`)}
                      style={{ background: 'rgba(46,91,140,0.25)', border: 'none', borderRadius: 999, padding: '6px 14px', color: C.ice, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
                      Manage roster →
                    </button>
                  )}
                </div>
              ))}
              {isCommissioner && scopedSubPools.length < 2 && (
                <div style={{ marginTop: 10 }}>
                  <Btn onClick={async () => {
                    try {
                      await createLeagueSubPools(id, multiDivision && selectedDivisionId ? selectedDivisionId : null);
                      await load();
                    } catch (e) { setError(e.message); }
                  }}>
                    + Create sub pools{multiDivision && selectedDivisionId ? ' for this division' : ''}
                  </Btn>
                </div>
              )}
            </Card>

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
                          <TeamLogo team={t} size={28} radius={5} />
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

        {/* DIVISIONS (LEAGUE-DIV-1 M3) */}
        {activeTab === 'Divisions' && (
          <>
            <SecLabel>Divisions</SecLabel>
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginBottom: 12, lineHeight: 1.5 }}>
              Each division has its own teams, standings, schedule, and playoffs — all inheriting this league's rules. A single-division league needs no setup; the default "Main" division is already here. Add divisions to split the league (e.g. CAHL's D1 / 4B / 5C).
            </div>
            <Card>
              {divisions.length === 0 && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.3)', padding: '6px 0' }}>No divisions yet.</div>}
              {divisions.map((d, i) => {
                const teamCount = teams.filter(t => t.division_id === d.id).length;
                const arrow = (disabled) => ({ background: 'none', border: 'none', color: disabled ? 'rgba(244,247,250,0.15)' : 'rgba(244,247,250,0.55)', cursor: disabled ? 'default' : 'pointer', fontSize: 9, lineHeight: 1.1, padding: 0 });
                return (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: i < divisions.length - 1 ? '0.5px solid rgba(244,247,250,0.06)' : 'none' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <button onClick={() => handleMoveDivision(i, -1)} disabled={i === 0} style={arrow(i === 0)}>▲</button>
                      <button onClick={() => handleMoveDivision(i, 1)} disabled={i === divisions.length - 1} style={arrow(i === divisions.length - 1)}>▼</button>
                    </div>
                    <input defaultValue={d.name}
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== d.name) handleRenameDivision(d.id, v); }}
                      style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
                    <span style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', whiteSpace: 'nowrap' }}>{teamCount} team{teamCount === 1 ? '' : 's'}</span>
                    <button onClick={() => handleDeleteDivision(d)} title="Delete division"
                      style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.3)', cursor: 'pointer', fontSize: 15 }}
                      onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.3)'}>🗑</button>
                  </div>
                );
              })}
            </Card>
            <SecLabel>Add Division</SecLabel>
            <Card>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inputStyle, flex: 1, marginBottom: 0 }} value={newDivisionName} onChange={e => setNewDivisionName(e.target.value)}
                  placeholder='e.g. "5A-North", "Lower Draft"' onKeyDown={e => { if (e.key === 'Enter') handleAddDivision(); }} />
                <Btn onClick={handleAddDivision} disabled={divBusy || !newDivisionName.trim()}>{divBusy ? 'Adding…' : 'Add'}</Btn>
              </div>
            </Card>
          </>
        )}

        {activeTab === 'Schedule' && (
          <>
            {multiDivision && (
              <>
                <SecLabel>Division</SecLabel>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginBottom: 8 }}>Schedule + games below are scoped to this division. Generate one division at a time.</div>
                <DivisionPicker divisions={divisions} selectedId={selectedDivisionId} onSelect={setSelectedDivisionId} accent={C.red} />
              </>
            )}
            <SecLabel>📋 Already have a schedule? Import it</SecLabel>
            <Card>
              <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 12 }}>
                Paste your teams and schedule straight from a spreadsheet (Excel / Google Sheets) and stand up the whole league in one shot — the fastest way to get live.
              </div>
              <button onClick={() => setShowImport(true)}
                style={{ padding: '11px 18px', borderRadius: 999, background: C.blue, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📋</span>
                <span>Import from spreadsheet</span>
              </button>
            </Card>

            <SecLabel>⚡ Smart Generator — Target Games Per Team</SecLabel>
            <Card>
              <SmartScheduleGenerator
                leagueId={id}
                teams={scopedTeamsList}
                rinks={rinks}
                divisionId={selectedDivisionId}
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
                disabled={!scopedTeamsList || scopedTeamsList.length < 2}
                style={{ padding: '11px 18px', borderRadius: 999, background: scopedTeamsList.length < 2 ? C.border : C.blue, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: scopedTeamsList.length < 2 ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>📅</span>
                <span>Open advanced builder</span>
              </button>
            </Card>

            <SecLabel>Add Single Game</SecLabel>
            <Card>
              <Field label="Home Team">
                <select style={inputStyle} value={gameForm.home_team_id} onChange={e => setGameForm(p => ({ ...p, home_team_id: e.target.value }))}>
                  <option value="">Select home team</option>
                  {scopedTeamsList.map(lt => <option key={lt.id} value={lt.id}>{lt.team?.name || lt.team_name}</option>)}
                </select>
              </Field>
              <Field label="Away Team">
                <select style={inputStyle} value={gameForm.away_team_id} onChange={e => setGameForm(p => ({ ...p, away_team_id: e.target.value }))}>
                  <option value="">Select away team</option>
                  {scopedTeamsList.map(lt => <option key={lt.id} value={lt.id}>{lt.team?.name || lt.team_name}</option>)}
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

            <SecLabel>Schedule ({scopedGamesList.length} games)</SecLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {scopedGamesList.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No games yet — run the Smart Generator above to build the slate.</div>}
              {scopedGamesList.map(g => {
                const home = g.home_lt?.team?.name || g.home_lt?.team_name;
                const away = g.away_lt?.team?.name || g.away_lt?.team_name;
                const isFinal = g.status === 'final';
                return (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {home || '?'} <span style={{ color: 'rgba(244,247,250,0.4)' }}>vs.</span> {away || '?'}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 1 }}>
                        {new Date(g.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        {g.rink?.name ? ` · ${g.rink.sub_rink ? `${g.rink.sub_rink} · ` : ''}${g.rink.name}` : ''}
                        {g.youtube_url ? ' · 📺 stream' : ''}
                      </div>
                    </div>
                    {isFinal && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)' }}>FINAL</span>}
                    <button onClick={() => setEditGameId(g.id)} style={{ background: 'none', border: '0.5px solid rgba(244,247,250,0.2)', color: C.ice, borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Edit</button>
                  </div>
                );
              })}
            </div>

            {editGameId && (() => {
              const g = scopedGamesList.find(x => x.id === editGameId);
              if (!g) return null;
              return (
                <EditGameModal
                  game={g}
                  rinks={rinks}
                  teams={scopedTeamsList.map(lt => ({ id: lt.id, name: lt.team?.name || lt.team_name }))}
                  title="Edit game"
                  onClose={() => setEditGameId(null)}
                  onSave={async (v) => {
                    await updateLeagueGame(g.id, {
                      start_time: v.start_time, rink_id: v.rink_id,
                      location: v.location, live_barn_venue_id: v.live_barn_venue_id, youtube_url: v.youtube_url,
                      home_team_id: v.home_team_id, away_team_id: v.away_team_id,
                    });
                    await load();
                  }}
                  onDelete={async () => {
                    await deleteLeagueGame(g.id);
                    await load();
                  }}
                />
              );
            })()}
          </>
        )}

        {/* PLAYOFFS — Phase 3b (division-scoped in M4) */}
        {activeTab === 'Playoffs' && (
          <>
            {multiDivision && (
              <>
                <SecLabel>Division</SecLabel>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginBottom: 8 }}>Bracket seeds from this division's standings.</div>
                <DivisionPicker divisions={divisions} selectedId={selectedDivisionId} onSelect={setSelectedDivisionId} accent={C.red} />
              </>
            )}
            <PlayoffsTab
              leagueId={id}
              teams={scopedTeamsList}
              standings={scopedStandingsList}
              games={scopedGamesList}
              rinks={rinks}
              divisionId={selectedDivisionId}
              onPublished={async () => { await load(); }}
            />
          </>
        )}

        {showScheduleBuilder && (
          <ScheduleBuilderModal
            leagueId={id}
            leagueTeams={scopedTeamsList}
            divisionId={selectedDivisionId}
            rinkByTeam={rinkByTeamMap(games)}
            onClose={() => setShowScheduleBuilder(false)}
            onPublished={async () => { setShowScheduleBuilder(false); await load(); }}
          />
        )}

        {showImport && (
          <LeagueImportModal
            open={showImport}
            leagueId={id}
            existingTeams={scopedTeamsList}
            rinks={rinks}
            divisionId={selectedDivisionId}
            onImported={async () => { await load(); }}
            onClose={() => setShowImport(false)}
          />
        )}

        {/* SETTINGS */}
        {activeTab === 'Registrations' && league && isCommissioner && (
          <RegistrationsTab leagueId={id} league={league} registrations={registrations} onChanged={load} />
        )}

        {activeTab === 'Sponsors' && league && isCommissioner && (
          <SponsorsManager ownerType="league" ownerId={id} isYouth={league.settings?.feature_profile === 'youth_competitive'}
            settings={league.settings || {}}
            onSaveSettings={async (partial) => { await updateLeague(id, { settings: { ...(league.settings || {}), ...partial } }); await load(); }} />
        )}

        {activeTab === 'Staff' && league && isCommissioner && (
          <LeagueStaffManager leagueId={id} leagueName={league.name} invitedBy={league.commissioner?.name || null} />
        )}

        {activeTab === 'Integrations' && league && isCommissioner && (
          <LeagueIntegrationsTab league={league} games={games} onSave={async (updates) => { await updateLeague(id, updates); await load(); }} />
        )}

        {activeTab === 'Settings' && league && isCommissioner && (
          <LeagueSettings league={league} onSave={async (updates) => { await updateLeague(id, updates); await load(); }} />
        )}
      </div>
    </div>
  );
}

// ── INTEGRATIONS TAB ───────────────────────────────────────────
// INTEGRATIONS-1 — external-source connections for a league. HockeyShift is
// live (its sync reads leagues.settings.hockeyshift.division_id); GameSheet for
// leagues is coming. The HockeyShift connect form is gated behind the reusable
// data-sync authorization clickwrap (DataSyncAuthorization).
function LeagueIntegrationsTab({ league, games = [], onSave }) {
  // division_id may be stored as a number (legacy) or string — coerce for the input.
  const rawWired = league?.settings?.hockeyshift?.division_id;
  const wired = (rawWired === null || rawWired === undefined || rawWired === '') ? '' : String(rawWired);
  const [divId, setDivId] = useState(wired);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const saveHockeyshift = async () => {
    setErr(''); setOk('');
    if (!authorized) { setErr('Authorize the data sync above before connecting.'); return; }
    if (!divId.trim()) { setErr('Enter your HockeyShift division id first.'); return; }
    setBusy(true);
    try {
      const settings = {
        ...(league.settings || {}),
        hockeyshift: { ...(league.settings?.hockeyshift || {}), division_id: divId.trim() },
      };
      await onSave({ settings });
      setOk('Connected — HockeyShift data syncs on the next scheduled run.');
    } catch (e) { setErr(e?.message || "That didn't save — check your connection and try again."); }
    setBusy(false);
  };

  const disconnect = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Disconnect HockeyShift? Future syncs stop — teams and games already imported stay put. You can reconnect anytime.')) return;
    setErr(''); setOk(''); setBusy(true);
    try {
      const hs = { ...(league.settings?.hockeyshift || {}) };
      delete hs.division_id;
      await onSave({ settings: { ...(league.settings || {}), hockeyshift: hs } });
      setDivId('');
      setOk('Disconnected.');
    } catch (e) { setErr(e?.message || "That didn't go through — try again."); }
    setBusy(false);
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.65)', marginBottom: 18, lineHeight: 1.5 }}>
        Connect Rinkd to your external scoring/stats provider. Teams, schedule, scores, standings, and recap pushes flow off the synced results — no double-entry.
      </div>

      {/* HockeyShift */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.ice, textTransform: 'uppercase', marginBottom: 4, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>HockeyShift / ShiftStats</div>
      <div style={{ fontSize: 12.5, color: 'rgba(244,247,250,0.6)', margin: '12px 0', lineHeight: 1.5 }}>
        Runs your league on HockeyShift (DigitalShift / ShiftStats)? Authorize the sync and paste your division id — Rinkd imports teams, games, and scores automatically.
      </div>

      <div style={{ marginBottom: 14 }}>
        <DataSyncAuthorization
          ownerType="league"
          ownerId={league.id}
          integration="hockeyshift"
          label="HockeyShift"
          accent={C.red}
          onAuthorizedChange={setAuthorized}
        />
      </div>

      {wired ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, color: C.ice, fontWeight: 600 }}>
            Connected · division <code style={{ color: C.ice }}>{wired}</code>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.5)', marginTop: 4, lineHeight: 1.5 }}>
            Live data syncs on Rinkd's schedule. Change the id below to re-point, or disconnect to stop syncing.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={divId} onChange={(e) => setDivId(e.target.value)} placeholder="HockeyShift division id (e.g. 48313)" style={{ ...inputStyle, flex: 1 }} />
            <Btn onClick={saveHockeyshift} disabled={busy || !authorized}>{busy ? 'Saving…' : 'Update'}</Btn>
          </div>
          <button onClick={disconnect} disabled={busy} style={{ background: 'none', border: `1px solid ${C.red}`, color: C.red, borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif', marginTop: 10 }}>Disconnect</button>
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, opacity: authorized ? 1 : 0.55 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>HockeyShift division id</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={divId} onChange={(e) => setDivId(e.target.value)} placeholder="e.g. 48313" disabled={!authorized} style={{ ...inputStyle, flex: 1 }} />
            <Btn onClick={saveHockeyshift} disabled={busy || !authorized || !divId.trim()}>{busy ? 'Connecting…' : 'Connect'}</Btn>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.45)', marginTop: 8, lineHeight: 1.5 }}>
            Find it in your ShiftStats URL: <code style={{ color: C.ice }}>shiftstats.com/divisions/<b>48313</b></code>. {!authorized && 'Authorize the data sync above to enable.'}
          </div>
        </div>
      )}

      {err && <div style={{ color: C.red, fontSize: 12.5, marginTop: 10 }}>{err}</div>}
      {ok && <div style={{ color: '#22C55E', fontSize: 12.5, marginTop: 10 }}>{ok}</div>}

      {/* GameSheet — live for leagues (GAMESHEET-LEAGUES-1) */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.ice, textTransform: 'uppercase', margin: '26px 0 4px', paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>GameSheet</div>
      <LeagueGameSheetSection league={league} games={games} />
    </div>
  );
}

// GAMESHEET-LEAGUES-1 — league GameSheet connect section. Mirrors the
// tournament GameSheetTab (TournamentManage.js) and the HockeyShift block above:
// authorize → paste a season id → Connect. The sync-gamesheet cron then mirrors
// scores into league_games (auto-import + recaps), and queues fuzzy matches as
// one-tap pending rows. Volunteer-grade: the commissioner only pastes a season
// id and taps Connect. Uses inline ok/err feedback to match the rest of the tab.
function LeagueGameSheetSection({ league, games = [] }) {
  const leagueId = league.id;
  const [links, setLinks] = useState([]);
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seasonId, setSeasonId] = useState('');
  const [autoImport, setAutoImport] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMapId, setBusyMapId] = useState(null);
  // Per-unmatched-row manual game pick (mapId → league_games id).
  const [pick, setPick] = useState({});
  const [msg, setMsg] = useState(null); // { kind:'ok'|'err', text }

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lk }, { data: mp }] = await Promise.all([
      listLeagueLinks(leagueId),
      listLeagueGameMaps(leagueId),
    ]);
    setLinks(lk || []); setMaps(mp || []); setLoading(false);
  }, [leagueId]);
  useEffect(() => { load(); }, [load]);

  // League games by id → "Home vs. Away" for resolving matched/manual rows.
  // (league games embed teams as home_lt / away_lt — see getLeagueGames.)
  const gameLabel = useMemo(() => {
    const m = {};
    for (const g of games) m[g.id] = `${g.home_lt?.team_name || 'TBD'} vs. ${g.away_lt?.team_name || 'TBD'}`;
    return m;
  }, [games]);
  // Games not already mapped — candidates for resolving an unmatched row.
  const unmappedGames = useMemo(() => {
    const taken = new Set(maps.filter(m => m.rinkd_game_id && m.status !== 'ignored').map(m => m.rinkd_game_id));
    return games.filter(g => !taken.has(g.id));
  }, [games, maps]);

  const addLink = async () => {
    if (!authorized) { setMsg({ kind: 'err', text: 'Authorize the data sync above before connecting.' }); return; }
    if (!seasonId.trim()) { setMsg({ kind: 'err', text: 'Paste the GameSheet season id first.' }); return; }
    setBusy(true);
    const { error } = await createLeagueLink(leagueId, { seasonId, autoImport });
    setBusy(false);
    if (error) { setMsg({ kind: 'err', text: `Couldn't link: ${error.message}` }); return; }
    setMsg({ kind: 'ok', text: autoImport ? 'Linked — teams, games + scores will sync in automatically.' : 'Linked — scores sync onto your existing schedule (you confirm matches).' });
    setSeasonId(''); load();
  };
  const toggleLink = async (lk) => {
    const { error } = await setLinkStatus(lk.id, lk.status === 'active' ? 'paused' : 'active');
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    load();
  };
  const dropLink = async (lk) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Unlink GameSheet season ${lk.gamesheet_season_id}? Scores already synced stay put — only future syncs stop. You can relink anytime.`)) return;
    const { error } = await removeLeagueLink(lk.id, leagueId);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setMsg({ kind: 'ok', text: 'Unlinked.' }); load();
  };
  const doConfirm = async (m) => {
    const rid = m.rinkd_game_id || pick[m.id];
    if (!rid) { setMsg({ kind: 'err', text: 'Pick the league game this matches first.' }); return; }
    setBusyMapId(m.id);
    const { error } = await confirmMatch(m.id, m.rinkd_game_id ? undefined : rid);
    setBusyMapId(null);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setMsg({ kind: 'ok', text: 'Confirmed — the next sync writes the score.' });
    load();
  };
  const doIgnore = async (m) => {
    setBusyMapId(m.id);
    const { error } = await ignoreMatch(m.id);
    setBusyMapId(null);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    load();
  };

  const pending = maps.filter(m => m.status === 'pending');
  const confirmed = maps.filter(m => m.status === 'confirmed');
  const hasLink = links.length > 0;
  const fmt = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'rgba(244,247,250,0.6)', margin: '12px 0', lineHeight: 1.5 }}>
        Run your league on GameSheet? Authorize the sync and paste the season id — Rinkd mirrors the scores in automatically. Standings, stats, the feed + recap pushes all flow off the imported results. No double-entry.
      </div>

      <div style={{ marginBottom: 14 }}>
        <DataSyncAuthorization
          ownerType="league"
          ownerId={leagueId}
          integration="gamesheet"
          label="GameSheet"
          accent={C.red}
          onAuthorizedChange={setAuthorized}
        />
      </div>

      {/* Link form / current links */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 16, opacity: (authorized || hasLink) ? 1 : 0.55 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.4)', textTransform: 'uppercase', marginBottom: 10 }}>Linked GameSheet seasons</div>
        {links.map((lk) => (
          <div key={lk.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(46,91,140,0.2)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>
                Season {lk.gamesheet_season_id}
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: lk.status === 'active' ? '#22C55E' : C.steel, background: lk.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(139,163,190,0.15)' }}>{lk.status === 'active' ? 'ACTIVE' : 'PAUSED'}</span>
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: C.steel, background: 'rgba(139,163,190,0.12)' }}>{lk.auto_import ? 'AUTO-IMPORT' : 'MATCH-ONLY'}</span>
              </div>
              <div style={{ fontSize: 11, color: C.steel, marginTop: 3 }}>
                {lk.last_synced_at ? `Last sync ${fmt(lk.last_synced_at)}${lk.last_sync_note ? ` · ${lk.last_sync_note}` : ''}` : 'Waiting for first sync…'}
              </div>
            </div>
            <button onClick={() => toggleLink(lk)} style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>{lk.status === 'active' ? 'Pause' : 'Resume'}</button>
            <button onClick={() => dropLink(lk)} style={{ background: 'transparent', color: C.red, border: `1px solid ${C.red}`, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Unlink</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: links.length ? 12 : 0 }}>
          <input value={seasonId} onChange={(e) => setSeasonId(e.target.value)} placeholder="GameSheet season id (e.g. 15073)" disabled={!authorized} style={{ ...inputStyle, flex: 1 }} />
          <Btn onClick={addLink} disabled={busy || !authorized || !seasonId.trim()}>{busy ? 'Linking…' : '+ Link season'}</Btn>
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, fontSize: 12, color: C.ice, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoImport} onChange={(e) => setAutoImport(e.target.checked)} disabled={!authorized} style={{ marginTop: 2 }} />
          <span><b>Auto-create teams &amp; games from GameSheet</b> <span style={{ color: C.steel }}>— recommended. Leave on if you haven&rsquo;t built your schedule in Rinkd; the poller creates the teams + games (with scores) for you. Turn off to match incoming results onto a schedule you&rsquo;ve already set up.</span></span>
        </label>
        <div style={{ fontSize: 11, color: C.steel, marginTop: 8, lineHeight: 1.5 }}>
          Find the id in your GameSheet stats URL: <code style={{ color: C.ice }}>gamesheetstats.com/seasons/<b>15073</b>/scores</code>. {!authorized && 'Authorize the data sync above to enable.'}
        </div>
      </div>

      {msg && <div style={{ color: msg.kind === 'ok' ? '#22C55E' : C.red, fontSize: 12.5, margin: '0 0 14px' }}>{msg.text}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: '24px 0', fontSize: 13 }}>Getting the ice ready.</div>
      ) : !hasLink ? null : (
        <>
          {/* Pending matches — commissioner confirms before any score is written */}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>
            Needs review ({pending.length})
          </div>
          {pending.length === 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, color: C.steel, fontSize: 13 }}>
              Nothing to review. New GameSheet results show up here for a quick confirm before they post.
            </div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              {pending.map((m, i) => (
                <div key={m.id} style={{ padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                    {m.gs_home_name} {m.gs_home_goals}–{m.gs_visitor_goals} {m.gs_visitor_name}
                  </div>
                  <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>
                    GameSheet · {[m.gs_date, m.gs_time, m.gs_division].filter(Boolean).join(' · ')}
                  </div>
                  {m.rinkd_game_id ? (
                    <div style={{ fontSize: 12, color: C.ice, marginTop: 8 }}>
                      → matches <b>{gameLabel[m.rinkd_game_id] || 'a league game'}</b>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: '#F59E0B', marginBottom: 4 }}>No automatic match — pick the league game:</div>
                      <select value={pick[m.id] || ''} onChange={(e) => setPick(p => ({ ...p, [m.id]: e.target.value }))} style={inputStyle}>
                        <option value="">— Select game —</option>
                        {unmappedGames.map(g => <option key={g.id} value={g.id}>{gameLabel[g.id]}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => doIgnore(m)} disabled={busyMapId === m.id} style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, borderRadius: 999, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Ignore</button>
                    <Btn onClick={() => doConfirm(m)} disabled={busyMapId === m.id}>{busyMapId === m.id ? '…' : 'Confirm'}</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Confirmed / synced */}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>
            Synced ({confirmed.length})
          </div>
          {confirmed.length === 0 ? (
            <div style={{ color: C.steel, fontSize: 13, padding: '4px 0 16px' }}>No games synced yet.</div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
              {confirmed.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{m.gs_home_name} {m.gs_home_goals}–{m.gs_visitor_goals} {m.gs_visitor_name}</div>
                    <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>{m.rinkd_game_id ? (gameLabel[m.rinkd_game_id] || 'imported game') : '—'}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, color: '#22C55E', background: 'rgba(34,197,94,0.15)' }}>SYNCED</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
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
function PlayoffsTab({ leagueId, teams, standings, games, rinks, divisionId = null, onPublished }) {
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
    const { error: insertErr } = await bulkInsertLeagueGames(leagueId, rows, divisionId);
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

function SmartScheduleGenerator({ leagueId, teams, rinks, divisionId = null, onPublished }) {
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
    const { error: insertErr } = await bulkInsertLeagueGames(leagueId, preview.rows, divisionId);
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
  const [payoutsReady, setPayoutsReady] = useState(null); // null = checking
  const [isFounder, setIsFounder] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectReturn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('connect') === 'done';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ready, { data: { user } }] = await Promise.all([
        leaguePayoutsReady(leagueId),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      setPayoutsReady(ready);
      setIsFounder(!!user && user.id === league.commissioner_id);
    })();
    return () => { cancelled = true; };
  }, [leagueId, league.commissioner_id]);

  const handleConnect = async () => {
    setConnecting(true);
    try { await startConnectOnboarding(`/league/${leagueId}/manage`); } // redirects away on success
    catch (e) { setCfgFlash({ kind: 'err', text: e.message || 'Could not start payout setup.' }); setConnecting(false); }
  };

  const regLink = `${window.location.origin}/league/${leagueId}/register`;

  const saveConfig = async () => {
    const feeCentsVal = Math.max(0, Math.round((parseFloat(feeDollars) || 0) * 100));
    setSavingCfg(true); setCfgFlash(null);
    try {
      await updateLeague(leagueId, {
        registration_open: open,
        registration_fee_cents: feeCentsVal,
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
      {/* --- Payouts (Stripe Connect) --- */}
      <SecLabel>Payouts</SecLabel>
      <Card>
        {payoutsReady === null ? (
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>Checking payout status…</div>
        ) : payoutsReady ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Payouts connected</div>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginTop: 2 }}>
                You receive 99% of every entry fee (Rinkd keeps 1%); Stripe handles the deposit + processing.
              </div>
            </div>
          </div>
        ) : isFounder ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Get paid directly <span style={{ color: 'rgba(244,247,250,0.4)', fontWeight: 600 }}>(optional)</span></div>
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.55)', marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
              Paid registration works right now — fees collect through Rinkd and we settle up with you. Want entry fees deposited straight to your bank automatically instead? Connect a Stripe account (you keep 99%). You can do this anytime.
            </div>
            <button onClick={handleConnect} disabled={connecting}
              style={{ padding: '11px 18px', background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 999, color: C.ice, fontSize: 14, fontWeight: 700, cursor: connecting ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif', opacity: connecting ? 0.6 : 1 }}>
              {connecting ? 'Opening Stripe…' : '💳 Connect payouts'}
            </button>
            {connectReturn && (
              <div style={{ fontSize: 12, color: '#F59E0B', marginTop: 10 }}>
                Just finished on Stripe? Verification can take a moment — reload this page to see it as connected.
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>
            Entry fees for this league are handled through Rinkd.
          </div>
        )}
      </Card>

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

// Normalize the recap + game-puck sponsors before save: a blank name clears that
// one (→ null) so it falls back (puck → recap → Rinkd); otherwise trim + null empties.
function cleanSponsorOnForm(form) {
  const settings = { ...(form.settings || {}) };
  const norm = (sp) => sp && (sp.name || '').trim()
    ? { name: sp.name.trim(), logo_url: (sp.logo_url || '').trim() || null, url: (sp.url || '').trim() || null }
    : null;
  settings.recap_sponsor = norm(settings.recap_sponsor);
  settings.gamepuck_sponsor = norm(settings.gamepuck_sponsor);
  // GS-6 — usah_classification has a CHECK constraint (six levels or NULL), so
  // the empty "Select…" option must coerce to null, never ''. Blank the other
  // compliance text fields to null too for a clean row.
  return {
    ...form,
    settings,
    usah_classification: form.usah_classification || null,
    usah_association_name: (form.usah_association_name || '').trim() || null,
    division_label: (form.division_label || '').trim() || null,
  };
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
    // GS-6 — USA Hockey compliance (season-setup; never asked of the game-day volunteer)
    usah_compliant_scoresheet: !!league.usah_compliant_scoresheet,
    usah_association_name: league.usah_association_name || '',
    usah_classification: league.usah_classification || '',
    division_label: league.division_label || '',
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
    if (upErr || !url) { alert("That logo didn't upload — check your connection and try again."); return; }
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
      <div style={{ fontSize: 12, color: '#8BA3BE', margin: '4px 0 14px', lineHeight: 1.5 }}>
        Recap &amp; Game Puck sponsors moved to the <b style={{ color: '#F4F7FA' }}>Sponsors</b> tab.
      </div>

      {/* GS-6 — USA Hockey compliant scoresheet (set once here; the scorer's
          official scoresheet then prints the roster, coaches, times + enforces
          coach/official signatures automatically). */}
      <SecLabel>USA Hockey Compliance</SecLabel>
      <Card>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '4px 0' }}>
          <input type="checkbox" checked={form.usah_compliant_scoresheet}
            onChange={e => set('usah_compliant_scoresheet', e.target.checked)}
            style={{ width: 20, height: 20, accentColor: C.red, flexShrink: 0, cursor: 'pointer' }} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#F4F7FA' }}>Produce a USA Hockey official scoresheet</span>
            <span style={{ display: 'block', fontSize: 12, color: '#8BA3BE', marginTop: 2, lineHeight: 1.4 }}>
              Turns on the printed roster, coaches block, game times, and coach + referee signatures. Leave off for non-USA-Hockey play.
            </span>
          </span>
        </label>
        {form.usah_compliant_scoresheet && (
          <div style={{ marginTop: 14 }}>
            <Field label="USA Hockey Registered Association">
              <input style={inputStyle} value={form.usah_association_name} onChange={e => set('usah_association_name', e.target.value)} placeholder="e.g. Cleveland Suburban Hockey League" />
            </Field>
            <Row2>
              <Field label="Level of Play">
                <select style={inputStyle} value={form.usah_classification} onChange={e => set('usah_classification', e.target.value)}>
                  <option value="">Select…</option>
                  <option value="tier1">Tier I</option>
                  <option value="tier2">Tier II</option>
                  <option value="girls_women">Girls/Women</option>
                  <option value="high_school">High School</option>
                  <option value="house_rec">House/Rec</option>
                  <option value="adult">Adult</option>
                </select>
              </Field>
              <Field label="Division (e.g. 10U, 12U)">
                <input style={inputStyle} value={form.division_label} onChange={e => set('division_label', e.target.value)} placeholder="10U" />
              </Field>
            </Row2>
          </div>
        )}
      </Card>
      <button onClick={async () => { setSaving(true); await onSave(cleanSponsorOnForm(form)); setSaving(false); }} disabled={saving || uploadingLogo}
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
