import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { Avatar } from '../components/Logos';
import { supabase } from '../lib/supabase';
import { signOut, updateProfile, PROFILE_SELECT } from '../lib/auth';
import { track } from '../lib/analytics';
import { listMyBlocks, unblockUser } from '../lib/blocks';
import { C, colors } from '../lib/tokens';

/**
 * /settings — account management surface.
 *
 * Two destructive-by-nature features:
 *   1. Download my data — bundles everything we have about the user into a
 *      JSON file the browser downloads. All queries are .eq('user_id', me)
 *      so RLS keeps the user's own data, nothing else.
 *   2. Delete my account — calls the delete-account Edge Function which
 *      verifies the JWT, then admin.deleteUser()'s the auth row. CASCADE on
 *      profiles.id then sweeps all personal content. Stewarded entities
 *      (leagues, teams, articles authored, etc.) survive with SET NULL.
 */
export default function SettingsPage({ currentUser, profile }) {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState(null);

  // ENRICH-1 (May 28, 2026): notification prefs. Initialized from the profile;
  // optimistic-flip + DB persist on toggle. Transactional default TRUE (always-on
  // for receipts/password-reset), marketing default FALSE (CAN-SPAM / GDPR
  // explicit opt-in), push default TRUE.
  const [notifs, setNotifs] = useState({
    notification_email_transactional: profile?.notification_email_transactional ?? true,
    notification_email_marketing: profile?.notification_email_marketing ?? false,
    notification_push: profile?.notification_push ?? true,
  });
  const [notifBusy, setNotifBusy] = useState(null); // key currently saving, or null
  const [notifError, setNotifError] = useState('');

  // Re-hydrate when profile arrives after the page has mounted.
  useEffect(() => {
    if (!profile) return;
    setNotifs({
      notification_email_transactional: profile.notification_email_transactional ?? true,
      notification_email_marketing: profile.notification_email_marketing ?? false,
      notification_push: profile.notification_push ?? true,
    });
  }, [profile?.id, profile?.notification_email_transactional, profile?.notification_email_marketing, profile?.notification_push]);

  const flipNotif = async (key) => {
    if (notifBusy) return;
    const next = !notifs[key];
    setNotifs(prev => ({ ...prev, [key]: next })); // optimistic
    setNotifBusy(key); setNotifError('');
    const { error } = await updateProfile(currentUser.id, { [key]: next });
    setNotifBusy(null);
    if (error) {
      setNotifs(prev => ({ ...prev, [key]: !next })); // revert
      setNotifError(error.message || "Couldn't save that just now — try the toggle again in a sec.");
      return;
    }
    track('notification_preference_changed', { key, value: next });
  };

  const loadBlocks = useCallback(async () => {
    setBlocksLoading(true);
    const rows = await listMyBlocks();
    setBlocks(rows);
    setBlocksLoading(false);
  }, []);

  useEffect(() => {
    if (currentUser) loadBlocks();
  }, [currentUser, loadBlocks]);

  const handleUnblock = async (userId) => {
    setUnblockingId(userId);
    const { error } = await unblockUser(userId);
    if (!error) {
      setBlocks((prev) => prev.filter((b) => b.blocked_id !== userId));
      track('unblock', { target_user_id: userId, source: 'settings' });
    }
    setUnblockingId(null);
  };

  if (!currentUser) {
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>
          Sign in to manage your settings.
        </div>
      </Layout>
    );
  }

  const handleExport = async () => {
    setExporting(true);
    setExportError('');
    try {
      const uid = currentUser.id;
      // Pull every table we'd want a user to take with them. RLS keeps us to
      // the user's own rows for everything except public reads (which is fine
      // because the rows are limited by .eq() below anyway).
      const tables = await Promise.all([
        // YOUTH-PRIVACY: email + date_of_birth are column-revoked; merged back
        // in below via get_my_contact() so the user's own export stays complete.
        supabase.from('profiles').select(PROFILE_SELECT).eq('id', uid).maybeSingle(),
        supabase.from('posts').select('*').eq('author_id', uid),
        supabase.from('comments').select('*').eq('author_id', uid),
        supabase.from('likes').select('*').eq('user_id', uid),
        supabase.from('follows').select('*').or(`follower_id.eq.${uid},following_id.eq.${uid}`),
        supabase.from('team_members').select('id, team_id, user_id, role, jersey_number, position, shot_hand, is_captain, is_alternate, status, joined_at, invite_name').eq('user_id', uid),
        supabase.from('team_game_rsvps').select('*').eq('user_id', uid),
        supabase.from('notifications').select('*').eq('recipient_id', uid),
        supabase.from('push_subscriptions').select('*').eq('user_id', uid),
        supabase.from('crease_subscriptions').select('*').eq('user_id', uid),
        supabase.from('bug_reports').select('*').eq('user_id', uid),
        supabase.from('game_lineups').select('*').eq('user_id', uid),
        supabase.from('tournament_roles').select('*').eq('user_id', uid),
      ]);
      const [
        profileRow, posts, comments, likes, follows, teamMembers,
        rsvps, notifications, pushSubs, creaseSubs, bugReports, lineups, tournamentRoles,
      ] = tables;

      // If any single table read failed, the export silently shipped partial
      // data. Record which ones so the file is honest about what's missing.
      const tableNames = [
        'profile', 'posts', 'comments', 'likes', 'follows', 'team_memberships',
        'game_rsvps', 'notifications', 'push_subscriptions', 'crease_subscriptions',
        'bug_reports_submitted', 'game_lineups', 'tournament_roles',
      ];
      const exportWarnings = tables
        .map((t, i) => (t.error ? { table: tableNames[i], error: t.error.message } : null))
        .filter(Boolean);

      // If the export couldn't read the user's profile, OR a third+ of the
      // tables failed, the download would be mostly empty arrays with a
      // warnings array most users will never check. Hard-fail with a clear
      // error instead of pretending it succeeded.
      const profileFailed = !!tables[0].error;
      const tooManyFailed = exportWarnings.length >= 5;
      if (profileFailed || tooManyFailed) {
        setExportError(
          profileFailed
            ? "Couldn't reach your profile — your data export would be empty. Check your connection and try again."
            : `Too many tables failed (${exportWarnings.length} of ${tables.length}). Check your connection and try again.`
        );
        return;
      }

      const payload = {
        export_metadata: {
          generated_at: new Date().toISOString(),
          source: 'rinkd.app',
          user_id: uid,
          format: 'json-v1',
          ...(exportWarnings.length ? { export_warnings: exportWarnings } : {}),
        },
        // Merge the user's OWN contact (email/DOB) back in — column-revoked on
        // the table but theirs to export, fetched via the self-scoped RPC.
        profile: profileRow.data
          ? { ...profileRow.data, ...((await supabase.rpc('get_my_contact')).data?.[0] || {}) }
          : null,
        posts: posts.data || [],
        comments: comments.data || [],
        likes: likes.data || [],
        follows: follows.data || [],
        team_memberships: teamMembers.data || [],
        game_rsvps: rsvps.data || [],
        notifications: notifications.data || [],
        push_subscriptions: pushSubs.data || [],
        crease_subscriptions: creaseSubs.data || [],
        bug_reports_submitted: bugReports.data || [],
        game_lineups: lineups.data || [],
        tournament_roles: tournamentRoles.data || [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const handle = (profile?.handle || 'rinkd-user').replace(/[^a-z0-9_-]+/gi, '');
      const ts = new Date().toISOString().slice(0, 10);
      const filename = `rinkd-data-export-${handle}-${ts}.json`;
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      track('data_export_downloaded');
    } catch (err) {
      setExportError(err?.message || "That export didn't finish — try again, or email hello@rinkd.app and we'll send it over.");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmText !== 'DELETE MY ACCOUNT') return;
    setDeleting(true);
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error('Your session expired — sign in again, then retry the delete.');
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL || 'https://tbpoopsyhfuqcbugrjbh.supabase.co'}/functions/v1/delete-account`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: '{}' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `We couldn't complete the delete (error ${res.status}) — try again, or email hello@rinkd.app and we'll handle it.`);
      track('account_deleted');
    } catch (err) {
      setDeleteError(err?.message || "We couldn't complete the delete — try again, or email hello@rinkd.app and we'll handle it.");
      setDeleting(false);
      return;
    }
    // Deletion succeeded — the account is gone. A sign-out or redirect failure
    // must NOT surface as "Delete failed", so it lives outside the try/catch.
    try { await signOut(); } catch { /* account already deleted; ignore */ }
    window.location.href = '/?deleted=1';
  };

  const section = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
    padding: 20, marginBottom: 16,
  };
  const h2 = {
    fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
    fontSize: 22, textTransform: 'uppercase', margin: 0, marginBottom: 10, color: C.ice,
  };
  const p = { fontSize: 14, color: C.steel, lineHeight: 1.6, margin: '0 0 16px' };
  const btnPrimary = {
    background: C.red, color: '#fff', border: 'none',
    padding: '11px 22px', borderRadius: 999, cursor: 'pointer',
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
    fontSize: 14, letterSpacing: '0.05em', textTransform: 'uppercase',
  };
  const btnGhost = {
    background: 'transparent', color: C.ice, border: `1px solid ${C.border}`,
    padding: '11px 22px', borderRadius: 999, cursor: 'pointer',
    fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600,
  };

  return (
    <Layout profile={profile}>
      <SEO title="Settings" noIndex />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 80px' }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 32, textTransform: 'uppercase', marginBottom: 4 }}>
            Settings
          </div>
          <div style={{ fontSize: 13, color: C.steel, marginBottom: 22 }}>
            Manage your account, your data, and your relationship with Rinkd.
          </div>

          {/* DOWNLOAD MY DATA */}
          <div style={section}>
            <h2 style={h2}>📦 Download My Data</h2>
            <p style={p}>
              Take everything we have about you with you. A single JSON file with your profile, posts,
              comments, likes, follows, team memberships, RSVPs, notifications, and subscriptions.
            </p>
            {exportError && <p style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{exportError}</p>}
            <button onClick={handleExport} disabled={exporting} style={btnPrimary}>
              {exporting ? 'Generating…' : 'Download (JSON)'}
            </button>
          </div>

          {/* NOTIFICATION PREFERENCES — ENRICH-1 (May 28, 2026). Three toggles
              persisted to profiles.notification_*. Transactional = receipts +
              password reset (default ON); marketing = re-engagement (default
              OFF, explicit opt-in); push = browser/PWA push (default ON, but
              actual delivery still needs a push_subscriptions row). */}
          <div style={section}>
            <h2 style={h2}>🔔 Notification Preferences</h2>
            {(() => {
              const Toggle = ({ k, title, body, warn }) => {
                const on = notifs[k];
                const busy = notifBusy === k;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    gap: 14, padding: '12px 0',
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: C.ice, fontWeight: 600, marginBottom: 2 }}>{title}</div>
                      <div style={{ fontSize: 12, color: C.steel, lineHeight: 1.5 }}>{body}</div>
                      {warn && !on && (
                        <div style={{ fontSize: 12, color: colors.warning, marginTop: 6, lineHeight: 1.5 }}>{warn}</div>
                      )}
                    </div>
                    <button onClick={() => flipNotif(k)} disabled={busy}
                      aria-pressed={on}
                      style={{
                        flexShrink: 0,
                        width: 46, height: 26, borderRadius: 999,
                        background: on ? colors.success : C.border,
                        border: 'none', cursor: busy ? 'wait' : 'pointer',
                        position: 'relative', transition: 'background 0.15s',
                        opacity: busy ? 0.6 : 1,
                      }}>
                      <span style={{
                        position: 'absolute', top: 3, left: on ? 23 : 3,
                        width: 20, height: 20, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.15s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }} />
                    </button>
                  </div>
                );
              };
              return (
                <>
                  <Toggle
                    k="notification_email_transactional"
                    title="Account email (receipts, password resets)"
                    body="One-off emails tied to actions you take — payment receipts, password reset links, registration confirmations. Default on."
                    warn="Off means we can't email you receipts or password-reset links. We'll still create the account, you just won't get the confirmation email."
                  />
                  <Toggle
                    k="notification_email_marketing"
                    title="Marketing email (news, product updates)"
                    body="Occasional roundups, feature launches, and rink-community highlights. Default off — opt in only."
                  />
                  <Toggle
                    k="notification_push"
                    title="Push notifications"
                    body="In-app pushes for game reminders, replies, and roster requests. Browser/PWA push also needs a permission grant — Profile has the Enable button."
                  />
                  {notifError && (
                    <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{notifError}</div>
                  )}
                </>
              );
            })()}
          </div>

          {/* BLOCKED USERS */}
          <div style={section}>
            <h2 style={h2}>🚫 Blocked Users</h2>
            <p style={p}>
              You won't see posts, comments, or notifications from anyone you've blocked.
              They won't see yours either.
            </p>
            {blocksLoading ? (
              <div style={{ fontSize: 13, color: C.steel }}>Warming up.</div>
            ) : blocks.length === 0 ? (
              <div style={{ fontSize: 13, color: C.steel, fontStyle: 'italic' }}>
                You haven't blocked anyone.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {blocks.map((b) => {
                  const prof = b.profiles || {};
                  const id = b.blocked_id;
                  return (
                    <div key={id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 10,
                      background: 'rgba(11,31,58,0.6)', border: `1px solid ${C.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <Avatar profile={prof} size={36} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: C.ice, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {prof.name || 'Unknown'}
                          </div>
                          {prof.handle && (
                            <div style={{ color: C.steel, fontSize: 12 }}>@{prof.handle}</div>
                          )}
                        </div>
                      </div>
                      <button onClick={() => handleUnblock(id)} disabled={unblockingId === id} style={{
                        ...btnGhost,
                        padding: '7px 14px', fontSize: 12, opacity: unblockingId === id ? 0.6 : 1,
                      }}>
                        {unblockingId === id ? '…' : 'Unblock'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* DELETE ACCOUNT */}
          <div style={{ ...section, borderColor: 'rgba(215,38,56,0.4)' }}>
            <h2 style={{ ...h2, color: C.red }}>🚨 Delete Account</h2>
            <p style={p}>
              Permanently delete your Rinkd account and all of your personal content:
              posts, comments, likes, follows, RSVPs, team memberships, notifications, subscriptions.
              <br /><br />
              <strong style={{ color: C.ice }}>What survives:</strong> leagues, teams, tournaments, and articles you created
              stay alive (so other members aren't affected), but with your name removed from them.
              <br /><br />
              <strong style={{ color: colors.warning }}>This cannot be undone.</strong>
            </p>

            {!showConfirm ? (
              <button onClick={() => setShowConfirm(true)} style={{ ...btnPrimary, background: 'transparent', color: C.red, border: `1px solid ${C.red}` }}>
                I want to delete my account
              </button>
            ) : (
              <div style={{ background: 'rgba(215,38,56,0.08)', border: '1px solid rgba(215,38,56,0.3)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 13, color: C.ice, marginBottom: 10, lineHeight: 1.55 }}>
                  Type <code style={{ background: C.dark, padding: '2px 8px', borderRadius: 4, color: C.red, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>DELETE MY ACCOUNT</code> below to confirm.
                </div>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus
                  placeholder="DELETE MY ACCOUNT"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: C.navy, border: `1px solid ${C.border}`, color: C.ice,
                    padding: '11px 13px', borderRadius: 8,
                    fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    outline: 'none', marginBottom: 12, letterSpacing: '0.04em',
                  }} />
                {deleteError && <p style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{deleteError}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setShowConfirm(false); setConfirmText(''); setDeleteError(''); }} disabled={deleting} style={btnGhost}>
                    Cancel
                  </button>
                  <button onClick={handleDelete} disabled={confirmText !== 'DELETE MY ACCOUNT' || deleting}
                    style={{
                      ...btnPrimary,
                      background: confirmText === 'DELETE MY ACCOUNT' && !deleting ? C.red : C.border,
                      cursor: confirmText === 'DELETE MY ACCOUNT' && !deleting ? 'pointer' : 'not-allowed',
                    }}>
                    {deleting ? 'Deleting…' : 'Permanently Delete Account'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer note */}
          <div style={{ fontSize: 12, color: C.steel, textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
            Need help? <a href="mailto:hello@rinkd.app" style={{ color: C.ice, textDecoration: 'underline' }}>hello@rinkd.app</a> · Replies within a few hours.
          </div>
        </div>
      </div>
    </Layout>
  );
}
