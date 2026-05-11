import React, { useState, useEffect, useCallback } from 'react';
import { subscribeToPush, isPushSubscribed } from '../lib/push';
import Layout, { BRAND_COLORS as C } from '../components/Layout';
import { Avatar, TierBadge } from '../components/Logos';
import { updateProfile } from '../lib/auth';
import { getTier, getTierProgress, getNextTier, TIERS } from '../lib/tiers';
import { supabase } from '../lib/supabase';
import { getPlayerLeagueStats } from '../lib/stats';
import { useParams } from 'react-router-dom';
import { followUser, unfollowUser, isFollowing, getFollowCounts, timeAgo } from '../lib/posts';
import MapLink from '../components/MapLink';

const POSITIONS = ['Forward', 'Defense', 'Goalie', 'Coach', 'Parent', 'Official', 'Fan'];
const LEVELS = ['Youth (Mite-Bantam)', 'Youth (Midget)', 'High School', 'Junior (Tier I)', 'Junior (Tier II/III)', 'College', 'Minor Pro', 'Beer League', 'Adult Rec', 'Fan'];

export default function Profile({ currentUser, profile: myProfile, onProfileUpdate }) {
  const { userId: urlUserId } = useParams();
  const [profile, setProfile] = useState(myProfile);
  const [posts, setPosts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [activeTab, setActiveTab] = useState('posts');
  const [following, setFollowing] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [followLoading, setFollowLoading] = useState(false);
  const [leagueStats, setLeagueStats] = useState([]);

  const [editName, setEditName] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editLevel, setEditLevel] = useState('');
  const [editRink, setEditRink] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    isPushSubscribed().then(setPushEnabled);
  }, []);

  const handleEnableNotifications = async () => {
    setPushLoading(true);
    const sub = await subscribeToPush(currentUser?.id);
    setPushEnabled(!!sub);
    setPushLoading(false);
    if (!sub) alert('Could not enable notifications. Please check your browser settings.');
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
      const { data } = await supabase.from('posts').select('*').eq('author_id', profileId).order('created_at', { ascending: false });
      const stats = await getPlayerLeagueStats(profileId);
      setLeagueStats(stats);
      setPosts(data || []);
      const counts = await getFollowCounts(profileId);
      setFollowCounts(counts);
      if (!isOwnProfile && currentUser) {
        const f = await isFollowing(currentUser.id, profileId);
        setFollowing(f);
      }
    }
  }, [profileId, isOwnProfile, myProfile, currentUser]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleFollow = async () => {
    if (!currentUser || isOwnProfile) return;
    setFollowLoading(true);
    if (following) {
      await unfollowUser(currentUser.id, profileId);
      setFollowing(false);
      setFollowCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) }));
    } else {
      await followUser(currentUser.id, profileId);
      setFollowing(true);
      setFollowCounts(c => ({ ...c, followers: c.followers + 1 }));
    }
    setFollowLoading(false);
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
    const updated = data || { ...profile, ...updates };
    setProfile(updated);
    if (onProfileUpdate) onProfileUpdate(updated);
    setEditing(false);
  };

  if (!profile) return <Layout profile={myProfile}><div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div style={{ color: C.steel }}>Loading...</div></div></Layout>;

  const tier = getTier(profile.points || 0);
  const progress = getTierProgress(profile.points || 0);
  const nextTier = getNextTier(profile.points || 0);

  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: C.steel, marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" };
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, background: '#080F1C', border: `1.5px solid ${C.border}`, color: C.ice, fontSize: 14, outline: 'none', fontFamily: "'Barlow', sans-serif", boxSizing: 'border-box' };

  return (
    <Layout profile={myProfile}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ height: 100, background: `linear-gradient(135deg, ${C.navy} 0%, ${tier.color}33 50%, ${C.navy} 100%)`, borderBottom: `1px solid ${C.border}`, position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: -28, left: 20 }}>
              <Avatar profile={profile} size={64} />
            </div>
          </div>
          <div style={{ padding: '36px 20px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 26, color: C.ice, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{profile.name}</div>
                <div style={{ fontSize: 13, color: C.steel }}>@{profile.handle}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <TierBadge tier={tier.name} size="md" />
                {isOwnProfile && !editing && (
                  <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={openEdit} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1.5px solid ${C.border}`, color: C.ice, fontFamily: "'Barlow', sans-serif", fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Edit</button>
                  {!pushEnabled && (
                    <button onClick={handleEnableNotifications} disabled={pushLoading} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1.5px solid #2E5B8C`, color: '#8BA3BE', fontFamily: "'Barlow', sans-serif", fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      {pushLoading ? '...' : '🔔 Notify'}
                    </button>
                  )}
                  {pushEnabled && (
                    <span style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(46,91,140,0.2)', border: '1px solid #2E5B8C', color: '#8BA3BE', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>🔔 On</span>
                  )}
                  </div>
                )}
                {!isOwnProfile && (
                  <button onClick={handleFollow} disabled={followLoading} style={{
                    padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: following ? C.border : C.red, color: 'white',
                    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14,
                    letterSpacing: '0.05em',
                  }}>{followLoading ? '...' : following ? 'Following' : 'Follow'}</button>
                )}
              </div>
            </div>

            {/* Follow counts */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: C.steel }}><strong style={{ color: C.ice }}>{followCounts.followers}</strong> Followers</span>
              <span style={{ fontSize: 13, color: C.steel }}><strong style={{ color: C.ice }}>{followCounts.following}</strong> Following</span>
            </div>

            {profile.bio && !editing && <p style={{ color: C.ice, fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>{profile.bio}</p>}
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
                  <div><label style={labelStyle}>Username</label><input value={editHandle} onChange={e => setEditHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} required maxLength={40} style={inputStyle}/></div>
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

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          {[['Posts', posts.length], ['Points', (profile.points || 0).toLocaleString()], ['Tier', tier.name]].map(([label, value]) => (
            <div key={label} style={{ background: C.card, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}`, textAlign: 'center' }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 26, color: C.ice, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Tier Progress */}
        <div style={{ background: C.card, borderRadius: 14, padding: '16px', border: `1px solid ${C.border}`, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: C.ice, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Tier Progress</span>
            <span style={{ fontSize: 12, color: C.steel }}>{nextTier ? `${(nextTier.min - (profile.points || 0)).toLocaleString()} pts to ${nextTier.name}` : 'Max Tier'}</span>
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
          {[{ id: 'posts', label: 'Posts' }, { id: 'stats', label: 'Stats' }, { id: 'badges', label: 'Badges' }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: '8px', borderRadius: 7, border: 'none', background: activeTab === t.id ? C.blue : 'transparent', color: activeTab === t.id ? C.ice : C.steel, fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{t.label}</button>
          ))}
        </div>

        {activeTab === 'posts' && (
          posts.length === 0 ? <div style={{ textAlign: 'center', color: C.steel, padding: '40px', fontSize: 14 }}>No posts yet.</div>
          : posts.map(post => (
            <div key={post.id} style={{ background: C.card, borderRadius: 12, padding: '14px 16px', border: `1px solid ${C.border}`, marginBottom: 10 }}>
              {post.tag && <span style={{ display: 'inline-block', marginBottom: 8, fontSize: 10, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 4, background: (post.tag_color || C.blue) + '22', color: post.tag_color || C.blue }}>{post.tag}</span>}
              {post.content && <p style={{ fontSize: 14, color: C.ice, lineHeight: 1.5, marginBottom: 8 }}>{post.content}</p>}
              {post.media_url && (
                post.media_type === 'video'
                  ? <video src={post.media_url} controls style={{ width: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 8 }}/>
                  : <img src={post.media_url} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}/>
              )}
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.steel }}>
                <span>❤️ {post.likes || 0}</span>
                <span>💬 {post.comment_count || 0}</span>
                <span style={{ marginLeft: 'auto' }}>{timeAgo(post.created_at)}</span>
              </div>
            </div>
          ))
        )}


        {activeTab === 'stats' && (
          <div>
            {leagueStats.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.steel, padding: '40px', fontSize: 14 }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>🏒</div>
                No league stats yet. Play in a league to see your stats here.
              </div>
            ) : leagueStats.map((s, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px', marginBottom: 12 }}>
                {/* League + team header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: s.team_logo_color || '#2E5B8C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: '#fff', flexShrink: 0 }}>
                    {s.team_logo_initials || s.team_name?.slice(0,2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>{s.team_name} · #{s.jersey_number}</div>
                    <div style={{ fontSize: 11, color: C.steel, marginTop: 2 }}>{s.league_name}{s.season ? ` · ${s.season}` : ''}{s.division ? ` · ${s.division}` : ''}</div>
                  </div>
                </div>
                {/* Stat grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                  {[['GP', s.gp], ['G', s.goals], ['A', s.assists], ['PTS', s.points], ['PIM', s.pim]].map(([label, val]) => (
                    <div key={label} style={{ background: '#07111F', borderRadius: 8, padding: '10px 0', textAlign: 'center' }}>
                      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: label === 'PTS' ? 22 : 18, color: label === 'PTS' ? '#D72638' : C.ice, lineHeight: 1 }}>{val}</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
