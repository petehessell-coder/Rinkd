// GameSheet data-source layer (the only part that talks to GameSheet).
//
// gamesheetstats.com was rebuilt on Next.js (App Router) + Firebase/Firestore
// (project "gamesheet-production"); the old REST route
//   /api/useScoredGames/getSeasonScores/{id}
// is gone (404). A season's games live in the Firestore subcollection
//   seasons/{seasonId}/games
// and reads are PUBLIC (no auth). The web API key below is non-secret — it ships
// in their client JS bundle (initializeApp({apiKey:...})) and only scopes the
// request to the gamesheet-production project; Firestore security rules govern
// access. Discovered Jun 16 2026 — see GAMESHEET_DATA_SOURCE.md.
//
// fetchSeasonScores() adapts each Firestore game doc into the legacy scored-game
// shape the poller already consumes, so all downstream logic is untouched:
//   { game: { gameId, type, number, date, time,
//             finalScore?: { homeGoals, visitorGoals },
//             homeTeam:    { name, division, recap[].events[].playerName },
//             visitorTeam: { name, division, recap[].events[].playerName } } }
// This module is pure (only fetch + Date) so it runs identically under Deno (the
// edge fn) and Node (the test harness).

const GS_FIRESTORE = 'https://firestore.googleapis.com/v1';
const GS_FB_PROJECT = 'gamesheet-production';
const GS_FB_KEY = 'AIzaSyCk5pKBFxvCMuwPchzXgvvz4XmmscJTvs8';

// Decode a Firestore REST "Value" (typed union) into a plain JS value.
export function fsVal(v: any): any {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fsFields(v.mapValue?.fields ?? {});
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(fsVal);
  return null;
}
export function fsFields(f: Record<string, any>): Record<string, any> {
  const o: Record<string, any> = {};
  for (const k in f) o[k] = fsVal(f[k]);
  return o;
}

// GameSheet exposes per-player goal totals on the lineup (stats.g) — the cleanest,
// most authoritative scorer source. Re-emit one event per goal so downstream
// scorerSummary() tallies "Name ×N" exactly (it counts playerName occurrences).
export function teamRecap(team: any): any[] {
  const out: any[] = [];
  for (const p of (team?.lineup?.players ?? [])) {
    const goals = Number(p?.stats?.g ?? 0);
    if (goals > 0) {
      const playerName = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
      if (playerName) out.push({ events: Array.from({ length: goals }, () => ({ playerName })) });
    }
  }
  return out;
}

// Is a GameSheet game FINAL (safe to write + recap)? A played game's status reads
// "unofficial" (scoresheet submitted) and gets an endTime when the scorekeeper
// ends it. Some operators never tap "end game", leaving a finished game stuck
// "in progress" with a full scoreboard (GameSheet's OWN standings still count it).
// So: final once it has ended (endTime present), OR it has a scoreboard AND its
// scheduled window is well in the past (>6h) — the stale fallback catches "forgot
// to end" without ever finalizing a genuinely live game (whose window is current).
const FINAL_STALE_MS = 6 * 3600 * 1000;
export function isGameFinal(game: any, hasScore: boolean): boolean {
  if (!hasScore) return false;
  if (game?.endTime) return true;
  const t = Date.parse(game?.scheduledStartTime ?? game?.startTime ?? '');
  return !Number.isNaN(t) && (Date.now() - t) > FINAL_STALE_MS;
}

// Map one decoded Firestore game doc → legacy scored-game entry (or null to skip).
export function adaptGameDoc(row: any): any | null {
  if (!row?.document?.fields) return null; // skip the readTime-only stream frame
  const docId = String(row.document.name ?? '').split('/').pop() ?? '';
  const doc = fsFields(row.document.fields);
  const data = doc?.data ?? {};
  const game = data?.game ?? {};
  const home = data?.home ?? {};
  const visitor = data?.visitor ?? {};
  const sb = doc?.computed?.scoreboard?.total ?? {};
  const hasScore = sb?.home != null && sb?.visitor != null;
  const homeGoals = Number(sb?.home ?? 0);
  const visitorGoals = Number(sb?.visitor ?? 0);
  const startIso = game?.scheduledStartTime ?? game?.startTime ?? null;

  return {
    game: {
      gameId: String(game?.id ?? docId),
      type: game?.type ?? null,            // "tournament" | "regular_season"
      number: game?.number ?? null,
      date: startIso,                       // ISO datetime; gsDateKey()/Date.parse() handle it
      time: '',                             // time is folded into the ISO date above
      ...(isGameFinal(game, hasScore) ? { finalScore: { homeGoals, visitorGoals } } : {}),
      homeTeam:    { name: home?.details?.title ?? '',    division: home?.division?.title ?? null,    recap: teamRecap(home) },
      visitorTeam: { name: visitor?.details?.title ?? '', division: visitor?.division?.title ?? null, recap: teamRecap(visitor) },
    },
  };
}

// Pull a GameSheet season's games (final + not-yet-final). finalScore is present
// ONLY on final games — the poller skips any game without it, so live/scheduled
// games are never scored.
export async function fetchSeasonScores(seasonId: string): Promise<any[]> {
  const url = `${GS_FIRESTORE}/projects/${GS_FB_PROJECT}/databases/(default)/documents/seasons/${encodeURIComponent(seasonId)}:runQuery?key=${GS_FB_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'RinkdSync/1.0 (+https://rinkd.app)' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'games' }] } }),
  });
  if (!res.ok) throw new Error(`gamesheet firestore season ${seasonId} → HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  const out: any[] = [];
  for (const row of rows) {
    const entry = adaptGameDoc(row);
    if (entry) out.push(entry);
  }
  return out;
}
