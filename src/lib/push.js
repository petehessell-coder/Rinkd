const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    console.log('SW registered');
    return reg;
  } catch (err) {
    console.error('SW registration failed:', err);
    return null;
  }
}

export async function subscribeToPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY
        ? urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        : undefined,
    });

    // Save subscription to Supabase
    const { supabase } = await import('./supabase');
    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      subscription: JSON.stringify(subscription),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return subscription;
  } catch (err) {
    console.error('Push subscription failed:', err);
    return null;
  }
}

export async function isPushSubscribed() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

/**
 * Drop the current push subscription. Removes both the browser-side
 * subscription and the row in push_subscriptions so we stop sending.
 */
export async function unsubscribeFromPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    if (userId) {
      const { supabase } = await import('./supabase');
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[push] unsubscribe failed:', err);
    return false;
  }
}

/**
 * Returns the high-level state needed to decide what to show in UI:
 *   'unsupported' — browser/device can't do push
 *   'denied'      — user blocked notifications at the OS/browser level
 *   'default'     — never been asked
 *   'granted-off' — granted but no active subscription (or removed)
 *   'subscribed'  — granted + active subscription
 */
export async function getPushState() {
  if (typeof window === 'undefined' || typeof Notification === 'undefined' ||
      !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied')  return 'denied';
  if (Notification.permission === 'default') return 'default';
  return (await isPushSubscribed()) ? 'subscribed' : 'granted-off';
}
