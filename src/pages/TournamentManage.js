import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getTournament } from '../lib/tournaments';
import {
  listTeams, createTeam, updateTeam, deleteTeam,
  listGames, updateGame, deleteGame,
  generatePoolSchedule,
  loadPoolQualifiers, createBracketGame,
  updateTournament, setTournamentYouth,
  listStandingsSummary,
  generateBracketV2, loadBracketSeedCandidates, BRACKET_SIZES,
  recordForfeit,
} from '../lib/tournamentManage';
import {
  listDivisions, createDivision, updateDivision, deleteDivision, reorderDivisions,
} from '../lib/tournamentDivisions';
import { listRinks } from '../lib/rinks';
import { listScorers, addScorerByInput, removeScorer } from '../lib/tournamentScorers';
import { listDirectors, addDirectorByInput, removeDirector, isExtraDirector as isDirectorRole } from '../lib/tournamentDirectors';
import { uploadMedia } from '../lib/posts';
import { classifyImage } from '../lib/imageModeration';
import DateTimePicker from '../components/DateTimePicker';
import EditGameModal from '../components/EditGameModal';
import SponsorsManager from '../components/SponsorsManager';
import { supabase } from '../lib/supabase';
import { TeamLogo } from '../components/Logos';
import { getTournamentRegistrations, updateTournamentRegistrationStatus, approveTournamentRegistration } from '../lib/registrations';
import { tournamentPayoutsReady, startConnectOnboarding } from '../lib/stripeConnect';
import { listLinks, createLink, setLinkStatus, removeLink, listGameMaps, confirmMatch, ignoreMatch } from '../lib/gamesheet';
import { listTournamentTeamJerseys, getTournamentTeamLinks, searchLinkableProfiles, linkTournamentPlayer, unlinkTournamentPlayer } from '../lib/tournamentRoster';

import Skeleton from '../components/ui/Skeleton';
import ErrorState from '../components/ui/ErrorState';
import Icon from '../components/ui/Icon';
import { ConfirmSheet, useConfirm, ConfirmSheetHost } from '../components/ui/ConfirmSheet';

import { C as sharedC, colors } from '../lib/tokens';

// Shared tokens + the two semantic keys this page's ~15 call sites still name
// green/amber (values converge to the tokens; rename to colors.* in a later pass).
const C = { ...sharedC, green: colors.success, amber: colors.warning };

const TABS = ['Divisions', 'Teams', 'Schedule', 'Bracket', 'Registrations', 'Scorers', 'Suspensions', 'Sponsors', 'Integrations', 'Settings'];

// Tabs whose panels operate on a single selected division. The scope selector
// (chips) renders above these tabs when the event has >1 division.
const DIVISION_SCOPED_TABS = new Set(['Teams', 'Schedule', 'Bracket']);

// Per-division format presets for the Divisions tab. "Inherit" = empty settings
// so the division falls back to the tournament's settings (the M3/public-page
// merge). Mirrors TournamentCreate's FORMAT_PRESETS; kept minimal here since a
// division only needs to override the format, not re-enter every field.
const DIVISION_FORMAT_PRESETS = {
  '': { label: 'Inherit from tournament', settings: null },
  blpa_bash: {
    label: 'BLPA Bash (3×12 · 6-goal mercy · 1 advances)',
    settings: {
      period_length_minutes: 12, period_type: 'stop', num_periods: 3,
      points_win: 2, points_tie: 1, points_loss: 0, shootout_win_points: 2,
      max_goal_differential: 6, allow_ties: true, shootout_pool: false,
      shootout_bracket: true, advancement_per_pool: 1,
      tiebreakers: ['goal_quotient', 'period_points', 'head_to_head', 'goal_diff', 'goals_for', 'goals_against', 'penalty_minutes', 'coin_toss'],
    },
  },
};

const REG_STATUS = {
  pending:    { label: 'Pending',    color: colors.warning, bg: 'rgba(245,158,11,0.15)' },
  approved:   { label: 'Approved',   color: colors.success, bg: 'rgba(34,197,94,0.15)' },
  waitlisted: { label: 'Waitlisted', color: C.steel, bg: 'rgba(139,163,190,0.15)' },
  rejected:   { label: 'Rejected',   color: C.red, bg: 'rgba(215,38,56,0.15)' },
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

// S10 — geometric loading placeholder for every tab/section that used to render
// a bare "Warming up." / "Loading standings…" string. `rows` grey bars, each
// matching a card row's height, so there's no layout shift when data hydrates.
// Reduced-motion safe (Skeleton holds a flat tint, no sweep).
function TabSkeleton({ rows = 3 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Skeleton width={36} height={36} radius={8} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="35%" height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

// S10 — page-level shell: header block + tab strip + a few card rows. Shown while
// the tournament + its teams/games/divisions load, matching the real layout the
// page settles into (no jump from a centered one-liner to the full board).
function PageSkeleton({ profile }) {
  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '20px 16px 80px' }}>
          <Skeleton width={140} height={12} style={{ marginBottom: 12 }} />
          <Skeleton width="60%" height={30} style={{ marginBottom: 8 }} />
          <Skeleton width="40%" height={13} style={{ marginBottom: 18 }} />
          <div style={{ display: 'flex', gap: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 18 }}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} width={72} height={16} />)}
          </div>
          <TabSkeleton rows={3} />
        </div>
      </div>
    </Layout>
  );
}

export default function TournamentManagePage({ currentUser, profile }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [rinks, setRinks] = useState([]);
  const [standingsByTeam, setStandingsByTeam] = useState({});
  // MULTIDIV-1 (M4): divisions drive the scope selector. Single-division events
  // (incl. BLPA's backfilled "Main") have exactly one; the chips stay hidden.
  const [divisions, setDivisions] = useState([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState(null);
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
      const [{ data: ts }, { data: gs }, { data: rk }, { data: st }, { count: suspCount }, { data: divs }] = await Promise.all([
        listTeams(id),
        listGames(id),
        listRinks().catch(() => ({ data: [] })),
        listStandingsSummary(id).catch(() => ({ data: [] })),
        supabase.from('game_suspensions')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', id).eq('status', 'pending'),
        listDivisions(id).catch(() => ({ data: [] })),
      ]);
      setTeams(ts); setGames(gs); setRinks(rk || []);
      setPendingSuspCount(suspCount || 0);
      const divList = divs || [];
      setDivisions(divList);
      // Default to the first division; preserve the director's pick across
      // reloads (mirror Tournament.js M3) so adding a team doesn't snap the
      // scope back to division 1.
      setSelectedDivisionId((cur) =>
        cur && divList.some((d) => d.id === cur) ? cur : (divList[0]?.id ?? null));
      // Convert standings rows to a team_id → {gp,wins,losses,ties,pts} lookup
      // so renderers can look up records by id in O(1). Empty tournament =
      // empty lookup, which the renderers treat as "no record yet."
      const map = {};
      (st || []).forEach(r => { map[r.team_id] = r; });
      setStandingsByTeam(map);
    } catch (e) {
      setError(e.message || "This tournament didn't load — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // S10 — geometric page skeleton (header + tabs + card rows) instead of a
  // centered one-liner, so there's no layout jump when the board hydrates.
  if (loading) return <PageSkeleton profile={profile} />;
  if (error || !tournament) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <ErrorState
          title={tournament ? 'That didn’t load' : 'We couldn’t find this tournament'}
          body={error || 'It may have been removed, or the link is off. Head back to browse events.'}
          onRetry={() => { setError(null); setLoading(true); load(); }}
        >
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
            <button onClick={() => navigate('/tournaments')} style={btnGhost}>Back to tournaments</button>
          </div>
        </ErrorState>
      </div>
    </Layout>
  );
  // Wait for the extra-director async check before deciding to lock out.
  // Without this gate, a freshly-added director navigating to /manage sees
  // the lock screen for a beat while tournament_roles is being queried.
  if (!extraDirectorChecked) return <PageSkeleton profile={profile} />;
  if (!isDirector) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12, padding: 20, textAlign: 'center' }}>
        <Icon name="privacy" size={40} color={C.steel} />
        <div>Only the tournament director can manage this event.</div>
        <button onClick={() => navigate(`/tournament/${id}`)} style={btnPrimary}>View tournament</button>
      </div>
    </Layout>
  );

  // MULTIDIV-1: scope teams/games/settings to the selected division so the
  // Teams/Schedule/Bracket panels only show + write that division's data.
  // Single-division events have selectedDivisionId = the backfilled "Main"
  // division (every row already points at it) → identical to pre-multidiv.
  // Events with no division yet (e.g. created before M5's create-step lands)
  // have selectedDivisionId = null → no filtering, today's behavior.
  const selectedDivision = divisions.find((d) => d.id === selectedDivisionId) || null;
  const divSettings = { ...(tournament.settings || {}), ...(selectedDivision?.settings || {}) };
  const divisionTeams = selectedDivisionId ? teams.filter((t) => t.division_id === selectedDivisionId) : teams;
  const divisionGames = selectedDivisionId ? games.filter((g) => g.division_id === selectedDivisionId) : games;
  const showScopeChips = divisions.length > 1 && DIVISION_SCOPED_TABS.has(tab);

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
              <Icon name="privacy" size={18} color={colors.warning} style={{ marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.warning }}>Activation pending</div>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.65)', marginTop: 4, lineHeight: 1.5 }}>
                  You can set up teams, schedule, and bracket now. Live scoring + auto-recap pushes are locked until Rinkd activates this tournament. Email <a href="mailto:hello@rinkd.app?subject=Tournament Activation Request" style={{ color: colors.warning }}>hello@rinkd.app</a> to activate, or see <a href="/pricing" style={{ color: colors.warning }}>pricing</a>.
                </div>
              </div>
            </div>
          )}

          {/* Tabs — wrapped in a relative container so the right-edge gradient
              mask hints at horizontal scroll on narrow viewports where "Settings"
              clips off-screen. Without the mask, mobile users miss the last tab. */}
          <div style={{ position: 'relative', marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {/* GameSheet-synced events hide Registrations (poller feeds scores; GameSheet tab manages the link). */}
              {(tournament?.scoring_source === 'external' ? TABS.filter((t) => t !== 'Registrations') : TABS).map((t) => (
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
              <Icon name={flash.kind === 'error' ? 'alert' : 'approved'} size={18} color={flash.kind === 'error' ? C.red : C.green} />
              <span style={{ flex: 1 }}>{flash.text}</span>
              <span style={{ fontSize: 11, color: C.steel }}>tap to dismiss</span>
            </div>
          )}

          {/* MULTIDIV-1 division scope selector — only when >1 division and the
              active tab operates on one division. Hidden for single-division
              events (BLPA unchanged). */}
          {showScopeChips && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Editing division</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {divisions.map((d) => (
                  <button key={d.id} onClick={() => setSelectedDivisionId(d.id)}
                    style={{
                      padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap',
                      border: selectedDivisionId === d.id ? 'none' : `1px solid ${C.border}`,
                      background: selectedDivisionId === d.id ? C.red : 'transparent',
                      color: selectedDivisionId === d.id ? '#fff' : C.steel,
                    }}>
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'Divisions' && <DivisionsTab tournamentId={id} divisions={divisions} teams={teams} games={games} selectedDivisionId={selectedDivisionId} onSelect={setSelectedDivisionId} reload={load} flash={showFlash} />}
          {tab === 'Teams' && <TeamsTab tournamentId={id} teams={divisionTeams} divisionId={selectedDivisionId} standingsByTeam={standingsByTeam} reload={load} flash={showFlash} />}
          {tab === 'Schedule' && <ScheduleTab tournamentId={id} tournament={tournament} teams={divisionTeams} games={divisionGames} divisionId={selectedDivisionId} rinks={rinks} reload={load} flash={showFlash} />}
          {tab === 'Bracket' && <BracketTab tournamentId={id} tournament={tournament} divSettings={divSettings} teams={divisionTeams} games={divisionGames} divisionId={selectedDivisionId} rinks={rinks} reload={load} flash={showFlash} />}
          {tab === 'Registrations' && <RegistrationsTab tournamentId={id} tournament={tournament} divisionId={selectedDivisionId} reload={load} flash={showFlash} />}
          {tab === 'Scorers' && <ScorersTab tournamentId={id} tournamentName={tournament.name} originalDirectorId={tournament.director_id} profile={profile} flash={showFlash} />}
          {tab === 'Suspensions' && <SuspensionsTab tournamentId={id} flash={showFlash} onPendingCount={setPendingSuspCount} />}
          {tab === 'Sponsors' && <SponsorsManager ownerType="tournament" ownerId={id} isYouth={tournament.settings?.feature_profile === 'youth_competitive'}
            settings={tournament.settings || {}}
            onSaveSettings={async (partial) => { await updateTournament(id, { settings: { ...(tournament.settings || {}), ...partial } }); await load(); }} />}
          {tab === 'Integrations' && <IntegrationsTab tournamentId={id} tournament={tournament} games={games} reload={load} flash={showFlash} />}
          {tab === 'Settings' && <SettingsTab tournament={tournament} currentUser={currentUser} reload={load} flash={showFlash} />}
        </div>
      </div>
    </Layout>
  );
}

// ====================== DIVISIONS TAB ======================
// MULTIDIV-1 (M4): in-app division CRUD + reorder. Before this, divisions only
// existed via SQL. Each division is the unit of competition (its own teams,
// schedule, bracket, format); the tournament is the event wrapper.
function DivisionsTab({ tournamentId, divisions, teams, games, selectedDivisionId, onSelect, reload, flash }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const confirm = useConfirm();

  // Per-division team + game counts so the director sees what a delete will
  // take with it (teams CASCADE; games' division_id is SET NULL).
  const counts = useMemo(() => {
    const m = {};
    for (const t of teams) { const k = t.division_id; if (!k) continue; m[k] = m[k] || { teams: 0, games: 0 }; m[k].teams++; }
    for (const g of games) { const k = g.division_id; if (!k) continue; m[k] = m[k] || { teams: 0, games: 0 }; m[k].games++; }
    return m;
  }, [teams, games]);

  const move = async (idx, dir) => {
    const next = idx + dir;
    if (next < 0 || next >= divisions.length) return;
    const ids = divisions.map((d) => d.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    setBusyId(divisions[idx].id);
    const { error } = await reorderDivisions(ids);
    setBusyId(null);
    if (error) { flash?.('error', `That reorder didn't save — ${error.message}`); return; }
    reload();
  };

  const remove = async (d) => {
    const c = counts[d.id] || { teams: 0, games: 0 };
    const warn = c.teams > 0 || c.games > 0
      ? `This removes its ${c.teams} team${c.teams === 1 ? '' : 's'}${c.games ? ` and unassigns ${c.games} game${c.games === 1 ? '' : 's'}` : ''} — this can't be undone.`
      : `This can't be undone.`;
    if (!(await confirm({ title: `Delete “${d.name}”?`, body: warn, confirmLabel: 'Delete division', danger: true }))) return;
    setBusyId(d.id);
    const { error } = await deleteDivision(d.id);
    setBusyId(null);
    if (error) { flash?.('error', `That didn't delete — ${error.message}`); return; }
    flash?.('success', `Deleted ${d.name}.`);
    // If we just deleted the selected division, drop the selection so the page
    // re-defaults to the first remaining one on reload.
    if (selectedDivisionId === d.id) onSelect?.(null);
    reload();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.steel }}>
          {divisions.length} division{divisions.length === 1 ? '' : 's'}
        </div>
        <button onClick={() => { setAdding(true); setEditingId(null); }} style={btnPrimary}>+ Add Division</button>
      </div>

      <div style={{ fontSize: 12, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
        Each division has its own teams, schedule, bracket, and format. Pick a division in the scope selector above the Teams / Schedule / Bracket tabs to manage it. A division's format overrides the tournament's; leave it on “Inherit” to use the tournament settings.
      </div>

      {adding && (
        <DivisionForm tournamentId={tournamentId} nextSortOrder={divisions.length}
          flash={flash} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />
      )}

      {divisions.length === 0 && !adding && (
        <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>
          Add your first division to start scoping teams and games.
        </div>
      )}

      <ConfirmSheetHost controller={confirm} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {divisions.map((d, i) => editingId === d.id ? (
          <DivisionForm key={d.id} tournamentId={tournamentId} division={d} nextSortOrder={d.sort_order}
            flash={flash} onDone={() => { setEditingId(null); reload(); }} onCancel={() => setEditingId(null)} />
        ) : (
          <div key={d.id} style={{ background: C.card, border: `1px solid ${selectedDivisionId === d.id ? C.red : C.border}`, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button onClick={() => move(i, -1)} disabled={i === 0 || busyId} title="Move up"
                style={{ ...btnGhost, padding: '2px 8px', opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? 'default' : 'pointer' }}>▲</button>
              <button onClick={() => move(i, 1)} disabled={i === divisions.length - 1 || busyId} title="Move down"
                style={{ ...btnGhost, padding: '2px 8px', opacity: i === divisions.length - 1 ? 0.3 : 1, cursor: i === divisions.length - 1 ? 'default' : 'pointer' }}>▼</button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ice, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {d.name}
                {d.age_group && <span style={{ fontSize: 10, fontWeight: 700, color: C.steel, background: C.navy, borderRadius: 6, padding: '2px 6px', letterSpacing: '0.05em' }}>{d.age_group}</span>}
                {d.tier && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: C.blue, borderRadius: 6, padding: '2px 6px', letterSpacing: '0.05em' }}>{d.tier}</span>}
              </div>
              <div style={{ fontSize: 12, color: C.steel, marginTop: 4 }}>
                {(counts[d.id]?.teams || 0)} team{(counts[d.id]?.teams || 0) === 1 ? '' : 's'} · {(counts[d.id]?.games || 0)} game{(counts[d.id]?.games || 0) === 1 ? '' : 's'} · {d.settings && Object.keys(d.settings).length > 0 ? 'custom format' : 'inherits format'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setEditingId(d.id); setAdding(false); }} style={btnGhost}>Edit</button>
              <button onClick={() => remove(d)} disabled={busyId === d.id} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DivisionForm({ tournamentId, division, nextSortOrder = 0, flash, onDone, onCancel }) {
  const [name, setName] = useState(division?.name || '');
  const [ageGroup, setAgeGroup] = useState(division?.age_group || '');
  const [tier, setTier] = useState(division?.tier || '');
  // Detect the current preset: empty settings → inherit; matches a known
  // preset key → that preset; anything else → "custom" (keep, don't clobber).
  const initialPreset = useMemo(() => {
    const s = division?.settings || {};
    if (!s || Object.keys(s).length === 0) return '';
    const match = Object.entries(DIVISION_FORMAT_PRESETS).find(
      ([, p]) => p.settings && JSON.stringify(p.settings) === JSON.stringify(s)
    );
    return match ? match[0] : 'custom';
  }, [division]);
  const [preset, setPreset] = useState(initialPreset);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const save = async () => {
    if (!name.trim()) { setLocalError('Add a division name to continue.'); return; }
    setLocalError('');
    setBusy(true);
    // 'custom' = keep the division's existing settings untouched; '' = inherit
    // (empty); a known preset = drop in that preset's settings object.
    let settings;
    if (preset === 'custom') settings = division?.settings || {};
    else settings = DIVISION_FORMAT_PRESETS[preset]?.settings || {};
    const fields = { name, ageGroup, tier, settings };
    const res = division
      ? await updateDivision(division.id, fields)
      : await createDivision(tournamentId, { ...fields, sortOrder: nextSortOrder });
    setBusy(false);
    if (res.error) { flash?.('error', `That didn't save — ${res.error.message}`); return; }
    flash?.('success', division ? 'Division saved.' : `Added ${name}.`);
    onDone();
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Division Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 12U AA" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Age Group</label>
          <input value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} placeholder="12U" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Tier</label>
          <input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="AA / AAA / A" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Format</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={inputStyle}>
            {Object.entries(DIVISION_FORMAT_PRESETS).map(([k, p]) => (
              <option key={k} value={k}>{p.label}</option>
            ))}
            {initialPreset === 'custom' && <option value="custom">Custom (keep current)</option>}
          </select>
        </div>
      </div>
      {localError && (
        <div style={{ background: 'rgba(215,38,56,0.12)', border: '1px solid rgba(215,38,56,0.4)', color: C.ice, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
          {localError}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={btnGhost}>Cancel</button>
        <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? 'Saving…' : division ? 'Save' : 'Add Division'}</button>
      </div>
    </div>
  );
}

// ====================== TEAMS TAB ======================
function TeamsTab({ tournamentId, teams, divisionId = null, standingsByTeam = {}, reload, flash }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [linkingId, setLinkingId] = useState(null);

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

      {adding && <TeamForm tournamentId={tournamentId} divisionId={divisionId} pools={pools} flash={flash} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}

      {teams.length === 0 && !adding && (
        <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>
          Add your first team to get this event on the ice.
        </div>
      )}

      {Object.entries(byPool).map(([pool, list]) => (
        <div key={pool} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>{pool}</div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {list.map((t, i) => editingId === t.id ? (
              <div key={t.id} style={{ padding: 12, borderTop: i ? `1px solid rgba(46,91,140,0.25)` : 'none' }}>
                <TeamForm tournamentId={tournamentId} divisionId={divisionId} pools={pools} team={t} flash={flash} onDone={() => { setEditingId(null); reload(); }} onCancel={() => setEditingId(null)} />
              </div>
            ) : (
              <div key={t.id} style={{ borderTop: i ? `1px solid rgba(46,91,140,0.25)` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: 12, gap: 12 }}>
                  <TeamLogo team={{ name: t.team_name, logo_url: t.logo_url, logo_color: C.navy }} size={36} radius={8} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{t.team_name}{t.seed ? ` · #${t.seed}` : ''}</div>
                    <div style={{ fontSize: 12, color: C.steel }}>
                      {standingsByTeam[t.id]?.gp > 0
                        ? <span><b style={{ color: C.ice }}>{standingsByTeam[t.id].wins}-{standingsByTeam[t.id].losses}-{standingsByTeam[t.id].ties}</b> · {standingsByTeam[t.id].pts} pts · {t.contact_email || 'no contact'}</span>
                        : (t.contact_email || '—')}
                    </div>
                  </div>
                  <button
                    onClick={() => setLinkingId(linkingId === t.id ? null : t.id)}
                    style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 6, ...(linkingId === t.id ? { borderColor: C.red, color: C.red } : {}) }}
                    title="Link Rinkd players to jerseys so their stats show on their profile"><Icon name="link" size={13} /> Players</button>
                  <button onClick={() => setEditingId(t.id)} style={btnGhost}>Edit</button>
                </div>
                {linkingId === t.id && <TeamPlayerLinks tournamentId={tournamentId} team={t} flash={flash} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// STATS-3 Step 4c — director-side jersey<->profile linking. A tournament team's
// "roster" is derived from its game_lineups (no stored roster table), so the
// jerseys shown are exactly the ones a link can actually attribute stats to.
// Adults only — the RPC is the gate; the minor hint here is just courtesy.
function TeamPlayerLinks({ tournamentId, team, flash }) {
  const [jerseys, setJerseys] = useState(null); // null = loading
  const [links, setLinks] = useState({});       // { [jersey_number]: {user_id,name,handle} }
  const [openJersey, setOpenJersey] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [js, lk] = await Promise.all([
      listTournamentTeamJerseys(tournamentId, team.id),
      getTournamentTeamLinks(team.id),
    ]);
    setJerseys(js);
    setLinks(lk);
  }, [tournamentId, team.id]);
  useEffect(() => { load(); }, [load]);

  // Debounced profile search while a jersey's search box is open.
  useEffect(() => {
    if (openJersey == null) return undefined;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return undefined; }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      const r = await searchLinkableProfiles(q);
      if (!cancelled) { setResults(r); setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, openJersey]);

  const startLink = (jersey) => { setOpenJersey(jersey); setQuery(''); setResults([]); };
  const cancelLink = () => { setOpenJersey(null); setQuery(''); setResults([]); };

  const doLink = async (jersey, profile) => {
    if (busy) return;
    if (profile.account_type === 'minor') {
      flash?.('error', 'Minor players can’t be linked yet — that needs guardian consent.');
      return;
    }
    setBusy(true);
    const { stamped, error } = await linkTournamentPlayer(team.id, jersey, profile.id);
    setBusy(false);
    if (error) {
      flash?.('error', /guardian consent/i.test(error.message || '')
        ? 'Minor players can’t be linked yet — that needs guardian consent.'
        : (error.message || "That didn't link — check your connection and try again."));
      return;
    }
    flash?.('success', `Linked ${profile.name} to #${jersey}${stamped ? ` · ${stamped} game${stamped === 1 ? '' : 's'}` : ''}.`);
    cancelLink();
    load();
  };

  const doUnlink = async (jersey) => {
    if (busy) return;
    setBusy(true);
    const { error } = await unlinkTournamentPlayer(team.id, jersey);
    setBusy(false);
    if (error) { flash?.('error', error.message || "That didn't unlink — check your connection and try again."); return; }
    flash?.('success', `Unlinked #${jersey}.`);
    load();
  };

  return (
    <div style={{ padding: '0 12px 14px 12px', background: 'rgba(7,17,31,0.35)' }}>
      <div style={{ fontSize: 12, color: C.steel, lineHeight: 1.5, padding: '10px 0' }}>
        Link a Rinkd profile to a jersey so this event’s stats show on their profile.
        <b style={{ color: C.ice }}> Adults only</b> — minors stay behind the guardian-consent path.
        New games for a linked jersey attach automatically.
      </div>
      {jerseys === null ? (
        <div style={{ padding: '8px 0' }}><TabSkeleton rows={2} /></div>
      ) : jerseys.length === 0 ? (
        <div style={{ fontSize: 12, color: C.steel, padding: '8px 0' }}>
          Jerseys show up here once this team has game lineups to attribute.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {jerseys.map((j) => {
            const link = links[j.jersey_number];
            return (
              <div key={j.jersey_number} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice, minWidth: 34 }}>#{j.jersey_number}</span>
                  <span style={{ fontSize: 13, color: C.steel, flex: 1, minWidth: 80 }}>{j.invite_name || '—'}</span>
                  {link ? (
                    <>
                      <span style={{ fontSize: 12, color: C.green, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="approved" size={13} color={C.green} /> {link.name}{link.handle ? ` · @${link.handle}` : ''}</span>
                      <button onClick={() => doUnlink(j.jersey_number)} disabled={busy} style={btnGhost}>Unlink</button>
                    </>
                  ) : openJersey === j.jersey_number ? (
                    <button onClick={cancelLink} style={btnGhost}>Cancel</button>
                  ) : (
                    <button onClick={() => startLink(j.jersey_number)} style={btnGhost}>Link Rinkd player</button>
                  )}
                </div>
                {openJersey === j.jersey_number && !link && (
                  <div style={{ marginTop: 8 }}>
                    <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or @handle…" style={inputStyle} />
                    {searching && <div style={{ fontSize: 11, color: C.steel, marginTop: 6 }}>Searching…</div>}
                    {!searching && query.trim().length >= 2 && results.length === 0 && (
                      <div style={{ fontSize: 11, color: C.steel, marginTop: 6 }}>No matches.</div>
                    )}
                    {results.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {results.map((p) => (
                          <button key={p.id} onClick={() => doLink(j.jersey_number, p)} disabled={busy}
                            style={{ textAlign: 'left', background: C.navy, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: C.ice, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                            {p.handle && <span style={{ fontSize: 12, color: C.steel }}>@{p.handle}</span>}
                            {p.account_type === 'minor' && <span style={{ fontSize: 10, color: C.amber, marginLeft: 'auto' }}>minor — consent needed</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// S05 C2a — split a pasted multi-line/comma-separated blob into individual team
// names. Supports newlines, commas, and semicolons as separators (captains often
// paste from a spreadsheet column or a comma list); blank entries are dropped.
function splitTeamNames(raw) {
  return (raw || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function TeamForm({ tournamentId, divisionId = null, team, pools, flash, onDone, onCancel }) {
  const [teamName, setTeamName] = useState(team?.team_name || '');
  // S05 A4 — pool is now a select of existing pools + "New pool…". `poolChoice`
  // drives the <select>; `newPool` holds the free-text value while "__new__" is
  // selected. Editing an existing team whose pool isn't in `pools` (shouldn't
  // happen since `pools` is derived from all teams, but stay defensive) falls
  // back to the "New pool…" text input pre-filled with that value.
  const initialPool = team?.pool || (pools[0] || '');
  const initialIsKnown = !initialPool || pools.includes(initialPool);
  const [poolChoice, setPoolChoice] = useState(initialIsKnown ? initialPool : '__new__');
  const [newPool, setNewPool] = useState(initialIsKnown ? '' : initialPool);
  const [seed, setSeed] = useState(team?.seed || '');
  const [contactEmail, setContactEmail] = useState(team?.contact_email || '');
  const [logoUrl, setLogoUrl] = useState(team?.logo_url || '');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [progress, setProgress] = useState(''); // "Adding 2/5…" during bulk add
  const confirm = useConfirm();

  const pool = poolChoice === '__new__' ? newPool.trim() : poolChoice;

  // S05 C2a — detect a pasted multi-name list. Single name (today's path) is
  // untouched; >1 name switches the Save button into bulk-add mode.
  const names = useMemo(() => splitTeamNames(teamName), [teamName]);
  const isBulk = !team && names.length > 1;

  const save = async () => {
    if (!teamName.trim()) { setLocalError('Add a team name to continue.'); return; }
    setLocalError('');
    setBusy(true);

    if (isBulk) {
      // Loop createTeam for each pasted name, same pool/division. Report
      // successes/failures via flash rather than blocking on the first error —
      // one bad row shouldn't stop the rest of a roster import.
      let ok = 0;
      const failures = [];
      for (let i = 0; i < names.length; i++) {
        const n = names[i];
        setProgress(`Adding ${i + 1}/${names.length}…`);
        const res = await createTeam(tournamentId, { teamName: n, pool, seed: '', contactEmail: '', logoUrl: '', divisionId });
        if (res.error) failures.push(`${n} (${res.error.message})`);
        else ok++;
      }
      setBusy(false);
      setProgress('');
      if (ok > 0) flash?.('success', `Added ${ok} team${ok === 1 ? '' : 's'}.${failures.length ? ` ${failures.length} failed.` : ''}`);
      if (failures.length > 0) flash?.('error', `Some teams didn't save — ${failures.join('; ')}`);
      if (ok > 0) onDone();
      return;
    }

    const fields = { teamName, pool, seed, contactEmail, logoUrl };
    const res = team ? await updateTeam(team.id, fields) : await createTeam(tournamentId, { ...fields, divisionId });
    setBusy(false);
    if (res.error) { flash?.('error', `That didn't save — ${res.error.message}`); return; }
    flash?.('success', team ? 'Team saved.' : `Added ${teamName}.`);
    onDone();
  };

  const remove = async () => {
    if (!team) return;
    if (!(await confirm({ title: `Delete “${team.team_name}”?`, body: "This removes the team and its schedule slots — this can't be undone.", confirmLabel: 'Delete team', danger: true }))) return;
    const { error } = await deleteTeam(team.id);
    if (error) { flash?.('error', `That didn't delete — ${error.message}`); return; }
    flash?.('success', `Deleted ${team.team_name}.`);
    onDone();
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Team Name{isBulk ? `s (${names.length})` : ''}</label>
          {team ? (
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Beer Necessities" style={inputStyle}/>
          ) : (
            // S05 C2a — textarea so a pasted multi-line list is visible + editable.
            // Single-name typing behaves identically to a plain input.
            <textarea value={teamName} onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Beer Necessities — or paste a list, one per line" rows={isBulk ? Math.min(names.length + 1, 6) : 1}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'Barlow, sans-serif', lineHeight: 1.4 }}/>
          )}
          {isBulk && <div style={{ fontSize: 11, color: C.steel, marginTop: 4 }}>Detected {names.length} team names — they'll all be added to the same pool.</div>}
        </div>
        <div>
          <label style={labelStyle}>Pool</label>
          <select value={poolChoice} onChange={(e) => setPoolChoice(e.target.value)} style={inputStyle}>
            <option value="">— No pool —</option>
            {pools.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="__new__">+ New pool…</option>
          </select>
          {poolChoice === '__new__' && (
            <input value={newPool} onChange={(e) => setNewPool(e.target.value)} placeholder="A / B / C…" style={{ ...inputStyle, marginTop: 6 }} autoFocus />
          )}
        </div>
        <div>
          <label style={labelStyle}>Seed</label>
          <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="1" style={inputStyle} disabled={isBulk} />
        </div>
        <div>
          <label style={labelStyle}>Contact Email</label>
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="captain@team.com" style={inputStyle} disabled={isBulk} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Logo URL (optional)</label>
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" style={inputStyle} disabled={isBulk} />
        </div>
      </div>
      {localError && (
        <div style={{ background: 'rgba(215,38,56,0.12)', border: '1px solid rgba(215,38,56,0.4)', color: C.ice, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
          {localError}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{team && <button onClick={remove} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Delete</button>}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {progress && <span style={{ fontSize: 12, color: C.steel }}>{progress}</span>}
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? (progress || 'Saving…') : team ? 'Save' : isBulk ? `Add ${names.length} teams` : 'Add Team'}</button>
        </div>
      </div>
      <ConfirmSheetHost controller={confirm} />
    </div>
  );
}

// ====================== SCHEDULE TAB ======================
function ScheduleTab({ tournamentId, tournament, teams, games, divisionId = null, rinks, reload, flash }) {
  const [showGen, setShowGen] = useState(false);
  const [genStart, setGenStart] = useState('');
  const [genMinutes, setGenMinutes] = useState(60);
  const [genRinkId, setGenRinkId] = useState('');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const confirm = useConfirm();

  const poolGames = games.filter((g) => (g.round || 'pool') === 'pool');

  const handleGenerate = async () => {
    if (!genStart) { flash?.('error', 'Pick a start date and time to generate the schedule.'); return; }
    setBusy(true);
    const { inserted, error, warning } = await generatePoolSchedule(tournamentId, {
      startDate: genStart,
      gameMinutes: parseInt(genMinutes, 10) || 60,
      rinkId: genRinkId || null,
      replaceExisting: replace,
      divisionId,
    });
    setBusy(false);
    if (error) { flash?.('error', `That didn't generate — ${error.message}`); return; }
    flash?.('success', warning || `Generated ${inserted} pool games.`);
    setShowGen(false); reload();
  };

  // If pool games already exist, re-running the generator nukes them. Surface
  // that fact in the button copy and gate the form behind a confirm so the
  // director can't accidentally wipe a scheduled day they just hand-edited.
  const hasPoolGames = poolGames.length > 0;
  const handleGenerateClick = async () => {
    if (hasPoolGames && !showGen) {
      const ok = await confirm({
        title: 'Regenerate the schedule?',
        body: `This wipes the ${poolGames.length} current pool game${poolGames.length === 1 ? '' : 's'} and rebuilds them. Bracket games stay intact.`,
        confirmLabel: 'Regenerate',
        danger: true,
      });
      if (!ok) return;
    }
    setShowGen((v) => !v);
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.steel }}>{poolGames.length} pool game{poolGames.length === 1 ? '' : 's'}</div>
        <button onClick={handleGenerateClick} style={btnPrimary}>
          {hasPoolGames ? `Regenerate (wipes ${poolGames.length})` : 'Generate Pool Schedule'}
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
          <Icon name="calendar" size={30} color={C.steel} style={{ margin: '0 auto 8px' }} />
          Fill the board — generate a round-robin or add games one at a time.
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
                  {g.youtube_url ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4 }}> · <Icon name="live" size={11} color={C.steel} /> stream</span> : ''}
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
            onForfeit={async (winner) => {
              const { error } = await recordForfeit(g.id, winner);
              if (error) throw new Error(error.message);
              const winName = teams.find((t) => t.id === (winner === 'home' ? g.home_team_id : g.away_team_id))?.team_name || 'Winner';
              flash?.('success', `Recorded forfeit — ${winName} wins 3–0.`);
              reload();
            }}
          />
        );
      })()}
      <ConfirmSheetHost controller={confirm} />
    </div>
  );
}

// ====================== BRACKET TAB ======================
function BracketTab({ tournamentId, tournament, divSettings, teams, games, divisionId = null, rinks, reload, flash }) {
  // MULTIDIV-1: read the selected division's settings (falls back to the
  // tournament's via the merge done on the page).
  const advPerPool = divSettings?.advancement_per_pool ?? tournament?.settings?.advancement_per_pool ?? 2;
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
  const confirm = useConfirm();

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
      const q = await loadPoolQualifiers(tournamentId, advPerPool, divisionId);
      setQualifiers(q);
      setLoaded(true);
    })();
  }, [tournamentId, advPerPool, finalPoolCount, divisionId]);

  const addBracketGame = async () => {
    if (!homeId || !awayId || homeId === awayId) { flash?.('error', 'Pick two different teams to set this matchup.'); return; }
    if (!startTime) { flash?.('error', 'Pick a start date and time to continue.'); return; }
    setBusy(true);
    const { error } = await createBracketGame(tournamentId, {
      homeTeamId: homeId, awayTeamId: awayId, round,
      startTime: new Date(startTime).toISOString(),
      rinkId: rinkId || null,
      divisionId,
    });
    setBusy(false);
    if (error) { flash?.('error', `That bracket game didn't save — ${error.message}`); return; }
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
            <div style={{ padding: 14 }}><TabSkeleton rows={3} /></div>
          ) : qualifiers.length === 0 ? (
            <div style={{ padding: 14, color: C.steel, fontSize: 13 }}>Seeds lock in as pool games go final.</div>
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

      {/* Auto-build the playoff bracket (BRACKET-GEN-2): general single-elim of
          size 4/8/16, seeded from the standings we compute off synced games.
          Director confirms seeds + size once; the poller then fills scores and
          advances winners up the tree automatically. */}
      <PlayoffBracketBuilder tournamentId={tournamentId} divisionId={divisionId} games={games} bracketGames={bracketGames} reload={reload} flash={flash} rinks={rinks} />

      {/* Add bracket game */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 18 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, marginBottom: 10, textTransform: 'uppercase' }}>
          Add Bracket Game
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Round</label>
            <select value={round} onChange={(e) => setRound(e.target.value)} style={inputStyle}>
              <option value="round_of_16">Round of 16</option>
              <option value="quarterfinal">Quarterfinal</option>
              <option value="semifinal">Semifinal</option>
              <option value="final">Final</option>
              <option value="consolation">3rd place</option>
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
        <div style={{ textAlign: 'center', color: C.steel, padding: 24, fontSize: 13 }}>The bracket fills in once you seed it or add games above.</div>
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
                if (!(await confirm({ title: 'Delete this bracket game?', body: "Its score and stats go with it — this can't be undone.", confirmLabel: 'Delete game', danger: true }))) return;
                const { error } = await deleteGame(g.id);
                if (error) { flash?.('error', `That didn't delete — ${error.message}`); return; }
                flash?.('success', 'Bracket game deleted.');
                reload();
              }} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Delete</button>
            </div>
            );
          })}
        </div>
      )}
      <ConfirmSheetHost controller={confirm} />
    </div>
  );
}

// ====================== PLAYOFF BRACKET BUILDER (BRACKET-GEN-2) ======================
// General single-elimination bracket of size 4/8/16. Surfaces once pool play is
// done (or anytime, with a warning), proposes seeds from the division's
// standings (overall: pts → goal-diff → goals-for), lets the director reorder
// and pick the size, then generates the full skeleton via generateBracketV2.
// External sources expose no bracket topology, so structure is always native;
// the sync-gamesheet poller fills scores and advances winners automatically.
function PlayoffBracketBuilder({ tournamentId, divisionId = null, games, bracketGames, reload, flash, rinks }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState([]);   // working seed order (reorderable team rows)
  const [size, setSize] = useState(null);
  const [start, setStart] = useState('');
  const [rinkId, setRinkId] = useState('');
  const [gameMinutes, setGameMinutes] = useState(60);
  const [thirdPlace, setThirdPlace] = useState(true);
  const [busy, setBusy] = useState(false);

  const alreadyGenerated = bracketGames.length > 0;

  // Pool-play readiness: at least one pool game and all pool games final.
  const poolGames = useMemo(() => games.filter((g) => (g.round || 'pool') === 'pool'), [games]);
  const finalPool = useMemo(() => poolGames.filter((g) => g.status === 'final').length, [poolGames]);
  const poolComplete = poolGames.length > 0 && finalPool === poolGames.length;

  // Propose seeds when the builder is relevant (pool play progresses).
  useEffect(() => {
    if (alreadyGenerated) return;
    (async () => {
      const rows = await loadBracketSeedCandidates(tournamentId, divisionId);
      setOrder(rows);
      const fits = BRACKET_SIZES.filter((n) => n <= rows.length);
      setSize(fits.length ? fits[fits.length - 1] : null);
    })();
  }, [tournamentId, divisionId, finalPool, alreadyGenerated]);

  const move = (i, dir) => setOrder((prev) => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const handleGenerate = async () => {
    if (!size) { flash?.('error', 'You need at least four teams in the standings to seed a bracket.'); return; }
    const seedTeamIds = order.slice(0, size).map((t) => t.team_id);
    setBusy(true);
    const { inserted, error } = await generateBracketV2(tournamentId, {
      divisionId, seedTeamIds,
      startTime: start ? new Date(start).toISOString() : null,
      rinkId: rinkId || null,
      gameMinutes: parseInt(gameMinutes, 10) || 60,
      thirdPlace,
    });
    setBusy(false);
    if (error) { flash?.('error', `That bracket didn't build — ${error.message}`); return; }
    flash?.('success', `Built a ${size}-team bracket (${inserted} games). Scores + advancement fill in automatically.`);
    setOpen(false);
    reload();
  };

  if (alreadyGenerated) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, textTransform: 'uppercase' }}>Playoff bracket</div>
        <div style={{ fontSize: 12, color: C.steel, marginTop: 4, lineHeight: 1.5 }}>
          Bracket is live — {bracketGames.length} game{bracketGames.length === 1 ? '' : 's'}. Scores and advancement fill in automatically as results sync. Delete the bracket games below to rebuild.
        </div>
      </div>
    );
  }

  const canFit = BRACKET_SIZES.filter((n) => n <= order.length);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, textTransform: 'uppercase' }}>Build playoff bracket</div>
          <div style={{ fontSize: 12, color: C.steel, marginTop: 4, lineHeight: 1.5 }}>
            {poolComplete
              ? 'Pool play is complete — seed the bracket and Rinkd fills scores + advances winners automatically as results sync.'
              : `Pool play in progress (${finalPool}/${poolGames.length} games final). Seed now from current standings, or wait until pool play wraps.`}
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="build" size={14} color="#fff" /> Build Bracket</button>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          {canFit.length === 0 ? (
            <div style={{ fontSize: 13, color: C.amber }}>You need at least four teams in the standings to build a bracket — finish more pool games first.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Bracket size</label>
                  <select value={size || ''} onChange={(e) => setSize(parseInt(e.target.value, 10))} style={inputStyle}>
                    {canFit.map((n) => <option key={n} value={n}>{n} teams</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>First game start</label>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.ice, marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={thirdPlace} onChange={(e) => setThirdPlace(e.target.checked)} /> Include a 3rd-place game
              </label>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 6 }}>
                Seeds — top {size} advance · reorder if needed
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                {order.map((t, i) => {
                  const seeded = i < size;
                  return (
                    <div key={t.team_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: i ? '1px solid rgba(46,91,140,0.2)' : 'none', opacity: seeded ? 1 : 0.4, background: i === size ? 'rgba(215,38,56,0.06)' : 'transparent' }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: seeded ? C.red : 'rgba(139,163,190,0.25)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{seeded ? i + 1 : '–'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{t.team_name}</div>
                        <div style={{ fontSize: 11, color: C.steel }}>{[t.pool, `${t.wins}-${t.losses}-${t.ties}`, `${t.pts} pts`, `${Number(t.goal_diff) >= 0 ? '+' : ''}${t.goal_diff} GD`].filter(Boolean).join(' · ')}</div>
                      </div>
                      <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btnGhost, padding: '4px 9px', opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={() => move(i, 1)} disabled={i === order.length - 1} style={{ ...btnGhost, padding: '4px 9px', opacity: i === order.length - 1 ? 0.3 : 1 }}>↓</button>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setOpen(false)} style={btnGhost}>Cancel</button>
                <button onClick={handleGenerate} disabled={busy} style={btnPrimary}>{busy ? 'Building…' : `Build ${size}-team bracket`}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ====================== SETTINGS TAB ======================
// --- Registrations tab: payouts (optional Connect) + config + submissions list.
//     Mirrors the league RegistrationsTab; same Stripe checkout/webhook back it. ---
function RegistrationsTab({ tournamentId, tournament, divisionId = null, reload, flash }) {
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
  // S05 C2b — registrations promoted to a tournament_teams row THIS session, so
  // the "Add as team" button disables itself without needing a schema link back
  // from tournament_teams to tournament_registrations. Resets on remount/tab
  // switch, which is fine — a re-promote would just create a second team, so we
  // only need to guard the common double-click case within one sitting.
  const [promotedIds, setPromotedIds] = useState({});
  // S05 C3 — "Approve all paid" progress text, e.g. "Approving 3/12…".
  const [approvingAll, setApprovingAll] = useState(null);
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
    if (error) { flash('err', error.message || "That didn't save — check your connection and try again."); return; }
    flash('ok', 'Registration settings saved.');
    reload();
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(regLink); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* link shown below */ }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try { await startConnectOnboarding(`/tournament/${tournamentId}/manage`); } // redirects away on success
    catch (e) { flash('err', e.message || "Payout setup didn't open — check your connection and try again."); setConnecting(false); }
  };

  const act = async (reg, action) => {
    setBusyId(reg.id);
    try {
      if (action === 'approve') await approveTournamentRegistration(reg.id);
      else await updateTournamentRegistrationStatus(reg.id, action);
      await loadRegs();
    } catch (e) { flash('err', e.message || "That didn't go through — check your connection and try again."); }
    finally { setBusyId(null); }
  };

  // S05 C2b — approved registrations never auto-promote to a tournament_teams
  // row (only the Stripe webhook / approveTournamentRegistration's own insert
  // does that, and only when it created the team itself). This gives directors
  // a manual "Add as team" for approved rows that still need a roster/pool
  // entry. Uses the registration's own fields + sensible fallbacks for what
  // createTeam wants but the registration doesn't carry (pool, seed, logo —
  // registrations have no pool concept, so we drop the team into the tab's
  // current division scope with no pool assigned).
  const promoteToTeam = async (reg) => {
    setBusyId(reg.id);
    try {
      const res = await createTeam(tournamentId, {
        teamName: reg.team_name || 'Unnamed team',
        contactEmail: reg.contact_email || '',
        pool: '',
        seed: '',
        logoUrl: '',
        divisionId,
      });
      if (res.error) { flash('error', `That didn't add as a team — ${res.error.message}`); return; }
      // Stamp the created team back onto the registration so the promoted
      // state survives a reload (S05 QA P1-2: promotedIds is session-only,
      // and a re-click after reload would double-create the team). Best
      // effort — the team exists either way; the stamp just locks the button.
      const newTeamId = res.data?.id || null;
      if (newTeamId) {
        try {
          await supabase.from('tournament_registrations')
            .update({ tournament_team_id: newTeamId })
            .eq('id', reg.id);
        } catch { /* non-fatal — session guard still applies */ }
      }
      setPromotedIds((m) => ({ ...m, [reg.id]: true }));
      flash('success', `Added ${reg.team_name || 'the team'} to Teams.`);
    } catch (e) {
      flash('error', e.message || "That didn't add as a team — check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  // S05 C3 — bulk-approve every pending registration that's already paid.
  // Sequential (not Promise.all) so the progress counter is meaningful and we
  // don't hammer the DB with N simultaneous inserts; failures don't stop the
  // rest of the batch, they're collected and flashed at the end.
  const pendingPaid = regs.filter((r) => r.status === 'pending' && !!r.paid_at);
  const approveAllPaid = async () => {
    if (pendingPaid.length < 2) return;
    const failures = [];
    let done = 0;
    for (const reg of pendingPaid) {
      setApprovingAll(`Approving ${done + 1}/${pendingPaid.length}…`);
      try { await approveTournamentRegistration(reg.id); done++; }
      catch (e) { failures.push(`${reg.team_name || 'team'} (${e.message || 'failed'})`); }
    }
    setApprovingAll(null);
    await loadRegs();
    if (done > 0) flash('success', `Approved ${done} paid registration${done === 1 ? '' : 's'}.`);
    if (failures.length > 0) flash('error', `Some approvals failed — ${failures.join('; ')}`);
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
    ...(kind === 'approve' ? { background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.5)', color: colors.success }
      : kind === 'rejected' ? { background: 'transparent', borderColor: 'rgba(215,38,56,0.45)', color: colors.redSoft }
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
          <TabSkeleton rows={1} />
        ) : payoutsReady ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="approved" size={18} color={C.green} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Payouts connected</div>
              <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>Entry fees deposit straight to your account — you keep 99% (Rinkd keeps 1%).</div>
            </div>
          </div>
        ) : isFounder ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>Get paid directly <span style={{ color: C.steel, fontWeight: 600 }}>(optional)</span></div>
            <div style={{ fontSize: 12, color: C.steel, marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
              Paid registration works right now — fees collect through Rinkd and we settle up with you. Want entry fees deposited straight to your bank automatically? Connect a Stripe account (you keep 99%). You can do this anytime.
            </div>
            <button onClick={handleConnect} disabled={connecting} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: connecting ? 0.6 : 1 }}>
              {connecting ? 'Opening Stripe…' : <><Icon name="connect" size={14} /> Connect payouts</>}
            </button>
            {connectReturn && <div style={{ fontSize: 12, color: C.amber, marginTop: 10 }}>Just finished on Stripe? Verification can take a moment — reload to see it as connected.</div>}
          </>
        ) : (
          <div style={{ fontSize: 13, color: C.steel }}>Entry fees for this tournament are handled through Rinkd.</div>
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
          <button onClick={copyLink} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 6, color: copied ? C.green : C.ice }}>{copied ? <><Icon name="approved" size={14} color={C.green} /> Copied</> : <><Icon name="link" size={14} /> Copy Link</>}</button>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.35)', marginTop: 10, wordBreak: 'break-all' }}>{regLink}</div>
      </div>

      {/* Submissions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={sec}>Registrations ({regs.length})</div>
        {regs.length > 0 && <button onClick={exportCsv} style={{ ...btnGhost, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="export" size={14} /> Export CSV</button>}
      </div>
      {regs.length === 0 ? (
        <div style={{ ...card, color: 'rgba(244,247,250,0.4)', fontSize: 13, textAlign: 'center' }}>No registrations yet. Share your link to start collecting teams.</div>
      ) : (
        REG_GROUPS.map(([status, gLabel]) => {
          const group = regs.filter(r => r.status === status);
          if (!group.length) return null;
          return (
            <div key={status} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: REG_STATUS[status].color }}>{gLabel} · {group.length}</div>
                {/* S05 C3 — bulk-approve when ≥2 pending rows have already paid. */}
                {status === 'pending' && pendingPaid.length >= 2 && (
                  <button onClick={approveAllPaid} disabled={!!approvingAll} style={{ ...actBtn('approve'), display: 'inline-flex', alignItems: 'center', gap: 5, opacity: approvingAll ? 0.7 : 1 }}>
                    {approvingAll || <><Icon name="approved" size={13} color={colors.success} /> Approve all paid ({pendingPaid.length})</>}
                  </button>
                )}
              </div>
              {group.map(r => {
                const promoted = !!promotedIds[r.id] || !!r.tournament_team_id;
                return (
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
                  {(actionsFor(status).length > 0 || status === 'approved') && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {actionsFor(status).map(([action, lbl]) => (
                        <button key={action} disabled={busyId === r.id} onClick={() => act(r, action)} style={actBtn(action)}>{lbl}</button>
                      ))}
                      {/* S05 C2b — promote an approved registration to a tournament_teams row. */}
                      {status === 'approved' && (
                        <button disabled={busyId === r.id || promoted} onClick={() => promoteToTeam(r)} style={{ ...actBtn('approve'), display: 'inline-flex', alignItems: 'center', gap: 5, opacity: promoted ? 0.5 : 1 }}>
                          {promoted ? <><Icon name="approved" size={13} color={colors.success} /> Added as team</> : busyId === r.id ? 'Adding…' : '+ Add as team'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );})}
            </div>
          );
        })
      )}
    </div>
  );
}

// YOUTH-PRIVACY: director correction for a mis-derived youth/adult classification.
// Saves immediately via the guarded set_tournament_youth RPC (separate from the
// form's "Save Settings"). The page already gates this whole screen to the
// director, so non-directors never see it; the RPC re-checks director/admin
// server-side. youth->adult is server-rejected when the event has minor
// participants — surfaced here as a friendly inline error. No skeleton: the
// tournament is already loaded by the page before this tab renders.
function AudienceControl({ tournament, reload, flash }) {
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Optimistic local copy, reconciled against the server after each change.
  const [value, setValue] = useState(!!tournament.is_youth);
  const [status, setStatus] = useState('idle'); // idle | saving | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmYouth, setConfirmYouth] = useState(false);

  useEffect(() => { setValue(!!tournament.is_youth); }, [tournament.is_youth]);

  const saving = status === 'saving';

  const apply = async (nextYouth) => {
    setConfirmYouth(false);
    setErrorMsg('');
    setStatus('saving');
    const prev = value;
    setValue(nextYouth); // optimistic
    let error = null;
    try {
      ({ error } = await setTournamentYouth(tournament.id, nextYouth));
    } catch (e) {
      // supabase-js resolves { data, error } for RPC-level errors, but a
      // network-level failure (offline/DNS) rejects — catch it so the control
      // can never get stuck in the 'saving' state with both segments disabled.
      error = e || { message: 'network' };
    }
    if (error) {
      setValue(prev); // reconcile: roll back the optimistic flip
      setStatus('error');
      const isMinorBlock = error.hint === 'has_minor_participants'
        || /minor participants/i.test(error.message || '');
      setErrorMsg(
        isMinorBlock
          ? 'This event has minor participants, so it can’t be set to Adult. Keep it Youth, or remove the minors first.'
          : error.code === '42501'
            ? 'Only the tournament director or an admin can change this.'
            : (error.message || 'That didn’t save — check your connection and try again.')
      );
      return;
    }
    setStatus('success');
    flash?.('success', nextYouth
      ? 'Set to Youth — rosters, schedules and player names are now private.'
      : 'Set to Adult — rosters and player names are now public.');
    reload(); // reconcile + propagate: re-reads is_youth (gating/leaderboards read it fresh server-side)
  };

  const onSelect = (nextYouth) => {
    if (saving) return;
    if (nextYouth === value && status !== 'error') return; // no-op on the current value
    if (nextYouth === true) {
      setConfirmYouth(true); // youth = more private: confirm so the consequence is explicit
      setErrorMsg('');
    } else {
      apply(false); // adult = the guarded direction: server rejects if minors are present
    }
  };

  const seg = (segIsYouth) => {
    const active = value === segIsYouth;
    return {
      flex: 1, minHeight: 44, padding: '10px 12px', border: 'none', borderRadius: 8,
      cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
      background: active ? (segIsYouth ? 'rgba(46,91,140,0.55)' : 'rgba(139,163,190,0.18)') : 'transparent',
      color: active ? C.ice : C.steel,
      fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic',
      fontSize: 15, letterSpacing: '0.04em', textTransform: 'uppercase',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: reduceMotion ? 'none' : 'background 160ms ease, color 160ms ease',
    };
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 4 }}>Audience</div>
      <div style={{ fontSize: 12, color: C.steel, marginBottom: 12, lineHeight: 1.4 }}>
        Auto-detected from your division. Change it only if it’s wrong — it saves right away.
      </div>

      <div role="group" aria-label="Tournament audience" style={{ display: 'flex', gap: 6, background: C.navy, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
        <button type="button" aria-pressed={value === true} disabled={saving} onClick={() => onSelect(true)} style={seg(true)}>
          {value === true && saving ? 'Updating…' : 'Youth'}
        </button>
        <button type="button" aria-pressed={value === false} disabled={saving} onClick={() => onSelect(false)} style={seg(false)}>
          {value === false && saving ? 'Updating…' : 'Adult'}
        </button>
      </div>

      {/* Plain-language consequence of the CURRENT selection (color is never the only cue). */}
      <div style={{ fontSize: 12, color: C.steel, marginTop: 10, lineHeight: 1.45, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {value && <Icon name="privacy" size={13} color={C.steel} style={{ marginTop: 2 }} />}
        <span>{value
          ? 'Youth events keep rosters, schedules and player names private — only insiders (the team, the scorekeeper, the director) can see them.'
          : 'Adult events are public — rosters, schedules and player names are visible to anyone.'}</span>
      </div>

      {confirmYouth && (
        <div aria-live="polite" style={{ marginTop: 12, background: 'rgba(46,91,140,0.14)', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, color: C.ice, marginBottom: 10, lineHeight: 1.45 }}>
            Make this a <strong>Youth</strong> event? Rosters, schedules and player names become private immediately.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => apply(true)} disabled={saving} style={{ ...btnPrimary, minHeight: 44 }}>
              {saving ? 'Updating…' : 'Make it Youth'}
            </button>
            <button type="button" onClick={() => setConfirmYouth(false)} disabled={saving} style={{ ...btnGhost, minHeight: 44 }}>Cancel</button>
          </div>
        </div>
      )}

      {status === 'error' && errorMsg && (
        <div role="alert" style={{ marginTop: 12, background: 'rgba(215,38,56,0.12)', border: '1px solid rgba(215,38,56,0.45)', borderRadius: 10, padding: '10px 12px', color: C.ice, fontSize: 13, lineHeight: 1.45 }}>
          {errorMsg}
        </div>
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
  // GS-6 — USA Hockey compliance (season-setup; never asked of the game-day volunteer)
  const [usahCompliant, setUsahCompliant] = useState(!!tournament.usah_compliant_scoresheet);
  const [usahAssoc, setUsahAssoc] = useState(tournament.usah_association_name || '');
  const [usahClass, setUsahClass] = useState(tournament.usah_classification || '');
  const [usahDivision, setUsahDivision] = useState(tournament.division_label || '');
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
      flash?.('error', 'That file isn’t an image — upload a PNG, JPG, SVG, or WebP.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      flash?.('error', `That logo is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 5 MB and try again.`);
      e.target.value = '';
      return;
    }
    setUploading(true);
    const verdict = await classifyImage(file);
    if (!verdict.ok) {
      setUploading(false);
      flash?.('error', 'That image may break Rinkd\'s guidelines — try a different one.');
      e.target.value = '';
      return;
    }
    const { url, error } = await uploadMedia(file, currentUser.id);
    setUploading(false);
    e.target.value = '';
    if (error || !url) { flash?.('error', error?.message || 'That logo didn’t upload — check your connection and try again.'); return; }
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
      usahCompliantScoresheet: usahCompliant, usahAssociationName: usahAssoc,
      usahClassification: usahClass, divisionLabel: usahDivision,
    });
    setBusy(false);
    if (error) { flash?.('error', `That didn't save — ${error.message}`); return; }
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
      <AudienceControl tournament={tournament} reload={reload} flash={flash} />
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
                {uploading ? 'Uploading…' : <><Icon name="camera" size={14} /> Upload</>}
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
        Recap &amp; Game Puck sponsors moved to the <b style={{ color: C.ice }}>Sponsors</b> tab.
      </div>

      {/* GS-6 — USA Hockey compliant scoresheet (set once here; the scorer's
          official scoresheet then prints roster, coaches, times + enforces
          coach/official signatures automatically). */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={usahCompliant} onChange={(e) => setUsahCompliant(e.target.checked)}
            style={{ width: 20, height: 20, accentColor: C.red, flexShrink: 0, cursor: 'pointer' }} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: C.ice }}>Produce a USA Hockey official scoresheet</span>
            <span style={{ display: 'block', fontSize: 12, color: C.steel, marginTop: 2, lineHeight: 1.4 }}>
              Turns on the printed roster, coaches block, game times, and coach + referee signatures. Leave off for non-USA-Hockey play.
            </span>
          </span>
        </label>
        {usahCompliant && (
          <div style={{ marginTop: 14 }}>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>USA Hockey Registered Association</label>
              <input value={usahAssoc} onChange={(e) => setUsahAssoc(e.target.value)} placeholder="e.g. Greater New York Amateur Hockey Assn." style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Level of Play</label>
                <select value={usahClass} onChange={(e) => setUsahClass(e.target.value)} style={inputStyle}>
                  <option value="">Select…</option>
                  <option value="tier1">Tier I</option>
                  <option value="tier2">Tier II</option>
                  <option value="girls_women">Girls/Women</option>
                  <option value="high_school">High School</option>
                  <option value="house_rec">House/Rec</option>
                  <option value="adult">Adult</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Division</label>
                <input value={usahDivision} onChange={(e) => setUsahDivision(e.target.value)} placeholder="10U" style={inputStyle} />
              </div>
            </div>
          </div>
        )}
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
  const confirm = useConfirm();

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
      setMsg({ ok: false, text: `No Rinkd account for @${res.handle} yet. Enter their email and we’ll send a sign-up invite.` });
    } else {
      setMsg({ ok: false, text: res.message || "That didn't go through — check your connection and try again." });
    }
  };

  const remove = async (roleId, name) => {
    if (!(await confirm({ title: `Remove ${name} as a scorer?`, body: "They lose access to score this tournament's games.", confirmLabel: 'Remove scorer', danger: true }))) return;
    const { error } = await removeScorer(roleId);
    if (error) { flash?.('error', `That didn't remove — ${error.message}`); return; }
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
        <TabSkeleton rows={2} />
      ) : scorers.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: '40px 0' }}>
          You can always score as the director — add others above to share the load.
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
                <button onClick={() => remove(s.id, name)} style={{ ...btnGhost, minHeight: 44, color: C.red, borderColor: C.red }}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmSheetHost controller={confirm} />
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
  const confirm = useConfirm();

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
      setMsg({ ok: false, text: `No Rinkd account for "${res.input}". Directors sign up first — share the link and add them once they've joined.` });
    } else {
      setMsg({ ok: false, text: res.message || "That didn't go through — check your connection and try again." });
    }
  };

  const remove = async (roleId, name) => {
    if (!(await confirm({ title: `Remove ${name} as a director?`, body: 'They lose full management access — schedule, teams, bracket, settings, and scorer assignments.', confirmLabel: 'Remove director', danger: true }))) return;
    const { error } = await removeDirector(roleId);
    if (error) { flash?.('error', `That didn't remove — ${error.message}`); return; }
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
        <TabSkeleton rows={1} />
      ) : directors.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: '24px 0', fontSize: 13 }}>
          No extra directors yet — add one above to share full management access. (The original director is set on the tournament itself.)
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
                  <button onClick={() => remove(d.id, name)} style={{ ...btnGhost, minHeight: 44, color: C.red, borderColor: C.red }}>Remove</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmSheetHost controller={confirm} />
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
      flash('error', `Suspensions didn't load — ${error.message}`);
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

  if (rows === null) return <TabSkeleton rows={3} />;

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
        warning badge on the public standings — player names are never shown publicly.
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>
        Pending ({pending.length})
      </div>
      {pending.length === 0 && (
        <div style={{ ...card, color: C.steel, fontSize: 13, textAlign: 'center' }}>No pending suspensions.</div>
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

// ====================== GAMESHEET TAB (SOCIAL-2 S3) ======================
// Director links the Rinkd event to a GameSheet season; the sync-gamesheet cron
// then mirrors scores in. This tab manages the link + lets the director confirm
// or ignore the matches the poller queues. (Polling/score-writing is server-side.)
const GS_MAP_STATUS = {
  pending:   { label: 'Needs review', color: colors.warning, bg: 'rgba(245,158,11,0.15)' },
  confirmed: { label: 'Synced',       color: colors.success, bg: 'rgba(34,197,94,0.15)' },
  ignored:   { label: 'Ignored',      color: C.steel, bg: 'rgba(139,163,190,0.15)' },
};

// ====================== INTEGRATIONS TAB ======================
// INTEGRATIONS-1 — houses external-source connections. Tournaments connect via
// GameSheet (live). HockeyShift is league-scoped (its sync targets leagues), so
// it isn't offered here. Keeps the tab provider-sectioned for future additions.
function IntegrationsTab({ tournamentId, tournament, games = [], reload, flash }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 16, lineHeight: 1.5 }}>
        Connect Rinkd to your external scoring/stats provider. Scores, standings, stats, and the feed + recap pushes all flow off the synced results — no double-entry.
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.ice, textTransform: 'uppercase', marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>GameSheet</div>
      <GameSheetTab tournamentId={tournamentId} tournament={tournament} games={games} reload={reload} flash={flash} />
    </div>
  );
}

function GameSheetTab({ tournamentId, tournament, games = [], reload, flash }) {
  const [links, setLinks] = useState([]);
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seasonId, setSeasonId] = useState('');
  const [autoImport, setAutoImport] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyMapId, setBusyMapId] = useState(null);
  // Per-unmatched-row manual game pick (mapId → rinkd_game_id).
  const [pick, setPick] = useState({});
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lk }, { data: mp }] = await Promise.all([
      listLinks(tournamentId),
      listGameMaps(tournamentId),
    ]);
    setLinks(lk || []); setMaps(mp || []); setLoading(false);
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);

  // Rinkd games by id → "Home vs. Away" for resolving matched/manual rows.
  const gameLabel = useMemo(() => {
    const m = {};
    for (const g of games) m[g.id] = `${g.home_team?.team_name || 'TBD'} vs. ${g.away_team?.team_name || 'TBD'}`;
    return m;
  }, [games]);
  // Games not already mapped — candidates for resolving an unmatched row.
  const unmappedGames = useMemo(() => {
    const taken = new Set(maps.filter(m => m.rinkd_game_id && m.status !== 'ignored').map(m => m.rinkd_game_id));
    return games.filter(g => !taken.has(g.id));
  }, [games, maps]);

  const addLink = async () => {
    if (!seasonId.trim()) { flash?.('error', 'Paste the GameSheet season id to link it.'); return; }
    setBusy(true);
    const { error } = await createLink(tournamentId, { seasonId, autoImport });
    setBusy(false);
    if (error) { flash?.('error', `That didn't link — ${error.message}`); return; }
    flash?.('success', autoImport ? 'Linked — teams, games + scores will sync in automatically.' : 'Linked — scores sync onto your existing schedule (you confirm matches).');
    setSeasonId(''); reload?.(); load();
  };
  const toggleLink = async (lk) => {
    const { error } = await setLinkStatus(lk.id, lk.status === 'active' ? 'paused' : 'active');
    if (error) { flash?.('error', error.message); return; }
    load();
  };
  const dropLink = async (lk) => {
    if (!(await confirm({
      title: `Unlink GameSheet season ${lk.gamesheet_season_id}?`,
      body: 'Scores already synced stay; future syncs stop. If this is the last link, the event returns to manual scoring.',
      confirmLabel: 'Unlink season',
      danger: true,
    }))) return;
    const { error } = await removeLink(lk.id, tournamentId);
    if (error) { flash?.('error', error.message); return; }
    flash?.('success', 'Unlinked.'); reload?.(); load();
  };
  const doConfirm = async (m) => {
    const rid = m.rinkd_game_id || pick[m.id];
    if (!rid) { flash?.('error', 'Pick the Rinkd game this matches to confirm it.'); return; }
    setBusyMapId(m.id);
    const { error } = await confirmMatch(m.id, m.rinkd_game_id ? undefined : rid);
    setBusyMapId(null);
    if (error) { flash?.('error', error.message); return; }
    flash?.('success', 'Confirmed — the next sync writes the score.');
    load();
  };
  const doIgnore = async (m) => {
    setBusyMapId(m.id);
    const { error } = await ignoreMatch(m.id);
    setBusyMapId(null);
    if (error) { flash?.('error', error.message); return; }
    load();
  };

  const pending = maps.filter(m => m.status === 'pending');
  const confirmed = maps.filter(m => m.status === 'confirmed');
  const hasLink = links.length > 0;

  return (
    <div>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
        Run your event on GameSheet? Link the season and Rinkd mirrors the scores in automatically — standings, stats, the feed + recap pushes all flow off the imported results. No double-entry. {hasLink && tournament?.scoring_source === 'external' && <span style={{ color: C.green }}>This event is in GameSheet-synced mode (manual scoring is off).</span>}
      </div>

      {/* Link form / current links */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 10 }}>Linked GameSheet seasons</div>
        {links.map((lk) => (
          <div key={lk.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(46,91,140,0.2)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>
                Season {lk.gamesheet_season_id}
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: lk.status === 'active' ? C.green : C.steel, background: lk.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(139,163,190,0.15)' }}>{lk.status === 'active' ? 'ACTIVE' : 'PAUSED'}</span>
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: C.steel, background: 'rgba(139,163,190,0.12)' }}>{lk.auto_import ? 'AUTO-IMPORT' : 'MATCH-ONLY'}</span>
              </div>
              <div style={{ fontSize: 11, color: C.steel, marginTop: 3 }}>
                {lk.last_synced_at ? `Last sync ${fmtDateTime(lk.last_synced_at)}${lk.last_sync_note ? ` · ${lk.last_sync_note}` : ''}` : 'Waiting for first sync…'}
              </div>
            </div>
            <button onClick={() => toggleLink(lk)} style={btnGhost}>{lk.status === 'active' ? 'Pause' : 'Resume'}</button>
            <button onClick={() => dropLink(lk)} style={{ ...btnGhost, color: C.red, borderColor: C.red }}>Unlink</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: links.length ? 12 : 0 }}>
          <input value={seasonId} onChange={(e) => setSeasonId(e.target.value)} placeholder="GameSheet season id (e.g. 6416)" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={addLink} disabled={busy} style={btnPrimary}>{busy ? 'Linking…' : '+ Link season'}</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, fontSize: 12, color: C.ice, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoImport} onChange={(e) => setAutoImport(e.target.checked)} style={{ marginTop: 2 }} />
          <span><b>Auto-create teams &amp; games from GameSheet</b> <span style={{ color: C.steel }}>— recommended. Leave on if you haven&rsquo;t built your schedule in Rinkd; the poller creates the teams + games (with scores) for you. Turn off to match incoming results onto a schedule you&rsquo;ve already set up.</span></span>
        </label>
        <div style={{ fontSize: 11, color: C.steel, marginTop: 8, lineHeight: 1.5 }}>
          Find the id in your GameSheet stats URL: <code style={{ color: C.ice }}>gamesheetstats.com/seasons/<b>6416</b>/scores</code>.
        </div>
      </div>

      {loading ? (
        <TabSkeleton rows={2} />
      ) : !hasLink ? null : (
        <>
          {/* Pending matches — director confirms before any score is written */}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>
            Needs review ({pending.length})
          </div>
          {pending.length === 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16, color: C.steel, fontSize: 13 }}>
              Nothing to review. New GameSheet results show up here for a quick confirm before they post.
            </div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
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
                      → matches <b>{gameLabel[m.rinkd_game_id] || 'a Rinkd game'}</b>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: C.amber, marginBottom: 4 }}>No automatic match — pick the Rinkd game:</div>
                      <select value={pick[m.id] || ''} onChange={(e) => setPick(p => ({ ...p, [m.id]: e.target.value }))} style={inputStyle}>
                        <option value="">— Select game —</option>
                        {unmappedGames.map(g => <option key={g.id} value={g.id}>{gameLabel[g.id]}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => doIgnore(m)} disabled={busyMapId === m.id} style={btnGhost}>Ignore</button>
                    <button onClick={() => doConfirm(m)} disabled={busyMapId === m.id} style={btnPrimary}>{busyMapId === m.id ? '…' : 'Confirm'}</button>
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
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {confirmed.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{m.gs_home_name} {m.gs_home_goals}–{m.gs_visitor_goals} {m.gs_visitor_name}</div>
                    <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>{m.rinkd_game_id ? gameLabel[m.rinkd_game_id] : '—'}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, color: GS_MAP_STATUS.confirmed.color, background: GS_MAP_STATUS.confirmed.bg }}>SYNCED</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <ConfirmSheetHost controller={confirm} />
    </div>
  );
}

