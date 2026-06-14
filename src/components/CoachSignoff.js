import React, { useRef, useState, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { supabase } from '../lib/supabase';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', dark:'#07111F', steel:'#8BA3BE', green:'#22C55E' };
const inputStyle = { width:'100%', background:'#07111F', border:'0.5px solid rgba(46,91,140,0.5)', borderRadius:8, padding:'10px 12px', color:C.ice, fontFamily:'Barlow, sans-serif', fontSize:14, outline:'none' };

// GS-6 — pre-game coach roster sign-off (USA Hockey Rule 505). The coach
// reviews the dressed roster and signs to certify it, BEFORE the game. Runs on
// the scorer's device (GameSheet model). Stupid-proof: the roster is already
// loaded — the coach just reads it and signs. Name + signature required; CEP
// optional (it's self-attested, same as paper).
export default function CoachSignoff({ game, isLeague, teamId, teamName, role, roster = [], onSigned, onRosterChanged, onClose }) {
  const sigRef = useRef(null);
  const [name, setName] = useState('');
  const [cep, setCep] = useState('');
  const [cepLevel, setCepLevel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Local copy so a last-minute scratch updates the list instantly while the
  // RPC persists in the background. Seeded from (and re-synced to) the prop.
  const [rows, setRows] = useState(roster);
  const [togglingId, setTogglingId] = useState(null);
  useEffect(() => { setRows(roster); }, [roster]);

  // Tap a player to flip dressed ↔ scratched (the last-minute "didn't show /
  // sick" case — works for skaters AND goalies; scratching one of two goalies
  // leaves the other as the sole dressed goalie). Optimistic, with rollback.
  const toggleStatus = async (row) => {
    if (togglingId) return;
    const next = row.roster_status === 'scratched' ? 'dressed' : 'scratched';
    setTogglingId(row.id);
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, roster_status: next } : r));
    const { error: rpcErr } = await supabase.rpc('set_lineup_roster_status', { p_lineup_id: row.id, p_status: next });
    setTogglingId(null);
    if (rpcErr) {
      // rollback the optimistic flip
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, roster_status: row.roster_status } : r));
      setError(rpcErr.message || 'Could not update the roster — check your connection and try again.');
      return;
    }
    setError(null);
    onRosterChanged?.();
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Enter the coach name.'); return; }
    if (!sigRef.current || sigRef.current.isEmpty()) { setError('Please sign in the box above.'); return; }
    setBusy(true);
    try {
      const { error: rpcErr } = await supabase.rpc('record_game_signoff', {
        p_game_id: game.id,
        p_game_source: isLeague ? 'league' : 'tournament',
        p_role: role,                 // 'home_coach' | 'visiting_coach'
        p_phase: 'pre_game',
        p_team_id: teamId,
        p_printed_name: name.trim(),
        p_signature_path: sigRef.current.toDataURL('image/png'),
        p_cep_number: cep.trim() || null,
        p_cep_level: cepLevel.trim() || null,
        p_cep_year: null,
        p_official_designation: null,
        p_is_head_coach: true,
      });
      if (rpcErr) { setError(rpcErr.message || 'Could not save the signature — check your connection and try again.'); setBusy(false); return; }
      onSigned?.();
      onClose?.();
    } catch (e) {
      setError('Could not save the signature — check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:320, overflowY:'auto', padding:16 }}>
      <div style={{ background:C.navy, borderRadius:16, maxWidth:460, margin:'0 auto', padding:20 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontFamily:'Barlow Condensed, sans-serif', fontStyle:'italic', fontWeight:900, fontSize:20, color:C.ice }}>Coach — sign your roster</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(244,247,250,0.5)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize:13, color:C.steel, marginBottom:14 }}>{teamName}</div>

        {/* Roster review — tap a player to scratch them (last-minute out). */}
        <div style={{ fontSize:11, fontWeight:700, color:'rgba(244,247,250,0.45)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>Your roster ({rows.filter(r => r.roster_status !== 'scratched').length} dressed)</div>
        <div style={{ fontSize:11, color:C.steel, marginBottom:6 }}>Tap a player to mark them out (scratched), then sign.</div>
        <div style={{ background:C.dark, border:'0.5px solid rgba(46,91,140,0.4)', borderRadius:10, overflow:'hidden', marginBottom:16, maxHeight:260, overflowY:'auto' }}>
          {rows.length === 0 && <div style={{ padding:14, color:C.steel, fontSize:13, textAlign:'center' }}>No lineup set for this team yet — set it first.</div>}
          {rows.map(p => {
            const scratched = p.roster_status === 'scratched';
            return (
              <div key={p.id || p.jersey} onClick={() => toggleStatus(p)}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', minHeight:44, borderBottom:'0.5px solid rgba(244,247,250,0.06)', cursor:'pointer', background: scratched ? 'rgba(215,38,56,0.07)' : 'transparent', opacity: togglingId === p.id ? 0.5 : 1, WebkitTapHighlightColor:'transparent' }}>
                <span style={{ fontFamily:'Barlow Condensed, sans-serif', fontStyle:'italic', fontWeight:900, fontSize:15, color:'rgba(244,247,250,0.6)', width:30, textAlign:'right', textDecoration: scratched ? 'line-through' : 'none' }}>#{p.jersey}</span>
                <span style={{ fontSize:13, color: scratched ? 'rgba(244,247,250,0.4)' : C.ice, flex:1, textDecoration: scratched ? 'line-through' : 'none' }}>{p.name || 'Unnamed'}{p.is_goalie ? '  🥅' : ''}</span>
                {p.is_captain && !scratched ? <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'rgba(215,38,56,0.2)', color:C.red }}>C</span> : p.is_alternate && !scratched ? <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'rgba(46,91,140,0.4)', color:C.steel }}>A</span> : null}
                {scratched
                  ? <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'rgba(215,38,56,0.18)', color:C.red, whiteSpace:'nowrap' }}>OUT — tap to undo</span>
                  : <span style={{ fontSize:16, color:'rgba(244,247,250,0.25)' }}>○</span>}
              </div>
            );
          })}
        </div>

        <div style={{ marginBottom:10 }}><input placeholder="Head coach name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></div>
        <div style={{ display:'flex', gap:8, marginBottom:14 }}>
          <input placeholder="CEP # (optional)" value={cep} onChange={e => setCep(e.target.value)} style={{ ...inputStyle, flex:2 }} />
          <input placeholder="CEP level" value={cepLevel} onChange={e => setCepLevel(e.target.value)} style={{ ...inputStyle, flex:1 }} />
        </div>

        <div style={{ fontSize:11, fontWeight:700, color:'rgba(244,247,250,0.45)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>Sign here</div>
        <div style={{ background:'#fff', borderRadius:8, border:'0.5px solid rgba(46,91,140,0.5)', overflow:'hidden', marginBottom:4 }}>
          <SignatureCanvas ref={sigRef} penColor="#0B1F3A" canvasProps={{ width:420, height:110, style:{ width:'100%', height:110 } }} />
        </div>
        <button onClick={() => sigRef.current?.clear()} style={{ background:'none', border:'none', color:'rgba(244,247,250,0.4)', fontSize:11, cursor:'pointer', fontFamily:'Barlow, sans-serif', marginBottom:14 }}>Clear</button>

        <div style={{ fontSize:11, color:C.steel, lineHeight:1.5, marginBottom:14 }}>
          By signing, the coach certifies this roster is correct for this game (USA Hockey Rule 505).
        </div>

        {error && <div style={{ background:'rgba(215,38,56,0.12)', border:'0.5px solid rgba(215,38,56,0.4)', borderRadius:8, padding:'9px 12px', marginBottom:12, fontSize:12.5, color:'#F4F7FA' }}>{error}</div>}

        <button onClick={submit} disabled={busy}
          style={{ width:'100%', padding:14, background:busy?'rgba(46,91,140,0.4)':C.red, border:'none', borderRadius:999, color:'#fff', fontSize:15, fontWeight:700, cursor:busy?'not-allowed':'pointer', fontFamily:'Barlow, sans-serif' }}>
          {busy ? 'Saving…' : '✓ Sign roster'}
        </button>
      </div>
    </div>
  );
}
