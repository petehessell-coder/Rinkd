import React, { useRef, useState, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', dark:'#07111F' };
const inputStyle = { width:'100%', background:'#07111F', border:'0.5px solid rgba(46,91,140,0.5)', borderRadius:8, padding:'8px 12px', color:C.ice, fontFamily:'Barlow, sans-serif', fontSize:13, outline:'none' };

// USA Hockey classification → the label printed on the official sheet.
const CLASS_LABEL = { tier1:'Tier I', tier2:'Tier II', girls_women:'Girls/Women', high_school:'High School', house_rec:'House/Rec', adult:'Adult' };

function SigPad({ label, sigRef, onClear }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize:11, fontWeight:700, color:'rgba(244,247,250,0.4)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>{label}</div>
      <div style={{ background:'#fff', borderRadius:8, border:'0.5px solid rgba(46,91,140,0.5)', overflow:'hidden' }}>
        <SignatureCanvas ref={sigRef} penColor="#0B1F3A" canvasProps={{ width:420, height:100, style:{ width:'100%', height:100 } }} />
      </div>
      <button onClick={onClear} style={{ marginTop:4, background:'none', border:'none', color:'rgba(244,247,250,0.4)', fontSize:11, cursor:'pointer', fontFamily:'Barlow, sans-serif' }}>Clear</button>
    </div>
  );
}

function StatusRow({ icon, label, status, skippedLabel }) {
  const color = status === 'success' ? '#22C55E'
    : status === 'error' ? C.red
    : status === 'loading' ? '#F59E0B'
    : status === 'skipped' ? 'rgba(244,247,250,0.5)'
    : 'rgba(244,247,250,0.3)';
  const symbol = status === 'success' ? '✓'
    : status === 'error' ? '✗'
    : status === 'loading' ? '...'
    : status === 'skipped' ? '—'
    : '–';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'0.5px solid rgba(244,247,250,0.06)' }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ flex:1, fontSize:13, color:'rgba(244,247,250,0.6)' }}>{status === 'skipped' && skippedLabel ? skippedLabel : label}</span>
      <span style={{ fontSize:13, fontWeight:700, color }}>{symbol}</span>
    </div>
  );
}

export default function Scoresheet({ game, goals, penalties, shots, goalieChanges, lineups = [], suspensions = [], isLeague = false, onClose }) {
  // Officials (post-game). Scorer is new + required for compliant mode.
  const scorerRef = useRef(null);
  const refRef = useRef(null);
  const lines1Ref = useRef(null);
  const lines2Ref = useRef(null);
  const [scorerName, setScorerName] = useState("");
  const [refName, setRefName] = useState("");
  const [refLevel, setRefLevel] = useState("");
  const [lines1Name, setLines1Name] = useState("");
  const [lines2Name, setLines2Name] = useState("");
  const [phase, setPhase] = useState("sign");
  const [status, setStatus] = useState({ pdf:"pending", storage:"pending", email:"pending" });
  const [signoffStatus, setSignoffStatus] = useState("pending");

  const ctx = isLeague ? (game.league || {}) : (game.tournament || {});
  const compliant = !!ctx.usah_compliant_scoresheet;

  // Pre-game coach sign-offs feed the coaches block + their signatures.
  const [coachSignoffs, setCoachSignoffs] = useState([]);
  useEffect(() => {
    if (!compliant || !game?.id) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.from('game_signoffs').select('*')
        .eq('game_id', game.id).eq('game_source', isLeague ? 'league' : 'tournament')
        .eq('phase', 'pre_game');
      if (alive) setCoachSignoffs(data || []);
    })();
    return () => { alive = false; };
  }, [compliant, game?.id, isLeague]);

  const homeTeam = isLeague ? (game.home_team?.team?.name || game.home_team?.team_name || game.home_lt?.team?.name || game.home_lt?.team_name || "Home") : (game.home_team?.team_name || "Home");
  const awayTeam = isLeague ? (game.away_team?.team?.name || game.away_team?.team_name || game.away_lt?.team?.name || game.away_lt?.team_name || "Away") : (game.away_team?.team_name || "Away");
  const homeId = game.home_team?.id || game.home_lt?.id;
  const awayId = game.away_team?.id || game.away_lt?.id;
  const contextName = isLeague ? (ctx.name || "League") : (ctx.name || "Tournament");
  const rink = game.rink ? ((game.rink.sub_rink || "") + " · " + game.rink.name).replace(/^\s*·\s*/, "") : "";
  const periodLabel = (p) => p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : p === 4 ? "OT" : "SO";
  const teamName = (id) => id === homeId ? homeTeam : awayTeam;
  const goalType = (g) => g.empty_net ? "EN" : g.is_shootout ? "SO" : "EV";
  const fmtTime = (iso) => { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" }); } catch { return ""; } };
  const rosterFor = (teamId) => lineups
    .filter(l => l.team_id === teamId && l.jersey_number != null)
    .sort((a,b) => (a.is_goalie === b.is_goalie ? (a.jersey_number ?? 999) - (b.jersey_number ?? 999) : (a.is_goalie ? -1 : 1)));
  const coachesFor = (teamId) => coachSignoffs
    .filter(s => s.team_id === teamId && (s.role === 'home_coach' || s.role === 'visiting_coach'))
    .sort((a,b) => (b.is_head_coach ? 1 : 0) - (a.is_head_coach ? 1 : 0));

  // ── Compliant roster + coaches block (drawn before the scoring tables) ──────
  const drawComplianceBlocks = (doc, margin, pageW, startY) => {
    let y = startY;
    [[homeId, homeTeam, "HOME"], [awayId, awayTeam, "VISITOR"]].forEach(([id, name, tag]) => {
      const roster = rosterFor(id);
      const coaches = coachesFor(id);
      doc.setFillColor(11,31,58); doc.rect(margin, y, pageW-margin*2, 7, "F");
      doc.setTextColor(244,247,250); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text(`${tag} — ${name}`, margin+3, y+5);
      y += 9;
      // roster table
      const rosterRows = roster.map(p => [
        p.is_goalie ? "G" : (p.position || ""),
        "#" + p.jersey_number,
        (p.invite_name || "").trim() + (p.is_captain ? "  (C)" : p.is_alternate ? "  (A)" : ""),
        p.roster_status && p.roster_status !== 'dressed' ? p.roster_status.toUpperCase() : "",
      ]);
      if (rosterRows.length === 0) rosterRows.push(["", "", "— no lineup set —", ""]);
      autoTable(doc, { startY:y, head:[["Pos","#","Player","Status"]], body:rosterRows,
        headStyles:{fillColor:[46,91,140],textColor:[244,247,250],fontSize:7,fontStyle:"bold"},
        bodyStyles:{fontSize:7.5,textColor:[17,17,17]}, alternateRowStyles:{fillColor:[248,250,252]},
        columnStyles:{0:{cellWidth:14},1:{cellWidth:14},3:{cellWidth:24}},
        didParseCell:(d)=>{ if(d.section==='body' && roster[d.row.index] && roster[d.row.index].roster_status && roster[d.row.index].roster_status!=='dressed'){ d.cell.styles.textColor=[150,150,150]; } },
        margin:{left:margin,right:margin}, theme:"grid", tableLineColor:[200,200,200], tableLineWidth:0.1 });
      y = doc.lastAutoTable.finalY + 3;
      // coaches line
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(11,31,58);
      doc.text("Coaches:", margin, y+2);
      doc.setFont("helvetica","normal"); doc.setTextColor(60,60,60);
      const coachText = coaches.length
        ? coaches.map(c => `${c.is_head_coach ? "HC " : ""}${c.printed_name}${c.cep_number ? ` (CEP ${c.cep_number}${c.cep_level ? `/L${c.cep_level}` : ""})` : ""} ✓ signed`).join("    ")
        : "________________________  (pre-game signature required)";
      doc.text(coachText, margin+16, y+2, { maxWidth: pageW - margin*2 - 16 });
      y += 9;
    });
    return y + 1;
  };

  const buildDoc = () => {
    const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"letter" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 14;

    // ── Header ────────────────────────────────────────────────────────────────
    doc.setFillColor(11,31,58); doc.rect(margin,y,pageW-margin*2,16,"F");
    doc.setTextColor(244,247,250); doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text("RINKD", margin+4, y+10);
    doc.setFontSize(10); doc.setFont("helvetica","normal");
    doc.text(compliant ? "Official Game Scoresheet · USA Hockey" : "Official Game Scoresheet", margin+4, y+14.5);
    doc.setFont("helvetica","bold"); doc.setFontSize(11);
    doc.text(contextName, pageW-margin-4, y+7, { align:"right" });
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(new Date(game.start_time).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}) + (rink ? " · " + rink : ""), pageW-margin-4, y+12, { align:"right" });
    y += 22;

    // Compliance header band: association / level / division / times
    if (compliant) {
      const bits = [];
      if (ctx.usah_association_name) bits.push(`Assn: ${ctx.usah_association_name}`);
      if (ctx.usah_classification) bits.push(`Level: ${CLASS_LABEL[ctx.usah_classification] || ctx.usah_classification}`);
      if (ctx.division_label) bits.push(`Division: ${ctx.division_label}`);
      const times = [];
      if (game.start_time) times.push(`Start ${fmtTime(game.start_time)}`);
      if (game.end_time) times.push(`End ${fmtTime(game.end_time)}`);
      if (game.curfew_time) times.push(`Curfew ${fmtTime(game.curfew_time)}`);
      doc.setFillColor(244,247,250); doc.rect(margin,y,pageW-margin*2,times.length?12:8,"F");
      doc.setTextColor(11,31,58); doc.setFont("helvetica","normal"); doc.setFontSize(8);
      doc.text(bits.join("    ") || "Assn / Level / Division: __________", margin+3, y+5);
      if (times.length) doc.text(times.join("    "), margin+3, y+10);
      y += (times.length?12:8) + 4;
    }

    // Scoreline
    doc.setFillColor(11,31,58); doc.rect(margin,y,pageW-margin*2,18,"F");
    doc.setTextColor(244,247,250); doc.setFont("helvetica","bold"); doc.setFontSize(13);
    doc.text(homeTeam, margin+4, y+11);
    doc.setFontSize(20); doc.text(String(game.home_score||0), pageW/2-12, y+13, {align:"right"});
    doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.text("FINAL", pageW/2, y+10, {align:"center"});
    doc.setFontSize(20); doc.setFont("helvetica","bold"); doc.text(String(game.away_score||0), pageW/2+12, y+13);
    doc.setFontSize(13); doc.text(awayTeam, pageW-margin-4, y+11, {align:"right"});
    y += 24;

    // ── Rosters + coaches (compliant only) ─────────────────────────────────────
    if (compliant) {
      y = drawComplianceBlocks(doc, margin, pageW, y);
      if (y > 210) { doc.addPage(); y = 14; }
    }

    const homeShots = typeof shots === "object" && !Array.isArray(shots) ? (shots[homeId] || 0) : 0;
    const awayShots = typeof shots === "object" && !Array.isArray(shots) ? (shots[awayId] || 0) : 0;
    doc.setTextColor(11,31,58); doc.setFontSize(9); doc.setFont("helvetica","normal");
    doc.text("Shots on Goal — " + homeTeam + ": " + homeShots + "    " + awayTeam + ": " + awayShots, margin, y);
    y += 8;

    // Goals (compliant adds a Type column)
    const goalHead = compliant ? [["#","Team","Scorer","Assist 1","Assist 2","Per","Time","Type"]] : [["#","Team","Scorer","Assist 1","Assist 2","Period","Time"]];
    const goalRows = goals.map((g,i) => {
      const base = [i+1, teamName(g.team_id), g.scorer_number?"#"+g.scorer_number:"—", g.assist1_number?"#"+g.assist1_number:"—", g.assist2_number?"#"+g.assist2_number:"—", periodLabel(g.period), g.time_in_period||"—"];
      return compliant ? [...base, goalType(g)] : base;
    });
    const goalFill = compliant ? 9 : 10;
    for (let i=0; i<Math.max(0,goalFill-goalRows.length); i++) goalRows.push(compliant ? [goalRows.length+1,"——————","——","——","——","——","——","——"] : [goalRows.length+1,"——————","——","——","——","——","——"]);
    autoTable(doc, { startY:y, head:goalHead, body:goalRows, headStyles:{fillColor:[11,31,58],textColor:[244,247,250],fontSize:8,fontStyle:"bold"}, bodyStyles:{fontSize:8,textColor:[17,17,17]}, alternateRowStyles:{fillColor:[248,250,252]}, didDrawCell:(data) => { if (data.section==="body" && data.row.index>=goals.length) { const {x,y:cy,width,height}=data.cell; doc.setDrawColor(180,180,180); doc.setLineWidth(0.3); doc.line(x,cy+height/2,x+width,cy+height/2); } }, margin:{left:margin,right:margin}, theme:"grid", tableLineColor:[200,200,200], tableLineWidth:0.1 });
    y = doc.lastAutoTable.finalY+8;

    const penRows = penalties.map((p,i) => [i+1, teamName(p.team_id), p.player_number?"#"+p.player_number:"—", p.penalty_type, p.severity?.includes("Major")||p.severity?.includes("Match")?"Major":p.severity?.includes("Double")?"Dbl Min":"Minor", p.duration_minutes, periodLabel(p.period), p.time_in_period||"—"]);
    for (let i=0; i<Math.max(0,8-penRows.length); i++) penRows.push([penRows.length+1,"——————","——","——————————","——","——","——","——"]);
    autoTable(doc, { startY:y, head:[["#","Team","Player","Penalty","Severity","Min","Period","Time"]], body:penRows, headStyles:{fillColor:[11,31,58],textColor:[244,247,250],fontSize:8,fontStyle:"bold"}, bodyStyles:{fontSize:8,textColor:[17,17,17]}, alternateRowStyles:{fillColor:[248,250,252]}, didDrawCell:(data) => { if (data.section==="body" && data.row.index>=penalties.length) { const {x,y:cy,width,height}=data.cell; doc.setDrawColor(180,180,180); doc.setLineWidth(0.3); doc.line(x,cy+height/2,x+width,cy+height/2); } }, margin:{left:margin,right:margin}, theme:"grid", tableLineColor:[200,200,200], tableLineWidth:0.1 });
    y = doc.lastAutoTable.finalY+8;

    if (goalieChanges.length > 0) {
      const goalieRows = goalieChanges.map(c => [teamName(c.team_id), c.goalie_out_number?"#"+c.goalie_out_number:"—", c.goalie_in_number?"#"+c.goalie_in_number:"—", periodLabel(c.period), c.time_in_period||"—"]);
      autoTable(doc, { startY:y, head:[["Team","Out #","In #","Period","Time"]], body:goalieRows, headStyles:{fillColor:[11,31,58],textColor:[244,247,250],fontSize:8,fontStyle:"bold"}, bodyStyles:{fontSize:8,textColor:[17,17,17]}, margin:{left:margin,right:margin}, theme:"grid", tableLineColor:[200,200,200], tableLineWidth:0.1 });
      y = doc.lastAutoTable.finalY+8;
    }

    // GM/Match written statements (compliant; tournament suspensions carry them)
    if (compliant) {
      const statements = (suspensions || []).filter(s => s.official_statement && s.official_statement.trim());
      if (statements.length) {
        if (y > 245) { doc.addPage(); y = 14; }
        doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(11,31,58);
        doc.text("OFFICIALS' NOTE — Game Misconduct / Match penalties", margin, y); y += 4;
        doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(60,60,60);
        statements.forEach(s => {
          const jersey = s.jersey_number != null ? `#${s.jersey_number} ` : "";
          const lines = doc.splitTextToSize(`${jersey}${teamName(s.team_id)}: ${s.official_statement}`, pageW - margin*2);
          doc.text(lines, margin, y); y += lines.length*3.5 + 2;
        });
        y += 4;
      }
    }

    // ── Signatures ─────────────────────────────────────────────────────────────
    if (y > 215) { doc.addPage(); y = 14; }
    doc.setFillColor(244,247,250); doc.rect(margin,y,pageW-margin*2,8,"F");
    doc.setDrawColor(215,38,56); doc.setLineWidth(0.8); doc.line(margin,y,margin,y+8);
    doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(10);
    doc.text("OFFICIAL SIGNATURES", margin+4, y+5.5);
    y += 12;
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(100,100,100);
    doc.text("By signing below, officials certify that all scores, goals, penalties, and players in uniform recorded above are accurate and complete.", margin, y);
    doc.text("Unused lines have been crossed out to prevent alteration.", margin, y+4);
    y += 10;

    // Compliant: Official Scorer + Referee(R) + 2 Linespersons(L). Else: Ref + 2 lines (legacy).
    const sigs = compliant
      ? [{ ref:scorerRef, name:scorerName, label:"Official Scorer" }, { ref:refRef, name:refName + (refLevel?` (L${refLevel})`:""), label:"Referee (R)" }, { ref:lines1Ref, name:lines1Name, label:"Linesperson (L)" }, { ref:lines2Ref, name:lines2Name, label:"Linesperson (L)" }]
      : [{ ref:refRef, name:refName, label:"Referee (Lead)" }, { ref:lines1Ref, name:lines1Name, label:"Linesperson 1" }, { ref:lines2Ref, name:lines2Name, label:"Linesperson 2" }];
    const perRow = sigs.length === 4 ? 2 : 3;
    const sigW = (pageW-margin*2-(perRow-1)*4)/perRow;
    sigs.forEach((s, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) y += 38;
      const sx = margin + col*(sigW+4);
      if (s.ref.current && !s.ref.current.isEmpty()) { doc.addImage(s.ref.current.toDataURL("image/png"), "PNG", sx, y, sigW, 20); }
      else { doc.setDrawColor(200,200,200); doc.setLineWidth(0.2); doc.rect(sx,y,sigW,20); }
      doc.setDrawColor(11,31,58); doc.setLineWidth(0.4); doc.line(sx,y+22,sx+sigW,y+22);
      doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(11,31,58);
      doc.text(s.label, sx, y+26);
      doc.setFont("helvetica","normal"); doc.setFontSize(7);
      doc.setTextColor(s.name ? 80 : 160, s.name ? 80 : 160, s.name ? 80 : 160);
      doc.text(s.name || "Print name", sx, y+30);
    });
    y += 38;

    doc.setDrawColor(200,200,200); doc.setLineWidth(0.2); doc.line(margin,y,pageW-margin,y); y+=4;
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(150,150,150);
    doc.text("Generated by Rinkd · rinkd.app · " + new Date().toLocaleString(), margin, y);
    doc.setFont("helvetica","bold"); doc.setTextColor(215,38,56);
    doc.text(compliant ? "USA HOCKEY OFFICIAL SCORESHEET" : "OFFICIAL SCORESHEET", pageW-margin, y, { align:"right" });
    return doc;
  };

  // Record the post-game official sign-offs as structured rows (best-effort —
  // a failure here never blocks the PDF the officials need).
  const recordOfficialSignoffs = async () => {
    const src = isLeague ? 'league' : 'tournament';
    const rows = [];
    const dataUrl = (r) => (r.current && !r.current.isEmpty()) ? r.current.toDataURL("image/png") : null;
    if (scorerName.trim()) rows.push({ p_role:'official_scorer', p_printed_name:scorerName.trim(), p_signature_path:dataUrl(scorerRef), p_official_designation:null });
    if (refName.trim())    rows.push({ p_role:'referee',         p_printed_name:refName.trim(),    p_signature_path:dataUrl(refRef),    p_official_designation:'R', p_cep_level:refLevel||null });
    if (lines1Name.trim()) rows.push({ p_role:'linesperson',     p_printed_name:lines1Name.trim(), p_signature_path:dataUrl(lines1Ref), p_official_designation:'L' });
    if (lines2Name.trim()) rows.push({ p_role:'linesperson',     p_printed_name:lines2Name.trim(), p_signature_path:dataUrl(lines2Ref), p_official_designation:'L' });
    if (rows.length === 0) return 'skipped';
    let ok = true;
    for (const r of rows) {
      const { error } = await supabase.rpc('record_game_signoff', {
        p_game_id: game.id, p_game_source: src, p_phase: 'post_game', p_team_id: null,
        p_cep_number: null, p_cep_level: null, p_is_head_coach: false, ...r,
      });
      if (error) { ok = false; console.error('signoff failed:', error); }
    }
    return ok ? 'success' : 'error';
  };

  const handleSubmit = async () => {
    setPhase("submitting");
    setStatus({ pdf:"loading", storage:"pending", email:"pending" });
    setSignoffStatus(compliant ? "loading" : "skipped");
    try {
      const doc = buildDoc();
      setStatus(s => ({ ...s, pdf:"success", storage:"loading" }));
      const filename = "Scoresheet_" + homeTeam.replace(/\s+/g,"_") + "_vs_" + awayTeam.replace(/\s+/g,"_") + "_" + new Date().toISOString().split("T")[0] + ".pdf";
      const pdfBase64 = doc.output("datauristring").split(",")[1];
      doc.save(filename);

      // Compliant: persist the official sign-offs as structured records.
      if (compliant) {
        try { setSignoffStatus(await recordOfficialSignoffs()); }
        catch (e) { console.error(e); setSignoffStatus("error"); }
      }

      // submit-scoresheet resolves recipients + emails managers SERVER-SIDE
      // (service_role) and ignores any addresses in the body — and with
      // YOUTH-PRIVACY profiles.email is column-revoked on the client anyway.
      // So we just submit and trust the function's reported outcome.
      setStatus(s => ({ ...s, storage:"loading", email:"loading" }));
      const { data, error } = await supabase.functions.invoke("submit-scoresheet", {
        body: { pdf_base64: pdfBase64, filename, game_id: game.id, is_league: isLeague, home_team: homeTeam, away_team: awayTeam, context_name: contextName }
      });
      if (error) throw error;
      const storageOk = data.results?.storage === "uploaded";
      const emailOutcome = data.results?.email === "sent" ? "success"
        : data.results?.email === "skipped" ? "skipped"
        : "error";
      setStatus({ pdf:"success", storage: storageOk ? "success" : "error", email: emailOutcome });
    } catch(e) {
      console.error("Submission error:", e);
      setStatus(s => ({ ...s, storage:"error", email:"error" }));
    }
    setPhase("done");
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:300, overflowY:"auto", padding:16 }}>
      <div style={{ background:C.navy, borderRadius:16, maxWidth:480, margin:"0 auto", padding:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div style={{ fontFamily:"Barlow Condensed, sans-serif", fontStyle:"italic", fontWeight:900, fontSize:20, color:C.ice }}>
            {phase === "done" ? "Scoresheet Submitted" : compliant ? "Official Scoresheet · USA Hockey" : "Official Scoresheet"}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"rgba(244,247,250,0.5)", fontSize:20, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ background:C.dark, borderRadius:10, padding:"12px 16px", marginBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:13, fontWeight:700, color:C.ice }}>{homeTeam}</span>
          <span style={{ fontFamily:"Barlow Condensed, sans-serif", fontStyle:"italic", fontWeight:900, fontSize:28, color:C.ice }}>{game.home_score||0} – {game.away_score||0}</span>
          <span style={{ fontSize:13, fontWeight:700, color:C.ice }}>{awayTeam}</span>
        </div>

        {phase === "sign" && (
          <>
            <div style={{ fontSize:11, color:"rgba(244,247,250,0.4)", marginBottom:16 }}>{goals.length} goals · {penalties.length} penalties · {goalieChanges.length} goalie changes</div>
            {compliant && (
              <div style={{ fontSize:11.5, color:"rgba(244,247,250,0.55)", lineHeight:1.5, marginBottom:16, background:"rgba(34,197,94,0.08)", border:"0.5px solid rgba(34,197,94,0.3)", borderRadius:10, padding:"10px 12px" }}>
                🇺🇸 USA Hockey mode — the printed roster, coaches, and times come from this game automatically. Officials just sign below.
                {coachSignoffs.length === 0 && <div style={{ marginTop:6, color:"#F59E0B" }}>⚠ No coach pre-game signatures recorded — the coaches line will print blank.</div>}
              </div>
            )}
            <div style={{ fontSize:13, fontWeight:700, color:C.ice, marginBottom:6 }}>Official Signatures</div>
            <div style={{ fontSize:11, color:"rgba(244,247,250,0.4)", marginBottom:16 }}>Each official signs below before submitting.</div>
            {compliant && (
              <>
                <SigPad label="Official Scorer" sigRef={scorerRef} onClear={() => scorerRef.current?.clear()} />
                <div style={{ marginBottom:12 }}><input placeholder="Official scorer print name" value={scorerName} onChange={e => setScorerName(e.target.value)} style={inputStyle} /></div>
              </>
            )}
            <SigPad label={compliant ? "Referee (R)" : "Referee (Lead)"} sigRef={refRef} onClear={() => refRef.current?.clear()} />
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <input placeholder="Referee print name" value={refName} onChange={e => setRefName(e.target.value)} style={{ ...inputStyle, flex:2 }} />
              {compliant && <input placeholder="CEP level" value={refLevel} onChange={e => setRefLevel(e.target.value)} style={{ ...inputStyle, flex:1 }} />}
            </div>
            <SigPad label={compliant ? "Linesperson (L)" : "Linesperson 1"} sigRef={lines1Ref} onClear={() => lines1Ref.current?.clear()} />
            <div style={{ marginBottom:12 }}><input placeholder={compliant ? "Linesperson print name" : "Linesperson 1 print name"} value={lines1Name} onChange={e => setLines1Name(e.target.value)} style={inputStyle} /></div>
            <SigPad label={compliant ? "Linesperson (L)" : "Linesperson 2"} sigRef={lines2Ref} onClear={() => lines2Ref.current?.clear()} />
            <div style={{ marginBottom:20 }}><input placeholder={compliant ? "Linesperson print name" : "Linesperson 2 print name"} value={lines2Name} onChange={e => setLines2Name(e.target.value)} style={inputStyle} /></div>
            <button onClick={handleSubmit}
              style={{ width:"100%", padding:14, background:C.red, border:"none", borderRadius:999, color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Barlow, sans-serif", transition:"all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background=C.ice; e.currentTarget.style.color=C.navy; }}
              onMouseLeave={e => { e.currentTarget.style.background=C.red; e.currentTarget.style.color="#fff"; }}>
              📄 Submit Official Scoresheet
            </button>
            <div style={{ fontSize:10, color:"rgba(244,247,250,0.25)", textAlign:"center", marginTop:10 }}>Downloads locally · saved to Rinkd · emailed to team managers</div>
          </>
        )}

        {phase === "submitting" && (
          <div style={{ padding:"20px 0" }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.ice, marginBottom:12 }}>Submitting scoresheet...</div>
            <StatusRow icon="📄" label="Generating PDF" status={status.pdf} />
            {compliant && <StatusRow icon="🖊️" label="Recording official signatures" status={signoffStatus} skippedLabel="No officials signed — skipped" />}
            <StatusRow icon="☁️" label="Saving to Rinkd" status={status.storage} />
            <StatusRow icon="✉️" label="Emailing team managers" status={status.email}
              skippedLabel={isLeague ? "No manager emails on file — skipped" : "No team contact emails on file — skipped"} />
          </div>
        )}

        {phase === "done" && (
          <div style={{ padding:"10px 0" }}>
            <div style={{ background:"rgba(34,197,94,0.1)", border:"0.5px solid rgba(34,197,94,0.3)", borderRadius:10, padding:"14px 16px", marginBottom:16, textAlign:"center" }}>
              <div style={{ fontSize:24, marginBottom:6 }}>✅</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#22C55E", marginBottom:4 }}>Scoresheet submitted</div>
              <div style={{ fontSize:12, color:"rgba(244,247,250,0.4)" }}>
                PDF downloaded · saved to Rinkd · {status.email === 'success'
                  ? 'managers notified'
                  : status.email === 'skipped'
                    ? (isLeague ? 'no manager emails on file' : 'no team emails on file')
                    : "couldn't email managers"}
              </div>
            </div>
            <StatusRow icon="📄" label="PDF generated & downloaded" status={status.pdf} />
            {compliant && <StatusRow icon="🖊️" label="Official signatures recorded" status={signoffStatus} skippedLabel="No officials signed — skipped" />}
            <StatusRow icon="☁️" label="Saved to Rinkd" status={status.storage} />
            <StatusRow icon="✉️" label="Emailed to team managers" status={status.email}
              skippedLabel={isLeague ? "No manager emails on file — skipped" : "No team contact emails on file — skipped"} />
            <button onClick={onClose}
              style={{ width:"100%", padding:12, background:"rgba(46,91,140,0.2)", border:"0.5px solid rgba(46,91,140,0.4)", borderRadius:999, color:C.ice, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"Barlow, sans-serif", marginTop:16, transition:"all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background=C.ice; e.currentTarget.style.color=C.navy; }}
              onMouseLeave={e => { e.currentTarget.style.background="rgba(46,91,140,0.2)"; e.currentTarget.style.color=C.ice; }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
