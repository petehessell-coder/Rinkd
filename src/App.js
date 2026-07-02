import React, { useState, useEffect, Suspense } from 'react';
import lazyWithRetry from './lib/lazyWithRetry';
import { AuthContext, useAuth } from './lib/authContext';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { getProfile, ensureProfileForUser, touchLastSeen } from './lib/auth';
import { motion } from './lib/tokens';
import { prefersReducedMotion } from './lib/motion';
// Eager — genuinely first-paint-critical (auth gate + authenticated home).
// Everything else is lazy so the main bundle stays lean.
import Auth from './pages/Auth';
import Home from './pages/Home';
import Feed from './pages/Feed';
import Landing from './pages/Landing';
const Profile = lazyWithRetry(() => import('./pages/Profile'));
const Leagues = lazyWithRetry(() => import('./pages/Leagues'));
const Tournament = lazyWithRetry(() => import('./pages/Tournament'));
const Tournaments = lazyWithRetry(() => import('./pages/Tournaments'));
import { setSentryUser, captureException } from './lib/sentry';
import { track, capturePilotRef } from './lib/analytics';
import OnboardingModal from './components/OnboardingModal';
import { MotionProvider, RouteTransition, ToastProvider } from './components/ui';
import RouteAnalytics from './components/RouteAnalytics';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineBanner from './components/OfflineBanner';
import { DuesTrackerPage } from './pages/ComingSoon';

// Lazy — code-split the heavier / less-frequent routes out of the main bundle
// (pre-pilot audit P1-11). Each is its own chunk fetched on first visit; the
// <Suspense> boundary around <Routes> shows RouteFallback while it loads. Only
// default-export pages are lazied here.
const Rinkside = lazyWithRetry(() => import('./pages/Rinkside'));
const Crease = lazyWithRetry(() => import('./pages/Crease'));
const CreaseShow = lazyWithRetry(() => import('./pages/CreaseShow'));
const CreaseEpisode = lazyWithRetry(() => import('./pages/CreaseEpisode'));
const Survey = lazyWithRetry(() => import('./pages/Survey'));
const RinksideArticle = lazyWithRetry(() => import('./pages/RinksideArticle'));
const RinksideEditor = lazyWithRetry(() => import('./pages/RinksideEditor'));
const Store = lazyWithRetry(() => import('./pages/Store'));
const Legal = lazyWithRetry(() => import('./pages/Legal'));
const Discover = lazyWithRetry(() => import('./pages/Discover'));
const TournamentCreate = lazyWithRetry(() => import('./pages/TournamentCreate'));
const TournamentManage = lazyWithRetry(() => import('./pages/TournamentManage'));
const AdminAnalytics = lazyWithRetry(() => import('./pages/AdminAnalytics'));
const AdminActivations = lazyWithRetry(() => import('./pages/AdminActivations'));
const AdminFeedback = lazyWithRetry(() => import('./pages/AdminFeedback'));
const AdminModeration = lazyWithRetry(() => import('./pages/AdminModeration'));
const Settings = lazyWithRetry(() => import('./pages/Settings'));
const Pricing = lazyWithRetry(() => import('./pages/Pricing'));
const Notifications = lazyWithRetry(() => import('./pages/Notifications'));
const Messages = lazyWithRetry(() => import('./pages/Messages'));
const ResetPassword = lazyWithRetry(() => import('./pages/ResetPassword'));
const Teams = lazyWithRetry(() => import('./pages/Teams'));
const League = lazyWithRetry(() => import('./pages/League'));
const LeagueManage = lazyWithRetry(() => import('./pages/LeagueManage'));
const LeagueCreate = lazyWithRetry(() => import('./pages/LeagueCreate'));
const LeagueRegister = lazyWithRetry(() => import('./pages/LeagueRegister'));
const TournamentRegister = lazyWithRetry(() => import('./pages/TournamentRegister'));
const AcceptTeamInvite = lazyWithRetry(() => import('./pages/AcceptTeamInvite'));
const AcceptLeagueInvite = lazyWithRetry(() => import('./pages/AcceptLeagueInvite'));
const Team = lazyWithRetry(() => import('./pages/Team'));
const TeamManage = lazyWithRetry(() => import('./pages/TeamManage'));
const ScorerView = lazyWithRetry(() => import('./pages/ScorerView'));
const GameDetail = lazyWithRetry(() => import('./pages/GameDetail'));
const PublicGame = lazyWithRetry(() => import('./pages/PublicGame'));
const AdminPanel = lazyWithRetry(() => import('./pages/AdminPanel'));
const VolunteerCoordinator = lazyWithRetry(() => import('./pages/VolunteerCoordinator'));
const NotFound = lazyWithRetry(() => import('./pages/NotFound'));
const Operator = lazyWithRetry(() => import('./pages/Operator'));

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
  const safe = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/home';
  return <Navigate to={safe} replace />;
}

function ProtectedRoute({ children }) {
  const { user, loading, profileError } = useAuth();
  // Show a "tap to reload" hint after 4s so a slow cold-start doesn't feel
  // like a crash. The hint disappears the moment loading resolves.
  const [loadingSlow, setLoadingSlow] = React.useState(false);
  React.useEffect(() => {
    if (!loading) { setLoadingSlow(false); return; }
    const t = setTimeout(() => setLoadingSlow(true), 4000);
    return () => clearTimeout(t);
  }, [loading]);
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0B1F3A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow', sans-serif", color: '#8BA3BE', fontSize: 15 }}>
      <div style={{ textAlign: 'center' }}>
        <img className="rinkd-loading-mark" src={LOADING_MARK.src} alt={LOADING_MARK.alt} width={LOADING_MARK.size} height={LOADING_MARK.size}
          style={{ display: 'block', margin: '0 auto 16px', borderRadius: LOADING_MARK.borderRadius, animation: 'rinkd-pulse 1.6s ease-in-out infinite' }} />
        <div>Getting the ice ready.</div>
        {loadingSlow && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, color: 'rgba(139,163,190,0.6)', marginBottom: 10 }}>Taking longer than usual…</div>
            <button onClick={() => window.location.reload()}
              style={{ background: 'rgba(46,91,140,0.3)', border: '1px solid rgba(46,91,140,0.5)', borderRadius: 999, color: '#F4F7FA', padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}>
              Tap to reload
            </button>
          </div>
        )}
        <style>{`@keyframes rinkd-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.65; transform: scale(0.96); } } @media (prefers-reduced-motion: reduce) { .rinkd-loading-mark { animation: none !important; } }`}</style>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/" replace />;
  // Logged in, but the profile fetch failed after all retries — show a real
  // retry screen instead of falling through to pages with profile={null}.
  if (profileError) return (
    <div style={{ minHeight: '100vh', background: '#0B1F3A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow', sans-serif", color: '#8BA3BE', fontSize: 15, padding: 24 }}>
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

// Shown while a lazy route chunk loads (pre-pilot P1-11 code-splitting).
// Manifesto "show nothing under 300ms": the mark is held invisible for the
// first ~320ms (36% of the 900ms ease-in) so a fast chunk swap is pure navy
// with no flash, then it fades in and holds — a branded beat, not a spinner.
// Navy matches the iOS splash + first paint so the whole launch is seamless.
function RouteFallback() {
  return (
    <div style={{ minHeight: '100vh', background: '#0B1F3A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img className="rinkd-route-mark" src="/icon-192.png" alt="Rinkd" width={64} height={64}
        style={{ borderRadius: 16, opacity: 0, animation: 'rinkd-fallback-in 900ms ease-out forwards' }} />
      <style>{`@keyframes rinkd-fallback-in { 0%,36% { opacity: 0; transform: scale(0.94); } 100% { opacity: 1; transform: scale(1); } } @media (prefers-reduced-motion: reduce) { .rinkd-route-mark { animation: none !important; opacity: 1 !important; } }`}</style>
    </div>
  );
}

function AppRoutes() {
  const { user, profile, setProfile } = useAuth();

  // ICE reveal — the third beat of the onboarding cinematic (Locker Room →
  // Tunnel → Ice). The OnboardingModal's tunnel calls onReveal() as its white
  // flash peaks; we add a keyframe class to the routed-content wrapper so the
  // feed rises into view. Driven here (not inside Feed) because this wrapper is
  // ALWAYS mounted — no cross-component event, no Feed mount-timing race. Auto-
  // clears so it can never replay on a later route change.
  const [iceRise, setIceRise] = useState(false);
  const triggerIceReveal = () => {
    // Reduced motion: skip the rise entirely. The routed content (the feed) is
    // already mounted underneath the tunnel, so it simply appears — manifesto
    // rule "disable all animation at prefers-reduced-motion". Otherwise add the
    // keyframe class and auto-clear after the reveal finishes (+ buffer) so it
    // can never replay on a later route change.
    if (prefersReducedMotion()) return;
    setIceRise(true);
    setTimeout(() => setIceRise(false), motion.duration.reveal + 340);
  };

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
    <MotionProvider>
    {/* Fires a page_view on every route change → per-session navigation paths. */}
    <RouteAnalytics />
    {showOnboarding && (
      <OnboardingModal
        currentUser={user}
        profile={profile}
        onProfileUpdate={setProfile}
        onReveal={triggerIceReveal}
        // Functional updater + null guard. The race-fix path can mount this
        // modal BEFORE the profile fetch resolves; if the user closes it in
        // that window, a plain `{ ...profile, welcome_seen: true }` would
        // spread `null` and reduce the local profile to just
        // `{ welcome_seen: true }` — dropping name/handle/avatar until the
        // next fetch. The DB-side update lives in OnboardingModal.finish().
        onClose={() => setProfile((p) => ({ ...(p || {}), welcome_seen: true }))}
      />
    )}
    {/* Ice-rise keyframe sourced from the motion tokens (duration + easing) so
        the onboarding reveal speaks the same motion vocabulary as everything
        else. The media query is belt-and-suspenders alongside the JS guard in
        triggerIceReveal — either path alone disables the animation. */}
    <style>{`@keyframes rinkdIceRise{from{opacity:0;transform:translateY(48px)}to{opacity:1;transform:translateY(0)}}.rinkd-ice-rise{animation:rinkdIceRise ${motion.duration.reveal}ms ${motion.easing.out} both}@media (prefers-reduced-motion: reduce){.rinkd-ice-rise{animation:none}}`}</style>
    <div className={iceRise ? 'rinkd-ice-rise' : undefined}>
    <RouteTransition>
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Root: Landing handles the "first time mobile visitor" install pitch
          and falls through to Auth for desktop, installed PWA, or "continue
          in browser" tap. /login always goes straight to Auth (no marketing). */}
      <Route path="/" element={user ? <Navigate to="/home" replace /> : <Landing />} />
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
      {/* Magic-link landing for league-MANAGER invites (LEAGUE-MGR-1). Same
          public, self-routing pattern as the team-manager accept page. */}
      <Route path="/accept-league-invite" element={<AcceptLeagueInvite profile={profile} />} />
      {/* Survey is public — accessible from auth screen, marketing pages, and embedded in feeds */}
      <Route path="/survey" element={<Survey />} />
      {/* Pricing is public — shareable + indexable; linked from hosting CTAs, activation banners, and More */}
      <Route path="/pricing" element={<Pricing currentUser={user} profile={profile} />} />
      {/* Password recovery — public, handles the magic-link redirect from Supabase */}
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Event-Centric Home — the signed-in front door. A personalized tile
          board (their teams/events/scores) with the XRHL Featured hero on top,
          NOT the global chirp feed. /feed stays alive below as "Discover". */}
      <Route path="/home" element={<ProtectedRoute><Home currentUser={user} profile={profile} /></ProtectedRoute>} />
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
      {/* C12 · Operator Front Door — the branded /o/:slug landing we forward a
          partner platform or big operator. PUBLIC (outside ProtectedRoute), like
          /league/:id above. Link-only surface: no nav entry. RLS shows only
          is_active operators to anon; admins preview drafts. */}
      <Route path="/o/:slug" element={<Operator currentUser={user} profile={profile} />} />
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
      <Route path="/messages" element={<ProtectedRoute><Messages currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/messages/:conversationId" element={<ProtectedRoute><Messages currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/tournament/:id" element={<Tournament currentUser={user} profile={profile} />} />
      <Route path="/scorer/:gameId" element={<ProtectedRoute><ScorerView /></ProtectedRoute>} />
      {/* GROWTH-SHARE-1 · login-less public game/recap pages — the share deep-link
          target. PUBLIC by design (outside ProtectedRoute); reads game + box score
          as the anon role and self-gates on parent-event visibility + the youth
          public_sharing switch inside PublicGame. /g = tournament, /lg = league. */}
      <Route path="/g/:gameId" element={<PublicGame />} />
      <Route path="/lg/:gameId" element={<PublicGame league />} />
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
    </Suspense>
    </RouteTransition>
    </div>
    </MotionProvider>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);

  // Retry-on-null helper. Brand-new signups fire SIGNED_IN immediately, but the
  // profile row is provisioned by lib/auth.js's ensureProfileForUser AFTER auth
  // creation (server-side via the ensure_profile_for_current_user SECURITY DEFINER
  // RPC). If we hit `getProfile()` before that row commits, we get null. Without
  // retry, the React profile state stays null forever even though the DB row
  // exists a moment later — locking pages like /profile in "Loading..." purgatory
  // and silently breaking onboarding for users who navigate before the modal fires.
  //
  // After the email-confirmation path landed, this helper ALSO triggers
  // `ensureProfileForUser` on the first attempt if no profile exists — that's
  // how new users who confirmed via email link end up with a profile row
  // (since signUp couldn't create it without a session).
  const fetchProfileWithRetry = async (user) => {
    let ensureAttempted = false;
    // 3 attempts max (was 6). For returning users, the profile always exists on
    // the first try. The retries exist for the new-signup race where profile insert
    // hasn't committed yet — 3x150ms (~450ms total) covers that window without
    // blocking PWA cold-start for several seconds. If all 3 miss, profileError
    // shows the reload screen (much faster than the old ~7s wait).
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data } = await getProfile(user.id);
      if (data) return data;
      // First miss: try to build the profile from user_metadata. Idempotent
      // for users who already have one (the function early-returns).
      if (!ensureAttempted) {
        ensureAttempted = true;
        // ensureProfileForUser RETURNS { error } on an RLS/constraint reject
        // (it doesn't throw), so a bare try/catch silently dropped the real
        // failure — which is exactly how a profile-less signup went invisible.
        // Report both the returned error and any throw so the next one pages us.
        try {
          const res = await ensureProfileForUser(user);
          if (res?.error) {
            captureException(
              new Error(`ensureProfileForUser failed: ${res.error.message || res.error.code || 'unknown'}`),
              { where: 'fetchProfileWithRetry', userId: user.id, code: res.error.code }
            );
          }
        } catch (e) {
          captureException(e, { where: 'fetchProfileWithRetry/ensureProfileForUser', userId: user.id });
        }
      }
      // Flat 150ms between attempts. Covers the signup-race window without
      // adding seconds of perceived lag on slow connections.
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  };

  // PILOT-ANALYTICS: capture first-touch ?ref= / ?utm_source= on the very first
  // load, before any route change strips the query string. First touch wins.
  useEffect(() => { capturePilotRef(); }, []);

  useEffect(() => {
    // Track the signed-in identity so the expensive profile fetch only runs
    // when it actually changes — not on every hourly TOKEN_REFRESHED or
    // USER_UPDATED event, and not twice on cold start.
    let currentUserId = null;
    let mounted = true;

    // Safety net: if supabase.auth.getSession() hangs >5s (e.g. a network
    // failure mid token-refresh on rink wifi), give up and let the user land
    // on Landing/Auth instead of staring at "Loading Rinkd…" forever. Reading
    // from localStorage is normally <100ms; token refresh adds ~1-2s on a slow
    // connection. 5s is well past any real cold-start worst case while being
    // tight enough to not leave a PWA user staring at the spinner forever.
    const sessionTimeout = setTimeout(() => {
      if (mounted && currentUserId === null) {
        // eslint-disable-next-line no-console
        console.warn('[auth] getSession() did not resolve within 5s — dropping to logged-out state. The user can retry from Landing.');
        setLoading(false);
      }
    }, 5000);

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

  // GROWTH-SHARE-1 — install is the funnel's last step. Track globally (here,
  // not InstallButton) so an install from the login-less public page — which
  // never mounts the app chrome — still counts.
  useEffect(() => {
    const onInstalled = () => track('pwa_installed');
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, profile, setProfile, loading, profileError }}>
        {/* ToastProvider powers optimistic-action Undo toasts app-wide; the
            OfflineBanner pins a global connectivity state. Both sit above the
            router so every route can reach them. */}
        <ToastProvider>
          <OfflineBanner />
          <BrowserRouter><AppRoutes /></BrowserRouter>
        </ToastProvider>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
