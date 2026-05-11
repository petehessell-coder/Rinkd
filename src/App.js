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
import Leagues from './pages/Leagues';
import Store from './pages/Store';
import Legal from './pages/Legal';
import Discover from './pages/Discover';
import Tournament from './pages/Tournament';
import Tournaments from './pages/Tournaments';
import TournamentCreate from './pages/TournamentCreate';
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

export const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#07111F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow', sans-serif", color: '#8BA3BE', fontSize: 15 }}>
      <div style={{ textAlign: 'center' }}>
        <img src="/icon-192.png" alt="Rinkd" width="72" height="72"
          style={{ display: 'block', margin: '0 auto 16px', borderRadius: 16, animation: 'rinkd-pulse 1.6s ease-in-out infinite' }} />
        <div>Loading Rinkd...</div>
        <style>{`@keyframes rinkd-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.65; transform: scale(0.96); } }`}</style>
      </div>
    </div>
  );
  return user ? children : <Navigate to="/" replace />;
}

function AppRoutes() {
  const { user, profile, setProfile } = useAuth();
  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/feed" replace /> : <Auth />} />
      <Route path="/login" element={user ? <Navigate to="/feed" replace /> : <Auth />} />
      <Route path="/feed" element={<ProtectedRoute><Feed currentUser={user} profile={profile} /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile currentUser={user} profile={profile} onProfileUpdate={setProfile} /></ProtectedRoute>} />
      <Route path="/profile/:userId" element={<ProtectedRoute><Profile currentUser={user} profile={profile} onProfileUpdate={setProfile} /></ProtectedRoute>} />
      <Route path="/rinkside" element={<ProtectedRoute><Rinkside profile={profile} /></ProtectedRoute>} />
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
      <Route path="/tournament/:id" element={<ProtectedRoute><Tournament /></ProtectedRoute>} />
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
      <Route path="*" element={<Navigate to="/feed" replace />} />
    </Routes>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user || null;
      setUser(u);
      if (u) { const { data } = await getProfile(u.id); setProfile(data); }
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user || null;
      setUser(u);
      if (u) { const { data } = await getProfile(u.id); setProfile(data); } else { setProfile(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, setProfile, loading }}>
      <BrowserRouter><AppRoutes /></BrowserRouter>
    </AuthContext.Provider>
  );
}
