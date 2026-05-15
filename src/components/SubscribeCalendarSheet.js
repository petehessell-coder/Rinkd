import React, { useEffect, useState } from 'react';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C',
};

/**
 * SubscribeCalendarSheet — modal/popover for subscribing to a live calendar
 * feed (.ics auto-updating).
 *
 * Why this exists: the old "📡 Subscribe (Live)" button assumed every Apple-
 * userAgent device would route webcal:// to Calendar.app, and copied a URL
 * to the clipboard on everything else. In practice, desktop Chrome on Mac
 * silently drops the webcal:// handoff if Calendar.app isn't the default
 * calendar app, and the user gets no feedback at all — the button looks
 * dead. This sheet replaces that with three explicit, visible options that
 * each work on every platform.
 *
 * Props:
 *   - open: boolean — controls visibility
 *   - onClose: () => void — closes the sheet
 *   - httpsUrl: string — the public https URL of the .ics feed (used for
 *       Google Calendar and clipboard copy)
 *   - webcalUrl: string — the webcal:// version (used for the Apple option)
 *   - title: string — what's being subscribed to, e.g. "the Otters schedule"
 */
export default function SubscribeCalendarSheet({ open, onClose, httpsUrl, webcalUrl, title = 'this schedule' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) { setCopied(false); return; }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Defensive: if the feed URLs haven't been built yet (e.g. the team/league
  // is still loading), don't render dead action buttons — show a brief note.
  if (!httpsUrl || !webcalUrl) {
    return (
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(7, 17, 31, 0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, maxWidth: 420, width: '100%', padding: '20px 22px', fontFamily: "'Barlow', sans-serif", color: C.steel, fontSize: 14, textAlign: 'center' }}>
          The calendar feed isn't ready yet — give it a moment and try again.
          <div style={{ marginTop: 14 }}>
            <button onClick={onClose} style={{ background: C.navy, border: `1px solid ${C.border}`, color: C.ice, borderRadius: 10, padding: '10px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback: surface the URL so the user can copy it manually.
      // eslint-disable-next-line no-alert
      window.prompt('Copy this calendar URL:', httpsUrl);
    }
  };

  const googleUrl = `https://calendar.google.com/calendar/u/0/r/settings/addbyurl?cid=${encodeURIComponent(httpsUrl)}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(7, 17, 31, 0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 16,
        animation: 'rinkd-fade-in 0.15s ease-out',
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          maxWidth: 420, width: '100%', padding: '20px 22px 22px',
          fontFamily: "'Barlow', sans-serif", color: C.ice,
          boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
            fontSize: 24, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1,
          }}>
            Subscribe (Live)
          </div>
          <button onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', color: C.steel, border: 'none',
              cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px',
            }}>×</button>
        </div>
        <div style={{ color: C.steel, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
          Subscribe to {title} so it auto-updates in your calendar app when games are rescheduled.
        </div>

        {/* Apple */}
        <a
          href={webcalUrl}
          onClick={() => setTimeout(onClose, 250)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 10,
            borderRadius: 10, background: C.navy, border: `1px solid ${C.border}`,
            textDecoration: 'none', color: C.ice, cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.blue + '33'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = C.navy; }}>
          <span style={{ fontSize: 22 }}>🍎</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Apple Calendar</div>
            <div style={{ fontSize: 12, color: C.steel }}>iPhone, iPad, or Mac with Calendar.app</div>
          </div>
          <span style={{ color: C.steel, fontSize: 18 }}>→</span>
        </a>

        {/* Google */}
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setTimeout(onClose, 250)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 10,
            borderRadius: 10, background: C.navy, border: `1px solid ${C.border}`,
            textDecoration: 'none', color: C.ice, cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.blue + '33'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = C.navy; }}>
          <span style={{ fontSize: 22 }}>📅</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Google Calendar</div>
            <div style={{ fontSize: 12, color: C.steel }}>Opens Google Calendar with the URL prefilled</div>
          </div>
          <span style={{ color: C.steel, fontSize: 18 }}>→</span>
        </a>

        {/* Copy link — universal fallback (Outlook, Fantastical, any .ics-aware app) */}
        <button
          onClick={handleCopy}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
            borderRadius: 10, background: C.navy, border: `1px solid ${C.border}`,
            cursor: 'pointer', color: C.ice, textAlign: 'left',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.blue + '33'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = C.navy; }}>
          <span style={{ fontSize: 22 }}>{copied ? '✓' : '🔗'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{copied ? 'Copied!' : 'Copy Link'}</div>
            <div style={{ fontSize: 12, color: C.steel }}>
              {copied ? 'Paste into any calendar app that subscribes to .ics' : 'For Outlook, Fantastical, or any other calendar'}
            </div>
          </div>
        </button>

        <div style={{ fontSize: 11, color: C.steel, marginTop: 14, lineHeight: 1.45, textAlign: 'center' }}>
          The calendar auto-refreshes when games are added or rescheduled — no need to re-import.
        </div>
      </div>

      <style>{`@keyframes rinkd-fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}
