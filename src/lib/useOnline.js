// RESILIENCE — connectivity state.
//
// `navigator.onLine` is the cheap signal (true unless the OS knows the NIC is
// down). It famously over-reports on captive/rink WiFi (online === true but no
// real route), so the syncQueue layer does its own reachability probing for
// WRITES — this hook is for the lighter-weight job of telling the UI when the
// device has plainly dropped offline so a surface can switch to its offline
// state instead of spinning forever.
//
//   const online = useOnline();
//   if (!online) return <ErrorState offline onRetry={reload} />;

import { useEffect, useState } from 'react';

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function useOnline() {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // Re-sync on mount in case we missed an event while unmounted.
    setOnline(isOnline());
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export default useOnline;
