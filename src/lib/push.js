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
