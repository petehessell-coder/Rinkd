import React, { useState } from 'react';
import { downloadRosterTemplate, parseRoster, uploadRoster } from '../lib/roster';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C', amber: '#F59E0B', green: '#22C55E',
};

/**
 * "Upload Roster" affordance for team managers. Sits on TeamManage.
 *
 * Flow:
 *   1. Manager clicks "Upload Roster" → modal opens
 *   2. Downloads the CSV template (or uses their own with same columns)
 *   3. Picks the filled-in CSV — we parse + preview
 *   4. Clicks Send → INSERTs pending team_members + sends Resend invite per row
 *   5. Players get a branded email; signing up auto-links them to the team
 *
 * Props:
 *   teamId        — the team to add players to
 *   teamName      — used in the email subject + body
 *   invitedBy     — manager name shown in the email body
 *   onComplete    — callback after a successful upload (for the parent to reload the roster)
 */
export default function RosterUpload({ teamId, teamName, invitedBy, onComplete }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [filename, setFilename] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => { setParsed(null); setFilename(''); setResult(null); setSubmitting(false); };

  const close = () => { setOpen(false); reset(); };

  const handleFile = (file) => {
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      const out = parseRoster(text);
      setParsed(out);
    };
    reader.onerror = () => setParsed({ headers: [], rows: [], errors: ['Could not read that file.'] });
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!parsed) return;
    setSubmitting(true);
    setResult(null);
    const r = await uploadRoster({
      teamId, teamName, invitedBy,
      rows: parsed.rows,
    });
    setResult(r);
    setSubmitting(false);
    if (r.inserted > 0 && onComplete) onComplete();
  };

  const validCount = parsed ? parsed.rows.filter(r => !r.rowErrors.length).length : 0;
  const errorCount = parsed ? parsed.rows.length - validCount : 0;

  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '11px 18px', borderRadius: 999,
          background: B.red, border: 'none', color: '#fff',
          fontFamily: "'Barlow', sans-serif", fontSize: 14, fontWeight: 700,
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = B.ice; e.currentTarget.style.color = B.navy; }}
        onMouseLeave={e => { e.currentTarget.style.background = B.red; e.currentTarget.style.color = '#fff'; }}>
        <span style={{ fontSize: 16 }}>📋</span>
        <span>Upload Roster</span>
      </button>

      {open && (
        <div onClick={close}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 400,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 14,
                     maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
                     padding: '22px 24px', fontFamily: "'Barlow', sans-serif", color: B.ice }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase' }}>
                Upload Roster
              </div>
              <button onClick={close} style={{ background: 'none', border: 'none', color: B.steel, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}>✕</button>
            </div>

            <p style={{ fontSize: 13, color: B.steel, lineHeight: 1.6, marginBottom: 14 }}>
              Drop a CSV with one player per row. Each player gets a Rinkd signup invite and shows up
              on your roster as <strong style={{ color: B.amber }}>INVITED</strong> until they create an account.
            </p>

            {/* Step 1 — template */}
            <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', marginBottom: 4, fontFamily: "'Barlow Condensed', sans-serif" }}>
                Step 1 · Get the template
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13, color: B.ice }}>Columns: name, jersey_number, position, email</span>
                <button onClick={downloadRosterTemplate}
                  style={{ padding: '7px 14px', borderRadius: 999, background: 'transparent', border: `1px solid ${B.border}`, color: B.ice, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => { e.currentTarget.style.background = B.ice; e.currentTarget.style.color = B.navy; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = B.ice; }}>
                  ⬇ Download CSV
                </button>
              </div>
            </div>

            {/* Step 2 — file picker */}
            <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, padding: '14px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', marginBottom: 8, fontFamily: "'Barlow Condensed', sans-serif" }}>
                Step 2 · Upload your filled-in CSV
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 8, padding: '14px',
                border: `1px dashed ${B.border}`, borderRadius: 10,
                background: 'rgba(46,91,140,0.08)',
                cursor: 'pointer', fontSize: 13, color: B.ice,
              }}>
                <span style={{ fontSize: 18 }}>📂</span>
                <span>{filename ? filename : 'Choose CSV file…'}</span>
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                  onChange={e => handleFile(e.target.files?.[0])} />
              </label>
            </div>

            {/* Step 3 — preview */}
            {parsed && (
              <div style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
                    Step 3 · Preview
                  </div>
                  <div style={{ fontSize: 11, color: B.steel }}>
                    <span style={{ color: B.green }}>{validCount} valid</span>
                    {errorCount > 0 && <span style={{ color: B.red, marginLeft: 8 }}>{errorCount} with errors</span>}
                  </div>
                </div>

                {parsed.errors.length > 0 && (
                  <div style={{ fontSize: 12, color: B.red, marginBottom: 8, padding: '8px 10px', background: 'rgba(215,38,56,0.12)', borderRadius: 6 }}>
                    {parsed.errors.join(' · ')}
                  </div>
                )}

                <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12 }}>
                  {parsed.rows.map((r, i) => {
                    const bad = r.rowErrors.length > 0;
                    return (
                      <div key={i} style={{
                        display: 'flex', gap: 8, padding: '6px 0',
                        borderBottom: '0.5px solid rgba(244,247,250,0.06)',
                        opacity: bad ? 0.55 : 1,
                      }}>
                        <span style={{ width: 18, color: bad ? B.red : B.green, textAlign: 'center' }}>{bad ? '!' : '✓'}</span>
                        <span style={{ flex: '0 0 28px', color: B.steel }}>{r.jersey_number ?? '—'}</span>
                        <span style={{ flex: 2, color: B.ice }}>{r.name || '(missing name)'}</span>
                        <span style={{ flex: 1, color: B.steel }}>{r.position || '—'}</span>
                        <span style={{ flex: 2, color: B.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.email || '(missing email)'}</span>
                        {bad && <span style={{ color: B.red, flex: 1, textAlign: 'right' }}>{r.rowErrors.join(', ')}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 4 — submit */}
            {parsed && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button onClick={close}
                  style={{ flex: 1, padding: 11, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={submitting || validCount === 0}
                  style={{
                    flex: 2, padding: 11, borderRadius: 999,
                    background: submitting || validCount === 0 ? B.border : B.red,
                    border: 'none', color: '#fff', fontSize: 14, fontWeight: 700,
                    cursor: submitting || validCount === 0 ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}>
                  {submitting ? 'Sending invites…' : `Send ${validCount} invite${validCount === 1 ? '' : 's'}`}
                </button>
              </div>
            )}

            {/* Result message */}
            {result && (
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8,
                background: result.errors.length ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                border: `1px solid ${result.errors.length ? 'rgba(245,158,11,0.4)' : 'rgba(34,197,94,0.4)'}`,
                fontSize: 13, color: B.ice, lineHeight: 1.55 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {result.inserted > 0 ? `✓ Added ${result.inserted} ${result.inserted === 1 ? 'player' : 'players'} to ${teamName}` : 'No new players added.'}
                </div>
                <div style={{ color: B.steel }}>
                  {result.sent > 0 && `📬 Sent ${result.sent} invite ${result.sent === 1 ? 'email' : 'emails'}. `}
                  {result.skipped > 0 && `Skipped ${result.skipped} already on the team. `}
                  {result.capped > 0 && `${result.capped} more weren't sent — uploads cap at 50 per batch, so re-upload the rest. `}
                </div>
                {result.errors && result.errors.length > 0 && (
                  <ul style={{ fontSize: 12, color: B.amber, marginTop: 6, paddingLeft: 18 }}>
                    {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
