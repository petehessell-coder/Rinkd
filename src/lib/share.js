// GROWTH-SHARE-1 · M3 — Web Share API capability + small share utils.
// The orchestration (compose → share-or-fallback) lives in components/ShareButton.

// Can this browser share an actual image FILE (not just a link)? iOS Safari 15+
// and Android Chrome can; most desktop browsers cannot → we fall back.
export function canWebShareFiles() {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

// Trigger a browser download of a blob (desktop fallback path).
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 4000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Absolute share URL for a game (used in the Web Share payload + copy-link).
export function absoluteShareUrl(path) {
  const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'https://rinkd.app';
  return `${origin}${path}`;
}
