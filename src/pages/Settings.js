import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/auth';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  amber: '#F59E0B',
};

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

  if (!currentUser) {
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice }}>
          You need to be signed in to manage settings.
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
        supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
        supabase.from('posts').select('*').eq('author_id', uid),
        supabase.from('comments').select('*').eq('author_id', uid),
        supabase.from('likes').select('*').eq('user_id', uid),
        supabase.from('follows').select('*').or(`follower_id.eq.${uid},following_id.eq.${uid}`),
        supabase.from('team_members').select('*').eq('user_id', uid),
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

      const payload = {
        export_metadata: {
          generated_at: new Date().toISOString(),
          source: 'rinkd.app',
          user_id: uid,
          format: 'json-v1',
        },
        profile: profileRow.data || null,
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
      setExportError(err?.message || 'Export failed. Try again or email hello@rinkd.app.');
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
      if (!accessToken) throw new Error('No active session');
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL || 'https://tbpoopsyhfuqcbugrjbh.supabase.co'}/functions/v1/delete-account`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: '{}' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Failed (${res.status})`);
      track('account_deleted');
      await signOut();
      window.location.href = '/?deleted=1';
    } catch (err) {
      setDeleteError(err?.message || 'Delete failed. Email hello@rinkd.app and we\'ll handle it.');
      setDeleting(false);
    }
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

          {/* NOTIFICATION PREFERENCES — link to Profile (where the existing toggle lives) */}
          <div style={section}>
            <h2 style={h2}>🔔 Notification Preferences</h2>
            <p style={p}>
              Push notifications are managed from your profile — the 🔔 toggle next to "Edit".
            </p>
            <button onClick={() => navigate('/profile')} style={btnGhost}>Open Profile</button>
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
              <strong style={{ color: C.amber }}>This cannot be undone.</strong>
            </p>

            {!showConfirm ? (
              <button onClick={() => setShowConfirm(true)} style={{ ...btnPrimary, background: 'transparent', color: C.red, border: `1px solid ${C.red}` }}>
                I want to delete my account
              </button>
            ) : (
              <div style={{ background: 'rgba(215,38,56,0.08)', border: '1px solid rgba(215,38,56,0.3)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 13, color: C.ice, marginBottom: 10, lineHeight: 1.55 }}>
                  Type <code style={{ background: '#07111F', padding: '2px 8px', borderRadius: 4, color: C.red, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>DELETE MY ACCOUNT</code> below to confirm.
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
