import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../App';
import { Avatar } from '../components/Layout';
import { TierBadge } from '../components/Logos';
import { updateProfile } from '../lib/auth';
import { getPosts } from '../lib/posts';
import { getTier, getNextTier, TIERS } from '../lib/tiers';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', dark: '#07111F', card: '#112236', card2: '#0D2A47',
  lgray: '#8BA3BE', mgray: '#4A6180', border: '#1E3A5C',
};

export default function Profile() {
  const { user, profile, setProfile } = useContext(AuthContext);
  const [tab, setTab] = useState('stats');
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userPosts, setUserPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);

  const [editBio, setEditBio] = useState(profile?.bio || '');
  const [editPosition, setEditPosition] = useState(profile?.position || '');
  const [editLevel, setEditLevel] = useState(profile?.level || '');
  const [editRink, setEditRink] = useState(profile?.home_rink || '');

  const tier = getTier(profile?.points || 0);
  const nextTier = getNextTier(profile?.points || 0);
  const ptsToNext = tier.maxPts - (profile?.points || 0) + 1;
  const progress = Math.min(((profile?.points || 0) - tier.minPts) / (tier.maxPts - tier.minPts) * 100, 100);

  useEffect(() => {
    if (tab === 'posts' && user) {
      setLoadingPosts(true);
      getPosts(50).then(all => {
        setUserPosts(all.filter(p => p.author_id === user.id));
      }).finally(() => setLoadingPosts(false));
    }
  }, [tab, user]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await updateProfile(user.id, {
        bio: editBio,
        position: editPosition,
        level: editLevel,
        home_rink: editRink,
      });
      setProfile(prev => ({ ...prev, ...updated }));
      setEditMode(false);
    } catch (err) {
      console.error('Error saving profile:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.lgray }}>Loading profile...</div>
  );

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', paddingBottom: 40 }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(160deg, ${C.blue} 0%, ${C.navy} 60%)`, padding: '40px 24px 20px', position: 'relative', borderBottom: `2px solid ${C.red}` }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 84, height: 84, borderRadius: '50%', background: profile.avatar_color, border: `4px solid ${tier.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 30, color: '#fff', boxShadow: `0 0 0 2px ${C.dark}, 0 8px 32px ${tier.color}44`, flexShrink: 0 }}>
            {profile.avatar_initials}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 26, color: '#fff' }}>{profile.name}</span>
              <TierBadge tier={tier} size="lg" />
            </div>
            <div style={{ color: C.lgray, fontSize: 12, marginBottom: 4 }}>
              @{profile.handle}
              {profile.position ? ` · ${profile.position}` : ''}
              {profile.level ? ` · ${profile.level}` : ''}
            </div>
            {profile.home_rink && <div style={{ color: C.lgray, fontSize: 12 }}>🏒 {profile.home_rink}</div>}
            {editMode ? (
              <textarea value={editBio} onChange={e => setEditBio(e.target.value)} rows={2} placeholder="Write your bio..." style={{ marginTop: 8, width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none', resize: 'none' }} />
            ) : (
              profile.bio && <div style={{ color: '#E8F4FD', fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{profile.bio}</div>
            )}
          </div>
          <button onClick={() => editMode ? saveProfile() : setEditMode(true)} style={{ background: editMode ? C.red : 'rgba(0,0,0,0.3)', border: `1px solid ${editMode ? C.red : C.border}`, borderRadius: 8, color: '#fff', padding: '8px 16px', fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 12, letterSpacing: '0.08em' }}>
            {saving ? 'SAVING...' : editMode ? 'SAVE' : '✏️ EDIT'}
          </button>
        </div>

        {/* Edit fields */}
        {editMode && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 14 }}>
            {[
              ['Position', editPosition, setEditPosition, ['Forward','Defense','Goalie','Fan / Other']],
              ['Level', editLevel, setEditLevel, ['Youth','Beer League','Junior','College','Coach','Fan']],
            ].map(([label, val, setter, opts]) => (
              <div key={label}>
                <div style={{ color: C.lgray, fontSize: 10, letterSpacing: '0.1em', fontFamily: "'Barlow Condensed'", fontWeight: 700, marginBottom: 4 }}>{label.toUpperCase()}</div>
                <select value={val} onChange={e => setter(e.target.value)} style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 12, outline: 'none' }}>
                  <option value="">Select...</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div>
              <div style={{ color: C.lgray, fontSize: 10, letterSpacing: '0.1em', fontFamily: "'Barlow Condensed'", fontWeight: 700, marginBottom: 4 }}>HOME RINK</div>
              <input value={editRink} onChange={e => setEditRink(e.target.value)} placeholder="Your rink..." style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 12, outline: 'none' }} />
            </div>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', marginTop: 16, background: 'rgba(0,0,0,0.25)', borderRadius: 10, overflow: 'hidden' }}>
          {[['POINTS', profile.points || 0], ['TIER', tier.name.toUpperCase()], ['POSTS', userPosts.length]].map(([l, v], i) => (
            <div key={l} style={{ flex: 1, padding: '10px 8px', textAlign: 'center', borderRight: i < 2 ? `1px solid rgba(255,255,255,0.1)` : 'none' }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 20, color: i === 1 ? tier.color : '#fff' }}>{v}</div>
              <div style={{ color: C.mgray, fontSize: 9, letterSpacing: '0.1em', marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px 24px' }}>
        {/* Tier progress */}
        <div style={{ background: C.card, borderRadius: 12, padding: '16px 18px', marginBottom: 16, border: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 13, color: '#fff', letterSpacing: '0.08em' }}>TIER PROGRESS</div>
              <div style={{ color: C.lgray, fontSize: 11, marginTop: 2 }}>Earn points by posting, liking & engaging</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 20, color: tier.color }}>{(profile.points || 0).toLocaleString()}</div>
              <div style={{ color: C.mgray, fontSize: 10 }}>POINTS</div>
            </div>
          </div>
          {/* All tier pips */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
            {TIERS.map((t, i) => (
              <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < tier.level ? t.color : i === tier.level - 1 ? t.color : C.border }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: C.mgray, fontSize: 9 }}>Mite</span>
            <span style={{ color: C.mgray, fontSize: 9 }}>Pro</span>
          </div>
          {/* Current tier bar */}
          <div style={{ background: C.card2, borderRadius: 4, height: 7, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${tier.color}88, ${tier.color})`, width: `${progress}%`, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: C.lgray, fontSize: 11 }}>
              <span style={{ color: tier.color, fontWeight: 700 }}>{ptsToNext.toLocaleString()} pts</span> to <span style={{ color: nextTier.color, fontWeight: 700 }}>{nextTier.name}</span>
            </span>
            {tier.disc > 0 && (
              <span style={{ background: `${tier.color}22`, border: `1px solid ${tier.color}44`, color: tier.color, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontFamily: "'Barlow Condensed'", fontWeight: 700 }}>
                {tier.disc}% MERCH DISCOUNT ACTIVE
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
          {['stats', 'posts', 'badges'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 18px', background: 'transparent', border: 'none', borderBottom: `3px solid ${tab === t ? C.red : 'transparent'}`, color: tab === t ? '#fff' : C.lgray, fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 13, letterSpacing: '0.1em', cursor: 'pointer' }}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {tab === 'stats' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[['TIER', tier.name, tier.color],['POINTS', profile.points || 0, C.blue],['DISCOUNT', tier.disc > 0 ? `${tier.disc}%` : 'None', '#22C55E']].map(([l,v,c]) => (
                <div key={l} style={{ background: C.card2, borderRadius: 10, padding: '14px', textAlign: 'center', border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 22, color: c, lineHeight: 1 }}>{v}</div>
                  <div style={{ color: C.mgray, fontSize: 10, marginTop: 4, letterSpacing: '0.08em' }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ background: C.card2, borderRadius: 10, padding: '16px', border: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13, color: '#fff', letterSpacing: '0.08em', marginBottom: 10 }}>HOW TO EARN POINTS</div>
              {[['Post content','+ 5 pts per post'],['Receive a like','+ 1 pt per like'],['Comment','+ 1 pt per comment'],['Refer a user','+ 30 pts'],['Verified league player','+ 50 pts (one-time)']].map(([a,p]) => (
                <div key={a} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.lgray, fontSize: 13 }}>{a}</span>
                  <span style={{ color: '#22C55E', fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13 }}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'posts' && (
          <div>
            {loadingPosts ? (
              <div style={{ color: C.lgray, textAlign: 'center', padding: '40px 0' }}>Loading your posts...</div>
            ) : userPosts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', background: C.card, borderRadius: 12, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🏒</div>
                <div style={{ color: C.lgray, fontSize: 14 }}>No posts yet. Hit the feed and drop something.</div>
              </div>
            ) : (
              userPosts.map(p => (
                <div key={p.id} style={{ background: C.card, borderRadius: 10, padding: '12px 14px', marginBottom: 8, border: `1px solid ${C.border}` }}>
                  <div style={{ background: TAG_COLORS[p.tag] || C.blue, display: 'inline-block', padding: '2px 8px', borderRadius: 4, marginBottom: 6 }}>
                    <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 9, color: '#fff', letterSpacing: '0.12em' }}>{p.tag}</span>
                  </div>
                  <div style={{ color: '#E8F4FD', fontSize: 13, lineHeight: 1.5 }}>{p.content}</div>
                  <div style={{ color: C.mgray, fontSize: 11, marginTop: 6 }}>🏒 {p.likes || 0} · 💬 {p.comment_count || 0}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'badges' && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {[
                { icon: '🏒', label: 'Welcome to the Ice', desc: 'Joined Rinkd', earned: true, color: C.blue },
                { icon: '📝', label: 'First Post', desc: 'Made your first post', earned: (profile.points || 0) > 50, color: '#22C55E' },
                { icon: '🔥', label: 'On a Streak', desc: '7 days active', earned: false, color: C.red },
                { icon: '🏆', label: 'Hat Trick', desc: '3 posts in one day', earned: false, color: '#F5C842' },
                { icon: '⭐', label: 'Rising Star', desc: 'Reach Squirt tier', earned: (profile.points || 0) >= 100, color: '#60A5FA' },
                { icon: '👥', label: 'Community Player', desc: 'Leave 10 comments', earned: false, color: '#8B5CF6' },
              ].map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: b.earned ? C.card : C.card2, borderRadius: 10, padding: '10px 14px', border: `1px solid ${b.earned ? b.color + '44' : C.border}`, opacity: b.earned ? 1 : 0.5, flex: '1 1 200px' }}>
                  <span style={{ fontSize: 22 }}>{b.icon}</span>
                  <div>
                    <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13, color: b.earned ? '#fff' : C.lgray }}>{b.label}</div>
                    <div style={{ color: C.mgray, fontSize: 11 }}>{b.desc}</div>
                  </div>
                  {b.earned && <span style={{ marginLeft: 'auto', color: '#22C55E', fontSize: 14 }}>✓</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const TAG_COLORS = { 'GOAL ALERT':'#D72638','HIGHLIGHT':'#2E5B8C','GAME RECAP':'#22C55E','BEER LEAGUE':'#F59E0B','COACH\'S CORNER':'#60A5FA','QUESTION':'#8B5CF6','TRADE REQUEST':'#F97316','RINKSIDE':'#2E5B8C','POST':'#2E5B8C' };
