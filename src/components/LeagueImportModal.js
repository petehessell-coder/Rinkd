import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getLeagueTeams } from '../lib/leagues';
import { bulkInsertLeagueGames } from '../lib/scheduleBuilder';

// LeagueImportModal — paste teams + schedule from a spreadsheet and stand up a
// whole league in one shot. Kills the #1 onboarding friction (manual setup).
// Stupid-proof: paste → preview (every row checked) → import. Tab- or
// comma-separated, so copy/paste straight from Excel / Google Sheets works.
const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', dark:'#07111F', steel:'#8BA3BE', border:'#1E3A5C', green:'#22C55E', amber:'#F59E0B' };
const DEFAULT_TEAM_COLOR = '#2E5B8C';
const inputStyle = { width:'100%', background:'#07111F', border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 12px', color:C.ice, fontFamily:'Barlow, sans-serif', fontSize:14, outline:'none' };
const taStyle = { ...inputStyle, minHeight:120, fontFamily:'ui-monospace, Menlo, monospace', fontSize:13, lineHeight:1.5, resize:'vertical', whiteSpace:'pre' };

const norm = (s) => (s || '').trim().toLowerCase();
const initialsFrom = (name) => name.split(/\s+/).map(w => w[0]).join('').slice(0,3).toUpperCase();

// Split a pasted line on TAB if present (Excel paste), else comma (CSV).
const cells = (line) => (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim());

function parseTeams(text) {
  const out = [];
  const seen = new Set();
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [name, division] = cells(line);
    if (!name) continue;
    if (seen.has(norm(name))) continue;
    seen.add(norm(name));
    out.push({ name, division: (division || '').trim() });
  }
  return out;
}

function parseSchedule(text) {
  const out = [];
  (text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const c = cells(line);
    // Expected: Date, Time, Home, Away, [Rink]
    const [dateStr, timeStr, home, away, rink] = c;
    const problems = [];
    if (!home || !away) problems.push('missing team');
    let iso = null;
    const dt = new Date(`${dateStr || ''} ${timeStr || ''}`.trim());
    if (isNaN(dt.getTime())) problems.push('bad date/time'); else iso = dt.toISOString();
    out.push({ rowNum: i + 1, raw: line, dateStr, timeStr, home: (home || '').trim(), away: (away || '').trim(), rinkName: (rink || '').trim(), iso, problems });
  });
  return out;
}

export default function LeagueImportModal({ open, onClose, leagueId, existingTeams = [], rinks = [], divisionId = null, onImported }) {
  const [teamsText, setTeamsText] = useState('');
  const [schedText, setSchedText] = useState('');
  const [rinkId, setRinkId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { teams, games }

  useEffect(() => { if (open) { setTeamsText(''); setSchedText(''); setRinkId(''); setError(null); setDone(null); } }, [open]);

  const existingByName = useMemo(() => {
    const m = new Map();
    for (const lt of existingTeams) m.set(norm(lt.team?.name || lt.team_name), lt.id);
    return m;
  }, [existingTeams]);

  const parsedTeams = useMemo(() => parseTeams(teamsText), [teamsText]);
  const newTeams = useMemo(() => parsedTeams.filter(t => !existingByName.has(norm(t.name))), [parsedTeams, existingByName]);

  // Names known after import = existing + the ones we're about to create.
  const knownNames = useMemo(() => {
    const s = new Set(existingByName.keys());
    for (const t of parsedTeams) s.add(norm(t.name));
    return s;
  }, [existingByName, parsedTeams]);

  // Match an optional per-row rink name against existing rinks (by name /
  // sub-rink / combined). We never CREATE rinks here — add them under Rinks
  // first; an unmatched name falls back to the default and is flagged.
  const rinksByName = useMemo(() => {
    const m = new Map();
    for (const r of rinks) {
      const label = [r.sub_rink, r.name].filter(Boolean).join(' ');
      if (r.name) m.set(norm(r.name), r.id);
      if (r.sub_rink) m.set(norm(r.sub_rink), r.id);
      if (label) m.set(norm(label), r.id);
    }
    return m;
  }, [rinks]);

  const parsedGames = useMemo(() => {
    return parseSchedule(schedText).map(g => {
      const probs = [...g.problems];
      if (g.home && !knownNames.has(norm(g.home))) probs.push(`unknown team "${g.home}"`);
      if (g.away && !knownNames.has(norm(g.away))) probs.push(`unknown team "${g.away}"`);
      if (g.home && g.away && norm(g.home) === norm(g.away)) probs.push('home = away');
      // Per-row rink (optional): matched → use it; named-but-unmatched → soft
      // note + fall back to the default rink; blank → default rink.
      let resolvedRinkId = rinkId || null;
      let rinkNote = null;
      if (g.rinkName) {
        const m = rinksByName.get(norm(g.rinkName));
        if (m) resolvedRinkId = m;
        else rinkNote = `rink "${g.rinkName}" not found — using default (add it under Rinks to match)`;
      }
      return { ...g, resolvedRinkId, rinkNote, problems: probs, ok: probs.length === 0 };
    });
  }, [schedText, knownNames, rinksByName, rinkId]);

  const goodGames = parsedGames.filter(g => g.ok);
  const badGames = parsedGames.filter(g => !g.ok);
  const canImport = !busy && (newTeams.length > 0 || goodGames.length > 0);

  const runImport = async () => {
    setBusy(true); setError(null);
    try {
      // 1) Create any new teams via the canonical RPC.
      for (const t of newTeams) {
        const { error: e } = await supabase.rpc('create_league_team', {
          p_league_id: leagueId,
          p_team_name: t.name,
          p_logo_color: DEFAULT_TEAM_COLOR,
          p_logo_initials: initialsFrom(t.name),
          p_division: t.division || '',
          p_division_id: divisionId || null,
        });
        if (e) throw new Error(`Couldn't create the team "${t.name}" — ${e.message}`);
      }
      // 2) Re-fetch teams to map names → league_team ids (covers new + existing).
      const all = await getLeagueTeams(leagueId);
      const idByName = new Map();
      for (const lt of all) idByName.set(norm(lt.team?.name || lt.team_name), lt.id);

      // 3) Build + bulk-insert the schedule (only the clean rows).
      let gamesInserted = 0;
      if (goodGames.length > 0) {
        const rows = goodGames.map(g => ({
          home_team_id: idByName.get(norm(g.home)),
          away_team_id: idByName.get(norm(g.away)),
          start_time: g.iso,
          rink_id: g.resolvedRinkId || null,
        })).filter(r => r.home_team_id && r.away_team_id);
        if (rows.length > 0) {
          const { error: e } = await bulkInsertLeagueGames(leagueId, rows, divisionId || null);
          if (e) throw new Error(`Teams created, but the schedule didn't import — ${e.message}. Fix the flagged rows and try again.`);
          gamesInserted = rows.length;
        }
      }
      setDone({ teams: newTeams.length, games: gamesInserted });
      onImported?.();
    } catch (e) {
      setError(e.message || "That import didn't go through — nothing was lost. Fix the flagged rows and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:400, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:C.navy, border:`1px solid ${C.border}`, borderRadius:16, maxWidth:620, width:'100%', padding:'22px 24px', fontFamily:'Barlow, sans-serif', color:C.ice }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontStyle:'italic', fontWeight:900, fontSize:22, textTransform:'uppercase' }}>Import league from a spreadsheet</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.steel, fontSize:22, cursor:'pointer' }}>✕</button>
        </div>

        {done ? (
          <div style={{ padding:'14px 0' }}>
            <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.4)', borderRadius:12, padding:'16px', textAlign:'center', marginBottom:16 }}>
              <div style={{ fontSize:28, marginBottom:6 }}>✅</div>
              <div style={{ fontSize:15, fontWeight:700, color:C.green }}>Imported {done.teams} team{done.teams===1?'':'s'} and {done.games} game{done.games===1?'':'s'}</div>
              <div style={{ fontSize:12.5, color:C.steel, marginTop:6 }}>Your schedule and teams are live. Assign scorekeepers and you're ready to drop the puck.</div>
            </div>
            <button onClick={onClose} style={{ width:'100%', padding:13, borderRadius:999, background:C.red, border:'none', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize:13, color:C.steel, lineHeight:1.5, marginBottom:18 }}>
              Already have your league in a spreadsheet? Paste it here. Copy straight from Excel or Google Sheets — tabs and commas both work.
            </div>

            {/* TEAMS */}
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:C.steel, textTransform:'uppercase', marginBottom:6 }}>1 · Teams — one per line</div>
            <div style={{ fontSize:12, color:C.steel, marginBottom:6 }}>Just the team names. (Optional 2nd column = division.) Teams you already added are reused automatically.</div>
            <textarea value={teamsText} onChange={e => setTeamsText(e.target.value)} placeholder={'Red Wings\nBlue Jackets\nIce Hogs\nSharks'} style={taStyle} />
            <div style={{ fontSize:11.5, color: newTeams.length ? C.green : C.steel, margin:'6px 0 16px' }}>
              {parsedTeams.length === 0 ? 'No teams yet.' : `${parsedTeams.length} team${parsedTeams.length===1?'':'s'} pasted · ${newTeams.length} new to create · ${parsedTeams.length - newTeams.length} already exist`}
            </div>

            {/* SCHEDULE */}
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:C.steel, textTransform:'uppercase', marginBottom:6 }}>2 · Schedule — one game per line</div>
            <div style={{ fontSize:12, color:C.steel, marginBottom:6 }}>Format: <b style={{ color:C.ice }}>Date, Time, Home, Away</b><span style={{ opacity:0.75 }}>, Rink (optional — only for multi-rink leagues)</span> &nbsp;—&nbsp; e.g. <span style={{ fontFamily:'monospace' }}>9/20/2026, 7:00 PM, Red Wings, Sharks</span></div>
            <textarea value={schedText} onChange={e => setSchedText(e.target.value)} placeholder={'9/20/2026, 7:00 PM, Red Wings, Sharks\n9/20/2026, 8:15 PM, Ice Hogs, Blue Jackets\n9/27/2026, 7:00 PM, Sharks, Ice Hogs'} style={taStyle} />

            {rinks.length > 0 && (
              <div style={{ margin:'10px 0 4px' }}>
                <div style={{ fontSize:12, color:C.steel, marginBottom:4 }}>Default rink — used for any game that doesn't name its own rink (perfect for a single-building house league; multi-rink leagues can add a Rink column above):</div>
                <select value={rinkId} onChange={e => setRinkId(e.target.value)} style={inputStyle}>
                  <option value="">— No rink / set later —</option>
                  {rinks.map(r => <option key={r.id} value={r.id}>{[r.sub_rink, r.name].filter(Boolean).join(' · ')}</option>)}
                </select>
              </div>
            )}

            {/* PREVIEW */}
            {parsedGames.length > 0 && (
              <div style={{ margin:'14px 0', background:C.dark, border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden' }}>
                <div style={{ padding:'8px 12px', fontSize:12, fontWeight:700, color:C.ice, borderBottom:`1px solid ${C.border}` }}>
                  Preview · <span style={{ color:C.green }}>{goodGames.length} ready</span>{badGames.length > 0 && <> · <span style={{ color:C.amber }}>{badGames.length} need a fix</span></>}
                </div>
                <div style={{ maxHeight:200, overflowY:'auto' }}>
                  {parsedGames.map((g, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'7px 12px', borderBottom:'0.5px solid rgba(244,247,250,0.06)', fontSize:12.5 }}>
                      <span style={{ color: g.ok ? C.green : C.amber, fontWeight:700, flexShrink:0 }}>{g.ok ? '✓' : '⚠'}</span>
                      <span style={{ flex:1, color: g.ok ? C.ice : C.steel }}>
                        {g.home || '—'} vs {g.away || '—'} <span style={{ color:C.steel }}>{g.iso ? `· ${new Date(g.iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}` : ''}</span>
                        {g.ok && g.rinkNote && <span style={{ display:'block', color:C.steel, fontSize:11 }}>{g.rinkNote}</span>}
                        {!g.ok && <span style={{ display:'block', color:C.amber, fontSize:11 }}>row {g.rowNum}: {g.problems.join(', ')}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                {badGames.length > 0 && <div style={{ padding:'7px 12px', fontSize:11.5, color:C.steel }}>Flagged rows are skipped — fix the names/dates above and they'll turn green. (Team names must match exactly.)</div>}
              </div>
            )}

            {error && <div style={{ background:'rgba(215,38,56,0.12)', border:'1px solid rgba(215,38,56,0.4)', borderRadius:8, padding:'10px 12px', margin:'8px 0', fontSize:12.5, color:C.ice }}>{error}</div>}

            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <button onClick={onClose} style={{ flex:1, padding:12, borderRadius:999, background:'rgba(244,247,250,0.08)', border:'none', color:C.steel, fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
              <button onClick={runImport} disabled={!canImport} style={{ flex:2, padding:12, borderRadius:999, background: canImport ? C.red : C.border, border:'none', color:'#fff', fontSize:14, fontWeight:700, cursor: canImport ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>
                {busy ? 'Importing…' : `Import ${newTeams.length} team${newTeams.length===1?'':'s'} + ${goodGames.length} game${goodGames.length===1?'':'s'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
