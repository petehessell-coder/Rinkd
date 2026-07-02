import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';
import { TeamLogo } from '../components/Logos';
import { useIsRinkdAdmin } from '../lib/userRole';
import { deleteTournamentAsAdmin, deleteLeagueAsAdmin, deleteTeamAsAdmin } from '../lib/adminDelete';
import { C, colors, radii } from '../lib/tokens';
import { Icon, Skeleton, EmptyState, Button, useToast, useConfirm, ConfirmSheetHost } from '../components/ui';
import {
  adminListFeaturedOperators, adminGetOperatorEvents, adminUpsertFeaturedOperator,
  adminSetFeaturedOperatorEvents, adminDeleteFeaturedOperator, adminSetFeatured,
} from '../lib/operators';

// Admin activation console. Rinkd staff only.
//
// Each tournament + league carries `is_activated` (default false on create).
// While false, RLS blocks scoring writes — games UPDATE, game_goals INSERT,
// game_penalties INSERT. Organizers can still configure (teams, schedule,
// bracket) and the public page is visible, but no live scoring + no auto-
// recap pushes. Pete flips the toggle on this page when payment / billing
// is complete.
//
// The actual security is in RLS (migration
// `tournaments_and_leagues_add_is_activated_admin_gate`). This page is
// purely a convenience for the toggle — the column is also editable from
// any Postgres client with the right perms.

function Toggle({ value, onChange, busy }) {
  return (
    <div onClick={busy ? undefined : () => onChange(!value)}
      style={{
        width: 44, height: 24,
        background: value ? colors.success : 'rgba(244,247,250,0.15)',
        borderRadius: 24, position: 'relative',
        cursor: busy ? 'wait' : 'pointer',
        flexShrink: 0,
        opacity: busy ? 0.55 : 1,
        transition: 'background 0.15s',
      }}>
      <div style={{
        width: 18, height: 18, background: '#fff', borderRadius: '50%',
        position: 'absolute', top: 3, left: value ? 23 : 3,
        transition: 'left 0.15s',
      }} />
    </div>
  );
}

function StatusPill({ value }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: value ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.18)',
      color: value ? colors.success : colors.warning,
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {value ? '● Activated' : '○ Pending'}
    </span>
  );
}

const KIND_LABEL = { tournament: 'TOURNAMENT', league: 'LEAGUE', team: 'TEAM' };

// Featured pin — a small star toggle scoped to leagues/tournaments.is_featured
// (drives the Home hero + is pinnable to operator cards). Optimistic; the caller
// reverts + toasts on error.
function FeaturedPin({ on, busy, onClick }) {
  return (
    <button type="button" onClick={busy ? undefined : onClick}
      title={on ? 'Featured — tap to unpin' : 'Pin as Featured'}
      aria-label={on ? 'Unpin from Featured' : 'Pin as Featured'} aria-pressed={on}
      style={{
        width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: `0.5px solid ${on ? C.gold : C.border}`,
        color: on ? C.gold : C.steel, borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.55 : 1, fontSize: 16, lineHeight: 1,
      }}>
      {on ? '★' : '☆'}
    </button>
  );
}

function Row({ kind, item, onToggle, onDelete, onSetFeatured, featuredBusyId, busyId }) {
  const isActivated = !!item.is_activated;
  const navigate = useNavigate();
  const detailUrl = kind === 'tournament' ? `/tournament/${item.id}` : kind === 'league' ? `/league/${item.id}` : `/team/${item.id}`;
  const subtitle = useMemo(() => {
    if (kind === 'tournament') {
      const parts = [item.division, item.start_date, item.end_date].filter(Boolean);
      return parts.join(' · ');
    }
    if (kind === 'team') {
      const parts = [item.level, item.location].filter(Boolean);
      return parts.join(' · ');
    }
    const parts = [item.division, item.season, item.start_date, item.end_date].filter(Boolean);
    return parts.join(' · ');
  }, [item, kind]);

  // Normalize the avatar fields across the two shapes:
  //   tournaments: accent_color + logo_url (no logo_color / logo_initials)
  //   leagues:     logo_color + logo_initials + logo_url
  // Both fall back to a name-derived 2-letter chip on a blue background.
  const avatarColor = item.logo_color || item.accent_color || C.blue;
  const avatarInitials = item.logo_initials || (item.name || '?').slice(0, 2).toUpperCase();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
      <TeamLogo team={{ name: item.name, logo_url: item.logo_url, logo_color: avatarColor, logo_initials: avatarInitials }} size={36} radius={8} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div onClick={() => navigate(detailUrl)} style={{ fontSize: 14, fontWeight: 600, color: C.ice, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            {item.name}
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'rgba(46,91,140,0.3)', color: C.steel, letterSpacing: '0.06em' }}>
            {KIND_LABEL[kind]}
          </span>
        </div>
        {subtitle && <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>{subtitle}</div>}
        {kind !== 'team' && <div style={{ marginTop: 4 }}><StatusPill value={isActivated} /></div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {kind !== 'team' && <FeaturedPin on={!!item.is_featured} busy={featuredBusyId === item.id} onClick={() => onSetFeatured(kind, item.id, !item.is_featured)} />}
        {kind !== 'team' && <Toggle value={isActivated} busy={busyId === item.id} onChange={(v) => onToggle(kind, item.id, v)} />}
        <button title="Delete permanently" aria-label={`Delete ${item.name} permanently`} onClick={() => onDelete(kind, item)}
          style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '0.5px solid rgba(215,38,56,0.5)', color: C.red, borderRadius: 8, cursor: 'pointer' }}>
          <Icon name="delete" size={15} color={C.red} />
        </button>
      </div>
    </div>
  );
}

// Typed-name confirmation for an irreversible cascade delete.
function DeleteModal({ target, onCancel, onConfirm, busy, error }) {
  const [text, setText] = useState('');
  useEffect(() => { setText(''); }, [target]);
  if (!target) return null;
  const { kind, item } = target;
  const match = text.trim() === (item.name || '').trim();
  return (
    <div onClick={busy ? undefined : onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: 22, maxWidth: 440, width: '100%', fontFamily: 'Barlow, sans-serif', color: C.ice }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: C.red }}>Delete {kind}?</div>
        <div style={{ fontSize: 13, color: C.steel, marginTop: 10, lineHeight: 1.55 }}>
          This permanently deletes <strong style={{ color: C.ice }}>{item.name}</strong> and ALL of its data — games, scores, stats, rosters, recaps, and feed posts. <strong style={{ color: C.ice }}>This cannot be undone.</strong>
        </div>
        <div style={{ fontSize: 12, color: C.steel, marginTop: 14, marginBottom: 6 }}>Type the exact name to confirm:</div>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={item.name} disabled={busy}
          style={{ width: '100%', background: C.dark, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        {error && <div style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={busy}
            style={{ background: 'transparent', border: `0.5px solid ${C.border}`, color: C.steel, borderRadius: 999, padding: '8px 16px', cursor: busy ? 'wait' : 'pointer', fontFamily: 'Barlow, sans-serif', fontSize: 13 }}>Cancel</button>
          <button onClick={onConfirm} disabled={!match || busy}
            style={{ background: match && !busy ? C.red : 'rgba(215,38,56,0.35)', border: 'none', color: '#fff', borderRadius: 999, padding: '8px 18px', cursor: match && !busy ? 'pointer' : 'not-allowed', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700 }}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminActivations({ currentUser, profile }) {
  const navigate = useNavigate();
  const isAdmin = useIsRinkdAdmin(currentUser?.id);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tournaments, setTournaments] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [featuredBusyId, setFeaturedBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // { kind, item }
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [filter, setFilter] = useState('pending'); // 'pending' | 'activated' | 'all'
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // tournaments don't carry logo_color / logo_initials (only accent_color
      // + logo_url); leagues have all four. Select what each table actually
      // exposes and normalize at render time via the Row component.
      const [t, l, tm] = await Promise.all([
        supabase.from('tournaments')
          .select('id, name, division, start_date, end_date, is_activated, is_featured, is_youth, accent_color, logo_url, created_at')
          .order('created_at', { ascending: false })
          .limit(1000), // perf(scale): 200 hid teams 201+ from staff (search filtered the truncated set); server-side search is the spec'd follow-up
        supabase.from('leagues')
          .select('id, name, division, season, start_date, end_date, is_activated, is_featured, is_public, logo_color, logo_initials, logo_url, created_at')
          .order('created_at', { ascending: false })
          .limit(1000), // perf(scale): 200 hid teams 201+ from staff (search filtered the truncated set); server-side search is the spec'd follow-up
        supabase.from('teams')
          .select('id, name, level, location, logo_color, logo_initials, logo_url, created_at')
          .order('created_at', { ascending: false })
          .limit(1000), // perf(scale): 200 hid teams 201+ from staff (search filtered the truncated set); server-side search is the spec'd follow-up
      ]);
      if (t.error) throw t.error;
      if (l.error) throw l.error;
      if (tm.error) throw tm.error;
      setTournaments(t.data || []);
      setLeagues(l.data || []);
      setTeams(tm.data || []);
    } catch (e) {
      setError(e?.message || "Couldn't load activations — refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onToggle = async (kind, id, nextValue) => {
    setBusyId(id);
    // Use the admin_set_activation RPC instead of a direct UPDATE.
    // Tournaments + leagues UPDATE RLS only allows the founding director /
    // commissioner to mutate the row, NOT site-wide Rinkd admins — so a
    // direct UPDATE silently no-op'd on every event Pete didn't create.
    // The RPC is SECURITY DEFINER, gates itself on profiles.is_admin = true,
    // and is scoped to the is_activated column only.
    const { error: rpcErr } = await supabase.rpc('admin_set_activation', {
      p_kind: kind, p_id: id, p_value: nextValue,
    });
    setBusyId(null);
    if (rpcErr) {
      setError(rpcErr.message || `Failed to update ${kind}`);
      return;
    }
    // Optimistic local update so the toggle reflects immediately.
    const setter = kind === 'tournament' ? setTournaments : setLeagues;
    setter((prev) => prev.map((x) => (x.id === id ? { ...x, is_activated: nextValue } : x)));
  };

  // Optimistic Featured pin/unpin (drives the Home hero + operator-card pinning).
  const onSetFeatured = async (kind, id, nextValue) => {
    const setter = kind === 'tournament' ? setTournaments : setLeagues;
    setter((prev) => prev.map((x) => (x.id === id ? { ...x, is_featured: nextValue } : x)));
    setFeaturedBusyId(id);
    try {
      await adminSetFeatured(kind, id, nextValue);
    } catch (e) {
      // Revert on failure + tell the user what happened.
      setter((prev) => prev.map((x) => (x.id === id ? { ...x, is_featured: !nextValue } : x)));
      toast({ message: e?.message === 'admin_only' ? 'Admins only.' : "That pin didn't save — check your connection and try again.", tone: 'alert' });
    } finally {
      setFeaturedBusyId(null);
    }
  };

  const onDelete = (kind, item) => { setDeleteError(null); setDeleteTarget({ kind, item }); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { kind, item } = deleteTarget;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (kind === 'tournament') await deleteTournamentAsAdmin(item.id);
      else if (kind === 'league') await deleteLeagueAsAdmin(item.id);
      else await deleteTeamAsAdmin(item.id);
      const setter = kind === 'tournament' ? setTournaments : kind === 'league' ? setLeagues : setTeams;
      setter((prev) => prev.filter((x) => x.id !== item.id));
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(e?.message === 'admin_only' ? 'Admins only.' : (e?.message || 'Delete failed.'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const norm = (s) => (s || '').toLowerCase();
    const q = norm(search);
    const keep = (x) => {
      if (filter === 'pending' && x.is_activated) return false;
      if (filter === 'activated' && !x.is_activated) return false;
      if (q && !norm(x.name).includes(q) && !norm(x.division).includes(q)) return false;
      return true;
    };
    // Teams have no activation state — they only respond to the search box.
    const keepTeam = (x) => !q || norm(x.name).includes(q) || norm(x.location).includes(q);
    return {
      tournaments: tournaments.filter(keep),
      leagues: leagues.filter(keep),
      teams: teams.filter(keepTeam),
    };
  }, [tournaments, leagues, teams, filter, search]);

  if (loading || isAdmin === null) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: C.ice, maxWidth: 720, margin: '0 auto' }}>
        <Skeleton width={160} height={26} style={{ marginBottom: 8 }} />
        <Skeleton width={260} height={12} style={{ marginBottom: 20 }} />
        <Skeleton width={140} height={11} style={{ marginBottom: 8 }} />
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i < 3 ? '0.5px solid rgba(244,247,250,0.06)' : 'none' }}>
              <Skeleton width={36} height={36} radius={8} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton width="45%" height={14} />
                <div style={{ height: 6 }} />
                <Skeleton width="30%" height={11} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );

  if (!isAdmin) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12, padding: 24, textAlign: 'center' }}>
        <Icon name="privacy" size={40} color={C.steel} />
        <div>Activations is Rinkd staff only.</div>
        <button onClick={() => navigate('/home')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer' }}>Back to Home</button>
      </div>
    </Layout>
  );

  const totalPending = tournaments.filter((x) => !x.is_activated).length + leagues.filter((x) => !x.is_activated).length;

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: C.ice, maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 26, lineHeight: 1.05 }}>Activations</div>
            <div style={{ fontSize: 12, color: C.steel, marginTop: 4 }}>
              Flip events from <strong>pending</strong> to <strong>activated</strong> after billing. RLS blocks all scoring writes until activated.
            </div>
          </div>
          <button onClick={load} style={{ background: 'transparent', color: C.steel, border: `0.5px solid ${C.border}`, padding: '6px 14px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>↻ Reload</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: C.red }}>
            {error}
          </div>
        )}

        {/* Filter + search */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { value: 'pending', label: `Pending (${totalPending})` },
            { value: 'activated', label: 'Activated' },
            { value: 'all', label: 'All' },
          ].map((opt) => {
            const on = filter === opt.value;
            return (
              <button key={opt.value} onClick={() => setFilter(opt.value)}
                style={{
                  background: on ? C.red : 'rgba(46,91,140,0.18)',
                  border: `0.5px solid ${on ? C.red : C.border}`,
                  color: on ? '#fff' : C.steel,
                  borderRadius: 999, padding: '6px 14px',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'Barlow, sans-serif',
                }}>
                {opt.label}
              </button>
            );
          })}
          <input
            type="search" placeholder="Search by name or division…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 220px', minWidth: 180, background: C.dark, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, outline: 'none' }}
          />
        </div>

        {/* Tournaments */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 8, marginTop: 8 }}>
          Tournaments ({filtered.tournaments.length})
        </div>
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
          {filtered.tournaments.length === 0 ? (
            <EmptyState compact icon="🏆" title="No tournaments" body="None match this filter." style={{ border: 'none', borderRadius: 0 }} />
          ) : (
            filtered.tournaments.map((t) => (
              <Row key={t.id} kind="tournament" item={t} onToggle={onToggle} onDelete={onDelete} onSetFeatured={onSetFeatured} featuredBusyId={featuredBusyId} busyId={busyId} />
            ))
          )}
        </div>

        {/* Leagues */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 8 }}>
          Leagues ({filtered.leagues.length})
        </div>
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
          {filtered.leagues.length === 0 ? (
            <EmptyState compact icon="🏒" title="No leagues" body="None match this filter." style={{ border: 'none', borderRadius: 0 }} />
          ) : (
            filtered.leagues.map((l) => (
              <Row key={l.id} kind="league" item={l} onToggle={onToggle} onDelete={onDelete} onSetFeatured={onSetFeatured} featuredBusyId={featuredBusyId} busyId={busyId} />
            ))
          )}
        </div>

        {/* Teams — no activation toggle; delete only. Filtered by search, not the pending/activated tabs. */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 8 }}>
          Teams ({filtered.teams.length}{teams.length >= 200 ? '+, search to narrow' : ''})
        </div>
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtered.teams.length === 0 ? (
            <EmptyState compact icon="👥" title="No teams" body={search ? 'No teams match.' : 'No teams yet.'} style={{ border: 'none', borderRadius: 0 }} />
          ) : (
            filtered.teams.map((tm) => (
              <Row key={tm.id} kind="team" item={tm} onToggle={onToggle} onDelete={onDelete} onSetFeatured={onSetFeatured} featuredBusyId={featuredBusyId} busyId={busyId} />
            ))
          )}
        </div>

        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 18, lineHeight: 1.6 }}>
          <strong>How it works:</strong> non-activated events can be configured (teams, schedule, bracket) and have visible public pages, but live scoring + auto-recap pushes are blocked at the RLS layer. Flip activated only after billing is complete. The <span style={{ color: C.gold }}>★</span> pins an event as <strong>Featured</strong> (Home hero + operator cards). <strong style={{ color: C.red, display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}><Icon name="delete" size={11} color={C.red} /> Delete</strong> permanently removes an event/team and all its data (games, stats, recaps, rosters) — admins only, irreversible.
        </div>

        <FeaturedOperatorsPanel
          leagues={leagues}
          tournaments={tournaments}
          toast={toast}
          confirm={confirm}
        />
      </div>
      <DeleteModal target={deleteTarget} busy={deleteBusy} error={deleteError}
        onCancel={() => { if (!deleteBusy) { setDeleteTarget(null); setDeleteError(null); } }}
        onConfirm={confirmDelete} />
      <ConfirmSheetHost controller={confirm} />
    </Layout>
  );
}

// =============================================================================
// Featured Operators panel — create/edit the branded /o/:slug cards, pin their
// events, and flip them active. All writes go through the admin DEFINER RPCs.
// Copy law: everything frames Rinkd as the engagement layer ON TOP of the
// operator's platform — never a replacement.
// =============================================================================
const EMPTY_FORM = {
  id: null, slug: '', name: '', tagline: '', brand_color: '', accent_color: '',
  logo_url: '', logo_initials: '', cover_image_url: '', website_url: '', platform_label: '',
};

function fieldStyle() {
  return { width: '100%', background: C.dark, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
}
function labelStyle() {
  return { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.steel, textTransform: 'uppercase', marginBottom: 5, display: 'block' };
}

function FeaturedOperatorsPanel({ leagues, tournaments, toast, confirm }) {
  const navigate = useNavigate();
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pinned, setPinned] = useState([]); // [{ kind:'league'|'tournament', id, sort_order }]
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Only public leagues + non-youth tournaments are pinnable (the RPC refuses the
  // rest; we hide them from the pickers so an admin never hits a wall).
  const pinnableLeagues = useMemo(() => leagues.filter((l) => l.is_public === true), [leagues]);
  const pinnableTournaments = useMemo(() => tournaments.filter((t) => t.is_youth === false), [tournaments]);

  const loadOps = useCallback(async () => {
    setLoading(true);
    try { setOperators(await adminListFeaturedOperators()); }
    catch (e) { toast({ message: e?.message === 'admin_only' ? 'Admins only.' : "Couldn't load operators — reload and try again.", tone: 'alert' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadOps(); }, [loadOps]);

  const startNew = () => { setForm(EMPTY_FORM); setPinned([]); setEditing(true); };
  const startEdit = async (op) => {
    setForm({
      id: op.id, slug: op.slug, name: op.name, tagline: op.tagline || '',
      brand_color: op.brand_color || '', accent_color: op.accent_color || '',
      logo_url: op.logo_url || '', logo_initials: op.logo_initials || '',
      cover_image_url: op.cover_image_url || '', website_url: op.website_url || '',
      platform_label: op.platform_label || '',
    });
    setEditing(true);
    try {
      const rows = await adminGetOperatorEvents(op.id);
      setPinned(rows.map((r) => ({ kind: r.league_id ? 'league' : 'tournament', id: r.league_id || r.tournament_id, sort_order: r.sort_order ?? 0 })));
    } catch { setPinned([]); }
  };
  const cancelEdit = () => { setEditing(false); setForm(EMPTY_FORM); setPinned([]); };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const togglePin = (kind, id) => {
    setPinned((prev) => {
      const exists = prev.find((p) => p.kind === kind && p.id === id);
      if (exists) return prev.filter((p) => !(p.kind === kind && p.id === id));
      return [...prev, { kind, id, sort_order: prev.length }];
    });
  };
  const isPinned = (kind, id) => pinned.some((p) => p.kind === kind && p.id === id);

  // Persist card + events. Save the card FIRST (inactive if it has no events yet),
  // then its events, then re-activate — so the never-empty guardrail never trips
  // on an edit that legitimately has pins.
  const save = async (activate) => {
    if (!form.slug.trim() || !form.name.trim()) { toast({ message: 'Slug and name are required.', tone: 'alert' }); return; }
    if (activate && pinned.length === 0) { toast({ message: 'Pin at least one event before going live.', tone: 'alert' }); return; }
    setSaving(true);
    try {
      // Nulled/normalized payload — reused for every upsert step so re-activate
      // never overwrites the nulled fields with raw empty strings from `form`.
      const payload = {
        ...form,
        slug: form.slug.trim(),
        name: form.name.trim(),
        tagline: form.tagline || null,
        brand_color: form.brand_color || null,
        accent_color: form.accent_color || null,
        logo_url: form.logo_url || null,
        logo_initials: form.logo_initials || null,
        cover_image_url: form.cover_image_url || null,
        website_url: form.website_url || null,
        platform_label: form.platform_label || null,
      };
      // Step 1: upsert the card WITHOUT activating (dodges operator_needs_events
      // on a brand-new card whose events aren't inserted yet).
      const opId = await adminUpsertFeaturedOperator({ ...payload, is_active: false });
      // Step 2: replace pinned events.
      const events = pinned.map((p, i) => (
        p.kind === 'league'
          ? { league_id: p.id, sort_order: i }
          : { tournament_id: p.id, sort_order: i }
      ));
      await adminSetFeaturedOperatorEvents(opId, events);
      // Step 3: if going live, activate now that events exist.
      if (activate) {
        await adminUpsertFeaturedOperator({ ...payload, id: opId, is_active: true });
      }
      toast({ message: activate ? 'Operator card is live.' : 'Operator card saved as a draft.', tone: 'success' });
      cancelEdit();
      loadOps();
    } catch (e) {
      const msg = e?.message === 'admin_only' ? 'Admins only.'
        : e?.message === 'operator_needs_events' ? 'Pin at least one event before going live.'
        : e?.message === 'league_not_public' ? 'One of those leagues is private — only public leagues can be pinned.'
        : e?.message === 'tournament_is_youth' ? 'Youth tournaments cannot be pinned.'
        : e?.message === 'invalid_slug' ? 'Slug must be lowercase letters, digits, and hyphens (3–40 chars).'
        : (e?.message || "That didn't save — check your connection and try again.");
      toast({ message: msg, tone: 'alert' });
    } finally {
      setSaving(false);
    }
  };

  const removeOperator = async (op) => {
    if (!(await confirm({
      title: `Delete ${op.name}?`,
      body: `This permanently removes the /o/${op.slug} front door and its pinned-event list. The events themselves are untouched. This can't be undone.`,
      confirmLabel: 'Delete card',
      danger: true,
    }))) return;
    try {
      await adminDeleteFeaturedOperator(op.id);
      toast({ message: 'Operator card deleted.', tone: 'success' });
      loadOps();
    } catch (e) {
      toast({ message: e?.message === 'admin_only' ? 'Admins only.' : "That didn't delete — check your connection and try again.", tone: 'alert' });
    }
  };

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, lineHeight: 1.05 }}>Featured Operators</div>
          <div style={{ fontSize: 12, color: C.steel, marginTop: 3, maxWidth: 480, lineHeight: 1.5 }}>
            Branded <code style={{ color: C.ice }}>/o/:slug</code> front doors — the engagement layer on top of the platform an operator already runs. Pin their events, flip live, forward the link.
          </div>
        </div>
        {!editing && <Button size="sm" onClick={startNew}>New operator</Button>}
      </div>

      {/* Existing operators */}
      {!editing && (
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 14 }}>
              <Skeleton width="40%" height={14} /><div style={{ height: 8 }} /><Skeleton width="60%" height={11} />
            </div>
          ) : operators.length === 0 ? (
            <EmptyState compact icon="🏟️" title="No operators yet" body="Create a branded front door to forward a partner platform or big operator." style={{ border: 'none', borderRadius: 0 }} />
          ) : (
            operators.map((op) => (
              <div key={op.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                <TeamLogo team={{ name: op.name, logo_url: op.logo_url, logo_color: op.brand_color || C.blue, logo_initials: op.logo_initials }} size={36} radius={8} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div onClick={() => navigate(`/o/${op.slug}`)} style={{ fontSize: 14, fontWeight: 600, color: C.ice, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>{op.name}</div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'rgba(46,91,140,0.3)', color: C.steel }}>/o/{op.slug}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: op.is_active ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.18)', color: op.is_active ? colors.success : colors.warning, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {op.is_active ? '● Live' : '○ Draft'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>{op.eventCount} pinned event{op.eventCount === 1 ? '' : 's'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Button size="sm" variant="secondary" onClick={() => startEdit(op)}>Edit</Button>
                  <button title="Delete operator card" aria-label={`Delete ${op.name} operator card`} onClick={() => removeOperator(op)}
                    style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '0.5px solid rgba(215,38,56,0.5)', color: C.red, borderRadius: 8, cursor: 'pointer' }}>
                    <Icon name="delete" size={15} color={C.red} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create / edit form */}
      {editing && (
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle()}>Slug *</label>
              <input value={form.slug} onChange={set('slug')} placeholder="black-bear" style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Name *</label>
              <input value={form.name} onChange={set('name')} placeholder="Black Bear Sports Group" style={fieldStyle()} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle()}>Tagline (optional — a partner-safe default is used if blank)</label>
              <input value={form.tagline} onChange={set('tagline')} placeholder="The fan & community layer on top of the platform you already run." style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Brand color (hero)</label>
              <input value={form.brand_color} onChange={set('brand_color')} placeholder="#0B1F3A" style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Accent color</label>
              <input value={form.accent_color} onChange={set('accent_color')} placeholder="#D72638" style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Logo URL</label>
              <input value={form.logo_url} onChange={set('logo_url')} placeholder="https://…" style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Logo initials (fallback)</label>
              <input value={form.logo_initials} onChange={set('logo_initials')} placeholder="BB" style={fieldStyle()} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle()}>Cover image URL (real photography — brand panel fallback if blank)</label>
              <input value={form.cover_image_url} onChange={set('cover_image_url')} placeholder="https://…" style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Website URL (link-back)</label>
              <input value={form.website_url} onChange={set('website_url')} placeholder="https://…" style={fieldStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Platform label (co-brand — e.g. GameSheet)</label>
              <input value={form.platform_label} onChange={set('platform_label')} placeholder="GameSheet" style={fieldStyle()} />
            </div>
          </div>

          {/* Event pickers */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.steel, textTransform: 'uppercase', marginBottom: 6 }}>
              Pinned events ({pinned.length}) — public leagues + non-youth tournaments
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <EventPicker title="Leagues" items={pinnableLeagues} kind="league" isPinned={isPinned} onToggle={togglePin} />
              <EventPicker title="Tournaments" items={pinnableTournaments} kind="tournament" isPinned={isPinned} onToggle={togglePin} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>Cancel</Button>
            <Button size="sm" variant="secondary" onClick={() => save(false)} loading={saving}>Save draft</Button>
            <Button size="sm" onClick={() => save(true)} loading={saving} disabled={pinned.length === 0} disabledReason="Pin at least one event to go live.">Save & go live</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EventPicker({ title, items, kind, isPinned, onToggle }) {
  return (
    <div style={{ background: C.dark, border: `0.5px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.steel, textTransform: 'uppercase', padding: '8px 10px', borderBottom: `0.5px solid ${C.border}` }}>{title} ({items.length})</div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: C.steel, padding: 12 }}>None available.</div>
        ) : (
          items.map((it) => {
            const on = isPinned(kind, it.id);
            return (
              <button key={it.id} type="button" onClick={() => onToggle(kind, it.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  padding: '8px 10px', minHeight: 44, background: on ? 'rgba(46,91,140,0.25)' : 'transparent',
                  border: 'none', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer',
                }}>
                <span style={{ width: 18, height: 18, borderRadius: radii.chip, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: on ? C.red : 'transparent', border: `1px solid ${on ? C.red : C.border}`, color: '#fff', fontSize: 12 }}>{on ? '✓' : ''}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
