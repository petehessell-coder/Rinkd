import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';
import { useIsRinkdAdmin } from '../lib/userRole';
import { timeAgo } from '../lib/posts';
import { Avatar } from '../components/Logos';
import { Icon, Skeleton, EmptyState, ConfirmSheet, useToast } from '../components/ui';
import { C, colors } from '../lib/tokens';

/**
 * /admin/moderation — commissioner-only flagged content queue.
 *
 * Pulls posts + comments where is_flagged = true (either via the auto-moderation
 * trigger or future user-reported flags). Lets the admin restore (unhide) or
 * delete with one tap.
 */

const TABS = [
  { id: 'posts', label: 'Posts' },
  { id: 'comments', label: 'Comments' },
  { id: 'blocklist', label: 'Blocklist' },
];

export default function AdminModerationPage({ currentUser, profile }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  // Platform-level moderation queue: Rinkd staff only. Per-league
  // commissioners moderate their own league's stuff via AdminPanel.
  const isAdmin = useIsRinkdAdmin(currentUser?.id);
  const [tab, setTab] = useState('posts');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [blocklist, setBlocklist] = useState([]);
  const [newWord, setNewWord] = useState('');
  const [newSeverity, setNewSeverity] = useState('high');
  const [removeTarget, setRemoveTarget] = useState(null); // { kind, id } pending delete confirm
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async () => {
    // Don't fire the moderation queries until we know this is actually a Rinkd
    // staff member — otherwise non-admins trigger 403s on protected tables
    // every time they land on this URL, and the queue UI flickers in.
    if (isAdmin !== true) return;
    setLoading(true);
    if (tab === 'posts' || tab === 'comments') {
      const targetType = tab === 'posts' ? 'post' : 'comment';
      const sel = tab === 'posts'
        ? '*, profiles ( id, name, handle, avatar_color, avatar_initials )'
        : '*, profiles!comments_author_id_fkey ( id, name, handle, avatar_color, avatar_initials )';
      const { data } = await supabase
        .from(tab)
        .select(sel)
        .eq('is_flagged', true)
        .order('flagged_at', { ascending: false })
        .limit(100);
      const list = data || [];
      // Annotate each flagged item with how many distinct users reported it.
      // Useful for triage — three users complaining is a stronger signal than
      // one. Skipped silently if the read fails; the queue still works.
      if (list.length) {
        const ids = list.map((x) => x.id);
        const { data: reports } = await supabase
          .from('content_reports')
          .select('target_id')
          .eq('target_type', targetType)
          .in('target_id', ids);
        const counts = (reports || []).reduce((acc, r) => {
          acc[r.target_id] = (acc[r.target_id] || 0) + 1;
          return acc;
        }, {});
        list.forEach((x) => { x.__report_count = counts[x.id] || 0; });
      }
      setItems(list);
    } else if (tab === 'blocklist') {
      const { data } = await supabase
        .from('moderation_blocklist')
        .select('*')
        .order('severity', { ascending: true })
        .order('word');
      setBlocklist(data || []);
    }
    setLoading(false);
  }, [tab, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const approve = async (kind, id) => {
    const table = kind === 'posts' ? 'posts' : 'comments';
    const { error } = await supabase.from(table).update({ is_flagged: false, is_hidden: false, flag_reason: null }).eq('id', id);
    if (error) {
      // Don't drop it from the queue — it's still flagged in the database.
      toast({ message: "That didn't go through — check your connection and try again.", tone: 'alert' });
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const askRemove = (kind, id) => setRemoveTarget({ kind, id });

  // Hard DB delete with no restore path — a confirm (not useUndoable) since
  // there's genuinely nothing to hand back if the admin taps Undo.
  const confirmRemove = async () => {
    if (!removeTarget) return;
    const { kind, id } = removeTarget;
    const table = kind === 'posts' ? 'posts' : 'comments';
    setRemoveBusy(true);
    const { error } = await supabase.from(table).delete().eq('id', id);
    setRemoveBusy(false);
    setRemoveTarget(null);
    if (error) {
      // The row is still there — keep showing it rather than pretending it's gone.
      toast({ message: "That didn't delete — check your connection and try again.", tone: 'alert' });
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const addWord = async (e) => {
    e.preventDefault();
    if (!newWord.trim()) return;
    const { error } = await supabase.from('moderation_blocklist').insert({
      word: newWord.trim().toLowerCase(),
      severity: newSeverity,
      added_by: currentUser?.id,
    });
    if (error && !error.message.includes('duplicate')) { toast({ message: error.message, tone: 'alert' }); return; }
    setNewWord('');
    load();
  };

  const deleteWord = async (id) => {
    await supabase.from('moderation_blocklist').delete().eq('id', id);
    setBlocklist((prev) => prev.filter((w) => w.id !== id));
  };

  // isAdmin === null means useIsRinkdAdmin is still resolving. Render a
  // geometric skeleton (not a bare spinner) so a real staff member doesn't
  // see "staff only" flash while the role lookup is in flight.
  if (isAdmin === null) {
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 80px' }}>
            <Skeleton width={200} height={28} style={{ marginBottom: 8 }} />
            <Skeleton width={280} height={13} style={{ marginBottom: 20 }} />
            <ModerationListSkeleton />
          </div>
        </div>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12, padding: 24, textAlign: 'center' }}>
          <Icon name="privacy" size={40} color={C.steel} />
          <div>The moderation queue is Rinkd staff only.</div>
          <button onClick={() => navigate('/home')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer' }}>Back to Home</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 80px' }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 4 }}>
            Moderation
          </div>
          <div style={{ fontSize: 13, color: C.steel, marginBottom: 18 }}>
            Content the text blocklist auto-flagged, plus future image moderation hooks.
          </div>

          <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 18, overflowX: 'auto' }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  background: 'transparent', color: tab === t.id ? C.ice : C.steel,
                  border: 'none', padding: '10px 16px', cursor: 'pointer',
                  fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                  borderBottom: tab === t.id ? `3px solid ${C.red}` : '3px solid transparent',
                  fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'blocklist' ? (
            <>
              <form onSubmit={addWord} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input value={newWord} onChange={(e) => setNewWord(e.target.value)}
                  placeholder="Add a word or phrase to block"
                  style={{ flex: 1, background: C.navy, border: `1px solid ${C.border}`, color: C.ice, padding: '10px 12px', borderRadius: 8, fontSize: 14, fontFamily: 'Barlow, sans-serif', outline: 'none' }}/>
                <select value={newSeverity} onChange={(e) => setNewSeverity(e.target.value)}
                  style={{ background: C.navy, border: `1px solid ${C.border}`, color: C.ice, padding: '10px 12px', borderRadius: 8, fontSize: 14, fontFamily: 'Barlow, sans-serif' }}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button type="submit" disabled={!newWord.trim()}
                  style={{ background: newWord.trim() ? C.red : C.border, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontFamily: 'Barlow, sans-serif' }}>
                  Add
                </button>
              </form>
              {loading ? <ModerationListSkeleton rows={6} compact /> : blocklist.length === 0 ? (
                <EmptyState icon="📝" title="Blocklist is empty" body="Add a word or phrase above and Rinkd auto-flags it on sight." />
              ) : (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  {blocklist.map((w, i) => {
                    const sevColor = w.severity === 'high' ? C.red : w.severity === 'medium' ? colors.warning : C.steel;
                    return (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
                        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, color: C.ice, flex: 1 }}>{w.word}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: sevColor, background: sevColor + '22', border: `1px solid ${sevColor}44`, padding: '3px 8px', borderRadius: 4 }}>{w.severity}</span>
                        {w.notes && <span style={{ fontSize: 11, color: C.steel, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.notes}</span>}
                        <button onClick={() => deleteWord(w.id)} aria-label={`Remove ${w.word} from blocklist`}
                          style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: C.steel, border: 'none', cursor: 'pointer' }}>
                          <Icon name="close" size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : loading ? <ModerationListSkeleton rows={4} /> : items.length === 0 ? (
            <EmptyState icon="✅" title="Clean sheet" body={`No flagged ${tab} right now. Nothing for you to review.`} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((it) => (
                <div key={it.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Avatar profile={it.profiles} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{it.profiles?.name || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: C.steel }}>@{it.profiles?.handle} · {timeAgo(it.flagged_at || it.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.red, background: 'rgba(215,38,56,0.15)', border: '1px solid rgba(215,38,56,0.4)', padding: '3px 8px', borderRadius: 4 }}>
                        {it.flag_reason || 'flagged'}
                      </span>
                      {it.__report_count > 0 && (
                        <span title={`${it.__report_count} user${it.__report_count === 1 ? '' : 's'} reported this`} style={{ fontSize: 10, fontWeight: 600, color: C.steel }}>
                          {it.__report_count} report{it.__report_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, color: C.ice, lineHeight: 1.55, marginBottom: 10, background: C.navy, padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {it.content || '(no text)'}
                  </div>
                  {tab === 'posts' && it.media_url && (
                    <div style={{ fontSize: 11, color: C.steel, marginBottom: 10 }}>📎 Media: <a href={it.media_url} target="_blank" rel="noopener noreferrer" style={{ color: C.ice, textDecoration: 'underline' }}>{it.media_type} attachment</a></div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => approve(tab, it.id)}
                      style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, background: colors.success, color: '#fff', border: 'none', padding: '0 16px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                      <Icon name="approved" size={14} /> Approve (unhide)
                    </button>
                    <button onClick={() => askRemove(tab, it.id)}
                      style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: C.red, border: `1px solid ${C.red}`, padding: '0 16px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                      <Icon name="delete" size={14} color={C.red} /> Delete permanently
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmSheet
        open={!!removeTarget}
        title="Delete this content for good?"
        body="This can't be undone."
        confirmLabel="Delete"
        danger
        busy={removeBusy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </Layout>
  );
}

// Geometric stand-in for the flagged-content / blocklist lists — matches the
// real row shapes instead of a spinner. `compact` mirrors the tighter
// single-line blocklist rows; the default matches the flagged-content cards.
function ModerationListSkeleton({ rows = 4, compact = false }) {
  if (compact) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
            <Skeleton width="40%" height={13} />
            <Skeleton width={50} height={16} radius={4} style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Skeleton width={32} height={32} radius={999} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton width="35%" height={13} />
              <div style={{ height: 4 }} />
              <Skeleton width="45%" height={11} />
            </div>
          </div>
          <Skeleton width="100%" height={40} radius={8} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <Skeleton width={130} height={28} radius={999} />
            <Skeleton width={150} height={28} radius={999} />
          </div>
        </div>
      ))}
    </div>
  );
}
