// perf(scale) — client-side image downscale + re-encode BEFORE upload, so a raw
// multi-MB phone photo never reaches Storage or the feed at full resolution.
// CLAUDE.md "Built for Scale": "Image optimization mandatory. Compress and
// resize before serving. Raw uploads never hit the feed directly."
//
// One 8MB original fanned out to 10k Saturday-night viewers ≈ 80GB of egress and
// a full-res decode on every phone (jank + memory pressure on the exact
// mid-range device a hockey grandparent is holding). Capping the longest edge at
// 1600px and re-encoding to WebP @0.82 typically cuts that 90–95% (→ ~300–500KB)
// with no visible loss in a feed card; avatars/logos shrink to single-digit KB.
//
//   const slim = await compressImage(file);                     // feed (1600px)
//   const tiny = await compressImage(file, { maxEdge: 512 });   // avatars/logos
//
// Never throws and never blocks a post: any format we can't decode (HEIC on a
// browser without native support, a decode error, an already-smaller file)
// falls back to the original, untouched.

const DEFAULTS = { maxEdge: 1600, quality: 0.82 };

// GIFs lose their animation through a canvas round-trip; videos and everything
// else aren't ours to touch here. Only still raster images get compressed.
function isCompressibleImage(file) {
  return !!file && typeof file.type === 'string'
    && file.type.startsWith('image/')
    && file.type !== 'image/gif';
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), type, quality); }
    catch { resolve(null); }
  });
}

export async function compressImage(file, opts = {}) {
  const { maxEdge, quality } = { ...DEFAULTS, ...opts };
  if (typeof document === 'undefined' || !isCompressibleImage(file)) return file;

  try {
    // `imageOrientation: 'from-image'` bakes in EXIF rotation so a portrait
    // phone photo isn't served sideways once its metadata is stripped.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width: w, height: h } = bitmap;
    if (!w || !h) { bitmap.close?.(); return file; }

    const scale = Math.min(1, maxEdge / Math.max(w, h)); // never upscale
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close?.();

    // Prefer WebP (smaller, and it preserves alpha). Fall back to JPEG ONLY when
    // the browser can't encode WebP — and never for a source that may be
    // transparent (PNG/WebP logos), since JPEG flattens alpha to black; return
    // the original untouched in that case.
    let blob = await canvasToBlob(canvas, 'image/webp', quality);
    if (!blob) {
      if (file.type === 'image/png' || file.type === 'image/webp') return file;
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }
    if (!blob) return file;

    // If compression somehow produced a bigger file (already-tiny optimized
    // images), keep the original.
    if (blob.size >= file.size) return file;

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const base = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.${ext}`, { type: blob.type, lastModified: Date.now() });
  } catch {
    return file; // unsupported format / decode failure → never block the upload
  }
}
