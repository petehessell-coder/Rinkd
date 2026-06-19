import React, { useState, useEffect, useCallback } from 'react';
import { subscribeToPush, isPushSubscribed, unsubscribeFromPush } from '../lib/push';
import Layout from '../components/Layout';
import { C } from '../lib/tokens';
import { Icon, StatNumber } from '../components/ui';
import { number, plural } from '../lib/format';
import { TierBadge } from '../components/Logos';
import { updateProfile } from '../lib/auth';
import { getTier, getTierProgress, getNextTier, TIERS } from '../lib/tiers';
import { supabase } from '../lib/supabase';
import { getPlayerLeagueStats, getPlayerTournamentStats } from '../lib/stats';
import { getUserGamePuckCount } from '../lib/gamePucks';
import { useParams, useNavigate } from 'react-router-dom';
import { getOrCreateDm } from '../lib/messages';
import { followUser, unfollowUser, isFollowing, getFollowCounts, timeAgo, uploadMedia } from '../lib/posts';
import { blockUser, unblockUser, isBlockedByMe } from '../lib/blocks';
import MapLink from '../components/MapLink';
import { MentionText } from '../components/Mentions';
import { track } from '../lib/analytics';
import { classifyImage } from '../lib/imageModeration';

const POSITIONS = ['Forward', 'Defense', 'Goalie', 'Coach', 'Parent', 'Official', 'Fan'];
const LEVELS = ['Youth (Mite-Bantam)', 'Youth (Midget)', 'High School', 'Junior (Tier I)', 'Junior (Tier II/III)', 'College', 'Minor Pro', 'Beer League', 'Adult Rec', 'Fan'];

// First+last initial, for the avatar fallback.
const initialsFromName = (name) => {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
};

// Broadcast lower-third section header — white Barlow Condensed 700 italic caps
// on solid navy (#0f2847), bleeding to the column's left edge with a red accent
// slab. The manifesto section-header pattern, not a generic label.
function LowerThird({ label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: '#0f2847', borderLeft: '4px solid #D72638',
      marginLeft: -16, marginBottom: 12, padding: '8px 14px 8px 16px',
      borderTopRightRadius: 4, borderBottomRightRadius: 4,
    }}>
      <span style={{
        flex: 1, minWidth: 0,
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic',
        fontSize: 18, lineHeight: 1, letterSpacing: '0.05em', color: '#F4F7FA',
        textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
    </div>
  );
}

// Profile avatar — object-fit:cover at a fixed square aspect. On a missing or
// broken image it falls back to initials on the elevated dark surface (#162f55),
// never a broken-image icon.
function ProfileAvatar({ profile, size = 72 }) {
  const [imgError, setImgError] = useState(false);
  const initials = profile?.avatar_initials || initialsFromName(profile?.name) || '?';
  const showImg = profile?.avatar_url && !imgError;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      background: '#162f55', display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '2px solid rgba(255,255,255,0.16)',
    }}>
      {showImg ? (
        <img src={profile.avatar_url} alt={profile?.name || ''} onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: Math.round(size * 0.4), color: '#F4F7FA', lineHeight: 1 }}>{initials}</span>
      )}
    </div>
  );
}

// STATS-3: one stat-line card (team header + GP/G/A/PTS/PIM grid). Shared by the
// Leagues and Tournaments sections so both read identically; the two are never
// blended. Logo color/initials fall back gracefully (tournament teams don't
// carry a logo color, so the caller passes a neutral one + derived initials).
function StatLine({ logoColor, initials, title, subtitle, gp, goals, assists, points, pim }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: logoColor || '#2E5B8C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: '#fff', flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 11, color: C.steel, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
        </div>
      </div>
      {/* Number first, huge — never a bordered table. Tight grid of number+label
          pairs (TV score-overlay treatment). PTS emphasized in red. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 4 }}>
        {[['GP', gp], ['G', goals], ['A', assists], ['PTS', points], ['PIM', pim]].map(([label, val]) => (
          <div key={label} style={{ textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: label === 'PTS' ? 40 : 36, color: label === 'PTS' ? C.red : C.ice, lineHeight: 1, whiteSpace: 'nowrap' }}>{val ?? 0}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Profile({ currentUser, profile: myProfile, onProfileUpdate }) {
  const { userId: urlUserId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(myProfile);
  const [posts, setPosts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [activeTab, setActiveTab] = useState('posts');
  const [following, setFollowing] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [followLoading, setFollowLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [dmLoading, setDmLoading] = useState(false);
  const [leagueStats, setLeagueStats] = useState([]);
  const [tournamentStats, setTournamentStats] = useState([]);
  const [puckCount, setPuckCount] = useState(0);

  const [editName, setEditName] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editLevel, setEditLevel] = useState('');
  const [editRink, setEditRink] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [activity, setActivity] = useState([]);
  const [coverUploading, setCoverUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    isPushSubscribed().then(setPushEnabled);
  }, []);

  const handleEnableNotifications = async () => {
    setPushLoading(true);
    const sub = await subscribeToPush(currentUser?.id);
    setPushEnabled(!!sub);
    setPushLoading(false);
    if (!sub) alert('Could not enable notifications. Check your browser settings — if you blocked them earlier, you’ll need to allow them in site permissions first.');
  };

  const handleDisableNotifications = async () => {
    if (!window.confirm('Turn off push notifications? You’ll still see in-app messages.')) return;
    setPushLoading(true);
    await unsubscribeFromPush(currentUser?.id);
    setPushEnabled(false);
    setPushLoading(false);
  };

  const profileId = urlUserId || currentUser?.id;
  const isOwnProfile = !urlUserId || urlUserId === currentUser?.id;

  const loadProfile = useCallback(async () => {
    if (isOwnProfile) {
      setProfile(myProfile);
    } else {
      const { data } = await supabase.from('profiles').select('*').eq('id', profileId).single();
      setProfile(data);
    }
    if (profileId) {
      // These six reads are independent — fire them in parallel rather than as
      // a serial waterfall (was ~6 sequential round-trips on profile open).
      // Posts are capped at 50; the activity strip only uses the latest 20 and
      // the grid stays useful without pulling a power-user's entire history.
      const wantsRel = !isOwnProfile && currentUser;
      const [postsRes, stats, tournStats, counts, commentsRes, f, b, pucks] = await Promise.all([
        supabase.from('posts').select('*').eq('author_id', profileId).order('created_at', { ascending: false }).limit(50),
        getPlayerLeagueStats(profileId),
        getPlayerTournamentStats(profileId),
        getFollowCounts(profileId),
        supabase
          .from('comments')
          .select('id, content, created_at, post_id, posts(content, author_id)')
          .eq('author_id', profileId)
          .order('created_at', { ascending: false })
          .limit(20),
        wantsRel ? isFollowing(currentUser.id, profileId) : Promise.resolve(false),
        wantsRel ? isBlockedByMe(profileId) : Promise.resolve(false),
        getUserGamePuckCount(profileId),
      ]);
      const data = postsRes.data;
      const comments = commentsRes.data;
      setLeagueStats(stats);
      setTournamentStats(tournStats);
      setPuckCount(pucks || 0);
      setPosts(data || []);
      setFollowCounts(counts);
      if (wantsRel) {
        setFollowing(f);
        setBlocked(b);
      }
      // Recent activity = posts + comments, last 20, newest first.
      const acts = [
        ...(data || []).map((p) => ({ kind: 'post', id: p.id, at: p.created_at, post: p })),
        ...(comments || []).map((c) => ({ kind: 'comment', id: c.id, at: c.created_at, comment: c })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 20);
      setActivity(acts);
    }
  }, [profileId, isOwnProfile, myProfile, currentUser]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    if (file.size > 10 * 1024 * 1024) {
      alert(`Cover photo is ${(file.size / 1024 / 1024).toFixed(1)}MB — max 10MB.`);
      e.target.value = '';
      return;
    }
    const coverVerdict = await classifyImage(file);
    if (!coverVerdict.ok) {
      alert('Looks like this image may violate Rinkd\'s community guidelines. Try a different one.');
      e.target.value = '';
      track('upload_blocked_nsfw', { label: coverVerdict.label, score: coverVerdict.score, scope: 'cover' });
      return;
    }
    setCoverUploading(true);
    const { url, error } = await uploadMedia(file, currentUser.id);
    if (error || !url) { setCoverUploading(false); alert('Upload failed. Try again.'); return; }
    const { error: uErr } = await updateProfile(currentUser.id, { cover_image_url: url });
    setCoverUploading(false);
    if (uErr) { alert('Save failed: ' + uErr.message); return; }
    // Merge against the LATEST profile (via functional setter) and bubble the
    // merged value up. A quick second upload would otherwise read a stale
    // `profile` closure and clobber the first upload's field in the parent.
    setProfile((p) => {
      const next = { ...p, cover_image_url: url };
      onProfileUpdate?.(next);
      return next;
    });
    track('cover_photo_uploaded');
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(`Avatar is ${(file.size / 1024 / 1024).toFixed(1)}MB — max 5MB.`);
      e.target.value = '';
      return;
    }
    const avatarVerdict = await classifyImage(file);
    if (!avatarVerdict.ok) {
      alert('Looks like this image may violate Rinkd\'s community guidelines. Try a different one.');
      e.target.value = '';
      track('upload_blocked_nsfw', { label: avatarVerdict.label, score: avatarVerdict.score, scope: 'avatar' });
      return;
    }
    setAvatarUploading(true);
    const { url, error } = await uploadMedia(file, currentUser.id);
    if (error || !url) { setAvatarUploading(false); alert('Upload failed. Try again.'); return; }
    const { error: uErr } = await updateProfile(currentUser.id, { avatar_url: url });
    setAvatarUploading(false);
    if (uErr) { alert('Save failed: ' + uErr.message); return; }
    // See handleCoverUpload — merge against the latest profile so concurrent
    // uploads don't drop each other's field on the parent's myProfile.
    setProfile((p) => {
      const next = { ...p, avatar_url: url };
      onProfileUpdate?.(next);
      return next;
    });
    track('avatar_uploaded');
  };

  const handleMessage = async () => {
    if (!currentUser || isOwnProfile || dmLoading) return;
    setDmLoading(true);
    try {
      const conversationId = await getOrCreateDm(profileId);
      if (!conversationId) throw new Error('Could not open a conversation.');
      track('dm_opened_from_profile');
      navigate(`/messages/${conversationId}`);
    } catch (err) {
      alert(err?.message || 'Could not open a conversation.');
    } finally {
      setDmLoading(false);
    }
  };

  const handleFollow = async () => {
    if (!currentUser || isOwnProfile) return;
    track(following ? 'unfollow' : 'follow', { target_user_id: profileId });
    setFollowLoading(true);
    const wasFollowing = following;
    const result = wasFollowing
      ? await unfollowUser(currentUser.id, profileId)
      : await followUser(currentUser.id, profileId);
    // Only move the UI if the write actually landed — otherwise the button
    // simply reverts and the user can retry (no false "Following" state or
    // permanently inflated follower count).
    if (!result?.error) {
      setFollowing(!wasFollowing);
      setFollowCounts(c => ({ ...c, followers: Math.max(0, c.followers + (wasFollowing ? -1 : 1)) }));
    }
    setFollowLoading(false);
  };

  const handleBlock = async () => {
    if (!currentUser || isOwnProfile) return;
    if (blocked) {
      // Unblock has no confirmation — symmetric with un-follow.
      setBlockLoading(true);
      const { error } = await unblockUser(profileId);
      if (!error) setBlocked(false);
      setBlockLoading(false);
      track('unblock', { target_user_id: profileId });
      return;
    }
    const ok = window.confirm(
      `Block @${profile?.handle || 'this user'}? You won't see each other's posts, comments, or notifications. You'll be unfollowed if you currently follow them.`
    );
    if (!ok) return;
    setBlockLoading(true);
    const { error } = await blockUser(profileId);
    if (!error) {
      setBlocked(true);
      // Drop the local follow state so the UI matches the auto-unfollow that
      // blockUser() just performed against the DB.
      if (following) {
        setFollowing(false);
        setFollowCounts((c) => ({ ...c, followers: Math.max(0, c.followers - 1) }));
      }
    }
    setBlockLoading(false);
    track('block', { target_user_id: profileId });
  };

  const openEdit = () => {
    setEditName(profile?.name || ''); setEditHandle(profile?.handle || '');
    setEditBio(profile?.bio || ''); setEditPosition(profile?.position || 'Fan');
    setEditLevel(profile?.level || 'Beer League'); setEditRink(profile?.home_rink || '');
    setSaveError(''); setEditing(true);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    setSaving(true); setSaveError('');
    const updates = { name: editName.trim(), handle: editHandle.trim().replace('@', ''), bio: editBio.trim(), position: editPosition, level: editLevel, home_rink: editRink.trim() };
    const { data, error } = await updateProfile(currentUser.id, updates);
    setSaving(false);
    if (error) { setSaveError(error.message || 'Failed to save.'); return; }
    // Functional updater so a quick second edit while the previous setProfile
    // hasn't flushed sees the freshest local profile, not a stale closure.
    // The DB row is authoritative when `data` is returned; we fall back to
    // merging `updates` onto the latest local profile only when the server
    // returns nothing (defensive — updateProfile usually returns data).
    setProfile((prev) => {
      const merged = data || { ...(prev || profile || {}), ...updates };
      onProfileUpdate?.(merged);
      return merged;
    });
    setEditing(false);
  };

  if (!profile) return <Layout profile={myProfile}><div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: C.ice, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Getting the ice ready.</div></div></Layout>;

  const tier = getTier(profile.points || 0);
  const progress = getTierProgress(profile.points || 0);
  const nextTier = getNextTier(profile.points || 0);

  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: C.steel, marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" };
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, background: '#080F1C', border: `1.5px solid ${C.border}`, color: C.ice, fontSize: 14, outline: 'none', fontFamily: "'Barlow', sans-serif", boxSizing: 'border-box' };

  return (
    <Layout profile={myProfile}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{
            height: 140,
            background: profile.cover_image_url
              ? `linear-gradient(180deg, rgba(7,17,31,0.1) 0%, rgba(7,17,31,0.55) 100%), url(${profile.cover_image_url}) center/cover`
              : `linear-gradient(135deg, ${C.navy} 0%, ${tier.color}33 50%, ${C.navy} 100%)`,
            borderBottom: `1px solid ${C.border}`, position: 'relative',
          }}>
            {isOwnProfile && (
              <>
                <input id="cover-upload" type="file" accept="image/*" onChange={handleCoverUpload} style={{ display: 'none' }} />
                <label htmlFor="cover-upload" title="Change cover photo"
                  style={{
                    position: 'absolute', top: 10, right: 10,
                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 999,
                    padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'Barlow, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                  {coverUploading ? 'Uploading…' : <><Icon name="camera" size={13} />{profile.cover_image_url ? 'Change cover' : 'Add cover'}</>}
                </label>
              </>
            )}
            <div style={{ position: 'absolute', bottom: -28, left: 20 }}>
              {isOwnProfile ? (
                <>
                  <input id="avatar-upload" type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
                  <label htmlFor="avatar-upload" title="Change profile picture"
                    style={{ cursor: 'pointer', display: 'inline-block', position: 'relative' }}>
                    <ProfileAvatar profile={profile} size={72} />
                    <span style={{
                      position: 'absolute', right: -2, bottom: -2,
                      width: 24, height: 24, borderRadius: '50%',
                      background: avatarUploading ? C.border : C.red, color: '#fff',
                      border: '2px solid #07111F',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, lineHeight: 1,
                    }}>{avatarUploading ? '…' : <Icon name="camera" size={12} color="#fff" />}</span>
                  </label>
                </>
              ) : (
                <ProfileAvatar profile={profile} size={72} />
              )}
            </div>
          </div>
          <div style={{ padding: '36px 20px 20px' }}>
            {/* ONBOARD-1 follow-on (May 28, 2026): nudge users to replace the
                auto-generated `user-<UUID-prefix>` placeholder handle.
                Self-removes the moment they set a real one. Only renders on
                your own profile, in read mode. */}
            {isOwnProfile && !editing && profile.handle?.startsWith('user-') && (
              <div style={{
                background: 'rgba(245,158,11,0.10)',
                border: '1px solid rgba(245,158,11,0.45)',
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 14,
                color: C.ice,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 13,
                lineHeight: 1.45,
                flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>👋</span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <strong style={{ color: '#F59E0B' }}>Pick your username.</strong>{' '}
                  Right now you're{' '}
                  <code style={{
                    background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: 4,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
                  }}>@{profile.handle}</code>{' '}
                  — an auto-generated placeholder. Others see this on your posts and chirps.
                </div>
                <button onClick={openEdit} style={{
                  background: '#F59E0B', color: '#0B1F3A', border: 'none',
                  padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
                  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
                  fontSize: 13, letterSpacing: '0.05em', textTransform: 'uppercase',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  Set Username
                </button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 26, color: C.ice, textTransform: 'uppercase', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</div>
                <div style={{ fontSize: 13, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{profile.handle}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <TierBadge tier={tier.name} size="md" />
                {isOwnProfile && !editing && (
                  <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={openEdit} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1.5px solid ${C.border}`, color: C.ice, fontFamily: "'Barlow', sans-serif", fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Edit</button>
                  {!pushEnabled && (
                    <button onClick={handleEnableNotifications} disabled={pushLoading} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1.5px solid #2E5B8C`, color: '#8BA3BE', fontFamily: "'Barlow', sans-serif", fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      {pushLoading ? '...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="bell" size={14} />Notify</span>}
                    </button>
                  )}
                  {pushEnabled && (
                    <button onClick={handleDisableNotifications} disabled={pushLoading}
                      title="Click to turn off"
                      style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.5)', color: '#22C55E', fontSize: 13, fontFamily: "'Barlow', sans-serif", cursor: pushLoading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                      {pushLoading ? '...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="following" size={14} />On</span>}
                    </button>
                  )}
                  </div>
                )}
                {!isOwnProfile && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {!blocked && (
                      <button onClick={handleMessage} disabled={dmLoading} title="Send a direct message" style={{
                        padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                        background: 'transparent', border: `1.5px solid ${C.border}`, color: C.ice,
                        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14,
                        letterSpacing: '0.05em',
                      }}>{dmLoading ? '...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="message" size={14} />Message</span>}</button>
                    )}
                    {!blocked && (
                      <button onClick={handleFollow} disabled={followLoading} style={{
                        padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: following ? C.border : C.red, color: 'white',
                        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14,
                        letterSpacing: '0.05em',
                      }}>{followLoading ? '...' : following ? 'Following' : 'Follow'}</button>
                    )}
                    <button onClick={handleBlock} disabled={blockLoading} title={blocked ? 'Unblock this user' : 'Block this user'} style={{
                      padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                      background: 'transparent',
                      border: `1.5px solid ${blocked ? C.red : C.border}`,
                      color: blocked ? C.red : C.steel,
                      fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13,
                      letterSpacing: '0.05em',
                    }}>{blockLoading ? '...' : blocked ? 'Blocked' : 'Block'}</button>
                  </div>
                )}
              </div>
            </div>

            {/* Follow counts */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: C.steel }}><strong style={{ color: C.ice }}>{followCounts.followers}</strong> Followers</span>
              <span style={{ fontSize: 13, color: C.steel }}><strong style={{ color: C.ice }}>{followCounts.following}</strong> Following</span>
              {puckCount > 0 && (
                <span title="Game Pucks won — the fans' Player of the Game pick" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: '#0B1F3A', background: '#C9A84C', padding: '3px 10px', borderRadius: 999, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', letterSpacing: '0.04em', textTransform: 'uppercase' }}>🏆 {puckCount}× Game Puck</span>
              )}
            </div>

            {profile.bio && !editing && <p style={{ color: C.ice, fontSize: 14, lineHeight: 1.5, marginBottom: 10, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}><MentionText text={profile.bio} mentions={{}} /></p>}
            {!editing && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {profile.position && <span style={{ fontSize: 12, color: C.steel }}>🏒 {profile.position}</span>}
                {profile.level && <span style={{ fontSize: 12, color: C.steel }}>📊 {profile.level}</span>}
                {profile.home_rink && <span style={{ fontSize: 12, color: C.steel }}>🏟️ <MapLink text={profile.home_rink} icon="" style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }} /></span>}
              </div>
            )}

            {editing && (
              <form onSubmit={saveEdit} style={{ marginTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div><label style={labelStyle}>Name</label><input value={editName} onChange={e => setEditName(e.target.value)} required maxLength={80} style={inputStyle}/></div>
                  <div>
                    <label style={labelStyle}>Username</label>
                    <input value={editHandle} onChange={e => setEditHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} required maxLength={40} style={inputStyle}/>
                    {/* Inline hint while the field still holds the auto-
                        generated `user-<UUID-prefix>` placeholder. */}
                    {editHandle.startsWith('user-') && (
                      <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4, lineHeight: 1.4 }}>
                        That&apos;s an auto-generated placeholder — pick something you&apos;ll be known by.
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}><label style={labelStyle}>Bio</label><textarea value={editBio} onChange={e => setEditBio(e.target.value)} maxLength={200} rows={3} style={{ ...inputStyle, resize: 'vertical' }}/></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div><label style={labelStyle}>Position</label><select value={editPosition} onChange={e => setEditPosition(e.target.value)} style={inputStyle}>{POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                  <div><label style={labelStyle}>Level</label><select value={editLevel} onChange={e => setEditLevel(e.target.value)} style={inputStyle}>{LEVELS.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
                </div>
                <div style={{ marginBottom: 16 }}><label style={labelStyle}>Home Rink</label><input value={editRink} onChange={e => setEditRink(e.target.value)} maxLength={100} placeholder="Nationwide Arena, Columbus OH" style={inputStyle}/></div>
                {saveError && <p style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{saveError}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => setEditing(false)} style={{ padding: '9px 18px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.steel, fontFamily: "'Barlow', sans-serif", cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                  <button type="submit" disabled={saving} style={{ padding: '9px 24px', borderRadius: 8, background: saving ? C.border : C.red, color: 'white', border: 'none', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 15, cursor: 'pointer' }}>{saving ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Shareable stat hero — the screenshot-for-the-family-group-chat
            graphic. ESPN player-card energy: name large, the headline number
            front and center. Reads from a SINGLE source — league totals when
            present, otherwise tournament — never blended (the two aren't
            comparable). */}
        {(leagueStats.length > 0 || tournamentStats.length > 0) && (() => {
          const fromLeague = leagueStats.length > 0;
          const rows = fromLeague ? leagueStats : tournamentStats;
          const tot = rows.reduce((acc, s) => ({
            gp: acc.gp + (s.gp || 0), goals: acc.goals + (s.goals || 0),
            assists: acc.assists + (s.assists || 0), points: acc.points + (s.points || 0),
            pim: acc.pim + (s.pim || 0),
          }), { gp: 0, goals: 0, assists: 0, points: 0, pim: 0 });
          const kicker = fromLeague
            ? `League Season · ${plural(leagueStats.length, 'League')}`
            : `Tournament Play · ${plural(tournamentStats.length, 'Event')}`;
          const sub = [profile.position, profile.level].filter(Boolean).join(' · ');
          return (
            <div style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg, #162f55 0%, #0B1F3A 100%)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px 18px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 3, height: 14, background: C.red, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{kicker}</span>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 32, lineHeight: 1, color: C.ice, textTransform: 'uppercase', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</div>
              {sub && <div style={{ fontSize: 12, color: C.steel, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 4px' }}>
                <StatNumber value={number(tot.points)} label="Points" size="xl" align="center" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
                {[['GP', tot.gp], ['G', tot.goals], ['A', tot.assists], ['PIM', tot.pim]].map(([label, val]) => (
                  <StatNumber key={label} value={number(val)} label={label} size="md" align="center" />
                ))}
              </div>
            </div>
          );
        })()}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          {[['Posts', number(posts.length)], ['Points', number(profile.points || 0)], ['Tier', tier.name]].map(([label, value]) => (
            <div key={label} style={{ background: C.card, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
              <StatNumber value={value} label={label} size="md" align="center" />
            </div>
          ))}
        </div>

        {/* Tier Progress */}
        <div style={{ background: C.card, borderRadius: 14, padding: '16px', border: `1px solid ${C.border}`, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: C.ice, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Tier Progress</span>
            <span style={{ fontSize: 12, color: C.steel }}>{nextTier ? `${number(nextTier.min - (profile.points || 0))} pts to ${nextTier.name}` : 'Max Tier'}</span>
          </div>
          <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${tier.color}99, ${tier.color})`, borderRadius: 4, transition: 'width 0.5s ease' }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {TIERS.map(t => (
              <div key={t.name} style={{ textAlign: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: (profile.points || 0) >= t.min ? t.color : C.border, margin: '0 auto 2px' }}/>
                <div style={{ fontSize: 8, color: C.steel }}>{t.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Posts */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: C.navy, borderRadius: 10, padding: 4, border: `1px solid ${C.border}` }}>
          {[{ id: 'posts', label: 'Posts' }, { id: 'stats', label: 'Stats' }, { id: 'activity', label: 'Activity' }, { id: 'badges', label: 'Badges' }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: '8px', borderRadius: 7, border: 'none', background: activeTab === t.id ? C.blue : 'transparent', color: activeTab === t.id ? C.ice : C.steel, fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{t.label}</button>
          ))}
        </div>

        {activeTab === 'posts' && (
          posts.length === 0 ? <div style={{ textAlign: 'center', color: C.steel, padding: '40px', fontSize: 14 }}>{isOwnProfile ? 'No chirps yet — drop your first one from the feed.' : 'No chirps yet.'}</div>
          : posts.map(post => (
            <div key={post.id} style={{ background: C.card, borderRadius: 12, padding: '14px 16px', border: `1px solid ${C.border}`, marginBottom: 10 }}>
              {post.tag && <span style={{ display: 'inline-block', marginBottom: 8, fontSize: 10, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 4, background: (post.tag_color || C.blue) + '22', color: post.tag_color || C.blue }}>{post.tag}</span>}
              {post.content && <p style={{ fontSize: 14, color: C.ice, lineHeight: 1.5, marginBottom: 8 }}>{post.content}</p>}
              {post.media_url && (
                post.media_type === 'video'
                  ? <video src={post.media_url} controls style={{ width: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 8 }}/>
                  : <img src={post.media_url} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}/>
              )}
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.steel, alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="like" size={14} /> {post.likes || 0}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="comment" size={14} /> {post.comment_count || 0}</span>
                <span style={{ marginLeft: 'auto' }}>{timeAgo(post.created_at)}</span>
              </div>
            </div>
          ))
        )}


        {activeTab === 'stats' && (
          <div>
            {leagueStats.length === 0 && tournamentStats.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 24px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 }}>
                <picture>
                  <source srcSet="/mascot-rizzo.webp" type="image/webp" />
                  <img src="/mascot-rizzo.png" alt="Rinkd Rat" width="120" height="120" style={{ display: 'block', margin: '0 auto 14px', maxWidth: '40%', height: 'auto' }} />
                </picture>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice, textTransform: 'uppercase', marginBottom: 8 }}>No stat line yet</div>
                <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.5, maxWidth: 340, margin: '0 auto' }}>
                  {isOwnProfile
                    ? 'Lace ’em up — play a league or tournament game and your goals, assists, and points light up right here.'
                    : 'No games logged yet. Check back once the season drops the puck.'}
                </div>
              </div>
            ) : (
              <>
                {/* Leagues — kept separate from Tournaments; never a blended total. */}
                {leagueStats.length > 0 && (
                  <div style={{ marginBottom: tournamentStats.length > 0 ? 22 : 0 }}>
                    <LowerThird label="League Stats" />
                    {leagueStats.map((s, i) => (
                      <StatLine key={`lg-${i}`}
                        logoColor={s.team_logo_color}
                        initials={s.team_logo_initials || s.team_name?.slice(0, 2).toUpperCase()}
                        title={`${s.team_name} · #${s.jersey_number}`}
                        subtitle={`${s.league_name}${s.season ? ` · ${s.season}` : ''}${s.division ? ` · ${s.division}` : ''}`}
                        gp={s.gp} goals={s.goals} assists={s.assists} points={s.points} pim={s.pim} />
                    ))}
                  </div>
                )}
                {/* Tournaments — own section beside Leagues. Empty for unlinked
                    players until a tournament lineup carries their user_id. */}
                {tournamentStats.length > 0 && (
                  <div>
                    <LowerThird label="Tournament Stats" />
                    {tournamentStats.map((s, i) => (
                      <StatLine key={`tn-${i}`}
                        logoColor="#2E5B8C"
                        initials={s.team_name?.slice(0, 2).toUpperCase()}
                        title={`${s.team_name} · #${s.jersey_number}`}
                        subtitle={`${s.tournament_name}${s.division ? ` · ${s.division}` : ''}`}
                        gp={s.gp} goals={s.goals} assists={s.assists} points={s.points} pim={s.pim} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {activeTab === 'activity' && (
          activity.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.steel, padding: '40px', fontSize: 14 }}>No activity yet.</div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {activity.map((a, i) => (
                <div key={`${a.kind}-${a.id}`} style={{ display: 'flex', gap: 10, padding: '12px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.2)' : 'none', alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, marginTop: 1, color: C.steel }}><Icon name={a.kind === 'post' ? 'subAlert' : 'comment'} size={18} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
                      {a.kind === 'post' ? 'Posted' : 'Commented'} · {timeAgo(a.at)}
                    </div>
                    <div style={{ fontSize: 13, color: C.ice, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {a.kind === 'post' ? (a.post.content || '(media post)') : a.comment.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === 'badges' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { icon: '🏒', label: 'First Post', earned: posts.length > 0 },
              { icon: '❤️', label: 'First Like', earned: (profile.points || 0) > 0 },
              { icon: '💬', label: 'Commentator', earned: (profile.points || 0) >= 10 },
              { icon: '⭐', label: 'Squirt', earned: (profile.points || 0) >= 100 },
              { icon: '🎯', label: 'Peewee', earned: (profile.points || 0) >= 500 },
              { icon: '🏆', label: 'Pro', earned: (profile.points || 0) >= 15000 },
            ].map(badge => (
              <div key={badge.label} style={{ background: badge.earned ? C.card : C.navy, borderRadius: 12, padding: '16px 8px', textAlign: 'center', border: `1px solid ${C.border}`, opacity: badge.earned ? 1 : 0.4 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>{badge.icon}</div>
                <div style={{ fontSize: 11, color: C.steel, fontWeight: 600 }}>{badge.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
