import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPage } from '../lib/analytics';

/**
 * Fires a `page_view` analytics event on every route change. Mounted once
 * inside the Router so it sees all navigation, including the entry page on
 * first load. Renders nothing.
 *
 * Why this exists: until now analytics was hand-instrumented at specific
 * moments, so most in-app pages emitted no view and navigation paths couldn't
 * be reconstructed. With a page_view on each path change (plus the session_id +
 * created_at already on every event), per-session clickstreams fall out for
 * free. trackPage strips the query string, so tokens never land in the table.
 */
export default function RouteAnalytics() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Skip the single page_view caused by a service-worker auto-reload after a
    // deploy (index.js sets this flag right before location.reload()). Without it,
    // every parked/idle tab logs a phantom view on each ship — inflating metrics
    // (see Matt Howard: one /profile tab reloading on our deploys for days). A
    // manual refresh sets no flag, so genuine reloads still count.
    let swReload = false;
    try {
      swReload = !!sessionStorage.getItem('rinkd_sw_reload');
      if (swReload) sessionStorage.removeItem('rinkd_sw_reload');
    } catch { /* sessionStorage unavailable */ }
    if (swReload) return;
    trackPage(pathname);
  }, [pathname]);
  return null;
}
