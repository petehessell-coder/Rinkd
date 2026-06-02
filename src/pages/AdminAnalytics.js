import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { loadDailyRollup, loadDAU, loadRecentEvents, loadTopPages } from '../lib/analytics';
import { useIsRinkdAdmin } from '../lib/userRole';
import { supabase } from '../lib/supabase';

// ENRICH-1 follow-on (May 28, 2026): admin dormancy cohorting + recently-active
// table. Reads profiles.last_seen_at (stamped by App.js touchLastSeen with a
// >=5min PostgREST gate). Inline supabase query keeps this self-contained;
// if profiles row count crosses ~10k consider swapping to a SECURITY DEFINER
// RPC that returns the cohort tallies + top-N pre-aggregated.
function humanAgo(ts) {
  if (!ts) return 'Never';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return 'just now';
  const mins = ms / 60_000;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  green: '#22C55E',
};

function StatBox({ label, value, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 10, color: C.steel, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 32, lineHeight: 1, color: C.ice }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.steel, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Compact sparkline-style bar chart — pure SVG, no dependency.
function MiniBars({ data, height = 60 }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.v));
  const w = 240;
  const barW = Math.max(2, Math.floor((w - data.length) / data.length));
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.v / max) * (height - 4);
        return <rect key={i} x={i * (barW + 1)} y={height - h} width={barW} height={h} fill={C.red} opacity={0.8} />;
      })}
    </svg>
  );
}

export default function AdminAnalytics({ currentUser, profile }) {
  const navigate = useNavigate();
  // Platform-level analytics: Rinkd staff only. Per-league commissioners
  // do NOT see this — they manage their own league via AdminPanel.
  const isAdmin = useIsRinkdAdmin(currentUser?.id);
  const [daily, setDaily] = useState([]);
  const [dau, setDau] = useState([]);
  const [recent, setRecent] = useState([]);
  const [topPages, setTopPages] = useState([]);
  // ENRICH-1: snapshot of every profile's last_seen_at + handle/name/persona
  // for the cohort tiles + recently-active table below. Sorted server-side
  // so we can also use .slice(0, N) for the visible table without resorting.
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, u, r, a, tp] = await Promise.all([
        loadDailyRollup(30),
        loadDAU(30),
        loadRecentEvents(80),
        supabase
          .from('profiles')
          .select('id, handle, name, persona, last_seen_at')
          .order('last_seen_at', { ascending: false, nullsFirst: false }),
        loadTopPages(40),
      ]);
      setDaily(d); setDau(u); setRecent(r); setTopPages(tp);
      setActivity(a?.data || []);
    } catch (e) {
      // Without this catch, the entire useEffect's promise rejects unhandled
      // and `loading` stays true forever — the page hangs on "Loading
      // analytics…" with no path forward.
      setError(e?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Roll up totals by event for last 7d vs prior 7d
  const summary = useMemo(() => {
    const now = Date.now();
    const d7 = now - 7 * 86400_000;
    const d14 = now - 14 * 86400_000;
    const recentSet = daily.filter((d) => new Date(d.day).getTime() >= d7);
    const priorSet = daily.filter((d) => {
      const t = new Date(d.day).getTime();
      return t < d7 && t >= d14;
    });
    const sumBy = (set, key = 'events') => set.reduce((acc, r) => {
      acc[r.event] = (acc[r.event] || 0) + r[key];
      return acc;
    }, {});
    const cur = sumBy(recentSet, 'events');
    const prev = sumBy(priorSet, 'events');
    return Object.entries(cur)
      .map(([event, v]) => ({ event, v, prev: prev[event] || 0, delta: v - (prev[event] || 0) }))
      .sort((a, b) => b.v - a.v);
  }, [daily]);

  const dauSeries = useMemo(
    () => [...dau].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ day: d.day, v: d.dau })),
    [dau]
  );

  // ENRICH-1: dormancy cohorts. Buckets cap at 14d for the visible tiles —
  // anything older rolls into "Cold". `never` = profile_complete signups
  // that haven't been touched by App.js touchLastSeen yet (so either they
  // existed pre-deploy, OR they signed up + never came back).
  const cohorts = useMemo(() => {
    const now = Date.now();
    const HR = 3_600_000;
    let active24h = 0, active7d = 0, dormant7to14d = 0, cold = 0, never = 0;
    for (const p of activity) {
      if (!p.last_seen_at) { never++; continue; }
      const ageH = (now - new Date(p.last_seen_at).getTime()) / HR;
      if (ageH < 24) active24h++;
      else if (ageH < 24 * 7) active7d++;
      else if (ageH < 24 * 14) dormant7to14d++;
      else cold++;
    }
    return { active24h, active7d, dormant7to14d, cold, never, total: activity.length };
  }, [activity]);

  const totalSignups7d = summary.find((s) => s.event === 'signup_success')?.v ?? 0;
  const postsCreated7d = summary.find((s) => s.event === 'post_created')?.v ?? 0;
  const articleReads7d = summary.find((s) => s.event === 'article_read')?.v ?? 0;
  const paywallShown7d = summary.find((s) => s.event === 'crease_paywall_shown')?.v ?? 0;

  // isAdmin === null means useIsRinkdAdmin is still resolving. Gate on this
  // first so a real staff member doesn't see the "staff only" rejection
  // screen flash — same pattern as AdminPanel / AdminFeedback / AdminModeration
  // from Batch 4.
  if (loading || isAdmin === null) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>Loading analytics…</div>
    </Layout>
  );

  if (!isAdmin) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div>Analytics is Rinkd staff only.</div>
        <button onClick={() => navigate('/feed')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer' }}>Back to Feed</button>
      </div>
    </Layout>
  );

  if (error) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, padding: 20, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
          <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>Couldn't load analytics</div>
          <div style={{ color: C.steel, fontSize: 12, marginBottom: 16 }}>{error}</div>
          <button onClick={load} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontWeight: 700 }}>Retry</button>
        </div>
      </div>
    </Layout>
  );

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 16px 80px' }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 4 }}>
            Analytics
          </div>
          <div style={{ fontSize: 13, color: C.steel, marginBottom: 22 }}>Last 30 days · self-hosted on Supabase</div>

          {/* Top stat row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 22 }}>
            <StatBox label="Signups · 7d" value={totalSignups7d} />
            <StatBox label="Posts created · 7d" value={postsCreated7d} />
            <StatBox label="Articles read · 7d" value={articleReads7d} />
            <StatBox label="Crease paywall views · 7d" value={paywallShown7d} />
          </div>

          {/* DAU sparkline */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Daily Active Users</div>
              <div style={{ fontSize: 12, color: C.ice }}>{dauSeries[dauSeries.length - 1]?.v || 0} today</div>
            </div>
            <MiniBars data={dauSeries} height={70} />
          </div>

          {/* Top pages — page_view events grouped by path (last 30d). Backed by
              the analytics_top_pages security_invoker view. Empty until the
              first page_view rows land after this ships. */}
          <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            Top pages · last 30d
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 22 }}>
            <div style={{ display: 'flex', padding: '8px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
              <span style={{ flex: 1 }}>Path</span>
              <span style={{ width: 70, textAlign: 'right' }}>Views</span>
              <span style={{ width: 80, textAlign: 'right' }}>Sessions</span>
              <span style={{ width: 70, textAlign: 'right' }}>Users</span>
            </div>
            {topPages.length === 0 ? (
              <div style={{ padding: 18, color: C.steel, fontSize: 13, textAlign: 'center' }}>No pageviews yet — fills in once traffic lands after the next deploy.</div>
            ) : topPages.map((row, i) => (
              <div key={row.page} style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.2)' : 'none', fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0, color: C.ice, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.page}</span>
                <span style={{ width: 70, textAlign: 'right', fontWeight: 700, color: C.ice }}>{row.views}</span>
                <span style={{ width: 80, textAlign: 'right', color: C.steel }}>{row.sessions}</span>
                <span style={{ width: 70, textAlign: 'right', color: C.steel }}>{row.users}</span>
              </div>
            ))}
          </div>

          {/* ENRICH-1 dormancy cohorts — sourced from profiles.last_seen_at,
              stamped by App.js touchLastSeen (>=5min gate) on every auth
              resolve. "Never" = profile exists but has never been stamped
              (pre-deploy account OR signup that never returned). */}
          <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            User activity · dormancy cohorts
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
            <StatBox label="Active · <24h" value={cohorts.active24h} sub={`of ${cohorts.total} profiles`} />
            <StatBox label="Active · 1–7d" value={cohorts.active7d} />
            <StatBox label="Dormant · 7–14d" value={cohorts.dormant7to14d} sub="re-engagement window" />
            <StatBox label="Cold · 14d+" value={cohorts.cold} />
            <StatBox label="Never seen" value={cohorts.never} sub="signed up, no return" />
          </div>

          {/* Recently active — top 25 by last_seen_at desc. */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 22 }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.steel, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Recently active</span>
              <span style={{ fontSize: 11, color: C.steel, textTransform: 'none', letterSpacing: 0 }}>top 25</span>
            </div>
            {activity.length === 0 ? (
              <div style={{ padding: 18, color: C.steel, fontSize: 13, textAlign: 'center' }}>No profiles loaded.</div>
            ) : activity.slice(0, 25).map((p, i) => {
              // Color the "ago" cell by bucket so dormancy is glanceable.
              let agoColor = C.steel;
              if (p.last_seen_at) {
                const ageH = (Date.now() - new Date(p.last_seen_at).getTime()) / 3_600_000;
                if (ageH < 24) agoColor = C.green;
                else if (ageH < 24 * 7) agoColor = C.ice;
                else if (ageH < 24 * 14) agoColor = '#F59E0B';
                else agoColor = C.red;
              }
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.2)' : 'none', gap: 10, fontSize: 13 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.ice, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || '—'}</div>
                    <div style={{ color: C.steel, fontSize: 11 }}>@{p.handle}{p.persona ? ` · ${p.persona}` : ''}</div>
                  </div>
                  <div style={{ color: agoColor, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, width: 90, textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {humanAgo(p.last_seen_at)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Event breakdown */}
          <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            Events · last 7d vs prior 7d
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 22 }}>
            {summary.length === 0 ? (
              <div style={{ padding: 18, color: C.steel, fontSize: 13, textAlign: 'center' }}>No events yet. Once users start poking around, this will fill in.</div>
            ) : summary.map((row, i) => (
              <div key={row.event} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
                <div style={{ flex: 1, fontSize: 13, color: C.ice, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{row.event}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ice, width: 70, textAlign: 'right' }}>{row.v}</div>
                <div style={{ fontSize: 11, color: row.delta >= 0 ? C.green : C.red, width: 70, textAlign: 'right' }}>
                  {row.delta >= 0 ? '↑' : '↓'} {Math.abs(row.delta)}
                </div>
              </div>
            ))}
          </div>

          {/* Recent firehose */}
          <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            Recent events · live firehose
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {recent.length === 0 ? (
              <div style={{ padding: 18, color: C.steel, fontSize: 13, textAlign: 'center' }}>No events captured yet.</div>
            ) : recent.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', padding: '8px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.2)' : 'none', gap: 10, fontSize: 12 }}>
                <span style={{ color: C.steel, width: 110, flexShrink: 0 }}>{new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span style={{ color: C.red, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', flex: 1, minWidth: 0 }}>{e.event}</span>
                <span style={{ color: C.steel, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.url || ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
