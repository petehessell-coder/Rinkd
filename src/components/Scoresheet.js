import React, { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', dark: '#07111F',
};

function SigPad({ label, sigRef, onClear }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ background: '#fff', borderRadius: 8, border: '0.5px solid rgba(46,91,140,0.5)', overflow: 'hidden' }}>
        <SignatureCanvas
          ref={sigRef}
          penColor="#0B1F3A"
          canvasProps={{ width: 420, height: 100, style: { width: '100%', height: 100 } }}
        />
      </div>
      <button onClick={onClear}
        style={{ marginTop: 4, background: 'none', border: 'none', color: 'rgba(244,247,250,0.4)', fontSize: 11, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
        Clear
      </button>
    </div>
  );
}

export default function Scoresheet({ game, goals, penalties, shots, goalieChanges, onClose }) {
  const refRef = useRef(null);
  const lines1Ref = useRef(null);
  const lines2Ref = useRef(null);
  const [refName, setRefName] = useState('');
  const [lines1Name, setLines1Name] = useState('');
  const [lines2Name, setLines2Name] = useState('');
  const [generating, setGenerating] = useState(false);

  const homeTeam = game.home_team?.team_name || 'Home';
  const awayTeam = game.away_team?.team_name || 'Away';
  const tournament = game.tournament?.name || '';
  const rink = game.rink ? `${game.rink.sub_rink} · ${game.rink.name}` : '';
  const periodLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p === 4 ? 'OT' : 'SO';
  const teamName = (id) => id === game.home_team?.id ? homeTeam : awayTeam;

  const generatePDF = async () => {
    setGenerating(true);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 14;

    // Header
    doc.setFillColor(11, 31, 58);
    doc.rect(margin, y, pageW - margin * 2, 16, 'F');
    doc.setTextColor(244, 247, 250);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('RINKD', margin + 4, y + 10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Official Game Scoresheet', margin + 4, y + 14.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(tournament, pageW - margin - 4, y + 7, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${new Date(game.start_time).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${rink}`, pageW - margin - 4, y + 12, { align: 'right' });
    y += 22;

    // Score box
    doc.setFillColor(11, 31, 58);
    doc.rect(margin, y, pageW - margin * 2, 18, 'F');
    doc.setTextColor(244, 247, 250);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(homeTeam, margin + 4, y + 11);
    doc.setFontSize(20);
    doc.text(String(game.home_score || 0), pageW / 2 - 12, y + 13, { align: 'right' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('FINAL', pageW / 2, y + 10, { align: 'center' });
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(String(game.away_score || 0), pageW / 2 + 12, y + 13);
    doc.setFontSize(13);
    doc.text(awayTeam, pageW - margin - 4, y + 11, { align: 'right' });
    y += 24;

    // Shots
    doc.setTextColor(11, 31, 58);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const homeShots = shots[game.home_team?.id] || 0;
    const awayShots = shots[game.away_team?.id] || 0;
    doc.text(`Shots on Goal — ${homeTeam}: ${homeShots}    ${awayTeam}: ${awayShots}`, margin, y);
    y += 8;

    // Goals table
    const goalRows = goals.map((g, i) => [
      i + 1,
      teamName(g.team_id),
      g.scorer_number ? `#${g.scorer_number}` : '—',
      g.assist1_number ? `#${g.assist1_number}` : '—',
      g.assist2_number ? `#${g.assist2_number}` : '—',
      periodLabel(g.period),
      g.time_in_period || '—',
    ]);
    // Add strikethrough empty rows up to 10
    const emptyGoalRows = Math.max(0, 10 - goalRows.length);
    for (let i = 0; i < emptyGoalRows; i++) {
      goalRows.push([goalRows.length + 1, '——————', '——', '——', '——', '——', '——']);
    }

    autoTable(doc, {
      startY: y,
      head: [['#', 'Team', 'Scorer', 'Assist 1', 'Assist 2', 'Period', 'Time']],
      body: goalRows,
      headStyles: { fillColor: [11, 31, 58], textColor: [244, 247, 250], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [17, 17, 17] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawCell: (data) => {
        // Strike through empty rows
        if (data.section === 'body' && data.row.index >= goals.length) {
          const { x, y: cy, width, height } = data.cell;
          doc.setDrawColor(180, 180, 180);
          doc.setLineWidth(0.3);
          doc.line(x, cy + height / 2, x + width, cy + height / 2);
        }
      },
      margin: { left: margin, right: margin },
      theme: 'grid',
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.1,
    });
    y = doc.lastAutoTable.finalY + 8;

    // Penalties table
    const penRows = penalties.map((p, i) => [
      i + 1,
      teamName(p.team_id),
      p.player_number ? `#${p.player_number}` : '—',
      p.penalty_type,
      p.severity.includes('Major') || p.severity.includes('Match') ? 'Major' : p.severity.includes('Double') ? 'Dbl Min' : 'Minor',
      p.duration_minutes,
      periodLabel(p.period),
      p.time_in_period || '—',
    ]);
    const emptyPenRows = Math.max(0, 8 - penRows.length);
    for (let i = 0; i < emptyPenRows; i++) {
      penRows.push([penRows.length + 1, '——————', '——', '——————————', '——', '——', '——', '——']);
    }

    autoTable(doc, {
      startY: y,
      head: [['#', 'Team', 'Player', 'Penalty', 'Severity', 'Min', 'Period', 'Time']],
      body: penRows,
      headStyles: { fillColor: [11, 31, 58], textColor: [244, 247, 250], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [17, 17, 17] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.row.index >= penalties.length) {
          const { x, y: cy, width, height } = data.cell;
          doc.setDrawColor(180, 180, 180);
          doc.setLineWidth(0.3);
          doc.line(x, cy + height / 2, x + width, cy + height / 2);
        }
      },
      margin: { left: margin, right: margin },
      theme: 'grid',
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.1,
    });
    y = doc.lastAutoTable.finalY + 8;

    // Goalie changes
    if (goalieChanges.length > 0) {
      const goalieRows = goalieChanges.map(c => [
        teamName(c.team_id),
        c.goalie_out_number ? `#${c.goalie_out_number}` : '—',
        c.goalie_in_number ? `#${c.goalie_in_number}` : '—',
        periodLabel(c.period),
        c.time_in_period || '—',
      ]);
      autoTable(doc, {
        startY: y,
        head: [['Team', 'Out #', 'In #', 'Period', 'Time']],
        body: goalieRows,
        headStyles: { fillColor: [11, 31, 58], textColor: [244, 247, 250], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [17, 17, 17] },
        margin: { left: margin, right: margin },
        theme: 'grid',
        tableLineColor: [200, 200, 200],
        tableLineWidth: 0.1,
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // Check if we need a new page for signatures
    if (y > 220) { doc.addPage(); y = 14; }

    // Signature section header
    doc.setFillColor(244, 247, 250);
    doc.rect(margin, y, pageW - margin * 2, 8, 'F');
    doc.setDrawColor(215, 38, 56);
    doc.setLineWidth(0.8);
    doc.line(margin, y, margin, y + 8);
    doc.setTextColor(11, 31, 58);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('OFFICIAL SIGNATURES', margin + 4, y + 5.5);
    y += 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text('By signing below, officials certify that all scores, goals, penalties, and assists recorded above are accurate and complete.', margin, y);
    doc.text('Unused lines have been crossed out to prevent alteration.', margin, y + 4);
    y += 10;

    // Embed signatures
    const sigW = (pageW - margin * 2 - 8) / 3;
    const sigs = [
      { ref: refRef, name: refName, label: 'Referee (Lead)' },
      { ref: lines1Ref, name: lines1Name, label: 'Linesperson 1' },
      { ref: lines2Ref, name: lines2Name, label: 'Linesperson 2' },
    ];

    for (let i = 0; i < sigs.length; i++) {
      const sx = margin + i * (sigW + 4);
      const sigObj = sigs[i];

      // Signature image
      if (sigObj.ref.current && !sigObj.ref.current.isEmpty()) {
        const imgData = sigObj.ref.current.toDataURL('image/png');
        doc.addImage(imgData, 'PNG', sx, y, sigW, 20);
      } else {
        // Empty sig box
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.rect(sx, y, sigW, 20);
      }

      // Signature line
      doc.setDrawColor(11, 31, 58);
      doc.setLineWidth(0.4);
      doc.line(sx, y + 22, sx + sigW, y + 22);

      // Labels
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(11, 31, 58);
      doc.text(sigObj.label, sx, y + 26);

      if (sigObj.name) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(80, 80, 80);
        doc.text(sigObj.name, sx, y + 30);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text('Print name', sx, y + 30);
      }
    }
    y += 38;

    // Footer
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated by Rinkd · rinkd.app · ${new Date().toLocaleString()}`, margin, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(215, 38, 56);
    doc.text('OFFICIAL SCORESHEET', pageW - margin, y, { align: 'right' });

    // Save
    const filename = `Scoresheet_${homeTeam.replace(/\s+/g, '_')}_vs_${awayTeam.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
    setGenerating(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300, overflowY: 'auto', padding: 16 }}>
      <div style={{ background: C.navy, borderRadius: 16, maxWidth: 480, margin: '0 auto', padding: 20 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice }}>
            Generate Scoresheet
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.5)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Score summary */}
        <div style={{ background: C.dark, borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>{homeTeam}</span>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 28, color: C.ice }}>{game.home_score || 0} – {game.away_score || 0}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>{awayTeam}</span>
        </div>

        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginBottom: 16 }}>
          {goals.length} goals · {penalties.length} penalties · {goalieChanges.length} goalie changes
        </div>

        {/* Referee signatures */}
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ice, marginBottom: 12 }}>Official Signatures</div>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginBottom: 16 }}>Each official signs below before the PDF is generated.</div>

        <SigPad label="Referee (Lead)" sigRef={refRef} onClear={() => refRef.current?.clear()} />
        <div style={{ marginBottom: 12 }}>
          <input placeholder="Referee print name" value={refName} onChange={e => setRefName(e.target.value)}
            style={{ width: '100%', background: '#07111F', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 8, padding: '8px 12px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, outline: 'none' }} />
        </div>

        <SigPad label="Linesperson 1" sigRef={lines1Ref} onClear={() => lines1Ref.current?.clear()} />
        <div style={{ marginBottom: 12 }}>
          <input placeholder="Linesperson 1 print name" value={lines1Name} onChange={e => setLines1Name(e.target.value)}
            style={{ width: '100%', background: '#07111F', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 8, padding: '8px 12px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, outline: 'none' }} />
        </div>

        <SigPad label="Linesperson 2" sigRef={lines2Ref} onClear={() => lines2Ref.current?.clear()} />
        <div style={{ marginBottom: 20 }}>
          <input placeholder="Linesperson 2 print name" value={lines2Name} onChange={e => setLines2Name(e.target.value)}
            style={{ width: '100%', background: '#07111F', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 8, padding: '8px 12px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, outline: 'none' }} />
        </div>

        <button onClick={generatePDF} disabled={generating}
          style={{ width: '100%', padding: 14, background: C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', opacity: generating ? 0.7 : 1, transition: 'all 0.15s' }}
          onMouseEnter={e => { if (!generating) { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}}
          onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
          {generating ? 'Generating PDF...' : '📄 Export Official Scoresheet PDF'}
        </button>

        <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.25)', textAlign: 'center', marginTop: 10 }}>
          PDF downloads automatically · Signatures are embedded
        </div>
      </div>
    </div>
  );
}
