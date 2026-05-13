import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from './Logos';
import { followUser } from '../lib/posts';
import { subscribeToPush } from '../lib/push';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

const ROLES = [
  { id: 'player',         icon: '🏒', label: 'Player',         body: 'I play in a league or pickup' },
  { id: 'coach',          icon: '🎯', label: 'Coach / Manager', body: 'I run a team or bench' },
  { id: 'parent',         icon: '👨‍👧', label: 'Hockey Parent',  body: 'I follow my kid\'s team' },
  { id: 'fan',            icon: '📺', label: 'Fan',            body: 'I follow the game' },
];

const btnPrimary = {
  background: C.red, color: '#fff', border: 'none', padding: '12px 24px',
  borderRadius: 999, cursor: 'pointer',
  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
  fontSize: 14, letterSpacing: '0.05em', textTransform: 'uppercase',
};
const btnGhost = {
  background: 'transparent', color: C.steel, border: `1px solid ${C.border}`,
  padding: '10px 20px', borderRadius: 999, cursor: 'pointer',
  fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600,
};

/**
 * First-run onboarding for new signups. Three steps:
 *   1. Choose role → writes to profiles.position when it's a recognised one,
 *      otherwise stored in metadata.
 *   2. Discover players to follow → optional, follows happen inline.
 *   3. Enable push notifications → optional, gracefully skipped if denied.
 * Always closes by setting profiles.welcome_seen = true so it never reappears.
 */
export default function OnboardingModal({ currentUser, profile, onClose, onProfileUpdate }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [chosenRole, setChosenRole] = useState(null);
  const [suggested, setSuggested] = useState([]);
  const [followingMap, setFollowingMap] = useState({});
  const [pushBusy, setPushBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => { track('onboarding_started'); }, []);

  useEffect(() => {
    // Step 2 needs suggestions — load 6 random-ish players that aren't the user.
    if (step !== 1 || suggested.length) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name, handle, position, avatar_color, avatar_initials, tier')
        .neq('id', currentUser?.id || '')
        .order('points', { ascending: false, nullsFirst: false })
        .limit(6);
      setSuggested(data || []);
    })();
  }, [step, suggested.length, currentUser]);

  const clearPendingFlag = () => {
    // Clear the race-fix sessionStorage flag set by Auth.js on signup.
    // Safe to call from finish() or skip() — idempotent.
    try { sessionStorage.removeItem('rinkd_pending_onboarding'); } catch (_) {}
  };

  const finish = async () => {
    setClosing(true);
    clearPendingFlag();
    try {
      await supabase
        .from('profiles')
        .update({ welcome_seen: true, onboarding_completed_at: new Date().toISOString() })
        .eq('id', currentUser.id);
      // profile may still be null if we mounted via the race-fix path before
      // the profile fetch returned — spread-of-null is fine.
      onProfileUpdate?.({ ...(profile || {}), welcome_seen: true });
      track('onboarding_completed', { role: chosenRole });
    } catch { /* don't block close */ }
    onClose?.();
  };

  const handleSkip = () => {
    track('onboarding_skipped', { at_step: step });
    clearPendingFlag();
    finish();
  };

  const handleRoleNext = async () => {
    if (chosenRole) {
      // Map onboarding role onto profiles.position when it lines up. Otherwise
      // we still record it in analytics — that's enough for now.
      const positionMap = { player: 'Forward', coach: 'Coach', parent: 'Parent', fan: 'Fan' };
      const pos = positionMap[chosenRole];
      if (pos) {
        await supabase.from('profiles').update({ position: pos }).eq('id', currentUser.id);
        // Only do the optimistic state update if profile is already loaded —
        // otherwise spreading null overwrites the full profile with just
        // { position }, losing every other field. The next profile fetch
        // will pick up the new position regardless.
        if (profile) {
          onProfileUpdate?.({ ...profile, position: pos });
        }
      }
      track('onboarding_role_chosen', { role: chosenRole });
    }
    setStep(1);
  };

  const toggleFollow = async (uid) => {
    if (followingMap[uid]) return;
    setFollowingMap((m) => ({ ...m, [uid]: true }));
    await followUser(currentUser.id, uid);
    track('onboarding_follow', { target_user_id: uid });
  };

  const handleEnablePush = async () => {
    setPushBusy(true);
    const sub = await subscribeToPush(currentUser.id);
    setPushBusy(false);
    track(sub ? 'onboarding_push_enabled' : 'onboarding_push_declined');
    finish();
  };

  if (closing) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(7,17,31,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      fontFamily: 'Barlow, sans-serif',
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        width: '100%', maxWidth: 480, color: C.ice,
        boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 999, background: i <= step ? C.red : C.border, transition: 'all 0.2s' }} />
            ))}
          </div>
          <button onClick={handleSkip} style={{ background: 'transparent', color: C.steel, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Skip for now</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          {step === 0 && (
            <>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
                fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 8,
              }}>
                Welcome to <span style={{ color: C.red }}>Rinkd</span> 🏒
              </div>
              <div style={{ fontSize: 14, color: C.steel, marginBottom: 20, lineHeight: 1.55 }}>
                Built for everyone in the hockey community — players, parents, coaches, fans. Three quick questions and you're in.
              </div>
              <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
                What brings you here?
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 4 }}>
                {ROLES.map((r) => (
                  <button key={r.id} onClick={() => setChosenRole(r.id)}
                    style={{
                      background: chosenRole === r.id ? 'rgba(215,38,56,0.15)' : C.navy,
                      border: `1px solid ${chosenRole === r.id ? C.red : C.border}`,
                      color: C.ice, padding: 14, borderRadius: 12, cursor: 'pointer',
                      textAlign: 'left', fontFamily: 'Barlow, sans-serif', transition: 'all 0.15s',
                    }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{r.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: C.steel, lineHeight: 1.4 }}>{r.body}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 26, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 8 }}>
                Find your people
              </div>
              <div style={{ fontSize: 14, color: C.steel, marginBottom: 18, lineHeight: 1.55 }}>
                Follow a few players to start building your feed. You can always add more from the Discover tab.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {suggested.length === 0 ? (
                  <div style={{ color: C.steel, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading suggestions…</div>
                ) : suggested.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: C.navy, borderRadius: 10, border: `1px solid ${C.border}` }}>
                    <Avatar profile={p} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: C.ice, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: C.steel }}>@{p.handle}{p.position ? ` · ${p.position}` : ''}</div>
                    </div>
                    <button onClick={() => toggleFollow(p.id)}
                      disabled={!!followingMap[p.id]}
                      style={{
                        background: followingMap[p.id] ? 'transparent' : C.red,
                        color: followingMap[p.id] ? C.steel : '#fff',
                        border: followingMap[p.id] ? `1px solid ${C.border}` : 'none',
                        padding: '6px 14px', borderRadius: 999, cursor: followingMap[p.id] ? 'default' : 'pointer',
                        fontSize: 12, fontWeight: 700, fontFamily: 'Barlow, sans-serif',
                      }}>
                      {followingMap[p.id] ? 'Following ✓' : 'Follow'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 26, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 8 }}>
                Never miss a puck drop
              </div>
              <div style={{ fontSize: 14, color: C.steel, marginBottom: 20, lineHeight: 1.55 }}>
                Turn on notifications and we'll ping you 24 hours before your team's next game, when a teammate replies, or when your roster needs you.
              </div>
              <div style={{ background: C.navy, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 18 }}>
                {[
                  '⏰ Game reminders 24 hours out',
                  '💬 Comments and replies',
                  '🏒 Roster + RSVP requests',
                ].map((line) => (
                  <div key={line} style={{ fontSize: 13, color: C.ice, padding: '5px 0' }}>{line}</div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.steel, lineHeight: 1.5 }}>
                You can change this anytime from your profile.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          {step > 0 ? (
            <button onClick={() => setStep((s) => s - 1)} style={btnGhost}>← Back</button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 0 && (
              <button onClick={handleRoleNext} disabled={!chosenRole} style={{ ...btnPrimary, opacity: chosenRole ? 1 : 0.45, cursor: chosenRole ? 'pointer' : 'not-allowed' }}>
                Continue →
              </button>
            )}
            {step === 1 && (
              <>
                <button onClick={() => setStep(2)} style={btnGhost}>Skip</button>
                <button onClick={() => setStep(2)} style={btnPrimary}>Continue →</button>
              </>
            )}
            {step === 2 && (
              <>
                <button onClick={finish} style={btnGhost}>Not now</button>
                <button onClick={handleEnablePush} disabled={pushBusy} style={btnPrimary}>
                  {pushBusy ? 'Enabling…' : '🔔 Enable & Finish'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
