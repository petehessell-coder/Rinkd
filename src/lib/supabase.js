import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('[Rinkd] Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY — check your .env.local');
}

/**
 * Per-tab in-memory mutex. Replaces Supabase's default `navigator.locks` lock,
 * which can deadlock forever when a previous tab/context died holding the lock.
 *
 * We intentionally do NOT coordinate across tabs. That's a deliberate tradeoff:
 * two tabs racing a token refresh is benign (Supabase handles the duplicate),
 * but the cross-tab Web Lock has demonstrated it can wedge the whole app.
 *
 * Calls are serialized within a single tab via a Promise chain.
 */
let inFlight = Promise.resolve();
function memoryLock(_name, _acquireTimeout, fn) {
  const next = inFlight.then(() => fn()).catch(err => {
    // Don't propagate prior failures to the next caller
    return Promise.reject(err);
  });
  // The next call should wait for this one regardless of success/failure
  inFlight = next.catch(() => undefined);
  return next;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: memoryLock,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
