import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';
import { useIsRinkdAdmin } from '../lib/userRole';
import { timeAgo } from '../lib/posts';
import { ListRowSkeleton, EmptyState } from '../components/Skeletons';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  green: '#22C55E', amber: '#F59E0B',
};

const STATUS_META = {
  new:       { label: 'New',       color: C.red },
  triaging:  { label: 'Triaging',  color: C.amber },
  resolved:  { label: 'Resolved',  color: C.green },
  wontfix:   { label: "Won't fix", color: C.steel },
};

const CATEGORY_META = {
  bug:      { icon: '🐛', label: 'Bug' },
  idea:     { icon: '💡', label: 'Idea' },
  question: { icon: '❓', label: 'Question' },
  other:    { icon: '✉️', label: 'Other' },
};

export default function AdminFeedbackPage({ currentUser, profile }) {
  const navigate = useNavigate();
  // Platform-level bug queue: Rinkd staff only. Per-league commissioners
  // don't need to see other leagues' bug reports.
  const isAdmin = useIsRinkdAdmin(currentUser?.id);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('bug_reports')
      .select('*, profiles:user_id ( id, name, handle )')
      .order('created_at', { ascending: false })
      .limit(100);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data } = await q;
    setItems(data || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    // Optimistic, but remember the old value so we can roll back if the write
    // fails — otherwise the queue shows a status the database never accepted.
    const prevStatus = items.find((r) => r.id === id)?.status;
    setItems((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    const { error } = await supabase.from('bug_reports').update({ status }).eq('id', id);
    if (error) {
      setItems((prev) => prev.map((r) => r.id === id ? { ...r, status: prevStatus } : r));
      // eslint-disable-next-line no-alert
      alert("Couldn't update that report's status. Try again.");
    }
  };

  if (!isAdmin) {
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🔒</div>
          <div>Feedback queue is Rinkd staff only.</div>
          <button onClick={() => navigate('/feed')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer' }}>Back to Feed</button>
        </div>
      </Layout>
    );
  }

  const newCount = items.filter((r) => r.status === 'new').length;

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 80px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase' }}>
                Feedback Queue
              </div>
              <div style={{ fontSize: 13, color: C.steel, marginTop: 2 }}>
                {newCount} new · {items.length} total visible
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['all', 'new', 'triaging', 'resolved', 'wontfix'].map((s) => (
                <button key={s} onClick={() => setFilter(s)}
                  style={{
                    background: filter === s ? C.red : 'transparent',
                    color: filter === s ? '#fff' : C.steel,
                    border: `1px solid ${filter === s ? C.red : C.border}`,
                    padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif',
                  }}>
                  {s === 'all' ? 'All' : STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <ListRowSkeleton rows={6} />
          ) : items.length === 0 ? (
            <EmptyState icon="📬" title="Inbox zero" body={filter === 'new' ? 'No new reports — nice.' : 'Nothing here yet.'} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((r) => {
                const cat = CATEGORY_META[r.category] || CATEGORY_META.other;
                const stat = STATUS_META[r.status] || STATUS_META.new;
                return (
                  <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18 }}>{cat.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.steel }}>{cat.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: stat.color, background: stat.color + '22', border: `1px solid ${stat.color}44`, padding: '2px 8px', borderRadius: 4 }}>{stat.label}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: C.steel }}>{timeAgo(r.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 14, color: C.ice, lineHeight: 1.55, marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {r.description}
                    </div>
                    <div style={{ fontSize: 11, color: C.steel, marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>
                        From: {r.profiles?.name ? <a href={`/profile/${r.profiles.id}`} style={{ color: C.ice, textDecoration: 'underline' }}>@{r.profiles.handle}</a> : <em style={{ color: C.steel }}>anonymous</em>}
                        {r.email && <span> · <a href={`mailto:${r.email}?subject=Re%3A+your+Rinkd+feedback`} style={{ color: C.ice, textDecoration: 'underline' }}>{r.email}</a></span>}
                      </span>
                      {r.url && <span>📍 <code style={{ color: C.ice }}>{r.url}</code></span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['new', 'triaging', 'resolved', 'wontfix'].filter((s) => s !== r.status).map((s) => (
                        <button key={s} onClick={() => updateStatus(r.id, s)}
                          style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                          → {STATUS_META[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
