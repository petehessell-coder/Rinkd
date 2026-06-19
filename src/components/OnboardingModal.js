import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Avatar } from './Logos';
import { followUser } from '../lib/posts';
import { subscribeToPush } from '../lib/push';
import { track } from '../lib/analytics';
import { Icon } from './ui';

const C = {
  navy: '#0B1F3A', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

// Locker Room → Tunnel → Ice (DESIGN_MANIFESTO "Onboarding Narrative").
// The locker-room photo sits BEHIND the onboarding steps; the tunnel plays once
// on first finish and is gated by localStorage so it never becomes a loading
// screen. These are the optimized assets (~200–500KB) served from /public.
const LOCKER_IMG = '/onboarding-locker-room.jpg';
const TUNNEL_IMG = '/onboarding-tunnel.jpg';
const TUNNEL_SEEN_KEY = 'rinkd_tunnel_seen';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ONBOARD-1 (May 28, 2026): the role chooser writes to `profiles.persona`
// — the new segmentation column added in ENRICH-1. IDs MUST match the
// persona CHECK constraint: ('player','parent','coach','commissioner',
// 'official','fan'). Order matters — most-common picks first.
const ROLES = [
  { id: 'player',       icon: 'player',       label: 'Player',          body: 'I play in a league or pickup' },
  { id: 'coach',        icon: 'coach',        label: 'Coach / Manager',  body: 'I run a team or bench' },
  { id: 'parent',       icon: 'parent',       label: 'Hockey Parent', body: "I follow my kid's team" },
  { id: 'commissioner', icon: 'commissioner', label: 'Commissioner',     body: 'I run a league or tournament' },
  { id: 'official',     icon: 'official',     label: 'Official',         body: 'I officiate games' },
  { id: 'fan',          icon: 'fan',          label: 'Fan',              body: 'I follow the game' },
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
 * The Tunnel — plays once on first finish. A still tunnel photo (the manifesto's
 * sanctioned fallback when no video asset exists) pushes forward: a slow zoom
 * with brightness lifting toward the light, then a white flash that hands off to
 * the feed. Pure inline CSS transitions (no @keyframes). Self-cleans its timers.
 *
 * Timeline:
 *   0ms     start zoom (2500ms ease-in)
 *   2500ms  white overlay begins fading in (400ms)
 *   2900ms  white fully covers → onReveal() (App starts the feed rising behind the white)
 *   2980ms  onDone() → modal unmounts, feed rises into the now-cleared white
 */
function TunnelOutro({ src, onReveal, onDone }) {
  const [zoom, setZoom] = useState(false);
  const [white, setWhite] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setZoom(true));
    const tWhite = setTimeout(() => setWhite(true), 2500);
    const tReveal = setTimeout(() => { revealRef.current?.(); }, 2900);
    const tDone = setTimeout(() => { doneRef.current?.(); }, 2980);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(tWhite); clearTimeout(tReveal); clearTimeout(tDone);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, overflow: 'hidden', background: C.dark, perspective: 1000 }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center',
        transform: zoom ? 'translateZ(20px) scale(1.08)' : 'translateZ(0px) scale(1.0)',
        filter: zoom ? 'brightness(1.3)' : 'brightness(1)',
        transition: 'transform 2500ms ease-in, filter 2500ms ease-in',
        willChange: 'transform, filter',
      }} />
      <div style={{
        position: 'absolute', inset: 0, background: '#fff', pointerEvents: 'none',
        opacity: white ? 1 : 0, transition: 'opacity 400ms ease-in',
      }} />
    </div>
  );
}

/**
 * First-run onboarding for new signups. Three steps:
 *   1. Choose role → writes to profiles.persona (segmentation column).
 *   2. Discover players to follow → optional, follows happen inline.
 *   3. Enable push notifications → optional, gracefully skipped if denied.
 * Always closes by setting profiles.welcome_seen = true so it never reappears.
 *
 * Visual: the three steps sit over a full-bleed locker-room photo; finishing
 * (by ANY path — finish or skip) earns the one-time tunnel cinematic.
 */
export default function OnboardingModal({ currentUser, profile, onClose, onProfileUpdate, onReveal }) {
  const [step, setStep] = useState(0);
  const [chosenRole, setChosenRole] = useState(null);
  const [suggested, setSuggested] = useState([]);
  // false until the suggestions query resolves — so the skeleton can't shimmer
  // forever if it returns empty (or errors); we show an invitation instead.
  const [suggestLoaded, setSuggestLoaded] = useState(false);
  const [followingMap, setFollowingMap] = useState({});
  const [pushBusy, setPushBusy] = useState(false);
  // 'loading' | 'ready' | 'failed' — gates whether the tunnel may play.
  const [tunnelStatus, setTunnelStatus] = useState('loading');
  const [outro, setOutro] = useState(false);

  useEffect(() => { track('onboarding_started'); }, []);

  // Preload the tunnel image while the user works the locker-room steps, so the
  // cinematic never opens on a gray box. If it can't decode in time (or errors),
  // we skip the tunnel entirely rather than show a half-loaded frame.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setTunnelStatus('ready');
    img.onerror = () => setTunnelStatus('failed');
    img.src = TUNNEL_IMG;
  }, []);

  useEffect(() => {
    // Step 2 suggestions. Two rules: (1) lead with the community/seed accounts
    // (Pete, The BLPA, Howie) — same set the auto-follow trigger uses; (2) NEVER
    // suggest demo accounts (`@demo.rinkd.app`, seeded with points=50 so they used
    // to dominate the old order-by-points query — the thing real pilot signups saw).
    // We filter on `email` without selecting it, so no addresses reach the client.
    if (step !== 1 || suggested.length) return;
    const SEED_EMAILS = ['pete@rinkd.app', 'nick@blpa.com', 'howard@cemented.ca'];
    const COLS = 'id, name, handle, position, avatar_color, avatar_initials, tier';
    const self = currentUser?.id || '';
    (async () => {
      try {
        const [seedRes, fillRes] = await Promise.all([
          supabase.from('profiles').select(COLS).in('email', SEED_EMAILS).neq('id', self),
          supabase.from('profiles').select(COLS).neq('id', self)
            .not('email', 'ilike', '%@demo.rinkd.app')
            .order('points', { ascending: false, nullsFirst: false })
            .limit(8),
        ]);
        const seen = new Set();
        const merged = [];
        for (const p of [...(seedRes.data || []), ...(fillRes.data || [])]) {
          if (p && !seen.has(p.id)) { seen.add(p.id); merged.push(p); }
        }
        setSuggested(merged.slice(0, 6));
      } finally {
        setSuggestLoaded(true);
      }
    })();
  }, [step, suggested.length, currentUser]);

  const clearPendingFlag = () => {
    // Clear the race-fix sessionStorage flag set by Auth.js on signup.
    // Safe to call from finish() or skip() — idempotent.
    try { sessionStorage.removeItem('rinkd_pending_onboarding'); } catch (_) {}
  };

  // Flip local app state (this unmounts the modal) and close. Deferred until the
  // tunnel finishes — flipping welcome_seen earlier would drop showOnboarding to
  // false in App.js and yank the tunnel out from under itself mid-play.
  const closeOut = () => {
    onProfileUpdate?.({
      ...(profile || {}),
      welcome_seen: true,
      ...(chosenRole ? { profile_complete: true, persona: chosenRole } : {}),
    });
    onClose?.();
  };

  // Persist completion to the DB. Fired in the background the instant the outro
  // starts so the cinematic never waits on a network round-trip.
  const persist = async () => {
    try {
      // ENRICH-1 + ONBOARD-1: flip profile_complete = true only if the user
      // actually picked a persona. If they skipped the role step, leave it false
      // so the dismissible Feed banner keeps nudging them.
      const updates = {
        welcome_seen: true,
        onboarding_completed_at: new Date().toISOString(),
      };
      if (chosenRole) updates.profile_complete = true;
      await supabase
        .from('profiles')
        .update(updates)
        .eq('id', currentUser.id);
      track('onboarding_completed', { role: chosenRole, profile_complete: !!chosenRole });
    } catch { /* don't block close */ }
  };

  // Decide between the cinematic and an instant close. The tunnel plays only on
  // the very first finish (localStorage gate), with motion enabled, and only if
  // the image actually decoded. Otherwise we close straight to the feed.
  const startOutro = () => {
    let seen = false;
    try { seen = localStorage.getItem(TUNNEL_SEEN_KEY) === '1'; } catch (_) {}
    if (seen || prefersReducedMotion() || tunnelStatus !== 'ready') {
      closeOut();
      return;
    }
    try { localStorage.setItem(TUNNEL_SEEN_KEY, '1'); } catch (_) {}
    track('onboarding_tunnel_played');
    setOutro(true);
  };

  // Any exit path that ends onboarding routes through here. Finishing OR skipping
  // earns the tunnel (Pete's call: skipping still earns the ice).
  const finish = () => {
    clearPendingFlag();
    persist();        // background — don't await
    startOutro();     // tunnel or instant close
  };

  const handleSkip = () => {
    track('onboarding_skipped', { at_step: step });
    finish();
  };

  const handleRoleNext = async () => {
    if (chosenRole) {
      // Write the chosen role to `profiles.persona` (NOT `profiles.position`).
      // Position is on-ice (Forward/Defense/Goalie); persona is who-am-I-in-hockey.
      await supabase.from('profiles').update({ persona: chosenRole }).eq('id', currentUser.id);
      // Only optimistic-update if profile is already loaded — otherwise spreading
      // null would overwrite the full profile with just { persona }.
      if (profile) {
        onProfileUpdate?.({ ...profile, persona: chosenRole });
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

  // The tunnel takes over the whole viewport once it starts.
  if (outro) {
    return <TunnelOutro src={TUNNEL_IMG} onReveal={onReveal} onDone={closeOut} />;
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Safe-area insets so the centered card never tucks under the notch or
      // the home indicator when its content runs tall.
      padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px))',
      fontFamily: 'Barlow, sans-serif', overflow: 'hidden',
    }}>
      {/* Locker room — full-bleed photograph behind everything (manifesto: the UI
          sits ON the photo, not in front of a generic dark background). */}
      <div style={{
        position: 'fixed', inset: 0,
        backgroundImage: `url(${LOCKER_IMG})`, backgroundSize: 'cover', backgroundPosition: 'center',
      }} />
      {/* Readability overlay so the white type holds over any frame of the photo. */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.65)' }} />

      {/* Content column — sits over the photo, no competing card surface. */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 480, color: C.ice,
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '0 4px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 999, background: i <= step ? C.red : C.border, transition: 'all 0.2s' }} />
            ))}
          </div>
          <button onClick={handleSkip} style={{ background: 'transparent', color: C.ice, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: 0.85 }}>Skip for now</button>
        </div>

        {/* Body */}
        <div style={{ padding: '4px 4px 0' }}>
          {step === 0 && (
            <>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
                fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 8,
                textShadow: '0 2px 12px rgba(0,0,0,0.6)',
              }}>
                Welcome to <span style={{ color: C.red }}>Rinkd</span> 🏒
              </div>
              <div style={{ fontSize: 14, color: C.ice, opacity: 0.9, marginBottom: 20, lineHeight: 1.55, textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>
                Built for everyone in the hockey community — players, parents, coaches, fans. Three quick questions and you're in.
              </div>
              <div style={{ fontSize: 11, color: C.ice, opacity: 0.8, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
                What brings you here?
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 4 }}>
                {ROLES.map((r) => (
                  <button key={r.id} onClick={() => setChosenRole(r.id)}
                    style={{
                      background: chosenRole === r.id ? 'rgba(215,38,56,0.22)' : 'rgba(11,31,58,0.82)',
                      border: `1px solid ${chosenRole === r.id ? C.red : C.border}`,
                      color: C.ice, padding: 14, borderRadius: 12, cursor: 'pointer',
                      textAlign: 'left', fontFamily: 'Barlow, sans-serif', transition: 'all 0.15s',
                      backdropFilter: 'blur(2px)',
                    }}>
                    <div style={{ marginBottom: 6 }}><Icon name={r.icon} size={24} color={chosenRole === r.id ? C.red : C.ice} /></div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: C.steel, lineHeight: 1.4 }}>{r.body}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 26, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 8, textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
                Find your people
              </div>
              <div style={{ fontSize: 14, color: C.ice, opacity: 0.9, marginBottom: 18, lineHeight: 1.55, textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>
                Follow a few players to start building your feed. You can always add more from the Discover tab.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {suggested.length === 0 ? (suggestLoaded ? (
                  <div style={{ color: C.ice, opacity: 0.85, fontSize: 13, lineHeight: 1.55, padding: '16px 14px', background: 'rgba(11,31,58,0.82)', borderRadius: 10, border: `1px solid ${C.border}`, backdropFilter: 'blur(2px)', textAlign: 'center' }}>
                    We’ll surface players to follow as your rink fills up — you can always find people from the Discover tab.
                  </div>
                ) : (
                  <>
                    {/* Geometric skeleton matching the follow-row exactly (avatar
                        + name + handle + Follow pill) — never a spinner or
                        "Loading…" text (DESIGN_MANIFESTO: Period Intermission). */}
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(11,31,58,0.82)', borderRadius: 10, border: `1px solid ${C.border}`, backdropFilter: 'blur(2px)' }}>
                        <div className="rinkd-ob-sk" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="rinkd-ob-sk" style={{ width: '52%', height: 11, borderRadius: 4, marginBottom: 6 }} />
                          <div className="rinkd-ob-sk" style={{ width: '32%', height: 9, borderRadius: 4 }} />
                        </div>
                        <div className="rinkd-ob-sk" style={{ width: 72, height: 28, borderRadius: 999, flexShrink: 0 }} />
                      </div>
                    ))}
                    <style>{`.rinkd-ob-sk{background:rgba(46,91,140,0.32);animation:rinkdObPulse 1.3s ease-in-out infinite}@keyframes rinkdObPulse{0%,100%{opacity:1}50%{opacity:0.5}}@media (prefers-reduced-motion:reduce){.rinkd-ob-sk{animation:none}}`}</style>
                  </>
                )) : suggested.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(11,31,58,0.82)', borderRadius: 10, border: `1px solid ${C.border}`, backdropFilter: 'blur(2px)' }}>
                    <Avatar profile={p} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: C.ice, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{p.handle}{p.position ? ` · ${p.position}` : ''}</div>
                    </div>
                    <button onClick={() => toggleFollow(p.id)}
                      disabled={!!followingMap[p.id]}
                      style={{
                        background: followingMap[p.id] ? 'transparent' : C.red,
                        color: followingMap[p.id] ? C.steel : '#fff',
                        border: followingMap[p.id] ? `1px solid ${C.border}` : 'none',
                        padding: '6px 14px', borderRadius: 999, cursor: followingMap[p.id] ? 'default' : 'pointer',
                        fontSize: 12, fontWeight: 700, fontFamily: 'Barlow, sans-serif', flex: '0 0 auto',
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
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 26, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 8, textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
                Never miss a puck drop
              </div>
              <div style={{ fontSize: 14, color: C.ice, opacity: 0.9, marginBottom: 20, lineHeight: 1.55, textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>
                Turn on notifications and we'll ping you 24 hours before your team's next game, when a teammate replies, or when your roster needs you.
              </div>
              <div style={{ background: 'rgba(11,31,58,0.82)', border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 18, backdropFilter: 'blur(2px)' }}>
                {[
                  { icon: 'gameReminder', text: 'Game reminders 24 hours out' },
                  { icon: 'comment', text: 'Comments and replies' },
                  { icon: 'rosterRequest', text: 'Roster + RSVP requests' },
                ].map((line) => (
                  <div key={line.text} style={{ fontSize: 13, color: C.ice, padding: '5px 0', display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Icon name={line.icon} size={16} color={C.steel} />{line.text}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.ice, opacity: 0.8, lineHeight: 1.5 }}>
                You can change this anytime from your profile.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '18px 4px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
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
                <button onClick={handleEnablePush} disabled={pushBusy} style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {pushBusy ? 'Enabling…' : <><Icon name="bell" size={15} color="#fff" />Enable &amp; Finish</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
