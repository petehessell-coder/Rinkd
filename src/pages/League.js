import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import MapLink from '../components/MapLink';
import { getLeague, getLeagueTeams, getLeagueGames, getLeagueStandings, getUserLeagueRole } from '../lib/leagues';


function getLiveBarnUrl(venueId) {
  if (!venueId) return null;
  return 'https://watch.livebarn.com/en/videoplayer?venueid=' + venueId + '&referrer=rinkd&promo=RINKD10';
}

function LedV({ size = 16 }) {
  return (
    <svg width={size * 0.85} height={size} viewBox="0 0 22 26" xmlns="http://www.w3.org/2000/svg">
      <circle cx="2"  cy="2"  r="1.6" fill="#D72638"/><circle cx="2"  cy="6"  r="1.6" fill="#D72638"/>
      <circle cx="4"  cy="10" r="1.6" fill="#D72638"/><circle cx="6"  cy="14" r="1.6" fill="#D72638"/>
      <circle cx="8"  cy="18" r="1.6" fill="#D72638"/><circle cx="10" cy="22" r="1.6" fill="#D72638"/>
      <circle cx="20" cy="2"  r="1.6" fill="#D72638"/><circle cx="20" cy="6"  r="1.6" fill="#D72638"/>
      <circle cx="18" cy="10" r="1.6" fill="#D72638"/><circle cx="16" cy="14" r="1.6" fill="#D72638"/>
      <circle cx="14" cy="18" r="1.6" fill="#D72638"/><circle cx="12" cy="22" r="1.6" fill="#D72638"/>
    </svg>
  );
}

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };
const TABS = ['Schedule', 'Standings', 'Teams', 'Info'];

function TeamLogo({ team, size = 32 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: team?.logo_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: size * 0.35, color: '#fff', flexShrink: 0 }}>
      {team?.logo_initials || (team?.name || '?').slice(0, 2).toUpperCase()}
    </div>
  );
}

function GameRow({ game, isCommissioner, navigate }) {
  const home = game.home_lt?.team || { name: game.home_lt?.team_name, logo_color: game.home_lt?.logo_color, logo_initials: game.home_lt?.logo_initials };
  const away = game.away_lt?.team || { name: game.away_lt?.team_name, logo_color: game.away_lt?.logo_color, logo_initials: game.away_lt?.logo_initials };
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const date = new Date(game.start_time);
  const venueId = game.live_barn_venue_id || game.rink?.live_barn_venue_id;
  const hasStream = !!venueId;
  const liveBarnUrl = getLiveBarnUrl(venueId);

  return (
    <div onClick={() => navigate('/league-game/' + game.id + '?type=league')} style={{ padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }} onMouseEnter={e=>e.currentTarget.style.background='rgba(46,91,140,0.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Date */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', width: 44, flexShrink: 0, lineHeight: 1.5 }}>
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br/>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        {/* Teams */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <TeamLogo team={home} size={20} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ice, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{home?.name || '—'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TeamLogo team={away} size={20} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ice, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{away?.name || '—'}</span>
          </div>
          {(game.location || game.rink) && (
            <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.35)', marginTop: 3 }}>
              {game.rink
                ? <MapLink rink={game.rink} style={{ color: 'inherit' }} />
                : <MapLink text={game.location} style={{ color: 'inherit' }} />}
            </div>
          )}
        </div>
        {/* Score / Time */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {isLive && <>
            <span style={{ background: C.red, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, display: 'block', marginBottom: 4 }}>● LIVE</span>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>{game.home_score} – {game.away_score}</span>
          </>}
          {isFinal && <>
            <span style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, display: 'block', marginBottom: 4 }}>FINAL</span>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>{game.home_score} – {game.away_score}</span>
          </>}
          {!isLive && !isFinal && (
            <span style={{ background: 'rgba(46,91,140,0.4)', color: C.steel, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
              {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Watch with LiveBarn — matches tournament style */}
      {hasStream && !isFinal && (
        <button onClick={() => window.open(liveBarnUrl, '_blank')} style={{display:'inline-flex',alignItems:'center',gap:7,background:'#FFFFFF',color:'#0B1F3A',border:'none',borderRadius:999,padding:'8px 14px 8px 8px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',marginTop:10}}>
          <span style={{width:24,height:24,background:'#07111F',borderRadius:5,border:'1px solid rgba(215,38,56,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}><LedV size={16}/></span>
          Watch with LiveBarn
        </button>
      )}
      {hasStream && !isFinal && (
        <div style={{background:'rgba(215,38,56,0.08)',border:'0.5px solid rgba(215,38,56,0.3)',borderRadius:7,padding:'7px 11px',marginTop:9,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:10,color:'rgba(244,247,250,0.5)',lineHeight:1.6}}>Rinkd members save · ✓ Code <strong style={{color:'#D72638'}}>RINKD10</strong> auto-applied</div>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:14,color:'#D72638',marginLeft:10}}>10% off</div>
        </div>
      )}

      {/* Scorer View */}
      {isCommissioner && !isFinal && (
        <button onClick={() => navigate('/league-scorer/' + game.id + '?type=league')}
          style={{ marginTop: 8, width: '100%', padding: '8px', background: 'rgba(46,91,140,0.2)', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 8, color: '#F4F7FA', fontFamily: 'Barlow,sans-serif', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.2)'; e.currentTarget.style.color = '#F4F7FA'; }}>
          ✏️ Open Scorer View
        </button>
      )}
    </div>
  );
}

export default function LeaguePage({ profile }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [standings, setStandings] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Schedule');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, t, g, s, r] = await Promise.all([
        getLeague(id), getLeagueTeams(id), getLeagueGames(id), getLeagueStandings(id), getUserLeagueRole(id)
      ]);
      setLeague(l); setTeams(t); setGames(g); setStandings(s); setUserRole(r);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Layout profile={profile}><div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Loading...</div></Layout>;
  if (!league) return <Layout profile={profile}><div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>League not found</div></Layout>;

  const isCommissioner = userRole === 'commissioner';
  const now = new Date();
  const liveGames = games.filter(g => g.status === 'live');
  const upcomingGames = games.filter(g => g.status === 'scheduled' && new Date(g.start_time) >= now);
  const recentGames = games.filter(g => g.status === 'final').slice(-5).reverse();
  const allGamesByWeek = games.reduce((acc, g) => {
    const week = getWeekLabel(g.start_time);
    if (!acc[week]) acc[week] = [];
    acc[week].push(g);
    return acc;
  }, {});

  return (
    <Layout profile={profile}>
      <SEO
        title={`${league.name}${league.division ? ' · ' + league.division : ''}`}
        description={`${league.name} on Rinkd. Live standings, full schedule, and team pages for the ${league.division || 'league'}.`}
        url={`https://rinkd.app/league/${league.id}`}
      />
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>

        {/* BANNER */}
        <div style={{ background: 'linear-gradient(135deg,#0B1F3A 0%,#1a3a5c 100%)', padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ width: 60, height: 60, borderRadius: 12, background: league.logo_color || C.red, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: '#fff', flexShrink: 0 }}>
              {league.logo_initials || league.name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: C.ice, lineHeight: 1.1 }}>{league.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginTop: 4 }}>
                {[league.division, league.season, league.location].filter(Boolean).join(' · ')}
              </div>
              <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, marginTop: 6, background: league.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(244,247,250,0.08)', color: league.status === 'active' ? '#22C55E' : 'rgba(244,247,250,0.4)', letterSpacing: '0.06em' }}>
                {league.status === 'active' ? '● IN SEASON' : league.status === 'complete' ? 'SEASON COMPLETE' : 'DRAFT'}
              </span>
            </div>
            {isCommissioner && (
              <button onClick={() => navigate(`/league/${id}/manage`)}
                style={{ background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: C.ice, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.25)'; e.currentTarget.style.color = C.ice; }}>
                ⚙️ Manage
              </button>
            )}
          </div>

          {/* Stats bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderTop: '0.5px solid rgba(46,91,140,0.4)', background: C.navy }}>
            {[
              { num: teams.length, label: 'Teams' },
              { num: games.length, label: 'Games' },
              { num: games.filter(g => g.status === 'final').length, label: 'Played' },
              { num: games.filter(g => g.status === 'scheduled').length, label: 'Left' },
            ].map((s, i) => (
              <div key={i} style={{ padding: '10px 0', textAlign: 'center', borderRight: i < 3 ? '0.5px solid rgba(46,91,140,0.3)' : 'none' }}>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice }}>{s.num}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(244,247,250,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '2px solid rgba(46,91,140,0.3)', overflowX: 'auto' }}>
            {TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ fontSize: 13, fontWeight: 700, padding: '10px 16px', color: '#FFFFFF', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '3px solid #D72638' : '3px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', opacity: activeTab === tab ? 1 : 0.5, transition: 'opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.opacity = activeTab === tab ? '1' : '0.5'; }}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 16 }}>
          {league.status === 'draft' && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '0.5px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⏳</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>League activation pending</div>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginTop: 2 }}>The commissioner is still setting up the schedule. You'll be notified when the season goes live.</div>
              </div>
            </div>
          )}


          {/* SCHEDULE TAB */}
          {activeTab === 'Schedule' && (
            <>
              {games.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button
                    onClick={() => {
                      // Live league calendar — refreshes when commissioners reschedule.
                      const base = 'tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/schedule-ics';
                      const webcalUrl = `webcal://${base}?league=${league.id}`;
                      const httpsUrl = `https://${base}?league=${league.id}`;
                      const ua = (navigator.userAgent || '').toLowerCase();
                      const isAppleish = /iphone|ipad|ipod|macintosh/.test(ua);
                      if (isAppleish) {
                        window.location.href = webcalUrl;
                      } else {
                        try {
                          navigator.clipboard?.writeText(httpsUrl);
                          // eslint-disable-next-line no-alert
                          alert('Live league calendar link copied!\n\nPaste it into Google Calendar → Other calendars → From URL, or any app that subscribes to .ics feeds. The full league schedule will auto-refresh.');
                        } catch {
                          window.location.href = webcalUrl;
                        }
                      }
                    }}
                    style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
                      padding: '8px 16px', borderRadius: 999,
                      background: C.red, border: 'none',
                      color: '#fff', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontFamily: "'Barlow', sans-serif", transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
                    📡 Subscribe to League Calendar
                  </button>
                </div>
              )}
              {!showAll ? (
                <>
                  {liveGames.length > 0 && (
                    <>
                      <div style={secLabel}>Live Now</div>
                      <div style={card}>{liveGames.map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </>
                  )}
                  {upcomingGames.length > 0 && (
                    <>
                      <div style={secLabel}>Upcoming</div>
                      <div style={card}>{upcomingGames.slice(0, 5).map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </>
                  )}
                  {recentGames.length > 0 && (
                    <>
                      <div style={secLabel}>Recent Results</div>
                      <div style={card}>{recentGames.map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </>
                  )}
                  {games.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '40px 0' }}>No games scheduled yet</div>}
                  {games.length > 0 && (
                    <button onClick={() => setShowAll(true)}
                      style={{ width: '100%', padding: 12, background: 'rgba(46,91,140,0.15)', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 10, color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', marginTop: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.15)'; e.currentTarget.style.color = C.ice; }}>
                      View Full Season Schedule ({games.length} games)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={secLabel}>Full Season Schedule</div>
                    <button onClick={() => setShowAll(false)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.4)', fontSize: 12, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← Back</button>
                  </div>
                  {Object.entries(allGamesByWeek).map(([week, wGames]) => (
                    <div key={week}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{week}</div>
                      <div style={card}>{wGames.map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* STANDINGS TAB */}
          {activeTab === 'Standings' && (
            <>
              <div style={secLabel}>Season Standings</div>
              <div style={card}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 28px 28px 28px 28px 34px', padding: '8px 12px', background: 'rgba(46,91,140,0.2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.35)', textTransform: 'uppercase' }}>
                  <span>Team</span><span style={{textAlign:'center'}}>GP</span><span style={{textAlign:'center'}}>W</span><span style={{textAlign:'center'}}>L</span><span style={{textAlign:'center'}}>T</span><span style={{textAlign:'center'}}>GF</span><span style={{textAlign:'center'}}>PTS</span>
                </div>
                {standings.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No games played yet</div>}
                {standings.map((row, i) => (
                  <div key={row.lt_id} style={{ display: 'grid', gridTemplateColumns: '1fr 28px 28px 28px 28px 28px 34px', padding: '10px 12px', borderTop: '0.5px solid rgba(244,247,250,0.06)', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 5, background: row.logo_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 11, color: '#fff', flexShrink: 0 }}>
                        {row.logo_initials || row.team_name.slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{row.team_name}</span>
                    </div>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.gp}</span>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.wins}</span>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.losses}</span>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.ties}</span>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.gf}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'center', color: row.rank === 1 ? C.red : row.pts === 0 ? 'rgba(244,247,250,0.25)' : C.ice }}>{row.pts}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* TEAMS TAB */}
          {activeTab === 'Teams' && (
            <>
              <div style={secLabel}>{teams.length} Teams</div>
              <div style={card}>
                {teams.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No teams yet</div>}
                {teams.map(lt => (
                  <div key={lt.id} onClick={() => navigate('/team/' + lt.team_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(46,91,140,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <TeamLogo team={lt.team || { name: lt.team_name, logo_color: lt.logo_color, logo_initials: lt.logo_initials }} size={36} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{lt.team?.name || lt.team_name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{lt.team?.home_rink || lt.team?.location || ''}</div>
                    </div>
                    <div style={{ color: 'rgba(244,247,250,0.25)', fontSize: 18 }}>›</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* INFO TAB */}
          {activeTab === 'Info' && (
            <>
              <div style={{ background: 'linear-gradient(135deg,#0f2847 0%,#0B1F3A 100%)', border: '1px solid rgba(46,91,140,0.6)', borderRadius: 14, padding: '20px 18px', marginBottom: 16, textAlign: 'center' }}>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, marginBottom: 6 }}>Run your league on Rinkd</div>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginBottom: 14, lineHeight: 1.6 }}>Live standings · real-time scoring · team management · season scheduling</div>
                <a href="mailto:hello@rinkd.app?subject=League Hosting Inquiry" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 22px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>✉️ hello@rinkd.app</a>
                <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)', marginTop: 10 }}>We'll respond within 24 hours</div>
              </div>
              <div style={card}>
                {[['Division', league.division], ['Season', league.season], ['Location', league.location], ['Point System', `${league.settings?.points_win ?? 2}W · ${league.settings?.points_tie ?? 1}T · ${league.settings?.points_loss ?? 0}L`], ['Commissioner', league.commissioner ? `@${league.commissioner.handle}` : '—']].filter(([,v]) => v).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <span style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

function getWeekLabel(dateStr) {
  const date = new Date(dateStr);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

const secLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 };
const card = { background: '#0f2847', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 };
