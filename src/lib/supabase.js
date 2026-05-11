import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://tbpoopsyhfuqcbugrjbh.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRicG9vcHN5aGZ1cWNidWdyamJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NjkxMjQsImV4cCI6MjA5MzE0NTEyNH0.0gcGgxkyqmgjGwctCrLBBW18O1LfqFkzKBqJkvCDVpo';

/**
 * Custom auth lock with a 5-second timeout. Replaces the default Supabase
 * Web Lock which can deadlock forever when a previous tab/context held the
 * lock and died without releasing it (a real, reproducible issue — every
 * subsequent tab gets stuck on "Loading Rinkd...").
 *
 * If the lock can't be acquired in 5 seconds, we proceed without it. The
 * tradeoff is that two tabs racing to refresh a token at the exact same
 * moment might both call the refresh endpoint — Supabase handles that fine,
 * and it's vastly better than a hard deadlock.
 */
async function lockWithTimeout(name, acquireTimeout, fn) {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn();
  const timeoutMs = Math.max(1000, acquireTimeout || 5000);
  let acquired = false;
  let result;
  let resolved = false;

  await Promise.race([
    navigator.locks.request(name, async () => {
      acquired = true;
      result = await fn();
      resolved = true;
    }),
    new Promise(resolve => setTimeout(() => {
      if (!resolved) {
        // eslint-disable-next-line no-console
        console.warn('[supabase] auth lock timed out after ' + timeoutMs + 'ms; proceeding without lock');
        resolve();
      }
    }, timeoutMs)),
  ]);

  if (!acquired) {
    // Lock contended; run without it as a safety valve.
    return fn();
  }
  return result;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { lock: lockWithTimeout },
});
