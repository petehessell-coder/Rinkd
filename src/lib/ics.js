/**
 * Tiny RFC-5545 ICS builder. Enough to produce a valid single-event .ics file
 * that opens cleanly in Apple Calendar (iOS/macOS), Google Calendar (via
 * import), and Outlook.
 *
 * All times serialized in UTC (the `Z` suffix), which is the safest for events
 * sourced from a TIMESTAMPTZ column.
 */

function pad(n) { return String(n).padStart(2, '0'); }

function toUtc(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return d.getUTCFullYear()
    + pad(d.getUTCMonth() + 1)
    + pad(d.getUTCDate()) + 'T'
    + pad(d.getUTCHours())
    + pad(d.getUTCMinutes())
    + pad(d.getUTCSeconds()) + 'Z';
}

// RFC 5545 §3.3.11 — escape commas, semicolons, backslashes, newlines.
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// Line folding: lines must be <=75 octets; continuation lines start with a space.
function fold(line) {
  if (line.length <= 75) return line;
  const out = [];
  out.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) {
    out.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return out.join('\r\n');
}

/**
 * Build an .ics string for a single game.
 *
 * @param {object} opts
 * @param {string} opts.uid          Unique id (use game UUID).
 * @param {string} opts.title        SUMMARY line ("Test Team 1 vs. Goats")
 * @param {Date|string} opts.start   Game start time.
 * @param {Date|string} [opts.end]   End time. Defaults to start + duration.
 * @param {number} [opts.durationMinutes=90]  If no end, use this.
 * @param {string} [opts.location]   Plain-text venue (street address ideal).
 * @param {string} [opts.description] Long description (free text).
 * @param {string} [opts.url]        Link back to the game page.
 */
export function buildIcs({ uid, title, start, end, durationMinutes = 90, location, description, url }) {
  const startDate = (start instanceof Date) ? start : new Date(start);
  const endDate = end
    ? ((end instanceof Date) ? end : new Date(end))
    : new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const dtstamp = toUtc(new Date());
  const dtstart = toUtc(startDate);
  const dtend = toUtc(endDate);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rinkd//Rinkd//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid || (Date.now() + '@rinkd.app')}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeText(title || 'Rinkd game')}`,
  ];

  if (location)    lines.push(`LOCATION:${escapeText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (url)         lines.push(`URL:${escapeText(url)}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * Build a single .ics calendar containing multiple VEVENT blocks — for
 * "Add full schedule" exports.
 *
 * @param {Array} events  Each item: same shape as buildIcs() opts.
 * @param {string} [calendarName]  Optional X-WR-CALNAME / NAME hint shown by
 *                                 some clients (Apple Calendar respects this).
 */
export function buildIcsMulti(events, calendarName) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rinkd//Rinkd//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (calendarName) {
    lines.push(`NAME:${escapeText(calendarName)}`);
    lines.push(`X-WR-CALNAME:${escapeText(calendarName)}`);
  }
  for (const ev of events) {
    if (!ev || !ev.start) continue;
    const startDate = (ev.start instanceof Date) ? ev.start : new Date(ev.start);
    const endDate = ev.end
      ? ((ev.end instanceof Date) ? ev.end : new Date(ev.end))
      : new Date(startDate.getTime() + ((ev.durationMinutes || 90) * 60 * 1000));
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid || (Date.now() + Math.random() + '@rinkd.app')}`,
      `DTSTAMP:${toUtc(new Date())}`,
      `DTSTART:${toUtc(startDate)}`,
      `DTEND:${toUtc(endDate)}`,
      `SUMMARY:${escapeText(ev.title || 'Rinkd game')}`,
    );
    if (ev.location)    lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.url)         lines.push(`URL:${escapeText(ev.url)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Trigger a download (or open-with-Calendar on iOS) for a built ICS string. */
export function downloadIcs(ics, filename = 'rinkd-game.ics') {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // iOS Safari ignores `download` and just navigates — that's fine, Calendar takes over.
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 600);
}
