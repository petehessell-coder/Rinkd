import React, { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', dark:'#07111F' };
const inputStyle = { width:'100%', background:'#07111F', border:'0.5px solid rgba(46,91,140,0.5)', borderRadius:8, padding:'8px 12px', color:C.ice, fontFamily:'Barlow, sans-serif', fontSize:13, outline:'none' };

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

function StatusRow({ icon, label, status }) {
  const color = status === 'success' ? '#22C55E' : status === 'error' ? C.red : status === 'loading' ? '#F59E0B' : 'rgba(244,247,250,0.3)';
  const symbol = status === 'success' ? '✓' : status === 'error' ? '✗' : status === 'loading' ? '...' : '–';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'0.5px solid rgba(244,247,250,0.06)' }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ flex:1, fontSize:13, color:'rgba(244,247,250,0.6)' }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:700, color }}>{symbol}</span>
    </div>
  );
}

export default function Scoresheet({ game, goals, penalties, shots, goalieChanges, isLeague = false, onClose }) {
  const refRef = useRef(null);
  const lines1Ref = useRef(null);
  const lines2Ref = useRef(null);
  const [refName, setRefName] = useState("");
  const [lines1Name, setLines1Name] = useState("");
  const [lines2Name, setLines2Name] = useState("");
  const [phase, setPhase] = useState("sign");
  const [status, setStatus] = useState({ pdf:"pending", storage:"pending", email:"pending" });

  const homeTeam = game._homeTeamName || (isLeague ? (game.home_lt?.team?.name || game.home_lt?.team_name || "Home") : (game.home_team?.team_name || "Home"));
  const awayTeam = game._awayTeamName || (isLeague ? (game.away_lt?.team?.name || game.away_lt?.team_name || "Away") : (game.away_team?.team_name || "Away"));
  const contextName = isLeague ? (game.league?.name || "League") : (game.tournament?.name || "Tournament");
  const rink = game.rink ? ((game.rink.sub_rink || "") + " · " + game.rink.name).replace(/^\s*·\s*/, "") : "";
  const periodLabel = (p) => p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : p === 4 ? "OT" : "SO";
  const teamName = (id) => {
    if (isLeague) return id === game.home_lt?.id ? homeTeam : awayTeam;
    return id === game.home_team?.id ? homeTeam : awayTeam;
  };

  const buildDoc = () => {
    const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"letter" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 14;

    doc.setFillColor(11,31,58); doc.rect(margin,y,pageW-margin*2,16,"F");
    doc.setTextColor(244,247,250); doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text("RINKD", margin+4, y+10);
    doc.setFontSize(10); doc.setFont("helvetica","normal");
    doc.text("Official Game Scoresheet", margin+4, y+14.5);
    doc.setFont("helvetica","bold"); doc.setFontSize(11);
    doc.text(contextName, pageW-margin-4, y+7, { align:"right" });
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(new Date(game.start_time).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}) + (rink ? " · " + rink : ""), pageW-margin-4, y+12, { align:"right" });
    y += 22;

    doc.setFillColor(11,31,58); doc.rect(margin,y,pageW-margin*2,18,"F");
    doc.setTextColor(244,247,250); doc.setFont("helvetica","bold"); doc.setFontSize(13);
    doc.text(homeTeam, margin+4, y+11);
    doc.setFontSize(20); doc.text(String(game.home_score||0), pageW/2-12, y+13, {align:"right"});
    doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.text("FINAL", pageW/2, y+10, {align:"center"});
    doc.setFontSize(20); doc.setFont("helvetica","bold"); doc.text(String(game.away_score||0), pageW/2+12, y+13);
    doc.setFontSize(13); doc.text(awayTeam, pageW-margin-4, y+11, {align:"right"});
    y += 24;

    const homeShots = typeof shots === "object" && !Array.isArray(shots) ? (shots[game.home_team?.id] || shots[game.home_lt?.id] || 0) : 0;
    const awayShots = typeof shots === "object" && !Array.isArray(shots) ? (shots[game.away_team?.id] || shots[game.away_lt?.id] || 0) : 0;
    doc.setTextColor(11,31,58); doc.setFontSize(9); doc.setFont("helvetica","normal");
    doc.text("Shots on Goal — " + homeTeam + ": " + homeShots + "    " + awayTeam + ": " + awayShots, margin, y);
    y += 8;

    const goalRows = goals.map((g,i) => [i+1, teamName(g.team_id), g.scorer_number?"#"+g.scorer_number:"—", g.assist1_number?"#"+g.assist1_number:"—", g.assist2_number?"#"+g.assist2_number:"—", periodLabel(g.period), g.time_in_period||"—"]);
    for (let i=0; i<Math.max(0,10-goalRows.length); i++) goalRows.push([goalRows.length+1,"——————","——","——","——","——","——"]);
    autoTable(doc, { startY:y, head:[["#","Team","Scorer","Assist 1","Assist 2","Period","Time"]], body:goalRows, headStyles:{fillColor:[11,31,58],textColor:[244,247,250],fontSize:8,fontStyle:"bold"}, bodyStyles:{fontSize:8,textColor:[17,17,17]}, alternateRowStyles:{fillColor:[248,250,252]}, didDrawCell:(data) => { if (data.section==="body" && data.row.index>=goals.length) { const {x,y:cy,width,height}=data.cell; doc.setDrawColor(180,180,180); doc.setLineWidth(0.3); doc.line(x,cy+height/2,x+width,cy+height/2); } }, margin:{left:margin,right:margin}, theme:"grid", tableLineColor:[200,200,200], tableLineWidth:0.1 });
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

    if (y > 220) { doc.addPage(); y = 14; }
    doc.setFillColor(244,247,250); doc.rect(margin,y,pageW-margin*2,8,"F");
    doc.setDrawColor(215,38,56); doc.setLineWidth(0.8); doc.line(margin,y,margin,y+8);
    doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(10);
    doc.text("OFFICIAL SIGNATURES", margin+4, y+5.5);
    y += 12;
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(100,100,100);
    doc.text("By signing below, officials certify that all scores, goals, penalties, and assists recorded above are accurate and complete.", margin, y);
    doc.text("Unused lines have been crossed out to prevent alteration.", margin, y+4);
    y += 10;

    const sigW = (pageW-margin*2-8)/3;
    const sigs = [{ ref:refRef, name:refName, label:"Referee (Lead)" }, { ref:lines1Ref, name:lines1Name, label:"Linesperson 1" }, { ref:lines2Ref, name:lines2Name, label:"Linesperson 2" }];
    for (let i=0; i<sigs.length; i++) {
      const sx = margin + i*(sigW+4);
      const s = sigs[i];
      if (s.ref.current && !s.ref.current.isEmpty()) { doc.addImage(s.ref.current.toDataURL("image/png"), "PNG", sx, y, sigW, 20); }
      else { doc.setDrawColor(200,200,200); doc.setLineWidth(0.2); doc.rect(sx,y,sigW,20); }
      doc.setDrawColor(11,31,58); doc.setLineWidth(0.4); doc.line(sx,y+22,sx+sigW,y+22);
      doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(11,31,58);
      doc.text(s.label, sx, y+26);
      doc.setFont("helvetica","normal"); doc.setFontSize(7);
      doc.setTextColor(s.name ? 80 : 160, s.name ? 80 : 160, s.name ? 80 : 160);
      doc.text(s.name || "Print name", sx, y+30);
    }
    y += 38;

    doc.setDrawColor(200,200,200); doc.setLineWidth(0.2); doc.line(margin,y,pageW-margin,y); y+=4;
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(150,150,150);
    doc.text("Generated by Rinkd · rinkd.app · " + new Date().toLocaleString(), margin, y);
    doc.setFont("helvetica","bold"); doc.setTextColor(215,38,56);
    doc.text("OFFICIAL SCORESHEET", pageW-margin, y, { align:"right" });
    return doc;
  };

  const handleSubmit = async () => {
    setPhase("submitting");
    setStatus({ pdf:"loading", storage:"pending", email:"pending" });
    try {
      const doc = buildDoc();
      setStatus(s => ({ ...s, pdf:"success", storage:"loading" }));
      const filename = "Scoresheet_" + homeTeam.replace(/\s+/g,"_") + "_vs_" + awayTeam.replace(/\s+/g,"_") + "_" + new Date().toISOString().split("T")[0] + ".pdf";
      const pdfBase64 = doc.output("datauristring").split(",")[1];
      doc.save(filename);

      let managerEmails = [];
      try {
        if (isLeague) {
          const ids = [game.home_lt?.team?.id, game.away_lt?.team?.id].filter(Boolean);
          if (ids.length > 0) {
            const { data: teams } = await supabase.from("teams").select("manager_id").in("id", ids);
            const managerIds = (teams||[]).map(t => t.manager_id).filter(Boolean);
            if (managerIds.length > 0) {
              const { data: profiles } = await supabase.from("profiles").select("email").in("id", managerIds);
              managerEmails = (profiles||[]).map(p => p.email).filter(Boolean);
            }
          }
        }
      } catch(e) { console.error("Manager lookup failed:", e); }

      setStatus(s => ({ ...s, storage:"loading", email:"loading" }));
      const { data, error } = await supabase.functions.invoke("submit-scoresheet", {
        body: { pdf_base64: pdfBase64, filename, game_id: game.id, is_league: isLeague, home_team: homeTeam, away_team: awayTeam, context_name: contextName, manager_emails: managerEmails }
      });
      if (error) throw error;
      setStatus({ pdf:"success", storage: data.results?.storage === "uploaded" ? "success" : "error", email: data.results?.email === "sent" ? "success" : managerEmails.length === 0 ? "pending" : "error" });
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
            {phase === "done" ? "Scoresheet Submitted" : "Official Scoresheet"}
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
            <div style={{ fontSize:13, fontWeight:700, color:C.ice, marginBottom:6 }}>Official Signatures</div>
            <div style={{ fontSize:11, color:"rgba(244,247,250,0.4)", marginBottom:16 }}>Each official signs below before submitting.</div>
            <SigPad label="Referee (Lead)" sigRef={refRef} onClear={() => refRef.current?.clear()} />
            <div style={{ marginBottom:12 }}><input placeholder="Referee print name" value={refName} onChange={e => setRefName(e.target.value)} style={inputStyle} /></div>
            <SigPad label="Linesperson 1" sigRef={lines1Ref} onClear={() => lines1Ref.current?.clear()} />
            <div style={{ marginBottom:12 }}><input placeholder="Linesperson 1 print name" value={lines1Name} onChange={e => setLines1Name(e.target.value)} style={inputStyle} /></div>
            <SigPad label="Linesperson 2" sigRef={lines2Ref} onClear={() => lines2Ref.current?.clear()} />
            <div style={{ marginBottom:20 }}><input placeholder="Linesperson 2 print name" value={lines2Name} onChange={e => setLines2Name(e.target.value)} style={inputStyle} /></div>
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
            <StatusRow icon="☁️" label="Saving to Rinkd" status={status.storage} />
            <StatusRow icon="✉️" label="Emailing team managers" status={status.email} />
          </div>
        )}

        {phase === "done" && (
          <div style={{ padding:"10px 0" }}>
            <div style={{ background:"rgba(34,197,94,0.1)", border:"0.5px solid rgba(34,197,94,0.3)", borderRadius:10, padding:"14px 16px", marginBottom:16, textAlign:"center" }}>
              <div style={{ fontSize:24, marginBottom:6 }}>✅</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#22C55E", marginBottom:4 }}>Scoresheet submitted</div>
              <div style={{ fontSize:12, color:"rgba(244,247,250,0.4)" }}>PDF downloaded · saved to Rinkd · managers notified</div>
            </div>
            <StatusRow icon="📄" label="PDF generated & downloaded" status={status.pdf} />
            <StatusRow icon="☁️" label="Saved to Rinkd" status={status.storage} />
            <StatusRow icon="✉️" label="Emailed to team managers" status={status.email} />
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
