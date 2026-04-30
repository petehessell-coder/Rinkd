export const TIERS = [
  { level: 1, name: 'Mite',   minPts: 0,     maxPts: 99,    color: '#64748B', disc: 0  },
  { level: 2, name: 'Squirt', minPts: 100,   maxPts: 499,   color: '#60A5FA', disc: 0  },
  { level: 3, name: 'Peewee', minPts: 500,   maxPts: 1499,  color: '#34D399', disc: 5  },
  { level: 4, name: 'Bantam', minPts: 1500,  maxPts: 3999,  color: '#FBBF24', disc: 10 },
  { level: 5, name: 'Midget', minPts: 4000,  maxPts: 7999,  color: '#F97316', disc: 15 },
  { level: 6, name: 'Junior', minPts: 8000,  maxPts: 14999, color: '#D72638', disc: 20 },
  { level: 7, name: 'Pro',    minPts: 15000, maxPts: 99999, color: '#F5C842', disc: 25 },
];

export function getTier(points) {
  return TIERS.find(t => points >= t.minPts && points <= t.maxPts) || TIERS[0];
}

export function getNextTier(points) {
  const current = getTier(points);
  return TIERS[current.level] || current;
}

export function getProgress(points) {
  const tier = getTier(points);
  const range = tier.maxPts - tier.minPts;
  return Math.min(((points - tier.minPts) / range) * 100, 100);
}
