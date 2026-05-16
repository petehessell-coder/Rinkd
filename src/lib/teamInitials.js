const STOPWORDS = new Set(['the', 'of', 'a', 'an', 'and', '&', 'le', 'la', 'los', 'las', 'el']);

export function teamInitials(name, max = 3) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const words = s.split(/\s+/).filter(w => w && !STOPWORDS.has(w.toLowerCase()));
  const source = words.length ? words : s.split(/\s+/);
  return source.map(w => w[0]).join('').slice(0, max).toUpperCase() || '?';
}
