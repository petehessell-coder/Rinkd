import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { getProfile } from './lib/auth';
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
import AdminFeedback from './pages/AdminFeedback';
import AdminModeration from './pages/AdminModeration';
import Settings from './pages/Settings';
import Landing from './pages/Landing';
import { setSentryUser } from './lib/sentry';
import Notifications from './pages/Notifications';
import OnboardingModal from './components/OnboardingModal';
import ErrorBoundary from './components/ErrorBoundary';
import ResetPassword from './pages/ResetPassword';
import Teams from './pages/Teams';
import League from './pages/League';
import LeagueManage from './pages/LeagueManage';
import Team from './pages/Team';
import TeamManage from './pages/TeamManage';
import ScorerView from './pages/ScorerView';
import GameDetail from './pages/GameDetail';
import { DuesTrackerPage } from './pages/ComingSoon';
import AdminPanel from './pages/AdminPanel';
import VolunteerCoordinator from './pages/VolunteerCoordinator';
import NotFound from './pages/NotFound';

export const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

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

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
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
  return user ? children : <Navigate to="/" replace />;
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
        onClose={() => setProfile({ ...profile, welcome_seen: true })}
      />
    )}
    <Routes>
      {/* Root: Landing handles the "first time mobile visitor" install pitch
          and falls through to Auth for desktop, installed PWA, or "continue
          in browser" tap. /login always goes straight to Auth (no marketing). */}
      <Route path="/" element={user ? <Navigate to="/feed" replace /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to="/feed" replace /> : <Auth />} />
      {/* Survey is public — accessible from auth screen, marketing pages, and embedded in feeds */}
      <Route path="/survey" element={<Survey />} />
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
      <Route path="/leagues" element={<ProtectedRoute><Leagues profile={profile} /></ProtectedRoute>} />
      <Route path="/store" element={<ProtectedRoute><Store profile={profile} /></ProtectedRoute>} />
      <Route path="/discover" element={<ProtectedRoute><Discover currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/tournaments" element={<ProtectedRoute><Tournaments profile={profile} /></ProtectedRoute>} />
      <Route path="/teams" element={<ProtectedRoute><Teams profile={profile} /></ProtectedRoute>} />
      <Route path="/leagues" element={<ProtectedRoute><Leagues profile={profile} /></ProtectedRoute>} />
      <Route path="/league/create" element={<ProtectedRoute><LeagueManage profile={profile} /></ProtectedRoute>} />
      <Route path="/league/:id/manage" element={<ProtectedRoute><LeagueManage profile={profile} /></ProtectedRoute>} />
      <Route path="/league/:id" element={<ProtectedRoute><League profile={profile} /></ProtectedRoute>} />
      <Route path="/team/create" element={<ProtectedRoute><TeamManage profile={profile} /></ProtectedRoute>} />
      <Route path="/team/:id/manage" element={<ProtectedRoute><TeamManage profile={profile} /></ProtectedRoute>} />
      <Route path="/team/:id" element={<ProtectedRoute><Team currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/tournament/create" element={<ProtectedRoute><TournamentCreate profile={profile} /></ProtectedRoute>} />
      <Route path="/tournament/:id/manage" element={<ProtectedRoute><TournamentManage currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/admin/analytics" element={<ProtectedRoute><AdminAnalytics currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/admin/feedback" element={<ProtectedRoute><AdminFeedback currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/admin/moderation" element={<ProtectedRoute><AdminModeration currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><Notifications currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/tournament/:id" element={<ProtectedRoute><Tournament currentUser={user} profile={profile} /></ProtectedRoute>} />
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

  // Retry-on-null helper. Brand-new signups fire SIGNED_IN immediately, but
  // the profile row in lib/auth.js is inserted via a separate `.upsert()` call
  // that runs AFTER auth creation. If we hit `getProfile()` before the upsert
  // commits, we get null. Without retry, the React profile state stays null
  // forever even though the DB row exists a moment later — locking pages like
  // /profile in "Loading..." purgatory and silently breaking onboarding for
  // users who navigate before the modal fires.
  const fetchProfileWithRetry = async (userId) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data } = await getProfile(userId);
      if (data) return data;
      // Exponential-ish backoff: 200, 400, 800, 1200, 1800, 2500 ms (~7s total)
      await new Promise((r) => setTimeout(r, 200 + attempt * 400));
    }
    return null;
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user || null;
      setUser(u);
      if (u) {
        const data = await fetchProfileWithRetry(u.id);
        setProfile(data);
        setSentryUser(u, data);
      } else {
        setSentryUser(null);
      }
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user || null;
      setUser(u);
      if (u) {
        const data = await fetchProfileWithRetry(u.id);
        setProfile(data);
        setSentryUser(u, data);
      } else {
        setProfile(null);
        setSentryUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, profile, setProfile, loading }}>
        <BrowserRouter><AppRoutes /></BrowserRouter>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
