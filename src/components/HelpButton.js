import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

/**
 * Floating "?" button bottom-right of every page. Opens a help panel with:
 *   - Quick FAQ
 *   - Report a bug / send feedback form (writes to bug_reports)
 *   - Direct mailto link as fallback
 *
 * Anyone (incl. logged-out users on the auth screen) can submit feedback —
 * RLS allows anonymous inserts so the help channel never goes dark.
 */

const FAQ = [
  {
    q: 'How do I join a team?',
    a: 'Tap Discover → search for your team → "Request to Join." Your manager gets an instant notification and approves you from the team page.',
  },
  {
    q: 'How do I create a team or league?',
    a: 'In the sidebar menu, scroll to "Teams" or "Leagues" → tap the create button. League creation is open to anyone — once you create it you become commissioner.',
  },
  {
    q: 'How do I enable push notifications?',
    a: 'On your Profile, tap the "🔔 Notify" button next to Edit. If you blocked notifications earlier, you\'ll need to re-enable them in your browser site permissions first.',
  },
  {
    q: 'How do I subscribe to my team\'s schedule on my calendar?',
    a: 'On any team or league page, go to the Schedule tab and tap the red "📡 Subscribe (Live)" pill. iOS/Mac Calendar will subscribe automatically; on Android / desktop browsers we copy a Google Calendar URL to your clipboard.',
  },
  {
    q: 'I forgot my password.',
    a: 'On the sign-in screen, tap "Forgot password?" under the sign-in button. We\'ll send a reset link to your email — usually arrives within a minute.',
  },
  {
    q: 'How do I change my profile picture?',
    a: 'Go to your Profile and tap the small 📷 badge on your avatar. Up to 5 MB, any common image format. The same flow works for your cover photo at the top of the page.',
  },
  {
    q: 'Can I post photos and videos?',
    a: 'Yes — tap the 📷 icon in the feed composer. Up to 10 MB for photos, 50 MB for videos. Goal clips and game recaps are exactly what we want to see.',
  },
  {
    q: 'How do I see new posts as they happen?',
    a: 'Your Feed updates whenever you switch tabs back to Rinkd. The bell icon in the top right shows when someone likes, comments, or follows you in real time.',
  },
  {
    q: 'Is my data private?',
    a: 'We never sell or share your data. Posts you create are visible to other Rinkd users by default; team-scoped posts only show on that team\'s page. Read the full policy at rinkd.app/privacy.',
  },
  {
    q: 'How do I delete my account?',
    a: 'Account deletion + data export are landing this week. In the meantime, email hello@rinkd.app and we\'ll handle it the same day.',
  },
];

export default function HelpButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('faq'); // faq | report
  const [category, setCategory] = useState('bug');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [userId, setUserId] = useState(null);
  const [knownEmail, setKnownEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (user) {
          setUserId(user.id);
          setKnownEmail(user.email || '');
          setEmail(user.email || '');
        }
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    track('help_panel_opened');
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from('bug_reports').insert({
      user_id: userId || null,
      email: (email || knownEmail || '').trim() || null,
      description: description.trim(),
      url: typeof window !== 'undefined' ? window.location.pathname + window.location.search : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      category,
    });
    setSubmitting(false);
    if (error) { alert('Failed to submit: ' + error.message); return; }
    track('bug_report_submitted', { category });
    setSubmitted(true);
    setDescription('');
    setTimeout(() => { setOpen(false); setSubmitted(false); setTab('faq'); }, 1400);
  };

  return (
    <>
      {/* Floating trigger — bottom-right, lifted above mobile bottom nav */}
      <button onClick={() => setOpen(true)} aria-label="Help & feedback"
        style={{
          position: 'fixed',
          right: 'max(16px, env(safe-area-inset-right))',
          bottom: 'calc(80px + env(safe-area-inset-bottom))',
          width: 48, height: 48, borderRadius: '50%',
          background: C.red, color: '#fff', border: 'none',
          fontSize: 22, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 950,
          fontFamily: "'Barlow', sans-serif",
        }}>
        ?
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9990,
            background: 'rgba(7,17,31,0.85)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: 0,
            fontFamily: "'Barlow', sans-serif",
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18,
              width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
              color: C.ice, boxShadow: '0 -20px 50px rgba(0,0,0,0.5)',
            }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.card, zIndex: 2 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, lineHeight: 1.1, textTransform: 'uppercase' }}>
                Help & Feedback
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close"
                style={{ background: 'transparent', color: C.steel, border: 'none', fontSize: 24, cursor: 'pointer', padding: 4, lineHeight: 1 }}>
                ×
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.navy }}>
              {[['faq', '📖 FAQ'], ['report', '🐛 Report / Idea']].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  style={{
                    flex: 1, padding: '12px 16px',
                    background: 'transparent', color: tab === id ? C.ice : C.steel,
                    border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: tab === id ? 700 : 500,
                    borderBottom: tab === id ? `3px solid ${C.red}` : '3px solid transparent',
                    fontFamily: 'Barlow, sans-serif',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div style={{ padding: '14px 18px 26px' }}>
              {tab === 'faq' && (
                <div>
                  {FAQ.map(({ q, a }) => (
                    <details key={q} style={{ borderBottom: '1px solid rgba(46,91,140,0.25)', padding: '10px 0' }}>
                      <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: C.ice, listStyle: 'none', position: 'relative', paddingRight: 24 }}>
                        <span style={{ position: 'absolute', right: 0, top: 0, color: C.steel }}>+</span>
                        {q}
                      </summary>
                      <p style={{ fontSize: 13, color: C.steel, lineHeight: 1.55, margin: '8px 0 4px' }}>{a}</p>
                    </details>
                  ))}
                  <div style={{ marginTop: 18, padding: 14, background: C.navy, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, color: C.steel, lineHeight: 1.55 }}>
                    Didn't find it? <button onClick={() => setTab('report')} style={{ background: 'none', border: 'none', color: C.red, textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>Send us a message</button> or email <a href="mailto:hello@rinkd.app" style={{ color: C.ice, textDecoration: 'underline' }}>hello@rinkd.app</a>.
                  </div>
                </div>
              )}

              {tab === 'report' && (
                submitted ? (
                  <div style={{ textAlign: 'center', padding: '30px 0' }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase', marginBottom: 6 }}>
                      Thanks — got it.
                    </div>
                    <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.55 }}>
                      We'll take a look and follow up if we need more info.
                    </div>
                  </div>
                ) : (
                  <form onSubmit={submit}>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 11, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 6 }}>What is it?</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[
                          ['bug', '🐛 Bug'],
                          ['idea', '💡 Idea'],
                          ['question', '❓ Question'],
                          ['other', '✉️ Other'],
                        ].map(([id, label]) => (
                          <button key={id} type="button" onClick={() => setCategory(id)}
                            style={{
                              background: category === id ? C.red : 'transparent',
                              color: category === id ? '#fff' : C.steel,
                              border: `1px solid ${category === id ? C.red : C.border}`,
                              padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                              fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif',
                            }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 11, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 6 }}>What happened?</label>
                      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder={category === 'bug' ? 'What did you do, what did you expect, and what happened instead?'
                          : category === 'idea' ? 'What\'s the idea? Even half-baked thoughts are welcome.'
                          : 'Tell us what\'s on your mind…'}
                        rows={5} maxLength={2000} required
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          background: C.navy, border: `1px solid ${C.border}`, color: C.ice,
                          padding: '10px 12px', borderRadius: 8,
                          fontSize: 14, lineHeight: 1.5,
                          fontFamily: 'Barlow, sans-serif', outline: 'none', resize: 'vertical',
                        }} />
                    </div>

                    {!knownEmail && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 11, color: C.steel, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 6 }}>Email (optional)</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                          placeholder="So we can follow up"
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            background: C.navy, border: `1px solid ${C.border}`, color: C.ice,
                            padding: '10px 12px', borderRadius: 8,
                            fontSize: 14, fontFamily: 'Barlow, sans-serif', outline: 'none',
                          }} />
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: C.steel, marginBottom: 12, lineHeight: 1.55 }}>
                      We'll capture your current page ({typeof window !== 'undefined' ? window.location.pathname : '/'}) automatically so we can reproduce it.
                    </div>

                    <button type="submit" disabled={!description.trim() || submitting}
                      style={{
                        width: '100%', padding: 13, borderRadius: 10,
                        background: !description.trim() || submitting ? C.border : C.red,
                        color: '#fff', border: 'none',
                        fontFamily: "'Barlow Condensed', sans-serif",
                        fontWeight: 700, fontStyle: 'italic', fontSize: 16, textTransform: 'uppercase',
                        cursor: !description.trim() || submitting ? 'not-allowed' : 'pointer', letterSpacing: '0.05em',
                      }}>
                      {submitting ? 'Sending…' : 'Send It →'}
                    </button>

                    <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: C.steel }}>
                      Prefer email? <a href={`mailto:hello@rinkd.app?subject=Rinkd%20${category}`} style={{ color: C.ice, textDecoration: 'underline' }}>hello@rinkd.app</a>
                    </div>
                  </form>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
