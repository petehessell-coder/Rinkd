import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getTeam, getTeamMembers, getTeamGames, getUserRoleOnTeam, requestToJoin } from '../lib/teams';
import RsvpBlock from '../components/RsvpBlock';
import MapLink from '../components/MapLink';
import CalendarButton from '../components/CalendarButton';
import LineupModal from '../components/LineupModal';
import { buildIcsMulti, downloadIcs } from '../lib/ics';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };

const TABS = ['Roster', 'Schedule', 'Feed', 'Info'];

function Avatar({ name, color, initials, size = 34 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: size * 0.38, color: '#fff', flexShrink: 0 }}>
      {initials || (name || '?').slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function TeamPage({ profile }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [games, setGames] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Roster');
  const [joinRequested, setJoinRequested] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [lineupGame, setLineupGame] = useState(null); // game object whose lineup modal is open

  const load = useCallback(async () => {
    try {
      const [t, m, g, r] = await Promise.all([
        getTeam(id), getTeamMembers(id), getTeamGames(id), getUserRoleOnTeam(id)
      ]);
      setTeam(t); setMembers(m); setGames(g); setUserRole(r);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleJoin = async () => {
    setJoinLoading(true);
    try { await requestToJoin(id); setJoinRequested(true); } catch(e) { console.error(e); }
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

  const isManager = userRole?.role === 'manager';
  const isMember = !!userRole;
  const goalies = members.filter(m => m.role === 'goalie' || m.position?.toLowerCase().includes('goalie'));
  const defense = members.filter(m => m.position?.toLowerCase().includes('defense') || m.position?.toLowerCase().includes('d'));
  const forwards = members.filter(m => !goalies.includes(m) && !defense.includes(m) && m.role !== 'manager');
  const coaches = members.filter(m => m.role === 'coach' || m.role === 'manager');
  const recentGames = games.filter(g => g.status === 'final').slice(0, 5);
  const upcomingGames = games.filter(g => g.status === 'scheduled').slice(0, 5);

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
              {isManager && g.status === 'scheduled' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setLineupGame(g); }}
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                    padding: '3px 9px', borderRadius: 999,
                    background: 'rgba(46,91,140,0.25)',
                    border: '0.5px solid rgba(46,91,140,0.6)',
                    color: C.ice, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontFamily: "'Barlow', sans-serif", whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.25)'; e.currentTarget.style.color = C.ice; }}>
                  📋 Lineup
                </button>
              )}
            </div>
          )}
          {g.status === 'scheduled' && <RsvpBlock gameId={g.id} compact={false} />}
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
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>

        {/* TEAM BANNER */}
        <div style={{ background: 'linear-gradient(135deg,#0B1F3A 0%,#1a3a5c 100%)', padding: '20px 16px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 64, height: 64, borderRadius: 12, background: team.logo_color || C.red, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, color: '#fff', flexShrink: 0, border: `2px solid ${team.logo_color || C.red}88` }}>
            {team.logo_initials || team.name.slice(0, 2).toUpperCase()}
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
          {isManager && (
            <button onClick={() => navigate(`/team/${id}/manage`)}
              style={{ background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: C.ice, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.25)'; e.currentTarget.style.color = C.ice; }}>
              ⚙️ Manage
            </button>
          )}
        </div>

        {/* STATS BAR */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '0.5px solid rgba(46,91,140,0.4)', background: C.navy }}>
          {[
            { num: members.length, label: 'Players' },
            { num: games.filter(g => g.status === 'final').length, label: 'Games' },
            { num: wins, label: 'Wins', color: '#22C55E' },
            { num: losses, label: 'Losses', color: C.red },
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
                    onClick={() => {
                      // Live calendar subscription (auto-refreshes when games change).
                      // webcal:// hands off to the OS default calendar app on iOS/macOS;
                      // on Android/desktop browsers we fall back to copying the https URL
                      // so the user can paste it into Google Calendar / Outlook.
                      const base = 'tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/schedule-ics';
                      const webcalUrl = `webcal://${base}?team=${team.id}`;
                      const httpsUrl = `https://${base}?team=${team.id}`;
                      const ua = (navigator.userAgent || '').toLowerCase();
                      const isAppleish = /iphone|ipad|ipod|macintosh/.test(ua);
                      if (isAppleish) {
                        window.location.href = webcalUrl;
                      } else {
                        try {
                          navigator.clipboard?.writeText(httpsUrl);
                          // eslint-disable-next-line no-alert
                          alert('Live calendar link copied!\n\nPaste it into Google Calendar → Other calendars → From URL, or any app that subscribes to .ics feeds. The schedule will auto-refresh.');
                        } catch {
                          window.location.href = webcalUrl;
                        }
                      }
                    }}
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
              {games.length === 0 && (
                <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '30px 0' }}>No games scheduled yet</div>
              )}
            </>
          )}

          {/* FEED TAB */}
          {activeTab === 'Feed' && (
            <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '40px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📣</div>
              Team feed coming soon
            </div>
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

      {lineupGame && (
        <LineupModal
          open={true}
          onClose={() => setLineupGame(null)}
          onSaved={load}
          gameId={lineupGame.id}
          gameSource={lineupGame._source === 'league' ? 'league' : 'team'}
          teamId={id}
          /* For league games, game_goals.team_id is the league_team.id, not the real team.id.
             Pick the league_team id matching whichever side we're playing on this game. */
          lineupTeamId={lineupGame._source === 'league'
            ? (lineupGame.is_home ? lineupGame.home_team_id : lineupGame.away_team_id)
            : id}
          gameTitle={`${team.name} ${lineupGame.is_home ? 'vs.' : '@'} ${lineupGame.opponent || ''} · ${new Date(lineupGame.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
        />
      )}
    </Layout>
  );
}
