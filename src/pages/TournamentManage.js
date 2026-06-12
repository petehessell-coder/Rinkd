import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getTournament } from '../lib/tournaments';
import {
  listTeams, createTeam, updateTeam, deleteTeam,
  listGames, updateGame, deleteGame,
  generatePoolSchedule,
  loadPoolQualifiers, createBracketGame,
  updateTournament,
  listStandingsSummary,
  generateChampionshipBracket,
} from '../lib/tournamentManage';
import { listRinks } from '../lib/rinks';
import { listScorers, addScorerByInput, removeScorer } from '../lib/tournamentScorers';
import { listDirectors, addDirectorByInput, removeDirector, isExtraDirector as isDirectorRole } from '../lib/tournamentDirectors';
import { teamInitials } from '../lib/teamInitials';
import { uploadMedia } from '../lib/posts';
import { classifyImage } from '../lib/imageModeration';
import DateTimePicker from '../components/DateTimePicker';
import EditGameModal from '../components/EditGameModal';
import SponsorsManager from '../components/SponsorsManager';
import { supabase } from '../lib/supabase';
import { getTournamentRegistrations, updateTournamentRegistrationStatus, approveTournamentRegistration } from '../lib/registrations';
import { tournamentPayoutsReady, startConnectOnboarding } from '../lib/stripeConnect';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  green: '#22C55E', amber: '#F59E0B',
};

const TABS = ['Teams', 'Schedule', 'Bracket', 'Registrations', 'Scorers', 'Suspensions', 'Sponsors', 'Settings'];

const REG_STATUS = {
  pending:    { label: 'Pending',    color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  approved:   { label: 'Approved',   color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
  waitlisted: { label: 'Waitlisted', color: '#8BA3BE', bg: 'rgba(139,163,190,0.15)' },
  rejected:   { label: 'Rejected',   color: '#D72638', bg: 'rgba(215,38,56,0.15)' },
};
const REG_GROUPS = [['pending', 'Pending'], ['approved', 'Approved'], ['waitlisted', 'Waitlisted'], ['rejected', 'Rejected']];

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

export default function TournamentManagePage({ currentUser, profile }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [rinks, setRinks] = useState([]);
  const [standingsByTeam, setStandingsByTeam] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Teams');
  const [error, setError] = useState(null);
  // Page-level flash banner — every save/delete failure across all tabs now
  // surfaces here instead of a blocking native alert() dialog. Auto-dismisses
  // success messages after a few seconds; errors stay until tapped.
  const [flash, setFlash] = useState(null);

  const showFlash = useCallback((kind, text) => {
    setFlash({ kind, text, at: Date.now() });
  }, []);

  useEffect(() => {
    if (flash?.kind !== 'success') return;
    const t = setTimeout(() => setFlash(f => f && f.kind === 'success' ? null : f), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  // Additional directors granted via tournament_roles. Loaded async; the
  // original director (tournaments.director_id) gates synchronously below.
  // We track a "checked" flag so we don't flash the "🔒 access denied" screen
  // to extra directors during the brief window between page load and the
  // role check resolving.
  const [isExtraDirector, setIsExtraDirector] = useState(false);
  const [extraDirectorChecked, setExtraDirectorChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!id || !currentUser?.id) { setIsExtraDirector(false); setExtraDirectorChecked(true); return; }
    setExtraDirectorChecked(false);
    isDirectorRole(currentUser.id, id).then((v) => {
      if (cancelled) return;
      setIsExtraDirector(v);
      setExtraDirectorChecked(true);
    });
    return () => { cancelled = true; };
  }, [id, currentUser?.id]);

  const isDirector = tournament && currentUser && (
    tournament.director_id === currentUser.id || isExtraDirector
  );

  // GS-2 — pending suspension count drives the red badge on the Suspensions
  // tab. Refreshed by load() and by the tab itself after serve/overturn.
  const [pendingSuspCount, setPendingSuspCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const t = await getTournament(id);
      setTournament(t);
      const [{ data: ts }, { data: gs }, { data: rk }, { data: st }, { count: suspCount }] = await Promise.all([
        listTeams(id),
        listGames(id),
        listRinks().catch(() => ({ data: [] })),
        listStandingsSummary(id).catch(() => ({ data: [] })),
        supabase.from('game_suspensions')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', id).eq('status', 'pending'),
      ]);
      setTeams(ts); setGames(gs); setRinks(rk || []);
      setPendingSuspCount(suspCount || 0);
      // Convert standings rows to a team_id → {gp,wins,losses,ties,pts} lookup
      // so renderers can look up records by id in O(1). Empty tournament =
      // empty lookup, which the renderers treat as "no record yet."
      const map = {};
      (st || []).forEach(r => { map[r.team_id] = r; });
      setStandingsByTeam(map);
    } catch (e) {
      setError(e.message || 'Failed to load tournament');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

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
  // Wait for the extra-director async check before deciding to lock out.
  // Without this gate, a freshly-added director navigating to /manage sees
  // the lock screen for a beat while tournament_roles is being queried.
  if (!extraDirectorChecked) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>
        Loading…
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

          {tournament.is_activated === false && (
            <div style={{ background: 'rgba(245,158,11,0.12)', border: '0.5px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '12px 14px', marginBottom: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 18 }}>🔒</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>Activation pending</div>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.65)', marginTop: 4, lineHeight: 1.5 }}>
                  You can set up teams, schedule, and bracket now. Live scoring + auto-recap pushes are locked until Rinkd activates this tournament. Email <a href="mailto:hello@rinkd.app?subject=Tournament Activation Request" style={{ color: '#F59E0B' }}>hello@rinkd.app</a> to activate, or see <a href="/pricing" style={{ color: '#F59E0B' }}>pricing</a>.
                </div>
              </div>
            </div>
          )}

          {/* Tabs — wrapped in a relative container so the right-edge gradient
              mask hints at horizontal scroll on narrow viewports where "Settings"
              clips off-screen. Without the mask, mobile users miss the last tab. */}
          <div style={{ position: 'relative', marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ background: 'transparent', color: tab === t ? C.ice : C.steel, border: 'none', padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 500, borderBottom: tab === t ? `3px solid ${C.red}` : '3px solid transparent', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {t}
                  {t === 'Suspensions' && pendingSuspCount > 0 && (
                    <span style={{ background: C.red, color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, minWidth: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                      {pendingSuspCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, pointerEvents: 'none', background: `linear-gradient(to right, transparent, ${C.dark})` }} />
          </div>

          {/* Flash banner — page-level error/success surface. Replaces every
              alert() across the tab forms. Auto-dismisses on success; errors
              stay until tapped. */}
          {flash && (
            <div onClick={() => setFlash(null)}
              style={{
                background: flash.kind === 'error' ? 'rgba(215,38,56,0.12)' : 'rgba(34,197,94,0.12)',
                border: `1px solid ${flash.kind === 'error' ? 'rgba(215,38,56,0.4)' : 'rgba(34,197,94,0.4)'}`,
                color: C.ice, borderRadius: 10, padding: '11px 14px', marginBottom: 14,
                fontSize: 13, lineHeight: 1.5, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
              <span style={{ fontSize: 18 }}>{flash.kind === 'error' ? '⚠️' : '✓'}</span>
              <span style={{ flex: 1 }}>{flash.text}</span>
              <span style={{ fontSize: 11, color: C.steel }}>tap to dismiss</span>
            </div>
          )}

          {tab === 'Teams' && <TeamsTab tournamentId={id} teams={teams} standingsByTeam={standingsByTeam} reload={load} flash={showFlash} />}
          {tab === 'Schedule' && <ScheduleTab tournamentId={id} tournament={tournament} teams={teams} games={games} rinks={rinks} reload={load} flash={showFlash} />}
          {tab === 'Bracket' && <BracketTab tournamentId={id} tournament={tournament} teams={teams} games={games} rinks={rinks} reload={load} flash={showFlash} />}
          {tab === 'Registrations' && <RegistrationsTab tournamentId={id} tournament={tournament} reload={load} flash={showFlash} />}
          {tab === 'Scorers' && <ScorersTab tournamentId={id} tournamentName={tournament.name} originalDirectorId={tournament.director_id} profile={profile} flash={showFlash} />}
          {tab === 'Suspensions' && <SuspensionsTab tournamentId={id} flash={showFlash} onPendingCount={setPendingSuspCount} />}
          {tab === 'Sponsors' && <SponsorsManager ownerType="tournament" ownerId={id} isYouth={tournament.settings?.feature_profile === 'youth_competitive'}
            settings={tournament.settings || {}}
            onSaveSettings={async (partial) => { await updateTournament(id, { settings: { ...(tournament.settings || {}), ...partial } }); await load(); }} />}
          {tab === 'Settings' && <SettingsTab tournament={tournament} currentUser={currentUser} reload={load} flash={showFlash} />}
        </div>
      </div>
    </Layout>
  );
}

// ====================== TEAMS TAB ======================
function TeamsTab({ tournamentId, teams, standingsByTeam = {}, reload, flash }) {
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

      {adding && <TeamForm tournamentId={tournamentId} pools={pools} flash={flash} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}

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
                <TeamForm tournamentId={tournamentId} pools={pools} team={t} flash={flash} onDone={() => { setEditingId(null); reload(); }} onCancel={() => setEditingId(null)} />
              </div>
            ) : (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? `1px solid rgba(46,91,140,0.25)` : 'none', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: t.logo_url ? `url(${t.logo_url}) center/cover` : C.navy, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff' }}>
                  {!t.logo_url && teamInitials(t.team_name, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{t.team_name}{t.seed ? ` · #${t.seed}` : ''}</div>
                  <div style={{ fontSize: 12, color: C.steel }}>
                    {standingsByTeam[t.id]?.gp > 0
                      ? <span><b style={{ color: C.ice }}>{standingsByTeam[t.id].wins}-{standingsByTeam[t.id].losses}-{standingsByTeam[t.id].ties}</b> · {standingsByTeam[t.id].pts} pts · {t.contact_email || 'no contact'}</span>
                      : (t.contact_email || '—')}
                  </div>
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

function TeamForm({ tournamentId, team, pools, flash, onDone, onCancel }) {
  const [teamName, setTeamName] = useState(team?.team_name || '');
  const [pool, setPool] = useState(team?.pool || (pools[0] || ''));
  const [seed, setSeed] = useState(team?.seed || '');
  const [contactEmail, setContactEmail] = useState(team?.contact_email || '');
  const [logoUrl, setLogoUrl] = useState(team?.logo_url || '');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const save = async () => {
    if (!teamName.trim()) { setLocalError('Team name is required'); return; }
    setLocalError('');
    setBusy(true);
    const fields = { teamName, pool, seed, contactEmail, logoUrl };
    const res = team ? await updateTeam(team.id, fields) : await createTeam(tournamentId, fields);
    setBusy(false);
    if (res.error) { flash?.('error', `Save failed: ${res.error.message}`); return; }
    flash?.('success', team ? 'Team saved.' : `Added ${teamName}.`);
    onDone();
  };

  const remove = async () => {
    if (!team) return;
    if (!window.confirm(`Delete "${team.team_name}"? This cannot be undone.`)) return;
    const { error } = await deleteTeam(team.id);
    if (error) { flash?.('error', `Delete failed: ${error.message}`); return; }
    flash?.('success', `Deleted ${team.team_name}.`);
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
      {localError && (
        <div style={{ background: 'rgba(215,38,56,0.12)', border: '1px solid rgba(215,38,56,0.4)', color: C.ice, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
          {localError}
        </div>
      )}
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
function ScheduleTab({ tournamentId, tournament, teams, games, rinks, reload, flash }) {
  const [showGen, setShowGen] = useState(false);
  const [genStart, setGenStart] = useState('');
  const [genMinutes, setGenMinutes] = useState(60);
  const [genRinkId, setGenRinkId] = useState('');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const poolGames = games.filter((g) => (g.round || 'pool') === 'pool');

  const handleGenerate = async () => {
    if (!genStart) { flash?.('error', 'Pick a start time before generating.'); return; }
    setBusy(true);
    const { inserted, error, warning } = await generatePoolSchedule(tournamentId, {
      startDate: genStart,
      gameMinutes: parseInt(genMinutes, 10) || 60,
      rinkId: genRinkId || null,
      replaceExisting: replace,
    });
    setBusy(false);
    if (error) { flash?.('error', `Generate failed: ${error.message}`); return; }
    flash?.('success', warning || `Generated ${inserted} pool games.`);
    setShowGen(false); reload();
  };

  // If pool games already exist, re-running the generator nukes them. Surface
  // that fact in the button copy and gate the form behind a confirm so the
  // director can't accidentally wipe a scheduled day they just hand-edited.
  const hasPoolGames = poolGames.length > 0;
  const handleGenerateClick = () => {
    if (hasPoolGames && !showGen) {
      const ok = window.confirm(`Regenerating will replace the ${poolGames.length} existing pool game${poolGames.length === 1 ? '' : 's'}. Bracket games stay intact. Continue?`);
      if (!ok) return;
    }
    setShowGen((v) => !v);
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.steel }}>{poolGames.length} pool game{poolGames.length === 1 ? '' : 's'}</div>
        <button onClick={handleGenerateClick} style={btnPrimary}>
          {hasPoolGames ? `⚡ Regenerate (wipes ${poolGames.length})` : '⚡ Generate Pool Schedule'}
        </button>
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
          {poolGames.map((g, i) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? `1px solid rgba(46,91,140,0.25)` : 'none', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                  {g.home_team?.team_name || '?'} vs. {g.away_team?.team_name || '?'}
                  {g.home_team?.pool && <span style={{ marginLeft: 6, fontSize: 10, color: C.red, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{g.home_team.pool}</span>}
                </div>
                <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>
                  {fmtDateTime(g.start_time)}
                  {g.rink ? ` · ${[g.rink.sub_rink, g.rink.name].filter(Boolean).join(' · ')}` : ''}
                  {g.youtube_url ? ' · 📺 stream' : ''}
                </div>
              </div>
              <button onClick={() => setEditingId(g.id)} style={btnGhost}>Edit</button>
            </div>
          ))}
        </div>
      )}

      {editingId && (() => {
        const g = poolGames.find((x) => x.id === editingId);
        if (!g) return null;
        return (
          <EditGameModal
            game={g}
            rinks={rinks}
            teams={teams.map((t) => ({ id: t.id, name: t.team_name }))}
            title="Edit game"
            onClose={() => setEditingId(null)}
            onSave={async (v) => {
              const { error } = await updateGame(g.id, {
                startTime: v.start_time, rinkId: v.rink_id,
                homeTeamId: v.home_team_id, awayTeamId: v.away_team_id,
                location: v.location, liveBarnVenueId: v.live_barn_venue_id, youtubeUrl: v.youtube_url,
              });
              if (error) throw new Error(error.message);
              flash?.('success', 'Game updated.');
              reload();
            }}
            onDelete={async () => {
              const { error } = await deleteGame(g.id);
              if (error) throw new Error(error.message);
              flash?.('success', 'Game deleted.');
              reload();
            }}
          />
        );
      })()}
    </div>
  );
}

// ====================== BRACKET TAB ======================
function BracketTab({ tournamentId, tournament, teams, games, rinks, reload, flash }) {
  const advPerPool = tournament?.settings?.advancement_per_pool ?? 2;
  const bracketGames = games.filter((g) => (g.round || 'pool') !== 'pool');
  // Count distinct pools so the "Add Bracket Game" default round can be
  // derived from how many teams will advance. 2 advancers → Final, 4 → Semi,
  // 8 → Quarter. Saves directors from manually picking "Final" every time
  // when the bracket is small (the BLPA Bash 1-per-pool x 2 pools case).
  const poolCount = useMemo(() => {
    const set = new Set(teams.map((t) => t.pool).filter(Boolean));
    return Math.max(set.size, 1);
  }, [teams]);
  const defaultRound = useMemo(() => {
    const totalAdvancers = poolCount * advPerPool;
    if (totalAdvancers <= 2) return 'final';
    if (totalAdvancers <= 4) return 'semifinal';
    return 'quarterfinal';
  }, [poolCount, advPerPool]);
  const [qualifiers, setQualifiers] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [round, setRound] = useState(defaultRound);
  const [homeId, setHomeId] = useState('');
  const [awayId, setAwayId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [rinkId, setRinkId] = useState('');
  const [busy, setBusy] = useState(false);

  // Keep `round` in sync with the derived default whenever the tournament's
  // pool count or advancement rules change (e.g., director edits settings
  // and comes back to Bracket). Only updates when the user hasn't picked
  // a different round yet — we don't want to clobber their selection.
  useEffect(() => { setRound((r) => (r === 'quarterfinal' && defaultRound !== 'quarterfinal') ? defaultRound : r); }, [defaultRound]);

  // Refresh qualifiers when pool play actually progresses, not just when the
  // games array length changes. Pool games going final is what locks seeds.
  const finalPoolCount = useMemo(
    () => games.filter(g => (g.round || 'pool') === 'pool' && g.status === 'final').length,
    [games]
  );

  useEffect(() => {
    (async () => {
      const q = await loadPoolQualifiers(tournamentId, advPerPool);
      setQualifiers(q);
      setLoaded(true);
    })();
  }, [tournamentId, advPerPool, finalPoolCount]);

  const addBracketGame = async () => {
    if (!homeId || !awayId || homeId === awayId) { flash?.('error', 'Pick two different teams.'); return; }
    if (!startTime) { flash?.('error', 'Pick a start time.'); return; }
    setBusy(true);
    const { error } = await createBracketGame(tournamentId, {
      homeTeamId: homeId, awayTeamId: awayId, round,
      startTime: new Date(startTime).toISOString(),
      rinkId: rinkId || null,
    });
    setBusy(false);
    if (error) { flash?.('error', `Failed to add bracket game: ${error.message}`); return; }
    flash?.('success', `Added ${round} game.`);
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
                <div style={{ fontSize: 11, color: C.steel }}>{q.pool} · {q.wins}-{q.losses}-{q.ties} · {q.pts} pts</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-generate championship bracket — the BLPA "4-team-per-pool"
          pattern. Each pool with 4 teams gets 4 games: 2 semis (2v3, 1v4),
          a gold game (semi winners), and a bronze game (semi losers).
          Gold/bronze start with TBD teams and fill in when semis finalize. */}
      <ChampionshipBracketGenerator tournamentId={tournamentId} teams={teams} bracketGames={bracketGames} reload={reload} flash={flash} rinks={rinks} />

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
          {bracketGames.map((g, i) => {
            const isFinal = g.status === 'final';
            const isLive = g.status === 'live';
            const isSO = isFinal && (g.shootout_winner === 'home' || g.shootout_winner === 'away');
            return (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.red, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
                  {g.round}{g.pool ? ` · ${g.pool}` : ''}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ice, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{g.home_team?.team_name || 'TBD'} vs. {g.away_team?.team_name || 'TBD'}</span>
                  {(isFinal || isLive) && (
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, color: isFinal ? C.ice : C.red }}>
                      {g.home_score ?? 0}–{g.away_score ?? 0}{isSO ? ' SO' : isLive ? ' · LIVE' : ''}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>{fmtDateTime(g.start_time)}</div>
              </div>
              <button onClick={async () => {
                if (!window.confirm('Delete this bracket game?')) return;
                const { error } = await deleteGame(g.id);
                if (error) { flash?.('error', `Delete failed: ${error.message}`); return; }
                flash?.('success', 'Bracket game deleted.');
                reload();
              }} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Delete</button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ====================== CHAMPIONSHIP BRACKET GENERATOR ======================
// Self-contained sub-component for the Bracket tab. Reads the current
// pool-play status and either offers a "Generate Championship Bracket"
// button (when all pool games are final + no bracket games yet) or shows
// a status hint ("Waiting on N pool games" / "Bracket already generated").
function ChampionshipBracketGenerator({ tournamentId, teams, bracketGames, reload, flash, rinks }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [rinkId, setRinkId] = useState('');
  const [gameMinutes, setGameMinutes] = useState(60);
  const [busy, setBusy] = useState(false);

  // Count pools that have exactly 4 teams. The 4-team pattern is what this
  // generator supports; other shapes fall back to manual entry below.
  const poolSummary = useMemo(() => {
    const byPool = teams.reduce((acc, t) => {
      if (!t.pool) return acc;
      acc[t.pool] = (acc[t.pool] || 0) + 1;
      return acc;
    }, {});
    const fourTeamPools = Object.entries(byPool).filter(([, n]) => n === 4).map(([p]) => p);
    const otherPools    = Object.entries(byPool).filter(([, n]) => n !== 4);
    return { fourTeamPools, otherPools, totalPools: Object.keys(byPool).length };
  }, [teams]);

  const alreadyGenerated = bracketGames.length > 0;
  const eligible = poolSummary.fourTeamPools.length > 0;

  if (!eligible && !alreadyGenerated) {
    // Nothing to surface — Tournaments with non-4-team pools use the manual
    // "Add Bracket Game" form below.
    return null;
  }

  const handleGenerate = async () => {
    if (!start) { flash?.('error', 'Pick a start time for the first semifinal.'); return; }
    setBusy(true);
    const { inserted, error, poolsCovered } = await generateChampionshipBracket(tournamentId, {
      startTime: new Date(start).toISOString(),
      rinkId: rinkId || null,
      gameMinutes: parseInt(gameMinutes, 10) || 60,
    });
    setBusy(false);
    if (error) { flash?.('error', `Bracket generation failed: ${error.message}`); return; }
    flash?.('success', `Generated ${inserted} bracket games across ${poolsCovered.length} pool${poolsCovered.length === 1 ? '' : 's'}.`);
    setOpen(false);
    reload();
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, textTransform: 'uppercase' }}>
            Championship bracket
          </div>
          <div style={{ fontSize: 12, color: C.steel, marginTop: 4, lineHeight: 1.5 }}>
            {alreadyGenerated
              ? `${bracketGames.length} bracket game${bracketGames.length === 1 ? '' : 's'} already created. Delete them below to regenerate.`
              : `Auto-create 4 games per 4-team pool: 2 semis (seed 2 v 3, seed 1 v 4), final (winners), bronze (losers). Pools matched: ${poolSummary.fourTeamPools.join(' · ') || 'none'}.${poolSummary.otherPools.length ? ` Pools skipped (not 4 teams): ${poolSummary.otherPools.map(([p, n]) => `${p} (${n})`).join(', ')}.` : ''}`}
          </div>
        </div>
        {!alreadyGenerated && (
          <button onClick={() => setOpen((v) => !v)} style={btnPrimary}>
            🏆 Generate Bracket
          </button>
        )}
      </div>

      {open && !alreadyGenerated && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, color: C.steel, marginBottom: 12, lineHeight: 1.5 }}>
            Seeds resolve from current standings. Run this once pool play is complete (or use placeholder seeds and edit each game after). Bronze + final games start with TBD teams and fill in automatically when each semi finalizes.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>First semi start</label>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Per-game minutes</label>
              <input type="number" value={gameMinutes} onChange={(e) => setGameMinutes(e.target.value)} style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Default rink</label>
              <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {rinks.map((r) => <option key={r.id} value={r.id}>{[r.sub_rink, r.name].filter(Boolean).join(' · ')}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)} style={btnGhost}>Cancel</button>
            <button onClick={handleGenerate} disabled={busy} style={btnPrimary}>{busy ? 'Generating…' : 'Generate'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================== SETTINGS TAB ======================
// --- Registrations tab: payouts (optional Connect) + config + submissions list.
//     Mirrors the league RegistrationsTab; same Stripe checkout/webhook back it. ---
function RegistrationsTab({ tournamentId, tournament, reload, flash }) {
  const [regs, setRegs] = useState([]);
  const [open, setOpen] = useState(!!tournament.registration_open);
  const [feeDollars, setFeeDollars] = useState(tournament.registration_fee_cents ? String(tournament.registration_fee_cents / 100) : '');
  const [deadline, setDeadline] = useState(tournament.registration_deadline || '');
  const [maxTeams, setMaxTeams] = useState(tournament.max_teams != null ? String(tournament.max_teams) : '');
  const [savingCfg, setSavingCfg] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [payoutsReady, setPayoutsReady] = useState(null);
  const [isFounder, setIsFounder] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectReturn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('connect') === 'done';
  const regLink = `${window.location.origin}/tournament/${tournamentId}/register`;

  const loadRegs = useCallback(async () => {
    try { setRegs(await getTournamentRegistrations(tournamentId)); } catch { /* RLS → empty */ }
  }, [tournamentId]);

  useEffect(() => {
    loadRegs();
    let cancelled = false;
    (async () => {
      const [ready, { data: { user } }] = await Promise.all([
        tournamentPayoutsReady(tournamentId),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      setPayoutsReady(ready);
      setIsFounder(!!user && user.id === tournament.director_id);
    })();
    return () => { cancelled = true; };
  }, [loadRegs, tournamentId, tournament.director_id]);

  const saveConfig = async () => {
    setSavingCfg(true);
    const { error } = await updateTournament(tournamentId, {
      registrationOpen: open,
      registrationFeeCents: Math.max(0, Math.round((parseFloat(feeDollars) || 0) * 100)),
      registrationDeadline: deadline || null,
      maxTeams: maxTeams.trim() === '' ? null : Math.max(0, parseInt(maxTeams, 10) || 0),
    });
    setSavingCfg(false);
    if (error) { flash('err', error.message || 'Could not save settings.'); return; }
    flash('ok', 'Registration settings saved.');
    reload();
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(regLink); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* link shown below */ }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try { await startConnectOnboarding(`/tournament/${tournamentId}/manage`); } // redirects away on success
    catch (e) { flash('err', e.message || 'Could not start payout setup.'); setConnecting(false); }
  };

  const act = async (reg, action) => {
    setBusyId(reg.id);
    try {
      if (action === 'approve') await approveTournamentRegistration(reg.id);
      else await updateTournamentRegistrationStatus(reg.id, action);
      await loadRegs();
    } catch (e) { flash('err', e.message || 'Action failed.'); }
    finally { setBusyId(null); }
  };

  const exportCsv = () => {
    const head = ['Team', 'Contact', 'Email', 'Status', 'Fee ($)', 'Paid At', 'Registered'];
    const rows = regs.map(r => [
      r.team_name, r.contact_name, r.contact_email, r.status,
      r.fee_cents != null ? (r.fee_cents / 100).toFixed(2) : '',
      r.paid_at ? new Date(r.paid_at).toISOString() : '',
      r.created_at ? new Date(r.created_at).toISOString() : '',
    ]);
    const csv = [head, ...rows].map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(tournament.name || 'tournament').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_registrations.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionsFor = (status) => {
    if (status === 'pending') return [['approve', 'Approve'], ['waitlisted', 'Waitlist'], ['rejected', 'Reject']];
    if (status === 'waitlisted') return [['approve', 'Approve'], ['rejected', 'Reject']];
    if (status === 'rejected') return [['approve', 'Approve']];
    return [];
  };
  const actBtn = (kind) => ({
    fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', border: '0.5px solid',
    ...(kind === 'approve' ? { background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.5)', color: '#22C55E' }
      : kind === 'rejected' ? { background: 'transparent', borderColor: 'rgba(215,38,56,0.45)', color: '#E26B6B' }
      : { background: 'transparent', borderColor: C.border, color: C.steel }),
  });

  const card = { background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 };
  const sec = { fontSize: 11, fontWeight: 700, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '4px 0 8px' };

  return (
    <div>
      {/* Payouts (optional Stripe Connect) */}
      <div style={sec}>Payouts</div>
      <div style={card}>
        {payoutsReady === null ? (
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>Checking payout status…</div>
        ) : payoutsReady ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Payouts connected</div>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginTop: 2 }}>Entry fees deposit straight to your account — you keep 99% (Rinkd keeps 1%).</div>
            </div>
          </div>
        ) : isFounder ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Get paid directly <span style={{ color: 'rgba(244,247,250,0.4)', fontWeight: 600 }}>(optional)</span></div>
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.55)', marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
              Paid registration works right now — fees collect through Rinkd and we settle up with you. Want entry fees deposited straight to your bank automatically? Connect a Stripe account (you keep 99%). You can do this anytime.
            </div>
            <button onClick={handleConnect} disabled={connecting} style={{ ...btnGhost, opacity: connecting ? 0.6 : 1 }}>
              {connecting ? 'Opening Stripe…' : '💳 Connect payouts'}
            </button>
            {connectReturn && <div style={{ fontSize: 12, color: C.amber, marginTop: 10 }}>Just finished on Stripe? Verification can take a moment — reload to see it as connected.</div>}
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>Entry fees for this tournament are handled through Rinkd.</div>
        )}
      </div>

      {/* Registration settings */}
      <div style={sec}>Registration Settings</div>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Registration {open ? 'Open' : 'Closed'}</div>
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginTop: 2 }}>Teams can submit via your link only while open.</div>
          </div>
          <button onClick={() => setOpen(o => !o)} aria-label="Toggle registration open"
            style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: open ? C.green : 'rgba(139,163,190,0.35)', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 3, left: open ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Entry Fee (USD)</label>
            <input style={inputStyle} type="number" min={0} step="0.01" value={feeDollars} onChange={e => setFeeDollars(e.target.value)} placeholder="0.00 (free)" />
          </div>
          <div>
            <label style={labelStyle}>Max Teams (optional)</label>
            <input style={inputStyle} type="number" min={0} value={maxTeams} onChange={e => setMaxTeams(e.target.value)} placeholder="No cap" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Registration Deadline (optional)</label>
          <DateTimePicker value={deadline} onChange={setDeadline} placeholder="No deadline" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={saveConfig} disabled={savingCfg} style={{ ...btnPrimary, flex: 1, minWidth: 120, opacity: savingCfg ? 0.6 : 1 }}>{savingCfg ? 'Saving…' : 'Save Settings'}</button>
          <button onClick={copyLink} style={{ ...btnGhost, color: copied ? C.green : C.ice }}>{copied ? '✓ Copied' : '🔗 Copy Link'}</button>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.35)', marginTop: 10, wordBreak: 'break-all' }}>{regLink}</div>
      </div>

      {/* Submissions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={sec}>Registrations ({regs.length})</div>
        {regs.length > 0 && <button onClick={exportCsv} style={{ ...btnGhost, fontSize: 12 }}>⬇ Export CSV</button>}
      </div>
      {regs.length === 0 ? (
        <div style={{ ...card, color: 'rgba(244,247,250,0.4)', fontSize: 13, textAlign: 'center' }}>No registrations yet. Share your link to start collecting teams.</div>
      ) : (
        REG_GROUPS.map(([status, gLabel]) => {
          const group = regs.filter(r => r.status === status);
          if (!group.length) return null;
          return (
            <div key={status} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: REG_STATUS[status].color, marginBottom: 6 }}>{gLabel} · {group.length}</div>
              {group.map(r => (
                <div key={r.id} style={{ ...card, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>{r.team_name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginTop: 2 }}>{r.contact_name} · {r.contact_email}</div>
                      <div style={{ fontSize: 12, color: r.paid_at ? C.green : 'rgba(244,247,250,0.45)', marginTop: 4 }}>
                        {r.paid_at ? 'Paid' : 'Unpaid'} · ${((r.fee_cents || 0) / 100).toFixed(2)}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: REG_STATUS[status].bg, color: REG_STATUS[status].color, textTransform: 'uppercase', flexShrink: 0 }}>{REG_STATUS[status].label}</span>
                  </div>
                  {actionsFor(status).length > 0 && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {actionsFor(status).map(([action, lbl]) => (
                        <button key={action} disabled={busyId === r.id} onClick={() => act(r, action)} style={actBtn(action)}>{lbl}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function SettingsTab({ tournament, currentUser, reload, flash }) {
  const [name, setName] = useState(tournament.name || '');
  const [division, setDivision] = useState(tournament.division || '');
  const [startDate, setStartDate] = useState(tournament.start_date || '');
  const [endDate, setEndDate] = useState(tournament.end_date || '');
  const [status, setStatus] = useState(tournament.status || 'draft');
  const [logoUrl, setLogoUrl] = useState(tournament.logo_url || '');
  const [accentColor, setAccentColor] = useState(tournament.accent_color || '');
  // Format & rules live in the settings JSONB. Seed from what's stored, falling
  // back to sensible defaults for any key an older tournament is missing.
  const s0 = tournament.settings || {};
  const [fmt, setFmt] = useState({
    period_length_minutes: s0.period_length_minutes ?? 15,
    period_type: s0.period_type ?? 'stop',
    num_periods: s0.num_periods ?? 3,
    points_win: s0.points_win ?? 2,
    points_tie: s0.points_tie ?? 1,
    points_loss: s0.points_loss ?? 0,
    shootout_win_points: s0.shootout_win_points ?? 2,
    max_goal_differential: s0.max_goal_differential ?? null,
    allow_ties: s0.allow_ties ?? true,
    shootout_pool: s0.shootout_pool ?? false,
    shootout_bracket: s0.shootout_bracket ?? true,
    // Overtime defaults ON to preserve historical behavior. Directors of
    // BLPA-style "regulation → shootout, no OT" formats can flip it off and
    // the ScorerView's PERIOD selector hides the OT button.
    overtime_allowed: s0.overtime_allowed ?? true,
    advancement_per_pool: s0.advancement_per_pool ?? 2,
  });
  // Recap + Game Puck sponsors moved to the Sponsors tab (SponsorsManager); the
  // save below preserves settings.recap_sponsor / gamepuck_sponsor untouched.
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const setF = (k, v) => setFmt((prev) => ({ ...prev, [k]: v }));

  // Directors can paste a URL OR upload a logo file. Uploads go through the
  // shared media bucket (same as profile avatars + post images). The returned
  // public URL drops into the logoUrl field; the row only persists when the
  // director clicks Save Settings — matches the rest of the form's behavior.
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser?.id) { e.target.value = ''; return; }
    if (!file.type.startsWith('image/')) {
      flash?.('error', 'Logo must be an image (PNG, JPG, SVG, WebP).');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      flash?.('error', `Logo is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 5 MB.`);
      e.target.value = '';
      return;
    }
    setUploading(true);
    const verdict = await classifyImage(file);
    if (!verdict.ok) {
      setUploading(false);
      flash?.('error', 'That image looks like it may violate Rinkd\'s guidelines. Try a different one.');
      e.target.value = '';
      return;
    }
    const { url, error } = await uploadMedia(file, currentUser.id);
    setUploading(false);
    e.target.value = '';
    if (error || !url) { flash?.('error', `Upload failed: ${error?.message || 'unknown error'}`); return; }
    setLogoUrl(url);
    flash?.('success', 'Logo uploaded — click Save Settings to apply.');
  };

  const save = async () => {
    setBusy(true);
    // Coerce numeric fields so a blank input can never write an empty string
    // into the settings JSONB — the standings view casts these to int.
    const num = (v, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; };
    const cleanFmt = {
      period_length_minutes: num(fmt.period_length_minutes, 15),
      period_type: fmt.period_type || 'stop',
      num_periods: num(fmt.num_periods, 3),
      points_win: num(fmt.points_win, 2),
      points_tie: num(fmt.points_tie, 1),
      points_loss: num(fmt.points_loss, 0),
      shootout_win_points: num(fmt.shootout_win_points, 2),
      max_goal_differential: fmt.max_goal_differential == null ? null : num(fmt.max_goal_differential, null),
      allow_ties: !!fmt.allow_ties,
      shootout_pool: !!fmt.shootout_pool,
      shootout_bracket: !!fmt.shootout_bracket,
      overtime_allowed: !!fmt.overtime_allowed,
      advancement_per_pool: num(fmt.advancement_per_pool, 2),
    };
    // Merge back into the existing settings JSONB so keys we don't edit here
    // (venue_name, venue_address, pool_names, tiebreakers) are never clobbered.
    // Spreading the existing settings preserves recap_sponsor / gamepuck_sponsor
    // (now edited in the Sponsors tab) + venue/pool/tiebreaker keys we don't touch.
    const mergedSettings = { ...(tournament.settings || {}), ...cleanFmt };
    // Branding: only store a valid 6-digit hex; anything else clears it so the
    // public page falls back to the default Rinkd look.
    const cleanAccent = /^#[0-9a-fA-F]{6}$/.test((accentColor || '').trim()) ? accentColor.trim() : '';
    const { error } = await updateTournament(tournament.id, {
      name, division, startDate, endDate, status, settings: mergedSettings,
      logoUrl: (logoUrl || '').trim(), accentColor: cleanAccent,
    });
    setBusy(false);
    if (error) { flash?.('error', `Save failed: ${error.message}`); return; }
    flash?.('success', 'Settings saved.');
    reload();
  };

  const numInput = (k, opts = {}) => (
    <input type="number" value={fmt[k] ?? ''} min={opts.min} max={opts.max}
      onChange={(e) => setF(k, e.target.value === '' ? '' : parseInt(e.target.value, 10))}
      style={inputStyle} />
  );
  const checkbox = (k, label) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ice }}>
      <input type="checkbox" checked={!!fmt[k]} onChange={(e) => setF(k, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div>
      {/* Tournament Info */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 12 }}>Tournament Info</div>
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
              {/* Values match the tournaments_status_check DB constraint
                  exactly. Draft = pre-event, hidden from the public
                  Tournaments index; Active = live + visible; Complete =
                  wrapped + archived. */}
              <option value="draft">Draft (hidden from public)</option>
              <option value="active">Active (live, public)</option>
              <option value="complete">Complete</option>
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
      </div>

      {/* Format & Rules */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 4 }}>Format &amp; Rules</div>
        <div style={{ fontSize: 12, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
          Editable after creation. The point system feeds the standings table directly.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle}>Period Length (min)</label>
            {numInput('period_length_minutes', { min: 1, max: 60 })}
          </div>
          <div>
            <label style={labelStyle}>Period Type</label>
            <select value={fmt.period_type} onChange={(e) => setF('period_type', e.target.value)} style={inputStyle}>
              <option value="stop">Stop time</option>
              <option value="running">Running time</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Periods per Game</label>
            <select value={fmt.num_periods} onChange={(e) => setF('num_periods', parseInt(e.target.value, 10))} style={inputStyle}>
              <option value={1}>1 period</option>
              <option value={2}>2 periods</option>
              <option value={3}>3 periods</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Max Goal Diff</label>
            <select value={fmt.max_goal_differential ?? 'none'}
              onChange={(e) => setF('max_goal_differential', e.target.value === 'none' ? null : parseInt(e.target.value, 10))}
              style={inputStyle}>
              <option value="none">No limit</option>
              {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Points — Win</label>
            {numInput('points_win', { min: 0, max: 10 })}
          </div>
          <div>
            <label style={labelStyle}>Points — Tie</label>
            {numInput('points_tie', { min: 0, max: 10 })}
          </div>
          <div>
            <label style={labelStyle}>Points — Loss</label>
            {numInput('points_loss', { min: 0, max: 10 })}
          </div>
          <div>
            <label style={labelStyle}>Points — OT/SO Win</label>
            {numInput('shootout_win_points', { min: 0, max: 10 })}
          </div>
          <div>
            <label style={labelStyle}>Advance per Pool</label>
            <select value={fmt.advancement_per_pool} onChange={(e) => setF('advancement_per_pool', parseInt(e.target.value, 10))} style={inputStyle}>
              <option value={1}>1 team</option>
              <option value={2}>2 teams</option>
              <option value={3}>3 teams</option>
              <option value={4}>4 teams</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
          {checkbox('allow_ties', 'Allow ties in pool play')}
          {checkbox('overtime_allowed', 'Allow overtime')}
          {checkbox('shootout_pool', 'Shootout in pool play')}
          {checkbox('shootout_bracket', 'Shootout in bracket')}
        </div>
      </div>

      {/* Branding */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 4 }}>Branding</div>
        <div style={{ fontSize: 12, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
          Shown on the public tournament page. Leave blank for the default Rinkd look.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Logo</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://… or upload below" style={{ ...inputStyle, flex: 1, minWidth: 200 }}/>
              <input id="tournament-logo-upload" type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} disabled={uploading} />
              <label htmlFor="tournament-logo-upload"
                style={{
                  ...btnGhost,
                  cursor: uploading ? 'wait' : 'pointer',
                  opacity: uploading ? 0.6 : 1,
                  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                }}>
                {uploading ? 'Uploading…' : '📷 Upload'}
              </label>
              {logoUrl && (
                <button type="button" onClick={() => setLogoUrl('')}
                  style={{ ...btnGhost, color: C.red, borderColor: C.red, whiteSpace: 'nowrap' }}>
                  Remove
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.steel, marginTop: 6, lineHeight: 1.4 }}>
              PNG, JPG, SVG, or WebP up to 5 MB. Square or wide logos work best.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Accent Color (hex)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} placeholder="#D72638" style={{ ...inputStyle, flex: 1 }}/>
              <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, border: `1px solid ${C.border}`, background: /^#[0-9a-fA-F]{6}$/.test((accentColor || '').trim()) ? accentColor.trim() : 'transparent' }} />
            </div>
          </div>
        </div>
        {logoUrl && /^https?:\/\//.test(logoUrl.trim()) && (
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Logo preview</label>
            <img src={logoUrl.trim()} alt="" style={{ height: 44, width: 'auto', borderRadius: 6, background: C.navy, padding: 4, display: 'block' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </div>
        )}
      </div>

      {/* Recap + Game Puck sponsors moved to the Sponsors tab. */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontSize: 12, color: C.steel, lineHeight: 1.5 }}>
        Recap &amp; Game Puck sponsors moved to the <b style={{ color: '#F4F7FA' }}>Sponsors</b> tab.
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? 'Saving…' : 'Save Settings'}</button>
      </div>
    </div>
  );
}

// ====================== SCORERS TAB ======================
function ScorersTab({ tournamentId, tournamentName, originalDirectorId, profile, flash }) {
  const [scorers, setScorers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // When the director enters a handle that doesn't resolve to a Rinkd account,
  // we prompt for an email so they can still send an invite. Set when
  // addScorerByInput returns { status: 'needs_email' }.
  const [emailPromptHandle, setEmailPromptHandle] = useState(null);
  const [emailPromptValue, setEmailPromptValue] = useState('');

  const loadScorers = async () => {
    setLoading(true);
    const { data } = await listScorers(tournamentId);
    setScorers(data);
    setLoading(false);
  };
  // loadScorers reads tournamentId from props; safe to depend only on it.
  useEffect(() => { loadScorers(); }, [tournamentId]);

  const add = async (overrideFallbackEmail) => {
    if (!input.trim() || busy) return;
    setBusy(true); setMsg(null);
    const res = await addScorerByInput({
      tournamentId, tournamentName, input,
      invitedBy: profile?.name || null,
      fallbackEmail: overrideFallbackEmail || null,
    });
    setBusy(false);
    if (res.status === 'added') {
      setMsg({ ok: true, text: `Added ${res.profile.name || '@' + res.profile.handle} as a scorer.` });
      setInput(''); setEmailPromptHandle(null); setEmailPromptValue('');
      loadScorers();
    } else if (res.status === 'already') {
      setMsg({ ok: true, text: `${res.profile.name || '@' + res.profile.handle} already has a ${res.role} role here.` });
      setInput(''); setEmailPromptHandle(null); setEmailPromptValue('');
    } else if (res.status === 'invited') {
      setMsg({ ok: true, text: `No account yet — sent a sign-up invite to ${res.email}. Add them here once they've joined.` });
      setInput(''); setEmailPromptHandle(null); setEmailPromptValue('');
    } else if (res.status === 'needs_email') {
      // Handle didn't resolve — surface a follow-up email field so the
      // director can still send an invite without having to sign up the
      // person themselves first.
      setEmailPromptHandle(res.handle);
      setMsg({ ok: false, text: `No Rinkd account for @${res.handle}. Enter their email to send a sign-up invite.` });
    } else {
      setMsg({ ok: false, text: res.message || 'Could not add scorer.' });
    }
  };

  const remove = async (roleId, name) => {
    if (!window.confirm(`Remove ${name} as a scorer? They'll lose access to score this tournament's games.`)) return;
    const { error } = await removeScorer(roleId);
    if (error) { flash?.('error', `Remove failed: ${error.message}`); return; }
    flash?.('success', `${name} removed as a scorer.`);
    loadScorers();
  };

  return (
    <div>
      <DirectorsSection tournamentId={tournamentId} originalDirectorId={originalDirectorId} flash={flash} />

      <div style={{ fontSize: 13, color: C.steel, marginTop: 24, marginBottom: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        Scorers
      </div>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
        Scorers can run the live scoreboard for this tournament. Add them by Rinkd handle or email —
        anyone without an account yet gets a sign-up invite, and you add them here once they've joined.
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <label style={labelStyle}>Add a scorer</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="@handle or email"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={() => add()} disabled={busy} style={btnPrimary}>{busy ? 'Adding…' : '+ Add'}</button>
        </div>
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12, color: msg.ok ? C.green : C.red, lineHeight: 1.5 }}>{msg.text}</div>
        )}
        {/* Email follow-up — appears when the entered handle didn't match any
            Rinkd account. Lets the director still send a sign-up invite. */}
        {emailPromptHandle && (
          <div style={{ marginTop: 10, padding: 10, background: C.navy, border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <label style={labelStyle}>Email for @{emailPromptHandle}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={emailPromptValue}
                onChange={(e) => setEmailPromptValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add(emailPromptValue.trim())}
                placeholder="them@example.com"
                style={{ ...inputStyle, flex: 1 }}
                autoFocus
              />
              <button
                onClick={() => add(emailPromptValue.trim())}
                disabled={busy || !emailPromptValue.trim()}
                style={btnPrimary}>
                {busy ? 'Sending…' : 'Send invite'}
              </button>
              <button
                onClick={() => { setEmailPromptHandle(null); setEmailPromptValue(''); setMsg(null); }}
                style={btnGhost}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ color: C.steel, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading scorers…</div>
      ) : scorers.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🥅</div>
          No scorers yet. You can always score as the director — add others above to share the load.
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {scorers.map((s, i) => {
            const p = s.profile || {};
            const name = p.name || (p.handle ? '@' + p.handle : 'Unknown');
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: p.avatar_color || C.navy, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff' }}>
                  {p.avatar_initials || (name[0] || '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{name}</div>
                  {p.handle && <div style={{ fontSize: 12, color: C.steel }}>@{p.handle}</div>}
                </div>
                <button onClick={() => remove(s.id, name)} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Directors sub-section rendered above ScorersTab's scorer list. Lets the
// current director add additional directors (who'll have full management
// access — schedule, scorers, teams, settings). Directors must have an
// existing Rinkd account; we don't email-invite directors (too privileged).
// The original director (matching tournaments.director_id) is shown with a
// "founder" badge and cannot be removed — RLS enforces this server-side.
function DirectorsSection({ tournamentId, originalDirectorId, flash }) {
  const [directors, setDirectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await listDirectors(tournamentId);
    setDirectors(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tournamentId]);

  const add = async () => {
    if (!input.trim() || busy) return;
    setBusy(true); setMsg(null);
    const res = await addDirectorByInput({ tournamentId, input });
    setBusy(false);
    if (res.status === 'added') {
      setMsg({ ok: true, text: `Added ${res.profile.name || '@' + res.profile.handle} as a director.` });
      setInput(''); load();
    } else if (res.status === 'already') {
      setMsg({ ok: true, text: `${res.profile.name || '@' + res.profile.handle} already has a ${res.role} role here.` });
      setInput('');
    } else if (res.status === 'no_account') {
      setMsg({ ok: false, text: `No Rinkd account for "${res.input}". Directors must sign up first — share the link and add them once they've joined.` });
    } else {
      setMsg({ ok: false, text: res.message || 'Could not add director.' });
    }
  };

  const remove = async (roleId, name) => {
    if (!window.confirm(`Remove ${name} as a director? They'll lose full management access.`)) return;
    const { error } = await removeDirector(roleId);
    if (error) { flash?.('error', `Remove failed: ${error.message}`); return; }
    flash?.('success', `${name} removed as a director.`);
    load();
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        Directors
      </div>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
        Directors have full management access — schedule, teams, bracket, settings, scorer assignments.
        Add by handle or email. They must already have a Rinkd account.
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <label style={labelStyle}>Add a director</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="@handle or email"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={add} disabled={busy} style={btnPrimary}>{busy ? 'Adding…' : '+ Add'}</button>
        </div>
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12, color: msg.ok ? C.green : C.red, lineHeight: 1.5 }}>{msg.text}</div>
        )}
      </div>

      {loading ? (
        <div style={{ color: C.steel, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading directors…</div>
      ) : directors.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: '24px 0', fontSize: 13 }}>
          No directors yet. (The original director isn't tracked here separately — they're set on the tournament itself.)
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {directors.map((d, i) => {
            const p = d.profile || {};
            const name = p.name || (p.handle ? '@' + p.handle : 'Unknown');
            const isFounder = d.user_id === originalDirectorId;
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: p.avatar_color || C.navy, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff' }}>
                  {p.avatar_initials || (name[0] || '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>
                    {name}
                    {isFounder && (
                      <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', background: C.amber + '30', color: C.amber, borderRadius: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        Founder
                      </span>
                    )}
                  </div>
                  {p.handle && <div style={{ fontSize: 12, color: C.steel }}>@{p.handle}</div>}
                </div>
                {isFounder ? (
                  <div style={{ fontSize: 11, color: C.steel }}>Can't remove</div>
                ) : (
                  <button onClick={() => remove(d.id, name)} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Remove</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ====================== SUSPENSIONS TAB (GS-2) ======================
// Director lifecycle surface for suspensions filed from ScorerView. Status
// transitions go through the fail-closed RPCs ONLY (serve_suspension /
// overturn_suspension) — there is deliberately no direct-update path, so the
// counting invariants live in one place. Mark Served consumes exactly one
// game per tap and flips to 'served' at zero; Overturn voids the record from
// pending OR served (the mis-tap recovery).
const SUSPENSION_TYPE_LABELS = {
  game_misconduct: 'Game misconduct',
  match_penalty: 'Match penalty',
  suspension_1: '1-game suspension',
  suspension_2: '2-game suspension',
  suspension_3: '3-game suspension',
  indefinite: 'Indefinite',
};

function SuspensionsTab({ tournamentId, flash, onPendingCount }) {
  const [rows, setRows] = useState(null);   // null = loading
  const [busyId, setBusyId] = useState(null);
  const [overturnFor, setOverturnFor] = useState(null); // suspension id with the note form open
  const [overturnNote, setOverturnNote] = useState('');

  const loadRows = useCallback(async () => {
    // Embeds qualified by FK name (PostgREST ambiguity footgun — never bare).
    const { data, error } = await supabase.from('game_suspensions')
      .select('*, team:tournament_teams!game_suspensions_team_id_fkey(team_name), game:games!game_suspensions_game_id_fkey(id, start_time)')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false });
    if (error) {
      flash('error', `Could not load suspensions: ${error.message}`);
      setRows([]);
      return;
    }
    setRows(data || []);
    onPendingCount?.((data || []).filter(r => r.status === 'pending').length);
  }, [tournamentId, flash, onPendingCount]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const serve = async (s) => {
    if (busyId) return;
    setBusyId(s.id);
    try {
      const { data, error } = await supabase.rpc('serve_suspension', { p_suspension_id: s.id });
      if (error) { flash('error', error.message); return; }
      flash('success', data?.status === 'served'
        ? `${data.player_name} has fully served the suspension.`
        : `Game served — ${data?.games_remaining} game${data?.games_remaining === 1 ? '' : 's'} left for ${data?.player_name}.`);
      await loadRows();
    } finally {
      setBusyId(null);
    }
  };

  const overturn = async (s) => {
    if (busyId) return;
    setBusyId(s.id);
    try {
      const { error } = await supabase.rpc('overturn_suspension', {
        p_suspension_id: s.id,
        p_note: overturnNote.trim() || null,
      });
      if (error) { flash('error', error.message); return; }
      flash('success', `Suspension for ${s.player_name} overturned.`);
      setOverturnFor(null);
      setOverturnNote('');
      await loadRows();
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) return <div style={{ color: C.steel, fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Loading suspensions…</div>;

  const pending = rows.filter(r => r.status === 'pending');
  const resolved = rows.filter(r => r.status !== 'pending');
  const playerLabel = (s) => `${s.jersey_number != null ? `#${s.jersey_number} ` : ''}${s.player_name}`;
  const remainingLabel = (s) => s.suspension_type === 'indefinite'
    ? 'Indefinite — overturn to lift'
    : `${s.games_remaining} game${s.games_remaining === 1 ? '' : 's'} remaining`;

  const card = { background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 };

  const renderRow = (s, actions) => (
    <div key={s.id} style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
              background: s.status === 'pending' ? 'rgba(215,38,56,0.18)' : s.status === 'served' ? 'rgba(34,197,94,0.15)' : 'rgba(139,163,190,0.15)',
              color: s.status === 'pending' ? C.red : s.status === 'served' ? C.green : C.steel }}>
              {s.status.toUpperCase()}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>{playerLabel(s)}</span>
          </div>
          <div style={{ fontSize: 12, color: C.steel, lineHeight: 1.6 }}>
            {s.team?.team_name || 'Unknown team'} · {SUSPENSION_TYPE_LABELS[s.suspension_type] || s.suspension_type}
            {s.status === 'pending' && <> · <span style={{ color: C.amber, fontWeight: 700 }}>{remainingLabel(s)}</span></>}
            <br />
            Filed {fmtDateTime(s.created_at)}{s.game?.start_time ? ` · game of ${fmtDateTime(s.game.start_time)}` : ''}
            {s.resolved_at ? ` · resolved ${fmtDateTime(s.resolved_at)}` : ''}
          </div>
          {s.notes && (
            <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.55)', marginTop: 6, whiteSpace: 'pre-wrap', borderLeft: `2px solid ${C.border}`, paddingLeft: 8 }}>
              {s.notes}
            </div>
          )}
        </div>
        {actions}
      </div>
      {overturnFor === s.id && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            placeholder="Why is this being overturned? (optional)"
            value={overturnNote}
            onChange={(e) => setOverturnNote(e.target.value)}
          />
          <button style={btnPrimary} disabled={busyId === s.id} onClick={() => overturn(s)}>
            {busyId === s.id ? 'Saving…' : 'Confirm overturn'}
          </button>
          <button style={btnGhost} onClick={() => { setOverturnFor(null); setOverturnNote(''); }}>Cancel</button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 16 }}>
        Suspensions are filed by scorekeepers when a game misconduct or match penalty is logged.
        <b style={{ color: C.ice }}> Mark Served</b> counts one game sat out (the suspension clears at zero);
        <b style={{ color: C.ice }}> Overturn</b> voids it. Teams with a pending suspension show a team-level
        ⚠️ badge on the public standings — player names are never shown publicly.
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>
        Pending ({pending.length})
      </div>
      {pending.length === 0 && (
        <div style={{ ...card, color: C.steel, fontSize: 13, textAlign: 'center' }}>No pending suspensions. 🎉</div>
      )}
      {pending.map(s => renderRow(s, (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {s.suspension_type !== 'indefinite' && (
            <button style={{ ...btnPrimary, opacity: busyId === s.id ? 0.6 : 1 }} disabled={!!busyId}
              onClick={() => serve(s)}>
              {busyId === s.id ? 'Saving…' : 'Mark Served'}
            </button>
          )}
          <button style={btnGhost} disabled={!!busyId}
            onClick={() => { setOverturnFor(overturnFor === s.id ? null : s.id); setOverturnNote(''); }}>
            Overturn
          </button>
        </div>
      )))}

      {resolved.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', margin: '18px 0 8px' }}>
            Resolved ({resolved.length})
          </div>
          {/* A served row can still be overturned — the recovery path for a
              mis-tapped Mark Served (there is deliberately no un-serve). */}
          {resolved.map(s => renderRow(s, s.status === 'served' ? (
            <button style={btnGhost} disabled={!!busyId}
              onClick={() => { setOverturnFor(overturnFor === s.id ? null : s.id); setOverturnNote(''); }}>
              Overturn
            </button>
          ) : null))}
        </>
      )}
    </div>
  );
}
