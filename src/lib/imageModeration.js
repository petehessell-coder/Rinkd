/**
 * Client-side image moderation via NSFW.js.
 *
 * Strategy:
 *   - Lazy-import the TFJS + NSFW.js model only when a user is actually
 *     about to upload — avoids the 5MB+ download on every page load.
 *   - Run the classifier entirely on-device. Zero server cost, full privacy
 *     (the explicit image never leaves the user's browser).
 *   - Block uploads classified as Porn/Hentai above threshold, or Sexy above
 *     a higher threshold (since sports photos can score moderately "sexy"
 *     against the model).
 *   - If the model fails to load (offline, blocked CDN, old browser), fall
 *     open to allow uploads — we'd rather not block real users on a network
 *     hiccup, and the server-side Sightengine pipeline (next sprint) catches
 *     the leftovers.
 */

let modelPromise = null;

async function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    // Dynamic imports keep TFJS + the model out of the initial JS bundle.
    const [{ default: nsfwjs }, tf] = await Promise.all([
      import(/* webpackChunkName: "nsfwjs" */ 'nsfwjs'),
      import(/* webpackChunkName: "tfjs" */ '@tensorflow/tfjs'),
    ]);
    // Prefer WebGL backend for speed; falls back to CPU if WebGL isn't available.
    await tf.ready();
    try { await tf.setBackend('webgl'); } catch { /* fall back to default */ }
    // The lite model is ~5MB. The full one is ~15MB. Lite is plenty for the
    // "obviously NSFW" cases we care about — server-side Sightengine handles
    // ambiguous edges in a follow-up sprint.
    return await nsfwjs.load('MobileNetV2Mid');
  })().catch((err) => {
    // Reset on failure so a retry can re-attempt loading.
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

/**
 * Classify an image file. Returns one of:
 *   { ok: true } — image is safe to upload
 *   { ok: false, reason: 'nsfw', label: 'Porn', score: 0.94 } — blocked
 *   { ok: true, skipped: true } — moderation failed to run; allow upload anyway
 */
export async function classifyImage(file, opts = {}) {
  const {
    pornThreshold = 0.6,
    hentaiThreshold = 0.6,
    sexyThreshold = 0.85,  // tolerant of sports photos
  } = opts;

  if (!file || !file.type?.startsWith('image/')) {
    return { ok: true, skipped: true };
  }

  let imgEl;
  try {
    const model = await loadModel();
    imgEl = await fileToImage(file);
    const predictions = await model.classify(imgEl);
    const byLabel = Object.fromEntries(predictions.map((p) => [p.className, p.probability]));
    const porn = byLabel.Porn || 0;
    const hentai = byLabel.Hentai || 0;
    const sexy = byLabel.Sexy || 0;
    if (porn >= pornThreshold) return { ok: false, reason: 'nsfw', label: 'Porn', score: porn };
    if (hentai >= hentaiThreshold) return { ok: false, reason: 'nsfw', label: 'Hentai', score: hentai };
    if (sexy >= sexyThreshold) return { ok: false, reason: 'nsfw', label: 'Sexy', score: sexy };
    return { ok: true };
  } catch (err) {
    // Don't block users if the model fails — log it and let the upload proceed.
    // Server-side moderation (Sightengine) will catch what slipped through.
    // eslint-disable-next-line no-console
    console.warn('[imageModeration] classify skipped:', err?.message || err);
    return { ok: true, skipped: true };
  } finally {
    if (imgEl?.src?.startsWith('blob:')) URL.revokeObjectURL(imgEl.src);
  }
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-decode-failed'));
    img.src = URL.createObjectURL(file);
  });
}
