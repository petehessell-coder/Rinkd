export const TIERS = [
  { name: 'Mite',   min: 0,     max: 99,    color: '#8BA3BE', discount: 0 },
  { name: 'Squirt', min: 100,   max: 499,   color: '#22C55E', discount: 0 },
  { name: 'Peewee', min: 500,   max: 1499,  color: '#0EA5E9', discount: 5 },
  { name: 'Bantam', min: 1500,  max: 3999,  color: '#F59E0B', discount: 10 },
  { name: 'Midget', min: 4000,  max: 7999,  color: '#8B5CF6', discount: 15 },
  { name: 'Junior', min: 8000,  max: 14999, color: '#D72638', discount: 20 },
  { name: 'Pro',    min: 15000, max: Infinity, color: '#F4F7FA', discount: 25 },
];

export function getTier(points) {
  return TIERS.find(t => points >= t.min && points <= t.max) || TIERS[0];
}

export function getTierProgress(points) {
  const tier = getTier(points);
  const idx = TIERS.indexOf(tier);
  if (idx === TIERS.length - 1) return 100;
  const progress = ((points - tier.min) / (tier.max - tier.min + 1)) * 100;
  return Math.min(100, Math.max(0, progress));
}

export function getNextTier(points) {
  const tier = getTier(points);
  const idx = TIERS.indexOf(tier);
  return idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
}
