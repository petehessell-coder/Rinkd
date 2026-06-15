import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getTeam, getTeamMembers, getTeamGames, getUserRoleOnTeam, isLeagueStaffOfTeam, requestToJoin } from '../lib/teams';
import { captureDataError } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import RsvpBlock from '../components/RsvpBlock';
import PinToNavButton from '../components/PinToNavButton';
import MapLink from '../components/MapLink';
import CalendarButton from '../components/CalendarButton';
import LineupCTA from '../components/LineupCTA';
import TeamFeed from '../components/TeamFeed';
import TeamVolunteer from '../components/TeamVolunteer';
import SEO from '../components/SEO';
import { buildIcsMulti, downloadIcs } from '../lib/ics';
import SubscribeCalendarSheet from '../components/SubscribeCalendarSheet';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };

const TABS = ['Roster', 'Schedule', 'Feed', 'Volunteer', 'Info'];

function Avatar({ name, color, initials, size = 34 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: size * 0.38, color: '#fff', flexShrink: 0 }}>
      {initials || (name || '?').slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function TeamPage({ currentUser, profile }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [games, setGames] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [isLeagueStaff, setIsLeagueStaff] = useState(false); // league commissioner/manager of this team's league
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Roster');
  const [joinRequested, setJoinRequested] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  // Default schedule view shows recent 5 + upcoming 5; tapping "Show all"
  // expands to every game past + future. Persists per-team via state, resets
  // on page change. Keeps the team page light by default but never hides data.
  const [showAllGames, setShowAllGames] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, m, g, r, ls] = await Promise.all([
        getTeam(id), getTeamMembers(id), getTeamGames(id), getUserRoleOnTeam(id), isLeagueStaffOfTeam(id)
      ]);
      setTeam(t); setMembers(m); setGames(g); setUserRole(r); setIsLeagueStaff(ls);

      // Hydrate joinRequested from the DB so a reload after requesting
      // doesn't show the button as fresh-and-active. RLS lets a user
      // SELECT their own pending requests; the row may have any status —
      // we only suppress the button when there's an unresolved 'pending'.
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: existing } = await supabase
          .from('team_join_requests')
          .select('status')
          .eq('team_id', id)
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .maybeSingle();
        if (existing) setJoinRequested(true);
      }
    } catch(e) { console.error(e); captureDataError(e, { where: 'Team.load', teamId: id }); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleJoin = async () => {
    setJoinLoading(true);
    try {
      await requestToJoin(id);
      setJoinRequested(true);
    } catch (e) {
      console.error(e);
      // A duplicate just means the request is already in — treat it as done.
      if (/duplicate/i.test(e?.message || '')) {
        setJoinRequested(true);
      } else {
        // eslint-disable-next-line no-alert
        alert("Couldn't send your join request. Check your connection and try again.");
      }
    }
    setJoinLoading(false);
  };

  if (loading) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Loading...</div>
    </Layout>
  );

  if (!team) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Team not found</div>
    </Layout>
  );

  // Manager = founding manager (teams.manager_id) OR team_members.role in (manager, coach).
  // Coaches get manager-equivalent access for now (interim — see ROLE-COACH-1 on the
  // roadmap). Honored server-side too: is_team_manager() treats manager + coach alike.
  // We OR the checks client-side so the UI matches what the server will allow.
  const isManager = userRole?.role === 'manager' || userRole?.role === 'coach' || (currentUser && team && team.manager_id === currentUser.id);
  // A league commissioner/manager of this team's league can also reach Manage (to
  // approve roster join-requests etc.) even when they don't directly manage the team.
  const canManage = isManager || isLeagueStaff;
  const isMember = !!userRole;
  const goalies = members.filter(m => m.role === 'goalie' || m.position?.toLowerCase().includes('goalie'));
  const defense = members.filter(m => m.position?.toLowerCase().includes('defense') || m.position?.toLowerCase().includes('d'));
  const forwards = members.filter(m => !goalies.includes(m) && !defense.includes(m) && m.role !== 'manager');
  const coaches = members.filter(m => m.role === 'coach' || m.role === 'manager');
  // When collapsed: show the 5 most recent and 5 next upcoming.
  // When expanded: show every game (capped at 200 as a sanity rail).
  // getTeamGames() returns everything newest-first — correct for finished
  // games (last game on top), backwards for upcoming. So we re-sort the
  // upcoming list ascending: next game on top, end of season at the bottom.
  const allFinal     = games.filter(g => g.status === 'final');
  const allUpcoming  = games
    .filter(g => g.status === 'scheduled')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const recentGames   = showAllGames ? allFinal.slice(0, 200)    : allFinal.slice(0, 5);
  const upcomingGames = showAllGames ? allUpcoming.slice(0, 200) : allUpcoming.slice(0, 5);
  const totalGames    = allFinal.length + allUpcoming.length;
  const visibleGames  = recentGames.length + upcomingGames.length;
  const hasMoreGames  = totalGames > visibleGames;

  const wins = games.filter(g => {
    if (g.status !== 'final') return false;
    const teamScore = g.is_home ? g.home_score : g.away_score;
    const oppScore = g.is_home ? g.away_score : g.home_score;
    return teamScore > oppScore;
  }).length;
  const losses = games.filter(g => {
    if (g.status !== 'final') return false;
    const teamScore = g.is_home ? g.home_score : g.away_score;
    const oppScore = g.is_home ? g.away_score : g.home_score;
    return teamScore < oppScore;
  }).length;
  const ties = games.filter(g => {
    if (g.status !== 'final') return false;
    const teamScore = g.is_home ? g.home_score : g.away_score;
    const oppScore = g.is_home ? g.away_score : g.home_score;
    return teamScore === oppScore && teamScore != null;
  }).length;

  const renderMemberRow = (m) => (
    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: 'rgba(244,247,250,0.3)', width: 28, textAlign: 'center', flexShrink: 0 }}>
        {m.jersey_number || '—'}
      </div>
      <Avatar name={m.profile?.name} color={m.profile?.avatar_color} initials={m.profile?.avatar_initials} size={34} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{m.profile?.name || m.invite_name || 'Unknown'}{m.status === 'pending' && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: 'rgba(245,158,11,0.2)', color: '#F59E0B' }}>INVITED</span>}</div>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)' }}>
          {[m.position, m.shot_hand ? `${m.shot_hand} shot` : null].filter(Boolean).join(' · ')}
        </div>
      </div>
      {m.is_captain && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(215,38,56,0.2)', color: C.red }}>C</span>}
      {m.is_alternate && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(46,91,140,0.3)', color: C.steel }}>A</span>}
      {m.role === 'goalie' && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(46,91,140,0.3)', color: C.steel }}>G</span>}
    </div>
  );

  const renderGameRow = (g) => {
    const teamScore = g.is_home ? g.home_score : g.away_score;
    const oppScore = g.is_home ? g.away_score : g.home_score;
    const isWin = g.status === 'final' && teamScore > oppScore;
    const isLoss = g.status === 'final' && teamScore < oppScore;
    const date = new Date(g.start_time);
    const isLeagueGame = g._source === 'league';
    // Route by source so GameDetail queries the right table:
    //   league   → /league-game/:id?type=league
    //   team-only → /game/:id?type=team  (team_games table)
    //   tournament → /game/:id  (games table — not exposed via Team schedule today)
    const gameUrl = isLeagueGame
      ? `/league-game/${g.id}?type=league`
      : `/game/${g.id}?type=team`;

    return (
      <div key={g.id}
        onClick={() => navigate(gameUrl)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.08)'; }}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', width: 48, flexShrink: 0, lineHeight: 1.4 }}>
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br/>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
              {g.is_home ? 'vs.' : '@'} {g.opponent}
            </div>
            {isLeagueGame && g._league_name && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: 'rgba(46,91,140,0.3)', color: '#8BA3BE', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                {g._league_name}
              </span>
            )}
          </div>
          {(g.location || g.rink) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}
              onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: 11, color: 'rgba(244,247,250,0.5)' }}>
                {g.rink ? [g.rink.sub_rink, g.rink.name].filter(Boolean).join(' · ') : g.location}
              </span>
              <MapLink rink={g.rink} text={g.location} icon=""
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  padding: '3px 9px', borderRadius: 999,
                  background: 'rgba(46,91,140,0.25)',
                  border: '0.5px solid rgba(46,91,140,0.6)',
                  color: C.ice, textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: "'Barlow', sans-serif",
                }}>
                📍 Directions
              </MapLink>
              {g.status === 'scheduled' && (
                <CalendarButton game={g} teamLabel={`${team.name} ${g.is_home ? 'vs.' : '@'} ${g.opponent || ''}`.trim()} />
              )}
            </div>
          )}
          {g.status === 'scheduled' && <RsvpBlock gameId={g.id} compact={false} />}
          {g.status === 'scheduled' && isManager && (
            <div onClick={e => e.stopPropagation()}>
              <LineupCTA game={g} teamId={id} teamName={team.name} canManage={isManager} onSaved={load} />
            </div>
          )}
        </div>
        {g.status === 'final'
          ? <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: isWin ? '#22C55E' : isLoss ? C.red : C.ice }}>
              {isWin ? 'W' : isLoss ? 'L' : 'T'} {teamScore}–{oppScore}
            </div>
          : <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
              <span style={{ fontSize: 14, color: 'rgba(244,247,250,0.25)' }}>›</span>
            </div>
        }
      </div>
    );
  };

  return (
    <Layout profile={profile}>
      <SEO
        title={`${team.name}${team.level ? ' · ' + team.level : ''}`}
        description={`${team.name} — ${members.length} player${members.length === 1 ? '' : 's'}${team.home_rink ? ` · ${team.home_rink}` : ''}. Follow schedule, lineups, and roster on Rinkd.`}
        url={`https://rinkd.app/team/${team.id}`}
      />
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>

        {/* TEAM BANNER */}
        <div style={{ background: 'linear-gradient(135deg,#0B1F3A 0%,#1a3a5c 100%)', padding: '20px 16px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 64, height: 64, borderRadius: 12, background: team.logo_url ? `url(${team.logo_url}) center/cover, ${team.logo_color || C.red}` : (team.logo_color || C.red), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, color: '#fff', flexShrink: 0, border: `2px solid ${team.logo_color || C.red}88` }}>
            {!team.logo_url && (team.logo_initials || team.name.slice(0, 2).toUpperCase())}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: C.ice, lineHeight: 1.1 }}>{team.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginTop: 4 }}>
              {[team.division, team.level, team.location].filter(Boolean).join(' · ')}
            </div>
            {team.home_rink && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'rgba(244,247,250,0.45)' }}>🏟 {team.home_rink}</span>
                <MapLink text={team.home_rink} icon=""
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                    padding: '3px 9px', borderRadius: 999,
                    background: 'rgba(46,91,140,0.25)',
                    border: '0.5px solid rgba(46,91,140,0.6)',
                    color: C.ice, textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontFamily: "'Barlow', sans-serif",
                  }}>
                  📍 Directions
                </MapLink>
              </div>
            )}
          </div>
          {canManage && (
            <button onClick={() => navigate(`/team/${id}/manage`)}
              style={{ background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: C.ice, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.25)'; e.currentTarget.style.color = C.ice; }}>
              ⚙️ Manage
            </button>
          )}
          {currentUser && <PinToNavButton userId={currentUser.id} pinType="team" targetId={id} />}
        </div>

        {/* STATS BAR */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '0.5px solid rgba(46,91,140,0.4)', background: C.navy }}>
          {[
            { num: members.length, label: 'Players' },
            { num: games.filter(g => g.status === 'final').length, label: 'Games' },
            { num: wins, label: 'Wins', color: '#22C55E' },
            { num: losses, label: 'Losses', color: C.red },
            { num: ties, label: 'Ties', color: 'rgba(244,247,250,0.65)' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '10px 0', textAlign: 'center', borderRight: i < 3 ? '0.5px solid rgba(46,91,140,0.3)' : 'none' }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: s.color || C.ice }}>{s.num}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(244,247,250,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div style={{ display: 'flex', background: C.navy, borderBottom: '2px solid rgba(46,91,140,0.3)', overflowX: 'auto' }}>
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ fontSize: 13, fontWeight: 700, padding: '10px 16px', color: '#FFFFFF', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '3px solid #D72638' : '3px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', opacity: activeTab === tab ? 1 : 0.5, transition: 'opacity 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.opacity = activeTab === tab ? '1' : '0.5'; }}>
              {tab}
            </button>
          ))}
        </div>

        <div style={{ padding: 16 }}>

          {/* COACH: next-game lines prompt — first thing a manager sees, every tab */}
          {isManager && (() => {
            const now = Date.now();
            const next = games
              .filter(g => g.status === 'scheduled' && g.start_time && new Date(g.start_time).getTime() >= now - 2 * 3.6e6)
              .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0];
            if (!next) return null;
            const d = new Date(next.start_time);
            return (
              <div style={{ marginBottom: 14, padding: 14, borderRadius: 12, background: 'rgba(46,91,140,0.12)', border: '1px solid rgba(46,91,140,0.5)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8BA3BE', marginBottom: 4 }}>Your next game</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.ice }}>
                  {next.is_home ? 'vs.' : '@'} {next.opponent || 'TBD'}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.6)', marginTop: 2 }}>
                  {d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} · {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
                <LineupCTA game={next} teamId={id} teamName={team.name} canManage={isManager} onSaved={load} />
              </div>
            );
          })()}

          {/* ROSTER TAB */}
          {activeTab === 'Roster' && (
            <>
              {coaches.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Coaching Staff</div>
                  <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                    {coaches.map(renderMemberRow)}
                  </div>
                </>
              )}
              {goalies.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Goalies</div>
                  <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                    {goalies.map(renderMemberRow)}
                  </div>
                </>
              )}
              {defense.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Defense</div>
                  <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                    {defense.map(renderMemberRow)}
                  </div>
                </>
              )}
              {forwards.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Forwards</div>
                  <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                    {forwards.map(renderMemberRow)}
                  </div>
                </>
              )}
              {members.length === 0 && (
                <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '30px 0' }}>No players on roster yet</div>
              )}
              {!isMember && (
                <button onClick={handleJoin} disabled={joinLoading || joinRequested}
                  style={{ width: '100%', padding: 13, background: joinRequested ? 'rgba(46,91,140,0.2)' : C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 14, fontWeight: 700, cursor: joinRequested ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif', transition: 'all 0.15s', marginTop: 4 }}
                  onMouseEnter={e => { if (!joinRequested) { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}}
                  onMouseLeave={e => { e.currentTarget.style.background = joinRequested ? 'rgba(46,91,140,0.2)' : C.red; e.currentTarget.style.color = '#fff'; }}>
                  {joinRequested ? '✓ Request Sent' : joinLoading ? 'Sending...' : 'Request to Join Team'}
                </button>
              )}
            </>
          )}

          {/* SCHEDULE TAB */}
          {activeTab === 'Schedule' && (
            <>
              {games.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setSubscribeOpen(true)}
                    style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
                      padding: '8px 16px', borderRadius: 999,
                      background: C.red,
                      border: 'none',
                      color: '#fff', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontFamily: "'Barlow', sans-serif", transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
                    📡 Subscribe (Live)
                  </button>
                  <button
                    onClick={() => {
                      const events = games.map(g => {
                        const isLeagueG = g._source === 'league';
                        const opp = g.opponent || '';
                        const title = `🏒 ${team.name} ${g.is_home ? 'vs.' : '@'} ${opp}`.trim();
                        const venueParts = [];
                        if (g.rink) {
                          const rinkName = [g.rink.sub_rink, g.rink.name].filter(Boolean).join(' · ');
                          if (rinkName) venueParts.push(rinkName);
                          if (g.rink.address) venueParts.push(g.rink.address);
                        } else if (g.location) {
                          venueParts.push(g.location);
                        }
                        const descLines = [];
                        if (isLeagueG && g._league_name) descLines.push(`League: ${g._league_name}`);
                        descLines.push(`Status: ${g.status || 'scheduled'}`);
                        descLines.push('Added from Rinkd · rinkd.app');
                        return {
                          uid: `${g.id}@rinkd.app`,
                          title,
                          start: g.start_time,
                          durationMinutes: 90,
                          location: venueParts.join(' — '),
                          description: descLines.join('\n'),
                        };
                      });
                      const ics = buildIcsMulti(events, `${team.name} schedule`);
                      const safeName = team.name.replace(/[^\w\-]+/g, '_');
                      downloadIcs(ics, `${safeName}_schedule.ics`);
                    }}
                    style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
                      padding: '8px 16px', borderRadius: 999,
                      background: 'rgba(46,91,140,0.25)',
                      border: '0.5px solid rgba(46,91,140,0.6)',
                      color: C.ice, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontFamily: "'Barlow', sans-serif", transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.25)'; e.currentTarget.style.color = C.ice; }}>
                    📅 Add Full Schedule
                  </button>
                </div>
              )}
              {recentGames.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Recent</div>
                  <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                    {recentGames.map(renderGameRow)}
                  </div>
                </>
              )}
              {upcomingGames.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Upcoming</div>
                  <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                    {upcomingGames.map(renderGameRow)}
                  </div>
                </>
              )}
              {(hasMoreGames || showAllGames) && totalGames > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                  <button
                    onClick={() => setShowAllGames(v => !v)}
                    style={{
                      padding: '10px 18px',
                      borderRadius: 999,
                      background: 'transparent',
                      border: `1px solid ${C.border}`,
                      color: C.ice,
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontStyle: 'italic',
                      fontSize: 13,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.blue + '33'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    {showAllGames
                      ? `Show recent only`
                      : `Show all ${totalGames} games →`}
                  </button>
                </div>
              )}
              {games.length === 0 && (
                <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '30px 0' }}>No games scheduled yet</div>
              )}
            </>
          )}

          {/* FEED TAB */}
          {activeTab === 'Feed' && (
            <TeamFeed teamId={team.id} currentUser={currentUser} isMember={isMember} />
          )}

          {/* VOLUNTEER TAB — open slots, claim/release, manager can add */}
          {activeTab === 'Volunteer' && (
            <TeamVolunteer teamId={team.id} isManager={isManager} currentUser={currentUser} />
          )}

          {/* INFO TAB */}
          {activeTab === 'Info' && (
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {[
                ['Division', team.division],
                ['Level', team.level],
                ['Location', team.location],
                ['Home Rink', team.home_rink ? <MapLink text={team.home_rink} icon="" style={{ color: C.ice, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }} /> : null],
                ['Manager', team.manager ? `@${team.manager.handle}` : '—'],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                  <span style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>{k}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{v}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>


      <SubscribeCalendarSheet
        open={subscribeOpen}
        onClose={() => setSubscribeOpen(false)}
        httpsUrl={`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/schedule-ics?team=${team?.id || ''}`}
        webcalUrl={`${(process.env.REACT_APP_SUPABASE_URL || '').replace(/^https/, 'webcal')}/functions/v1/schedule-ics?team=${team?.id || ''}`}
        title={team?.name ? `${team.name}'s schedule` : 'this team\'s schedule'}
      />
    </Layout>
  );
}
