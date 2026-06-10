import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from './authContext';
import { getFamily, getClaims } from './family';

// REG-2 — family / "acting-as" context.
//
// Light acting-as (Pete, Jun 10): switching to a managed person opens their
// person-card and makes RSVPs act on their behalf; the social feed stays the
// guardian's. So this context exposes:
//   members      — the actable set: [me, ...managed people I guard]
//   activePerson — who I'm currently acting as (defaults to me)
//   actingForId  — activePerson.id (what RsvpBlock writes as)
//   isSelf       — true when acting as myself
//   setActingAs(id|null) — null resets to me; persisted per-account
//   managed, coGuardians, households, claims, refresh, loading
//
// The provider no-ops cleanly when signed out (profile null).

const FamilyContext = createContext(null);
export function useFamily() {
  return useContext(FamilyContext) || EMPTY;
}

const EMPTY = {
  loading: false, household: null, households: [], members: [], managed: [],
  coGuardians: [], claims: [], activePerson: null, actingForId: null,
  isSelf: true, setActingAs: () => {}, refresh: async () => {},
};

const LS_KEY = 'rinkd_acting_as';

export function FamilyProvider({ children }) {
  const { profile } = useAuth();
  const myId = profile?.id || null;

  const [data, setData] = useState({ households: [], members: [], managed: [], coGuardians: [] });
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actingForId, setActingForId] = useState(null);

  const refresh = useCallback(async () => {
    if (!myId) { setData({ households: [], members: [], managed: [], coGuardians: [] }); setClaims([]); return; }
    setLoading(true);
    try {
      const [fam, cl] = await Promise.all([getFamily(myId), getClaims().catch(() => [])]);
      setData(fam);
      setClaims(cl);
    } catch (e) {
      // A family-load failure must never blank the app chrome — hold empty.
      console.warn('[family] load failed:', e?.message || e);
    } finally {
      setLoading(false);
    }
  }, [myId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Restore persisted acting-as for THIS account once family loads; validate it
  // still points at someone I can act as, else fall back to me.
  useEffect(() => {
    if (!myId) { setActingForId(null); return; }
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) {}
    const wanted = stored && stored.owner === myId ? stored.id : null;
    const actable = new Set(data.managed.map(m => m.profile_id));
    setActingForId(wanted && actable.has(wanted) ? wanted : null);
  }, [myId, data.managed]);

  const setActingAs = useCallback((id) => {
    const next = id && id !== myId ? id : null;
    setActingForId(next);
    try {
      if (next) localStorage.setItem(LS_KEY, JSON.stringify({ owner: myId, id: next }));
      else localStorage.removeItem(LS_KEY);
    } catch (_) {}
  }, [myId]);

  const value = useMemo(() => {
    // The person objects the switcher renders: me first, then managed people.
    const meEntry = profile
      ? { profile_id: myId, role: 'guardian', profile, isSelf: true }
      : null;
    const managedEntries = data.managed.map(m => ({ ...m, isSelf: false }));
    const switcher = meEntry ? [meEntry, ...managedEntries] : managedEntries;
    const activeEntry = switcher.find(e => e.profile_id === (actingForId || myId)) || meEntry;

    return {
      loading,
      household: data.households[0] || null,
      households: data.households,
      members: switcher,            // actable set, me-first
      managed: data.managed,
      coGuardians: data.coGuardians,
      claims,
      activePerson: activeEntry?.profile || null,
      actingForId: actingForId || myId,
      isSelf: !actingForId,
      setActingAs,
      refresh,
    };
  }, [profile, myId, data, claims, loading, actingForId, setActingAs, refresh]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}
