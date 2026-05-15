import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { loadDailyRollup, loadDAU, loadRecentEvents } from '../lib/analytics';
import { useIsRinkdAdmin } from '../lib/userRole';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, u, r] = await Promise.all([loadDailyRollup(30), loadDAU(30), loadRecentEvents(80)]);
      setDaily(d); setDau(u); setRecent(r);
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
