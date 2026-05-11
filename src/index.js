import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

// ---------------------------------------------------------------------------
// Service worker registration with auto-update.
// ---------------------------------------------------------------------------
// Why this matters: a stale PWA is the #1 source of "I redeployed but my phone
// still shows the old site." The SW itself now bumps its BUILD_ID per deploy
// (see scripts/stamp-sw.js) — here we make sure the browser CHECKS for that
// new SW often enough, and gives the user a one-tap path to adopt it.
//
//   1. Register on load.
//   2. Poll registration.update() every 60s while the tab is open, and on every
//      visibilitychange/focus event (covers "I left the app open overnight").
//   3. When a new SW is waiting, render a tiny banner offering to reload.
//   4. After the new SW activates (controllerchange), force one reload so the
//      page is served by the fresh worker.
// ---------------------------------------------------------------------------

function showReloadBanner(reg) {
  if (document.getElementById('rinkd-sw-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'rinkd-sw-banner';
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:18px', 'transform:translateX(-50%)',
    'background:#D72638', 'color:#fff', 'padding:12px 18px', 'border-radius:999px',
    'font-family:Barlow, sans-serif', 'font-size:14px', 'font-weight:600',
    'box-shadow:0 10px 30px rgba(0,0,0,0.4)', 'z-index:99999',
    'cursor:pointer', 'display:flex', 'align-items:center', 'gap:10px',
  ].join(';');
  bar.innerHTML = `<span>🏒 New Rinkd update ready</span>
    <span style="background:#fff;color:#D72638;padding:4px 12px;border-radius:999px;font-weight:700;font-size:12px;">Reload</span>`;
  bar.addEventListener('click', () => {
    const waiting = reg.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    // controllerchange handler below will reload once the new SW takes over.
    setTimeout(() => window.location.reload(), 300);
  });
  document.body.appendChild(bar);
}

if ('serviceWorker' in navigator && window.location.hostname !== 'localhost') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      // Poll for updates so users on long-lived tabs/PWA installs eventually
      // see new deploys without manually pulling-to-refresh.
      const checkForUpdate = () => reg.update().catch(() => {});
      setInterval(checkForUpdate, 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('focus', checkForUpdate);

      // A new worker started installing — show the banner once it's ready.
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            showReloadBanner(reg);
          }
        });
      });

      // If there's already a waiting worker on load, prompt immediately.
      if (reg.waiting && navigator.serviceWorker.controller) {
        showReloadBanner(reg);
      }
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[Rinkd] Service worker registration failed', err);
    });

    // The SW posts SW_UPDATED on activate — guarantees the banner shows even
    // when updatefound fires before our listener is attached.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'SW_UPDATED') {
        navigator.serviceWorker.getRegistration().then((reg) => reg && showReloadBanner(reg));
      }
    });

    // When the new SW takes control, do one reload so the page is fully served
    // by the new worker (otherwise inline state could disagree with cached JS).
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
