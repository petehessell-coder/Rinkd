import { supabase } from './supabase';

const TEMPLATE_HEADERS = ['name', 'jersey_number', 'position', 'email'];

// Cap how many invites a single roster upload can fan out. Each row sends a
// Resend email and the free tier is ~150/day — an unbounded CSV could burn the
// whole quota at once. Rows past the cap are left for a follow-up upload.
const MAX_INVITES_PER_UPLOAD = 50;

/** Build a downloadable CSV template managers can fill in. */
export function buildRosterCsvTemplate() {
  const rows = [
    TEMPLATE_HEADERS,
    ['Mike Anderson', '11', 'Forward', 'mike@example.com'],
    ['Tom Becker',    '17', 'Defense', 'tom@example.com'],
    ['Jordan Kim',     '1', 'Goalie',  'jordan@example.com'],
  ];
  return rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadRosterTemplate() {
  const blob = new Blob([buildRosterCsvTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rinkd-roster-template.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 600);
}

// Minimal RFC-4180 CSV parser. Handles quoted fields, embedded commas, escaped quotes.
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"')      inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r'){ /* swallow; LF closes the row */ }
      else                 cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const ALIASES = {
  jersey: 'jersey_number',
  number: 'jersey_number',
  '#': 'jersey_number',
  player: 'name',
  player_name: 'name',
  full_name: 'name',
  pos: 'position',
  email_address: 'email',
  e_mail: 'email',
};

/**
 * Parse + validate a roster CSV string. Returns { headers, rows, errors }.
 * Each row gets a `rowErrors` array; only rows with no errors will be uploaded.
 */
export function parseRoster(text) {
  const raw = parseCsvText(text).filter(r => r.some(c => (c || '').trim() !== ''));
  if (raw.length === 0) return { headers: [], rows: [], errors: ['That file is empty.'] };

  const header = raw[0].map(h => (h || '').trim().toLowerCase().replace(/\s+/g, '_'));
  const normalized = header.map(h => ALIASES[h] || h);

  const idx = {};
  for (const t of TEMPLATE_HEADERS) idx[t] = normalized.indexOf(t);

  const errors = [];
  if (idx.name === -1)  errors.push('Missing required column: name');
  if (idx.email === -1) errors.push('Missing required column: email');

  const seen = new Set();
  const parsed = [];
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    const get = (k) => idx[k] >= 0 ? (row[idx[k]] || '').trim() : '';
    const item = {
      name: get('name'),
      jersey_number: get('jersey_number'),
      position: get('position'),
      email: get('email').toLowerCase(),
    };
    const rowErrors = [];
    if (!item.name)                                              rowErrors.push('name required');
    if (!item.email)                                              rowErrors.push('email required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email))      rowErrors.push('invalid email');
    if (item.jersey_number && !/^\d+$/.test(item.jersey_number))  rowErrors.push('jersey must be a number');
    if (item.email && seen.has(item.email))                       rowErrors.push('duplicate email');
    seen.add(item.email);
    parsed.push({
      ...item,
      jersey_number: item.jersey_number ? parseInt(item.jersey_number, 10) : null,
      rowErrors,
    });
  }

  return { headers: normalized, rows: parsed, errors };
}

/**
 * INSERT pending team_members for each valid row, then call the existing
 * send-invite Edge Function (which uses Resend) for each new row.
 *
 * Returns { inserted, sent, errors[] }.
 */
export async function uploadRoster({ teamId, teamName, invitedBy, rows }) {
  const valid = (rows || []).filter(r => !r.rowErrors || r.rowErrors.length === 0);
  if (valid.length === 0) return { inserted: 0, sent: 0, errors: ['No valid rows to upload.'] };

  // Skip any emails that already exist on this team (idempotent re-upload).
  // invite_email is column-revoked (YOUTH-PRIVACY) — read existing contacts via
  // the insider-gated RPC instead of a direct column select.
  const { data: existingEmails } = await supabase.rpc('team_invite_emails', { p_team_id: teamId });
  const skipSet = new Set((existingEmails || [])
    .map(e => (typeof e === 'string' ? e : e?.team_invite_emails))
    .filter(Boolean));
  const allToInsert = valid.filter(r => !skipSet.has(r.email));

  if (allToInsert.length === 0) {
    return { inserted: 0, sent: 0, errors: [], skipped: valid.length, capped: 0 };
  }

  // Anything past the per-upload cap is left for a follow-up upload.
  const capped = Math.max(0, allToInsert.length - MAX_INVITES_PER_UPLOAD);
  const toInsert = allToInsert.slice(0, MAX_INVITES_PER_UPLOAD);

  const inserts = toInsert.map(r => ({
    team_id: teamId,
    invite_name: r.name,
    invite_email: r.email,
    jersey_number: r.jersey_number,
    position: r.position || null,
    role: (r.position || '').toLowerCase() === 'goalie' ? 'goalie' : 'player',
    status: 'pending',
  }));

  // invite_email is column-revoked on read — don't select it back. We already
  // hold each row's email in `toInsert` (same order PostgREST returns), so zip
  // it in for the invite send below.
  const { data: insertedIds, error: insertError } = await supabase
    .from('team_members')
    .insert(inserts)
    .select('id, invite_name');

  if (insertError) return { inserted: 0, sent: 0, errors: [insertError.message], capped };
  const insertedRows = (insertedIds || []).map((row, i) => ({ ...row, invite_email: toInsert[i]?.email }));

  // Send invites in small concurrent chunks instead of firing every row at
  // once — a 20-row upload firing 20 simultaneous Edge Function invocations is
  // a cold-start storm. Chunked + lightly paced keeps it gentle on the free tier.
  const CHUNK = 4;
  const inviteResults = [];
  const rowsToInvite = insertedRows || [];
  for (let i = 0; i < rowsToInvite.length; i += CHUNK) {
    const chunk = rowsToInvite.slice(i, i + CHUNK);
    const chunkResults = await Promise.allSettled(
      chunk.map(row =>
        supabase.functions.invoke('send-invite', {
          body: {
            type: 'team_invite',
            to_email: row.invite_email,
            to_name: row.invite_name,
            team_name: teamName,
            invited_by: invitedBy,
          },
        })
      )
    );
    inviteResults.push(...chunkResults);
    if (i + CHUNK < rowsToInvite.length) await new Promise(r => setTimeout(r, 250));
  }

  let sent = 0;
  const errors = [];
  inviteResults.forEach((r, i) => {
    const email = insertedRows[i]?.invite_email || '?';
    if (r.status === 'fulfilled' && !r.value?.error) sent++;
    else errors.push(`${email}: ${r.status === 'rejected' ? r.reason : JSON.stringify(r.value?.error || 'send failed')}`);
  });

  return {
    inserted: insertedRows.length,
    sent,
    errors,
    skipped: valid.length - allToInsert.length,
    capped,
  };
}

/**
 * Auto-link pending invites when a user signs up. Called from auth.signUp
 * after the new auth.users row is created. Finds team_members rows with
 * matching invite_email + status='pending' and binds them to the new user.
 */
export async function linkPendingInvitesForUser(userId, email) {
  if (!userId || !email) return { linked: 0 };
  // invite_email is column-revoked (YOUTH-PRIVACY), so the client can't filter
  // on it directly. link_pending_team_invites is a SECURITY DEFINER RPC that
  // matches + binds pending slots for the CURRENT user (current_profile_id())
  // server-side — same effect, no contact column exposed.
  const { data, error } = await supabase.rpc('link_pending_team_invites', { p_email: String(email).toLowerCase() });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[roster] linkPendingInvitesForUser failed:', error.message);
    return { linked: 0, error };
  }
  return { linked: data || 0 };
}
