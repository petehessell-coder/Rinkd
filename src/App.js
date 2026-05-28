import React, { useState, useEffect } from 'react';
import { AuthContext, useAuth } from './lib/authContext';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { getProfile, ensureProfileForUser, touchLastSeen } from './lib/auth';
import Auth from './pages/Auth';
import Feed from './pages/Feed';
import Profile from './pages/Profile';
import Rinkside from './pages/Rinkside';
import Crease from './pages/Crease';
import CreaseShow from './pages/CreaseShow';
import CreaseEpisode from './pages/CreaseEpisode';
import Survey from './pages/Survey';
import RinksideArticle from './pages/RinksideArticle';
import RinksideEditor from './pages/RinksideEditor';
import Leagues from './pages/Leagues';
import Store from './pages/Store';
import Legal from './pages/Legal';
import Discover from './pages/Discover';
import Tournament from './pages/Tournament';
import Tournaments from './pages/Tournaments';
import TournamentCreate from './pages/TournamentCreate';
import TournamentManage from './pages/TournamentManage';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminActivations from './pages/AdminActivations';
import AdminFeedback from './pages/AdminFeedback';
import AdminModeration from './pages/AdminModeration';
import Settings from './pages/Settings';
import Landing from './pages/Landing';
import Pricing from './pages/Pricing';
import { setSentryUser } from './lib/sentry';
import Notifications from './pages/Notifications';
import OnboardingModal from './components/OnboardingModal';
import ErrorBoundary from './components/ErrorBoundary';
import ResetPassword from './pages/ResetPassword';
import Teams from './pages/Teams';
import League from './pages/League';
import LeagueManage from './pages/LeagueManage';
import LeagueCreate from './pages/LeagueCreate';
import LeagueRegister from './pages/LeagueRegister';
import TournamentRegister from './pages/TournamentRegister';
import AcceptTeamInvite from './pages/AcceptTeamInvite';
import Team from './pages/Team';
import TeamManage from './pages/TeamManage';
import ScorerView from './pages/ScorerView';
import GameDetail from './pages/GameDetail';
import { DuesTrackerPage } from './pages/ComingSoon';
import AdminPanel from './pages/AdminPanel';
import VolunteerCoordinator from './pages/VolunteerCoordinator';
import NotFound from './pages/NotFound';

// AuthContext + useAuth live in ./lib/authContext so leaf components can
// consume them without creating a circular import back to App.js. Re-exported
// here for backwards compatibility with any future caller that grabs them
// from the App module.
export { AuthContext, useAuth };

// Coin-flip loading mark — half the time you see the LED R, half the time
// Rizzo the Rinkd Rat. The mascot is intentionally a delight moment, not the
// primary logo, so we keep the LED R as the 50/50 fallback. Pinning the choice
// in a module-level constant means it only flips on full app reloads, not on
// every render of ProtectedRoute (which would cause the icon to flash mid-load).
// WebP shaves Rizzo from 1.7MB (original) → 78KB (95.5% smaller). PNG fallback
// is still in /public/mascot-rizzo.png at 420KB for the unlikely case of a
// browser that can't decode WebP (Safari 13 and older — sub-1% in 2026).
const LOADING_MARK = Math.random() < 0.5
  ? { src: '/mascot-rizzo.webp', alt: 'Rinkd Rat', size: 96, borderRadius: 0 }
  : { src: '/icon-192.png',      alt: 'Rinkd',     size: 72, borderRadius: 16 };

// Small wrapper: reads ?returnTo from the URL with the same safety check
// Auth.js uses (must start with single "/" — no protocol, no //), then
// redirects there. Falls back to /feed when missing or unsafe.
function LoginRedirect() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('returnTo');
  const safe = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/feed';
  return <Navigate to={safe} replace />;
}

function ProtectedRoute({ children }) {
  const { user, loading, profileError } = useAuth();
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#07111F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow', sans-serif", color: '#8BA3BE', fontSize: 15 }}>
      <div style={{ textAlign: 'center' }}>
        <img src={LOADING_MARK.src} alt={LOADING_MARK.alt} width={LOADING_MARK.size} height={LOADING_MARK.size}
          style={{ display: 'block', margin: '0 auto 16px', borderRadius: LOADING_MARK.borderRadius, animation: 'rinkd-pulse 1.6s ease-in-out infinite' }} />
        <div>Loading Rinkd...</div>
        <style>{`@keyframes rinkd-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.65; transform: scale(0.96); } }`}</style>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/" replace />;
  // Logged in, but the profile fetch failed after all retries — show a real
  // retry screen instead of falling through to pages with profile={null}.
  if (profileError) return (
    <div style={{ minHeight: '100vh', background: '#07111F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow', sans-serif", color: '#8BA3BE', fontSize: 15, padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <div style={{ fontSize: 30, marginBottom: 12 }}>📡</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: '#F4F7FA', marginBottom: 8 }}>Couldn't load your profile</div>
        <div style={{ marginBottom: 18, lineHeight: 1.5 }}>Your connection dropped while loading your account. Your data is safe — just reload.</div>
        <button onClick={() => window.location.reload()} style={{ background: '#2E5B8C', border: 'none', borderRadius: 999, color: '#fff', padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}>Reload Rinkd</button>
      </div>
    </div>
  );
  return children;
}

function AppRoutes() {
  const { user, profile, setProfile } = useAuth();

  // Fire the onboarding modal the first time a fresh signup lands logged in.
  // welcome_seen flips to true once they finish or skip — never re-shows.
  //
  // Two trigger paths:
  //   1. `profile.welcome_seen === false` — the canonical signal once profile loads
  //   2. `sessionStorage.rinkd_pending_onboarding === '1'` — set by Auth.js
  //      immediately after signup so the modal can mount BEFORE the async
  //      profile fetch completes. Fixes the race where ~43% of new signups
  //      bounced during the few-hundred-ms profile-loading window.
  let pendingFromSession = false;
  try { pendingFromSession = sessionStorage.getItem('rinkd_pending_onboarding') === '1'; } catch (_) {}
  const showOnboarding = !!user && (
    (!!profile && profile.welcome_seen === false) || pendingFromSession
  );
  return (
    <>
    {showOnboarding && (
      <OnboardingModal
        currentUser={user}
        profile={profile}
        onProfileUpdate={setProfile}
        // Functional updater + null guard. The race-fix path can mount this
        // modal BEFORE the profile fetch resolves; if the user closes it in
        // that window, a plain `{ ...profile, welcome_seen: true }` would
        // spread `null` and reduce the local profile to just
        // `{ welcome_seen: true }` — dropping name/handle/avatar until the
        // next fetch. The DB-side update lives in OnboardingModal.finish().
        onClose={() => setProfile((p) => ({ ...(p || {}), welcome_seen: true }))}
      />
    )}
    <Routes>
      {/* Root: Landing handles the "first time mobile visitor" install pitch
          and falls through to Auth for desktop, installed PWA, or "continue
          in browser" tap. /login always goes straight to Auth (no marketing). */}
      <Route path="/" element={user ? <Navigate to="/feed" replace /> : <Landing />} />
      {/* If a logged-in user hits /login?returnTo=/tournament/X (e.g., they
          clicked the public-landing CTA but were already signed in), bounce
          them straight to returnTo instead of dropping them on /feed. Auth
          page handles the same query param on successful sign-in. */}
      <Route path="/login" element={user ? <LoginRedirect /> : <Auth />} />
      {/* Magic-link landing for league-commissioner team-manager invites.
          Public route — handles its own signed-in vs not-signed-in routing
          via the AcceptTeamInvite component (bounces to /login?returnTo
          when needed so the token survives the round trip). */}
      <Route path="/accept-team-invite" element={<AcceptTeamInvite profile={profile} />} />
      {/* Survey is public — accessible from auth screen, marketing pages, and embedded in feeds */}
      <Route path="/survey" element={<Survey />} />
      {/* Pricing is public — shareable + indexable; linked from hosting CTAs, activation banners, and More */}
      <Route path="/pricing" element={<Pricing currentUser={user} profile={profile} />} />
      {/* Password recovery — public, handles the magic-link redirect from Supabase */}
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/feed" element={<ProtectedRoute><Feed currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile currentUser={user} profile={profile} onProfileUpdate={setProfile} /></ProtectedRoute>} />
      <Route path="/profile/:userId" element={<ProtectedRoute><Profile currentUser={user} profile={profile} onProfileUpdate={setProfile} /></ProtectedRoute>} />
      <Route path="/rinkside" element={<ProtectedRoute><Rinkside currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/rinkside/new" element={<ProtectedRoute><RinksideEditor currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/rinkside/:slug/edit" element={<ProtectedRoute><RinksideEditor currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/rinkside/:slug" element={<ProtectedRoute><RinksideArticle currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/crease" element={<ProtectedRoute><Crease currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/crease/:slug" element={<ProtectedRoute><CreaseShow currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/crease/:showSlug/:episodeNumber" element={<ProtectedRoute><CreaseEpisode currentUser={user} profile={profile} /></ProtectedRoute>} />
      {/* Leagues index + league detail are publicly viewable so spectators
          can discover events without a Rinkd account. Mirrors the tournament
          pattern shipped May 18 (commit 80f71e54). Anonymous users see a
          PublicLeagueLanding teaser (name / season / venue / teams); live
          data (standings, schedule, scoresheet, feed composer) is gated
          inside League.js based on currentUser. RLS allows anonymous SELECT
          on is_public=true leagues + their teams + games. */}
      <Route path="/leagues" element={<Leagues profile={profile} />} />
      <Route path="/store" element={<ProtectedRoute><Store profile={profile} /></ProtectedRoute>} />
      <Route path="/discover" element={<ProtectedRoute><Discover currentUser={user} profile={profile} /></ProtectedRoute>} />
      {/* Tournaments index + tournament detail are publicly viewable so
          BLPA spectators can discover events without a Rinkd account.
          Anonymous users see a teaser landing (name / dates / venue /
          teams); live standings, schedule, bracket, and scoresheet
          require sign-in. Detail-level data is gated inside Tournament.js
          based on `currentUser`. RLS allows anonymous SELECT on active +
          complete tournaments and their teams/games/rinks. */}
      <Route path="/tournaments" element={<Tournaments profile={profile} currentUser={user} />} />
      <Route path="/teams" element={<ProtectedRoute><Teams profile={profile} /></ProtectedRoute>} />
      <Route path="/league/create" element={<ProtectedRoute><LeagueCreate profile={profile} /></ProtectedRoute>} />
      <Route path="/league/:id/manage" element={<ProtectedRoute><LeagueManage profile={profile} /></ProtectedRoute>} />
      {/* Public, unauthenticated team registration — opened by team contacts who
          may have no Rinkd account. Must stay outside ProtectedRoute. */}
      <Route path="/league/:id/register" element={<LeagueRegister />} />
      <Route path="/tournament/:id/register" element={<TournamentRegister />} />
      <Route path="/league/:id" element={<League currentUser={user} profile={profile} />} />
      <Route path="/team/create" element={<ProtectedRoute><TeamManage profile={profile} /></ProtectedRoute>} />
      <Route path="/team/:id/manage" element={<ProtectedRoute><TeamManage profile={profile} /></ProtectedRoute>} />
      <Route path="/team/:id" element={<ProtectedRoute><Team currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/tournament/create" element={<ProtectedRoute><TournamentCreate profile={profile} /></ProtectedRoute>} />
      <Route path="/tournament/:id/manage" element={<ProtectedRoute><TournamentManage currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/admin/activations" element={<ProtectedRoute><AdminActivations currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/admin/analytics" element={<ProtectedRoute><AdminAnalytics currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/admin/feedback" element={<ProtectedRoute><AdminFeedback currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/admin/moderation" element={<ProtectedRoute><AdminModeration currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><Notifications currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/tournament/:id" element={<Tournament currentUser={user} profile={profile} />} />
      <Route path="/scorer/:gameId" element={<ProtectedRoute><ScorerView /></ProtectedRoute>} />
      <Route path="/game/:gameId" element={<ProtectedRoute><GameDetail profile={profile} /></ProtectedRoute>} />
      <Route path="/league-game/:gameId" element={<ProtectedRoute><GameDetail profile={profile} /></ProtectedRoute>} />
      <Route path="/league-scorer/:gameId" element={<ProtectedRoute><ScorerView /></ProtectedRoute>} />
      {/* Role-based dropdown stubs (Phase 1 item 4) */}
      <Route path="/volunteer-coordinator" element={<ProtectedRoute><VolunteerCoordinator profile={profile} /></ProtectedRoute>} />
      <Route path="/dues-tracker" element={<ProtectedRoute><DuesTrackerPage profile={profile} /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminPanel profile={profile} /></ProtectedRoute>} />
      <Route path="/privacy" element={<Legal />} />
      <Route path="/terms" element={<Legal />} />
      {/* Catch-all 404 — shows the Rizzo mascot + back-to-Chirps CTA.
          Replaces the previous silent redirect to /feed so users get a real
          explanation when a link is dead. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);

  // Retry-on-null helper. Brand-new signups fire SIGNED_IN immediately, but
  // the profile row in lib/auth.js is inserted via a separate `.upsert()` call
  // that runs AFTER auth creation. If we hit `getProfile()` before the upsert
  // commits, we get null. Without retry, the React profile state stays null
  // forever even though the DB row exists a moment later — locking pages like
  // /profile in "Loading..." purgatory and silently breaking onboarding for
  // users who navigate before the modal fires.
  //
  // After the email-confirmation path landed, this helper ALSO triggers
  // `ensureProfileForUser` on the first attempt if no profile exists — that's
  // how new users who confirmed via email link end up with a profile row
  // (since signUp couldn't create it without a session).
  const fetchProfileWithRetry = async (user) => {
    let ensureAttempted = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data } = await getProfile(user.id);
      if (data) return data;
      // First miss: try to build the profile from user_metadata. Idempotent
      // for users who already have one (the function early-returns).
      if (!ensureAttempted) {
        ensureAttempted = true;
        try { await ensureProfileForUser(user); } catch (_) { /* swallow */ }
      }
      // Exponential-ish backoff: 200, 400, 800, 1200, 1800, 2500 ms (~7s total)
      await new Promise((r) => setTimeout(r, 200 + attempt * 400));
    }
    return null;
  };

  useEffect(() => {
    // Track the signed-in identity so the expensive profile fetch only runs
    // when it actually changes — not on every hourly TOKEN_REFRESHED or
    // USER_UPDATED event, and not twice on cold start.
    let currentUserId = null;
    let mounted = true;

    // Safety net: if supabase.auth.getSession() hangs >10s (e.g. a network
    // failure mid token-refresh on rink wifi), give up and let the user land
    // on Landing/Auth instead of staring at "Loading Rinkd…" forever. Reading
    // from localStorage is normally <100ms, so 10s is well past the worst
    // real-world cold-start case. If the session call eventually resolves
    // later, the listener below will pick it up and update state correctly.
    const sessionTimeout = setTimeout(() => {
      if (mounted && currentUserId === null) {
        // eslint-disable-next-line no-console
        console.warn('[auth] getSession() did not resolve within 10s — dropping to logged-out state. The user can retry from Landing.');
        setLoading(false);
      }
    }, 10000);

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      clearTimeout(sessionTimeout);
      const u = session?.user || null;
      setUser(u);
      const nextId = u?.id || null;
      if (nextId !== currentUserId) {
        currentUserId = nextId;
        if (u) {
          const data = await fetchProfileWithRetry(u);
          if (!mounted) return;
          setProfile(data);
          setProfileError(!data); // null after retries = the fetch failed
          setSentryUser(u, data);
          // ENRICH-1 (May 28, 2026): bounded last_seen_at update — gated to
          // ≥5min by the helper's PostgREST WHERE clause so a fast reload
          // followed by a slow profile fetch can't double-write. Fire-and-
          // forget; never blocks render.
          touchLastSeen(u.id);
        } else {
          setProfileError(false);
          setSentryUser(null);
        }
      }
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        const u = session?.user || null;
        const nextId = u?.id || null;
        // Fires on INITIAL_SESSION, TOKEN_REFRESHED (hourly), USER_UPDATED, etc.
        // Only react when the actual signed-in identity changes.
        if (nextId === currentUserId) return;
        currentUserId = nextId;
        setUser(u);
        if (u) {
          const data = await fetchProfileWithRetry(u);
          if (!mounted) return;
          setProfile(data);
          setProfileError(!data); // null after retries = the fetch failed
          setSentryUser(u, data);
          // ENRICH-1: bounded last_seen_at update (≥5min gate in helper).
          touchLastSeen(u.id);
          // If we'd previously timed out and dropped to logged-out, flip
          // loading back to false here too in case it wasn't already.
          setLoading(false);
        } else {
          setProfile(null);
          setProfileError(false);
          setSentryUser(null);
        }
      } catch (err) {
        console.error('[auth] onAuthStateChange handler error:', err);
      }
    });
    return () => {
      mounted = false;
      clearTimeout(sessionTimeout);
      subscription.unsubscribe();
    };
  }, []);

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, profile, setProfile, loading, profileError }}>
        <BrowserRouter><AppRoutes /></BrowserRouter>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
