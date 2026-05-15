import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LedR } from '../components/Logos';
import { getLiveBarnUrl } from '../lib/livebarn';


const TABS = ['Standings','Schedule','Bracket','Info'];

export default function TournamentPage({ currentUser }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('Standings');
  const [tournament, setTournament] = useState(null);
  const [games, setGames] = useState([]);
  const [standings, setStandings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Whether the current user has a 'scorer' role on this tournament. Assigned
  // scorers should see the "Open Scorer View" button on each game card — not
  // just the director. Loaded once after the tournament resolves.
  const [isAssignedScorer, setIsAssignedScorer] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load tournament
      const { data: t, error: te } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', id)
        .single();
      if (te) { setError(te.message); setLoading(false); return; }
      setTournament(t);

      // Load games — surface error instead of silently rendering the empty state.
      const { data: g, error: ge } = await supabase
        .from('games')
        .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool), away_team:tournament_teams!away_team_id(id,team_name,pool), rink:rinks(id,name,sub_rink,live_barn_venue_id)')
        .eq('tournament_id', id)
        .order('start_time', { ascending: true });
      if (ge) { setError(ge.message); setLoading(false); return; }
      setGames(g || []);

      // Load standings — same treatment so a failed query doesn't masquerade
      // as "no games played yet."
      const { data: s, error: se } = await supabase
        .from('tournament_standings')
        .select('*')
        .eq('tournament_id', id)
        .order('pool', { ascending: true })
        .order('pool_rank', { ascending: true });
      if (se) { setError(se.message); setLoading(false); return; }
      const grouped = (s || []).reduce((acc, row) => {
        if (!acc[row.pool]) acc[row.pool] = [];
        acc[row.pool].push(row);
        return acc;
      }, {});
      setStandings(grouped);

    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription — spectators see standings and scores update live as
  // games finish. Channel name carries a per-call random suffix so a remount
  // (StrictMode in dev, route revisit) doesn't collide with the prior channel.
  // The notifications module uses the same pattern; mirror it for consistency.
  //
  // Note: we subscribe only to the `games` table — `tournament_standings` is
  // a VIEW, which Postgres logical replication does not stream. Standings
  // refresh automatically because load() re-fetches both games and standings
  // whenever a games row changes.
  useEffect(() => {
    if (!id) return;
    let channel = null;
    try {
      const name = `tournament:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase.channel(name)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'games', filter: `tournament_id=eq.${id}` },
          () => { try { load(); } catch { /* swallow */ } })
        .subscribe();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[tournament] realtime subscribe failed; spectators will see stale data until they refresh:', err);
    }
    return () => { try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
  }, [id, load]);

  // Resolve whether the signed-in user has a scorer role on THIS tournament.
  // RLS on tournament_roles allows users to read their own rows, so this is
  // a single cheap query. Re-runs when the tournament id or current user
  // changes — not on every standings update.
  useEffect(() => {
    let cancelled = false;
    if (!id || !currentUser?.id) { setIsAssignedScorer(false); return; }
    (async () => {
      const { data } = await supabase
        .from('tournament_roles')
        .select('role')
        .eq('tournament_id', id)
        .eq('user_id', currentUser.id)
        .eq('role', 'scorer')
        .maybeSingle();
      if (!cancelled) setIsAssignedScorer(!!data);
    })();
    return () => { cancelled = true; };
  }, [id, currentUser?.id]);

  if (loading) return (
    <div style={{background:'#07111F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#F4F7FA',fontFamily:'Barlow,sans-serif',fontSize:14}}>
      Loading tournament...
    </div>
  );

  if (error) return (
    <div style={{background:'#07111F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#F4F7FA',fontFamily:'Barlow,sans-serif',fontSize:14,padding:20,textAlign:'center'}}>
      <div>
        <div style={{fontSize:32,marginBottom:10}}>⚠️</div>
        <div style={{color:'#D72638',marginBottom:4,fontWeight:600}}>Couldn't load this tournament</div>
        <div style={{color:'rgba(244,247,250,0.5)',fontSize:12,marginBottom:16}}>{error}</div>
        <div style={{display:'flex',gap:10,justifyContent:'center'}}>
          <button onClick={load} style={{background:'#D72638',color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',cursor:'pointer',fontFamily:'Barlow,sans-serif',fontWeight:700}}>Retry</button>
          <button onClick={() => navigate('/feed')} style={{background:'#2E5B8C',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>Back to Feed</button>
        </div>
      </div>
    </div>
  );

  const liveGames = games.filter(g => g.status === 'live');
  const finalGames = games.filter(g => g.status === 'final');
  const scheduledGames = games.filter(g => g.status === 'scheduled');
  const bracketGames = games.filter(g => g.round !== 'pool');
  const adv = tournament?.settings?.advancement_per_pool ?? 2;
  // Organizer branding — falls back to Rinkd red when the tournament isn't branded.
  const accent = tournament?.accent_color || '#D72638';
  // Directors AND assigned scorers see the in-card "Open Scorer View"
  // shortcut. ScorerView itself enforces the actual access check, so this is
  // purely about which users see the button — spectators don't.
  const canScore = !!(currentUser && tournament && (
    tournament.director_id === currentUser.id || isAssignedScorer
  ));

  return (
    <div style={{background:'#07111F',minHeight:'100vh',fontFamily:'Barlow,sans-serif',color:'#F4F7FA'}}>

      {/* HEADER */}
      <div style={{background:'#0B1F3A',padding:'14px 16px 0',borderTop:`3px solid ${accent}`,borderBottom:'0.5px solid rgba(46,91,140,0.4)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:8,flexWrap:'wrap'}}>
          <button onClick={() => navigate(-1)} style={{color:'rgba(244,247,250,0.6)',fontSize:13,background:'none',border:'none',cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>← Events</button>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {liveGames.length > 0 && <span style={{background:accent+'26',color:accent,fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20}}>● Live now</span>}
            {tournament && currentUser && tournament.director_id === currentUser.id && (
              <button onClick={() => navigate(`/tournament/${id}/manage`)}
                style={{background:accent,color:'#fff',border:'none',borderRadius:999,padding:'5px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',letterSpacing:'0.05em',textTransform:'uppercase'}}>
                ⚙ Manage
              </button>
            )}
          </div>
        </div>
        {tournament?.logo_url && (
          <img src={tournament.logo_url} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}
            style={{height:38,width:'auto',display:'block',marginBottom:8,borderRadius:6}} />
        )}
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:22}}>
          {(tournament?.name || '').toUpperCase()} · {tournament?.division}
        </div>
        <div style={{fontSize:12,color:'rgba(244,247,250,0.4)',margin:'3px 0 12px'}}>
          {tournament?.start_date} – {tournament?.end_date}
        </div>
        <div style={{display:'flex',overflowX:'auto',borderBottom:'2px solid rgba(46,91,140,0.3)'}}>
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{fontSize:13,fontWeight:700,padding:'10px 16px',background:'transparent',border:'none',
                borderBottom: activeTab===tab ? `3px solid ${accent}` : '3px solid transparent',
                marginBottom:-2,cursor:'pointer',fontFamily:'Barlow,sans-serif',whiteSpace:'nowrap',
                color:'#FFFFFF', opacity: activeTab===tab ? 1 : 0.5}}
              onMouseEnter={e=>{e.currentTarget.style.background='#FFFFFF';e.currentTarget.style.color='#0B1F3A';e.currentTarget.style.opacity='1';}}
              onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='#FFFFFF';e.currentTarget.style.opacity=activeTab===tab?'1':'0.5';}}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{padding:16}}>

        {activeTab === 'Standings' && (
          Object.keys(standings).length === 0
            ? <div style={{textAlign:'center',color:'rgba(244,247,250,0.3)',fontSize:13,paddingTop:40}}>No games played yet</div>
            : Object.entries(standings).map(([pool, rows]) => (
              <div key={pool} style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.1em',color:'rgba(244,247,250,0.3)',textTransform:'uppercase',marginBottom:8}}>Pool {pool}</div>
                <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,overflow:'hidden'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 28px 28px 28px 28px 34px',padding:'8px 12px',background:'rgba(46,91,140,0.2)',fontSize:10,fontWeight:700,color:'rgba(244,247,250,0.35)',textTransform:'uppercase'}}>
                    <span>TEAM</span><span style={{textAlign:'center'}}>W</span><span style={{textAlign:'center'}}>L</span><span style={{textAlign:'center'}}>T</span><span style={{textAlign:'center'}}>GF</span><span style={{textAlign:'center'}}>PTS</span>
                  </div>
                  {rows.map((row, i) => (
                    <React.Fragment key={row.team_id}>
                      {i === adv && <><div style={{height:2,background:'rgba(215,38,56,0.4)',margin:'0 12px'}}/><div style={{fontSize:10,color:'rgba(215,38,56,0.55)',padding:'4px 12px'}}>↑ ADVANCES TO BRACKET</div></>}
                      <div style={{display:'grid',gridTemplateColumns:'1fr 28px 28px 28px 28px 34px',padding:'10px 12px',borderTop:'0.5px solid rgba(244,247,250,0.06)',alignItems:'center'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{width:18,height:18,borderRadius:'50%',background:row.pool_rank===1?'#D72638':row.pool_rank===2?'#2E5B8C':'rgba(244,247,250,0.1)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,flexShrink:0}}>{row.pool_rank}</span>
                          <span style={{fontSize:13,fontWeight:600,color:'#F4F7FA'}}>{row.team_name}</span>
                        </div>
                        <span style={{fontSize:12,textAlign:'center',color:'rgba(244,247,250,0.65)'}}>{row.wins}</span>
                        <span style={{fontSize:12,textAlign:'center',color:'rgba(244,247,250,0.65)'}}>{row.losses}</span>
                        <span style={{fontSize:12,textAlign:'center',color:'rgba(244,247,250,0.65)'}}>{row.ties}</span>
                        <span style={{fontSize:12,textAlign:'center',color:'rgba(244,247,250,0.65)'}}>{row.gf}</span>
                        <span style={{fontSize:13,fontWeight:700,textAlign:'center',color:row.pool_rank===1?'#D72638':'#F4F7FA'}}>{row.pts}</span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))
        )}

        {activeTab === 'Schedule' && (
          games.length === 0
            ? <div style={{textAlign:'center',color:'rgba(244,247,250,0.3)',fontSize:13,paddingTop:40}}>No games scheduled yet</div>
            : games.map(g => <GameCard key={g.id} game={g} navigate={navigate} canScore={canScore} />)
        )}

        {activeTab === 'Bracket' && (
          bracketGames.length === 0
            ? <div style={{textAlign:'center',color:'rgba(244,247,250,0.3)',fontSize:13,paddingTop:40}}>Bracket seeds lock when pool play ends</div>
            : bracketGames.map(g => <GameCard key={g.id} game={g} navigate={navigate} canScore={canScore} />)
        )}

        {activeTab === 'Info' && <InfoTab tournament={tournament} />}

      </div>
    </div>
  );
}

function GameCard({ game, navigate, canScore }) {
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const url = getLiveBarnUrl(game.rink?.live_barn_venue_id);
  const hasStream = !!url;  // only "true" when the venue ID is real, not a placeholder

  return (
    <div onClick={() => navigate('/game/' + game.id)} style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,padding:'14px 16px',marginBottom:10,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.border='0.5px solid rgba(46,91,140,0.8)'} onMouseLeave={e=>e.currentTarget.style.border='0.5px solid rgba(46,91,140,0.4)'}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,gap:8}}>
        {isLive && <span style={{background:'#D72638',color:'#fff',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>● LIVE</span>}
        {isFinal && <span style={{background:'rgba(244,247,250,0.08)',color:'rgba(244,247,250,0.4)',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>FINAL</span>}
        {!isLive && !isFinal && <span style={{background:'#2E5B8C',color:'#F4F7FA',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>{game.start_time ? new Date(game.start_time).toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}) : 'TBD'}</span>}
        {hasStream && !isFinal && (
          <button onClick={() => window.open(url, '_blank')} style={{display:'inline-flex',alignItems:'center',gap:7,background:'#FFFFFF',color:'#0B1F3A',border:'none',borderRadius:999,padding:'8px 14px 8px 8px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
            <span style={{width:24,height:24,background:'#07111F',borderRadius:5,border:'1px solid rgba(215,38,56,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}><LedR size={16}/></span>
            Watch with LiveBarn
          </button>
        )}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:32,height:32,borderRadius:'50%',background:'#1a4a7a',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:11,color:'#fff'}}>{(game.home_team?.team_name||'?').split(' ').map(w=>w[0]).slice(0,3).join('')}</div>
          <span style={{fontSize:14,fontWeight:600,color:'#F4F7FA'}}>{game.home_team?.team_name}</span>
        </div>
        {(isLive||isFinal) && <span style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:26,color:'#F4F7FA'}}>{game.home_score}</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:32,height:32,borderRadius:'50%',background:'#6b1520',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:11,color:'#fff'}}>{(game.away_team?.team_name||'?').split(' ').map(w=>w[0]).slice(0,3).join('')}</div>
          <span style={{fontSize:14,fontWeight:600,color:'#F4F7FA'}}>{game.away_team?.team_name}</span>
        </div>
        {(isLive||isFinal) ? <span style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:26,color:'#F4F7FA'}}>{game.away_score}</span> : <span style={{fontSize:11,fontWeight:600,color:'rgba(244,247,250,0.3)'}}>VS</span>}
      </div>
      <div style={{fontSize:11,color:'rgba(244,247,250,0.4)'}}>📍 {game.rink?.sub_rink} · {game.rink?.name}</div>
      {canScore && (
        <button onClick={(e) => { e.stopPropagation(); navigate("/scorer/" + game.id); }} style={{marginTop:8,width:"100%",padding:"9px",background:"rgba(46,91,140,0.2)",border:"0.5px solid rgba(46,91,140,0.5)",borderRadius:8,color:"#F4F7FA",fontFamily:"Barlow,sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onMouseEnter={e=>{e.currentTarget.style.background="#F4F7FA";e.currentTarget.style.color="#0B1F3A";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(46,91,140,0.2)";e.currentTarget.style.color="#F4F7FA";}}>✏️ Open Scorer View</button>
      )}
      {hasStream && !isFinal && (
        <div style={{background:'rgba(215,38,56,0.08)',border:'0.5px solid rgba(215,38,56,0.3)',borderRadius:7,padding:'7px 11px',marginTop:9,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:10,color:'rgba(244,247,250,0.5)',lineHeight:1.6}}>Rinkd members save · ✓ Code <strong style={{color:'#D72638'}}>RINKD10</strong> auto-applied</div>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:14,color:'#D72638',marginLeft:10}}>10% off</div>
        </div>
      )}
    </div>
  );
}

function InfoTab({ tournament }) {
  const s = tournament?.settings ?? {};
  return (
    <div>
      <div style={{background:'linear-gradient(135deg,#0f2847 0%,#0B1F3A 100%)',border:'1px solid rgba(46,91,140,0.6)',borderRadius:14,padding:'20px 18px',marginBottom:16,textAlign:'center'}}>
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:20,marginBottom:6}}>Host your tournament on Rinkd</div>
        <div style={{fontSize:12,color:'rgba(244,247,250,0.5)',marginBottom:14,lineHeight:1.6}}>Live standings · real-time scoring · LiveBarn integration · bracket automation.<br/>Email us for pricing and availability.</div>
        <a href="mailto:hello@rinkd.app?subject=Tournament Hosting Inquiry" style={{display:'inline-flex',alignItems:'center',gap:8,background:'#D72638',color:'#fff',border:'none',borderRadius:999,padding:'11px 22px',fontFamily:'Barlow,sans-serif',fontSize:13,fontWeight:700,textDecoration:'none'}}>✉️ hello@rinkd.app</a>
        <div style={{fontSize:11,color:'rgba(244,247,250,0.3)',marginTop:10}}>We'll respond within 24 hours</div>
      </div>
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:'#F4F7FA',marginBottom:8}}>Format</div>
        <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,overflow:'hidden'}}>
          {[['Division', tournament?.division||'—'],['Period length',`${s.period_length_minutes??15} min ${s.period_type==='running'?'running':'stop-time'}`],['Periods per game', s.num_periods??3],['Advancement',`Top ${s.advancement_per_pool??2} per pool → bracket`]].map(([k,v]) => (
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'11px 14px',borderBottom:'0.5px solid rgba(244,247,250,0.06)'}}>
              <span style={{fontSize:13,color:'rgba(244,247,250,0.5)'}}>{k}</span>
              <span style={{fontSize:13,fontWeight:600,color:'#F4F7FA'}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:'#F4F7FA',marginBottom:8}}>Point System</div>
        <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,overflow:'hidden'}}>
          {[['Win',`${s.points_win??2} pts`,'#D72638'],['Tie',`${s.points_tie??1} pt`,'#F4F7FA'],['Loss',`${s.points_loss??0} pts`,'rgba(244,247,250,0.3)']].map(([k,v,c]) => (
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'11px 14px',borderBottom:'0.5px solid rgba(244,247,250,0.06)'}}>
              <span style={{fontSize:13,color:'rgba(244,247,250,0.5)'}}>{k}</span>
              <span style={{fontSize:13,fontWeight:700,color:c}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
