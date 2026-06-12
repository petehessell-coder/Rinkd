import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout, { BRAND_COLORS as C } from '../components/Layout';
import { supabase } from '../lib/supabase';
import { useUserRole } from '../lib/userRole';
import { listRinks, createRink, updateRink, deleteRink } from '../lib/rinks';

const TABS = ['Overview', 'Rinks', 'Requests'];
const inputStyle = {
  width: '100%', background: '#07111F', border: `0.5px solid ${C.border}`,
  borderRadius: 8, padding: '9px 11px', color: C.ice,
  fontFamily: "'Barlow', sans-serif", fontSize: 13, outline: 'none',
};

/**
 * Commissioner / system-admin dashboard at /admin.
 *
 * Guarded: anyone whose role is not "commissioner" sees a polite redirect-prompt
 * instead of the panel (the role badge in the sidebar is the only way it appears
 * in nav, but a direct URL visit also needs guarding).
 *
 * Tabs:
 *   • Overview — at-a-glance stat cards for the leagues/teams the user commissions
 *   • Rinks    — CRUD for the rinks table (no UI for this existed before)
 *   • Requests — pending team-join requests across all the user's teams/leagues
 */
export default function AdminPanel({ profile }) {
  const navigate = useNavigate();
  const role = useUserRole(profile?.id);
  const [tab, setTab] = useState('Overview');

  // role === null means useUserRole is still resolving. Render a neutral
  // spinner — a real commissioner would otherwise see the "Commissioners only"
  // rejection screen flash for ~200ms before the lookup completes.
  if (role === null) {
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.steel, fontFamily: "'Barlow', sans-serif", fontSize: 14 }}>
          Loading…
        </div>
      </Layout>
    );
  }

  if (role !== 'commissioner') {
    return (
      <Layout profile={profile}>
        <div style={{
          background: C.dark, minHeight: '100vh', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
          fontFamily: "'Barlow', sans-serif", color: C.ice,
        }}>
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
            padding: '32px 28px', maxWidth: 460, textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
            <h1 style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
              fontSize: 24, textTransform: 'uppercase', marginBottom: 8,
            }}>Commissioners only</h1>
            <p style={{ fontSize: 14, color: C.steel, lineHeight: 1.5, marginBottom: 18 }}>
              The admin panel is for league commissioners. If you should have access, ask the league
              owner to add you, then come back here.
            </p>
            <button onClick={() => navigate('/feed')}
              style={{ padding: '10px 22px', borderRadius: 999, background: C.red, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Back to Feed
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: "'Barlow', sans-serif", color: C.ice }}>
        {/* Header */}
        <div style={{ background: C.navy, padding: '16px 20px', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: 920, margin: '0 auto' }}>
            <div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase' }}>Admin Panel</div>
              <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>Manage leagues, rinks, and pending requests.</div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '4px 9px', borderRadius: 6, background: 'rgba(215,38,56,0.15)', color: C.red, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
              Commissioner
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ background: C.navy, borderBottom: '2px solid rgba(46,91,140,0.3)' }}>
          <div style={{ display: 'flex', maxWidth: 920, margin: '0 auto' }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  fontSize: 13, fontWeight: 700, padding: '11px 18px',
                  background: 'transparent', border: 'none',
                  borderBottom: tab === t ? `3px solid ${C.red}` : '3px solid transparent',
                  marginBottom: -2, cursor: 'pointer',
                  fontFamily: "'Barlow', sans-serif",
                  color: tab === t ? C.ice : C.steel,
                  transition: 'color 0.15s',
                }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: 920, margin: '0 auto', padding: 20 }}>
          {tab === 'Overview' && <OverviewTab profile={profile} navigate={navigate} />}
          {tab === 'Rinks'    && <RinksTab />}
          {tab === 'Requests' && <RequestsTab navigate={navigate} />}
        </div>
      </div>
    </Layout>
  );
}

// ─────────────────────────────── Overview ────────────────────────────────────

function OverviewTab({ profile, navigate }) {
  const [stats, setStats] = useState(null);
  const [leagues, setLeagues] = useState([]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    async function run() {
      // My leagues
      const { data: myLeagues } = await supabase
        .from('leagues')
        .select('id, name, season, division, status')
        .eq('commissioner_id', profile.id)
        .order('name');

      const leagueIds = (myLeagues || []).map(l => l.id);

      // My teams (manager_id)
      const { count: teamCount } = await supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('manager_id', profile.id);

      // Total league_teams across my leagues
      const { count: ltCount } = leagueIds.length
        ? await supabase
            .from('league_teams')
            .select('id', { count: 'exact', head: true })
            .in('league_id', leagueIds)
        : { count: 0 };

      // Total games + future scheduled across my leagues
      let totalGames = 0, upcomingGames = 0;
      if (leagueIds.length) {
        const { count: gAll } = await supabase
          .from('league_games')
          .select('id', { count: 'exact', head: true })
          .in('league_id', leagueIds);
        totalGames = gAll || 0;
        const { count: gUp } = await supabase
          .from('league_games')
          .select('id', { count: 'exact', head: true })
          .in('league_id', leagueIds)
          .eq('status', 'scheduled')
          .gte('start_time', new Date().toISOString());
        upcomingGames = gUp || 0;
      }

      // Pending team join requests (manager's teams)
      const { data: myTeams } = await supabase
        .from('teams')
        .select('id')
        .eq('manager_id', profile.id);
      const myTeamIds = (myTeams || []).map(t => t.id);
      let pendingReqs = 0;
      if (myTeamIds.length) {
        const { count: prc } = await supabase
          .from('team_join_requests')
          .select('id', { count: 'exact', head: true })
          .in('team_id', myTeamIds)
          .eq('status', 'pending');
        pendingReqs = prc || 0;
      }

      if (cancelled) return;
      setLeagues(myLeagues || []);
      setStats({
        leagues: (myLeagues || []).length,
        teams: teamCount || 0,
        leagueTeams: ltCount || 0,
        totalGames,
        upcomingGames,
        pendingReqs,
      });
    }
    run();
    return () => { cancelled = true; };
  }, [profile?.id]);

  if (!stats) return <Loading />;

  const cards = [
    { num: stats.leagues,        label: 'Leagues you run',     onClick: () => null },
    { num: stats.leagueTeams,    label: 'Teams in your leagues' },
    { num: stats.teams,          label: 'Teams you manage' },
    { num: stats.totalGames,     label: 'Total league games' },
    { num: stats.upcomingGames,  label: 'Upcoming games',      color: '#22C55E' },
    { num: stats.pendingReqs,    label: 'Pending requests',    color: stats.pendingReqs > 0 ? '#F59E0B' : undefined },
  ];

  return (
    <>
      {/* Stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 22 }}>
        {cards.map(card => (
          <div key={card.label} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: '14px 16px', textAlign: 'left',
          }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
              fontSize: 30, color: card.color || C.ice, lineHeight: 1,
            }}>{card.num}</div>
            <div style={{ fontSize: 11, color: C.steel, marginTop: 6, letterSpacing: '0.04em' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* My leagues */}
      <SectionLabel>Your Leagues</SectionLabel>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {leagues.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: C.steel, textAlign: 'center' }}>
            You're not commissioning any leagues yet. Create one from the Leagues tab.
          </div>
        )}
        {leagues.map(l => (
          <div key={l.id} onClick={() => navigate(`/league/${l.id}/manage`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
              borderBottom: `0.5px solid rgba(244,247,250,0.06)`, cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(46,91,140,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{l.name}</div>
              <div style={{ fontSize: 11, color: C.steel, marginTop: 1 }}>
                {[l.season, l.division].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              background: l.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(244,247,250,0.08)',
              color: l.status === 'active' ? '#22C55E' : C.steel,
              letterSpacing: '0.08em', textTransform: 'uppercase' }}>{l.status || 'draft'}</span>
            <span style={{ fontSize: 14, color: 'rgba(244,247,250,0.3)' }}>›</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ──────────────────────────────── Rinks ──────────────────────────────────────

function RinksTab() {
  const [rinks, setRinks] = useState(null);
  const [editing, setEditing] = useState(null); // null = no edit, object = edit form, 'new' = create
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try { setRinks(await listRinks()); } catch (e) { setError(e.message); setRinks([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => setEditing({ id: null, name: '', sub_rink: '', address: '', live_barn_venue_id: '', maps_url: '' });
  const startEdit = (r) => setEditing({ ...r, sub_rink: r.sub_rink || '', address: r.address || '', live_barn_venue_id: r.live_barn_venue_id || '', maps_url: r.maps_url || '' });

  const handleSave = async () => {
    if (!editing || !editing.name?.trim()) { setError('Name is required'); return; }
    setBusy(true); setError(null);
    try {
      if (editing.id) await updateRink(editing.id, editing);
      else            await createRink(editing);
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Delete "${r.name}${r.sub_rink ? ' · ' + r.sub_rink : ''}"? Games already pointing here will keep their rink_id (orphaned).`)) return;
    setBusy(true);
    try { await deleteRink(r.id); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (rinks === null) return <Loading />;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionLabel>Rinks ({rinks.length})</SectionLabel>
        <button onClick={startNew}
          style={{ padding: '8px 14px', borderRadius: 999, background: C.red, border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>+</span> Add Rink
        </button>
      </div>

      {error && <div style={{ background: 'rgba(215,38,56,0.12)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 13, color: C.red }}>{error}</div>}

      {editing && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Barlow Condensed', sans-serif" }}>
            {editing.id ? 'Edit rink' : 'New rink'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <Field label="Name *"><input style={inputStyle} value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="USA Hockey Arena" /></Field>
            <Field label="Sub-rink"><input style={inputStyle} value={editing.sub_rink || ''} onChange={e => setEditing({ ...editing, sub_rink: e.target.value })} placeholder="NHL Rink / Olympic / Sheet 1" /></Field>
          </div>
          <Field label="Address"><input style={inputStyle} value={editing.address || ''} onChange={e => setEditing({ ...editing, address: e.target.value })} placeholder="14900 Beck Rd, Plymouth, MI 48170" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <Field label="LiveBarn Venue ID"><input style={inputStyle} value={editing.live_barn_venue_id || ''} onChange={e => setEditing({ ...editing, live_barn_venue_id: e.target.value })} placeholder="e.g. 1023" /></Field>
            <Field label="Maps URL (optional)"><input style={inputStyle} value={editing.maps_url || ''} onChange={e => setEditing({ ...editing, maps_url: e.target.value })} placeholder="Google Maps link" /></Field>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => setEditing(null)}
              style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: C.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={busy}
              style={{ flex: 2, padding: 10, borderRadius: 999, background: busy ? C.border : C.red, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {busy ? 'Saving…' : editing.id ? 'Save changes' : 'Add rink'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {rinks.length === 0 && <div style={{ padding: 18, fontSize: 13, color: C.steel, textAlign: 'center' }}>No rinks yet — click <strong>Add Rink</strong> to create one.</div>}
        {rinks.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>
                {r.name}{r.sub_rink && <span style={{ color: C.steel, fontWeight: 400 }}> · {r.sub_rink}</span>}
              </div>
              <div style={{ fontSize: 11, color: C.steel, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {[r.address, r.live_barn_venue_id ? `LiveBarn #${r.live_barn_venue_id}` : null].filter(Boolean).join(' · ') || <em style={{ color: 'rgba(244,247,250,0.3)' }}>no address yet</em>}
              </div>
            </div>
            <button onClick={() => startEdit(r)}
              style={{ background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 999, color: C.ice, fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
            <button onClick={() => handleDelete(r)}
              style={{ background: 'transparent', border: 'none', color: 'rgba(244,247,250,0.3)', fontSize: 16, cursor: 'pointer', padding: 4 }} title="Delete">🗑</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────── Requests ────────────────────────────────────

function RequestsTab({ navigate }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRequests([]); return; }
    // Pending requests for teams managed by this user
    const { data: myTeams } = await supabase.from('teams').select('id, name').eq('manager_id', user.id);
    const ids = (myTeams || []).map(t => t.id);
    if (ids.length === 0) { setRequests([]); return; }
    const { data, error: e } = await supabase
      .from('team_join_requests')
      .select('id, team_id, user_id, created_at, status, profile:profiles!team_join_requests_user_id_fkey(name, handle, avatar_color, avatar_initials), team:teams(id, name)')
      .in('team_id', ids)
      .eq('status', 'pending')
      .order('created_at');
    if (e) { setError(e.message); setRequests([]); return; }
    setRequests(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (requests === null) return <Loading />;

  return (
    <>
      <SectionLabel>Pending Join Requests {requests.length > 0 ? `(${requests.length})` : ''}</SectionLabel>
      {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {requests.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: C.steel, textAlign: 'center' }}>
            No pending requests. You'll see them here when someone asks to join a team you manage.
          </div>
        )}
        {requests.map(r => (
          <div key={r.id} onClick={() => navigate(`/team/${r.team_id}/manage`)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(46,91,140,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: r.profile?.avatar_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff' }}>
              {r.profile?.avatar_initials || '?'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{r.profile?.name || 'Unknown player'}</div>
              <div style={{ fontSize: 11, color: C.steel }}>wants to join <strong style={{ color: C.ice }}>{r.team?.name || 'a team'}</strong></div>
            </div>
            <span style={{ fontSize: 14, color: 'rgba(244,247,250,0.3)' }}>›</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ────────────────────────────── shared bits ───────────────────────────────────

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Barlow Condensed', sans-serif" }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, fontFamily: "'Barlow Condensed', sans-serif" }}>{label}</div>
      {children}
    </div>
  );
}
function Loading() {
  return <div style={{ padding: 30, textAlign: 'center', color: C.steel, fontSize: 13 }}>Loading…</div>;
}
