import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';
import { useIsRinkdAdmin } from '../lib/userRole';

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

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  green: '#22C55E', amber: '#F59E0B',
};

function Toggle({ value, onChange, busy }) {
  return (
    <div onClick={busy ? undefined : () => onChange(!value)}
      style={{
        width: 44, height: 24,
        background: value ? C.green : 'rgba(244,247,250,0.15)',
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
      color: value ? C.green : C.amber,
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {value ? '● Activated' : '○ Pending'}
    </span>
  );
}

function Row({ kind, item, onToggle, busyId }) {
  const isActivated = !!item.is_activated;
  const navigate = useNavigate();
  const detailUrl = kind === 'tournament' ? `/tournament/${item.id}` : `/league/${item.id}`;
  const subtitle = useMemo(() => {
    if (kind === 'tournament') {
      const parts = [item.division, item.start_date, item.end_date].filter(Boolean);
      return parts.join(' · ');
    }
    const parts = [item.division, item.season, item.start_date, item.end_date].filter(Boolean);
    return parts.join(' · ');
  }, [item, kind]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: item.logo_url ? `url(${item.logo_url}) center/cover, ${item.logo_color || C.blue}` : (item.logo_color || C.blue),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff', flexShrink: 0,
      }}>
        {!item.logo_url && (item.logo_initials || (item.name || '?').slice(0, 2).toUpperCase())}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div onClick={() => navigate(detailUrl)} style={{ fontSize: 14, fontWeight: 600, color: C.ice, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            {item.name}
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'rgba(46,91,140,0.3)', color: C.steel, letterSpacing: '0.06em' }}>
            {kind === 'tournament' ? 'TOURNAMENT' : 'LEAGUE'}
          </span>
        </div>
        {subtitle && <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>{subtitle}</div>}
        <div style={{ marginTop: 4 }}><StatusPill value={isActivated} /></div>
      </div>
      <Toggle value={isActivated} busy={busyId === item.id} onChange={(v) => onToggle(kind, item.id, v)} />
    </div>
  );
}

export default function AdminActivations({ currentUser, profile }) {
  const navigate = useNavigate();
  const isAdmin = useIsRinkdAdmin(currentUser?.id);
  const [tournaments, setTournaments] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('pending'); // 'pending' | 'activated' | 'all'
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, l] = await Promise.all([
        supabase.from('tournaments')
          .select('id, name, division, start_date, end_date, is_activated, logo_color, logo_initials, logo_url, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('leagues')
          .select('id, name, division, season, start_date, end_date, is_activated, logo_color, logo_initials, logo_url, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);
      if (t.error) throw t.error;
      if (l.error) throw l.error;
      setTournaments(t.data || []);
      setLeagues(l.data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load activations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onToggle = async (kind, id, nextValue) => {
    setBusyId(id);
    const table = kind === 'tournament' ? 'tournaments' : 'leagues';
    const { error: upErr } = await supabase.from(table).update({ is_activated: nextValue }).eq('id', id);
    setBusyId(null);
    if (upErr) {
      setError(upErr.message || `Failed to update ${kind}`);
      return;
    }
    // Optimistic local update so the toggle reflects immediately without
    // forcing a full reload. A subsequent realtime-driven refetch would
    // be nice — for now manual.
    const setter = kind === 'tournament' ? setTournaments : setLeagues;
    setter((prev) => prev.map((x) => (x.id === id ? { ...x, is_activated: nextValue } : x)));
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
    return {
      tournaments: tournaments.filter(keep),
      leagues: leagues.filter(keep),
    };
  }, [tournaments, leagues, filter, search]);

  if (loading || isAdmin === null) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>Loading activations…</div>
    </Layout>
  );

  if (!isAdmin) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div>Activations is Rinkd staff only.</div>
        <button onClick={() => navigate('/feed')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer' }}>Back to Feed</button>
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
            style={{ flex: '1 1 220px', minWidth: 180, background: '#07111F', border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, outline: 'none' }}
          />
        </div>

        {/* Tournaments */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 8, marginTop: 8 }}>
          Tournaments ({filtered.tournaments.length})
        </div>
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
          {filtered.tournaments.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: C.steel, textAlign: 'center' }}>None match this filter.</div>
          ) : (
            filtered.tournaments.map((t) => (
              <Row key={t.id} kind="tournament" item={t} onToggle={onToggle} busyId={busyId} />
            ))
          )}
        </div>

        {/* Leagues */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginBottom: 8 }}>
          Leagues ({filtered.leagues.length})
        </div>
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtered.leagues.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: C.steel, textAlign: 'center' }}>None match this filter.</div>
          ) : (
            filtered.leagues.map((l) => (
              <Row key={l.id} kind="league" item={l} onToggle={onToggle} busyId={busyId} />
            ))
          )}
        </div>

        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 18, lineHeight: 1.6 }}>
          <strong>How it works:</strong> non-activated events can be configured (teams, schedule, bracket) and have visible public pages, but live scoring + auto-recap pushes are blocked at the RLS layer. Flip activated only after billing is complete.
        </div>
      </div>
    </Layout>
  );
}
