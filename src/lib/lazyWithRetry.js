import { lazy } from 'react';
import { isChunkLoadError, reloadOnceForChunk } from './chunkReload';

// Drop-in for React.lazy that self-heals the "stale chunk after deploy" failure:
// if the dynamic import() rejects because the chunk no longer exists (we shipped
// a new build), reload ONCE to fetch the fresh build instead of throwing the
// import error up to the ErrorBoundary. Hangs the promise after triggering the
// reload so React stays in Suspense until navigation happens.
export default function lazyWithRetry(importFn) {
  return lazy(() =>
    importFn().catch((err) => {
      if (isChunkLoadError(err) && reloadOnceForChunk()) {
        return new Promise(() => {}); // never resolves — the reload takes over
      }
      throw err; // not a chunk error, or we already reloaded once → let it surface
    })
  );
}
