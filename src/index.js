import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

// Register the service worker for offline support + push notifications.
// Skipped on localhost so HMR isn't shadowed by the cached shell.
if ('serviceWorker' in navigator && window.location.hostname !== 'localhost') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => {
        // When a new SW takes over, surface the chance to refresh — keeps the
        // staleness window short after a deploy. Auto-refresh is too aggressive.
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // eslint-disable-next-line no-console
              console.info('[Rinkd] New version available. Reload to update.');
            }
          });
        });
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[Rinkd] Service worker registration failed', err);
      });
  });
}
