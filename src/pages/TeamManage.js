import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DateTimePicker from '../components/DateTimePicker';
import { getTeam, getTeamMembers, getTeamGames, getJoinRequests, createTeam, updateTeam, addTeamMember, removeTeamMember, updateTeamMember, addTeamGame, approveJoinRequest, denyJoinRequest } from '../lib/teams';
import { supabase } from '../lib/supabase';
import RosterUpload from '../components/RosterUpload';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };
const inputStyle = { width:'100%', background:'#07111F', border:`0.5px solid ${C.border}`, borderRadius:8, padding:'10px 12px', color:C.ice, fontFamily:'Barlow, sans-serif', fontSize:14, outline:'none' };
const selectStyle = { ...inputStyle };

const LOGO_COLORS = ['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9','#EC4899','#0B1F3A'];
const POSITIONS = ['Center','Left Wing','Right Wing','Defense','Goalie','Coach'];

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{children}</div>;
}

function Card({ children }) {
  return <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>{children}</div>;
}

function Row2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

function ActionBtn({ onClick, children, variant = 'primary', small = false }) {
  const bg = variant === 'primary' ? C.red : variant === 'secondary' ? 'rgba(46,91,140,0.25)' : 'rgba(244,247,250,0.06)';
  const col = variant === 'danger' ? C.red : C.ice;
  return (
    <button onClick={onClick}
      style={{ background: bg, color: col, border: variant === 'danger' ? `0.5px solid rgba(215,38,56,0.4)` : 'none', borderRadius: small ? 6 : 999, padding: small ? '5px 10px' : '10px 18px', fontFamily: 'Barlow, sans-serif', fontSize: small ? 11 : 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
      onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.color = col; }}>
      {children}
    </button>
  );
}

// ── CREATE FLOW ───────────────────────────────────────────────
function CreateTeam({ profile, navigate }) {
  const [form, setForm] = useState({ name: '', division: '', level: '', location: '', home_rink: '', logo_color: '#D72638', logo_initials: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCreate = async () => {
    if (!form.name.trim()) { setError('Team name is required'); return; }
    setSaving(true); setError(null);
    try {
      const team = await createTeam(form);
      navigate('/team/' + team.id + '/manage');
    } catch(e) { setError(e.message); setSaving(false); }
  };

  const initials = form.logo_initials || form.name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();

  return (
    <div style={{ background: C.dark, minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: C.ice, maxWidth: 520, margin: '0 auto' }}>
      <button onClick={() => navigate('/teams')} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.5)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginBottom: 16 }}>← Teams</button>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, marginBottom: 4 }}>Create Team</div>
      <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Free · No credit card needed</div>

      {error && <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: C.red }}>{error}</div>}

      {/* Logo preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: form.logo_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 26, color: '#fff' }}>
          {initials || '?'}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Logo Color</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LOGO_COLORS.map(col => (
              <div key={col} onClick={() => set('logo_color', col)}
                style={{ width: 24, height: 24, borderRadius: '50%', background: col, cursor: 'pointer', border: form.logo_color === col ? '2px solid #fff' : '2px solid transparent', transition: 'border 0.15s' }} />
            ))}
          </div>
        </div>
      </div>

      <Card>
        <Field label="Team Name *"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. North Shore Jr. Eagles" /></Field>
        <Field label="Logo Initials"><input style={inputStyle} value={form.logo_initials} onChange={e => set('logo_initials', e.target.value.toUpperCase().slice(0, 3))} placeholder="e.g. NJ (auto from name if blank)" maxLength={3} /></Field>
        <Row2>
          <Field label="Division"><input style={inputStyle} value={form.division} onChange={e => set('division', e.target.value)} placeholder="e.g. 14U AA" /></Field>
          <Field label="Level"><input style={inputStyle} value={form.level} onChange={e => set('level', e.target.value)} placeholder="e.g. AAA, AA, Rec" /></Field>
        </Row2>
        <Row2>
          <Field label="City / State"><input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Chicago, IL" /></Field>
          <Field label="Home Rink"><input style={inputStyle} value={form.home_rink} onChange={e => set('home_rink', e.target.value)} placeholder="e.g. Oak Park Ice Arena" /></Field>
        </Row2>
      </Card>

      <button onClick={handleCreate} disabled={saving}
        style={{ width: '100%', padding: 14, background: C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', opacity: saving ? 0.7 : 1, transition: 'all 0.15s' }}
        onMouseEnter={e => { if (!saving) { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}}
        onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
        {saving ? 'Creating...' : '🏒 Create Team'}
      </button>
    </div>
  );
}

// ── MANAGE FLOW ───────────────────────────────────────────────
function ManageTeam({ id, profile, navigate }) {
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [games, setGames] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Roster');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Add member form
  const [memberForm, setMemberForm] = useState({ handle: '', jersey_number: '', position: 'Center', role: 'player', shot_hand: 'left' });
  // Add game form
  const [gameForm, setGameForm] = useState({ opponent: '', is_home: true, location: '', start_time: '', notes: '' });

  const load = useCallback(async () => {
    try {
      const [t, m, g, r] = await Promise.all([getTeam(id), getTeamMembers(id), getTeamGames(id), getJoinRequests(id)]);
      setTeam(t); setMembers(m); setGames(g); setRequests(r);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleAddMember = async () => {
    if (!memberForm.name.trim()) { setError('Player name is required'); return; }
    setSaving(true); setError(null);
    try {
      let userId = null;
      if (memberForm.email.trim()) {
        const { data: p } = await supabase.from('profiles').select('id').eq('email', memberForm.email.trim().toLowerCase()).maybeSingle();
        if (p) userId = p.id;
      }
      await addTeamMember({
        team_id: id,
        user_id: userId,
        role: memberForm.role,
        jersey_number: memberForm.jersey_number ? parseInt(memberForm.jersey_number) : null,
        position: memberForm.position,
        shot_hand: memberForm.shot_hand,
        invite_name: memberForm.name.trim(),
        invite_email: memberForm.email.trim() || null,
      });
      setMemberForm({ name: '', email: '', jersey_number: '', position: 'Center', role: 'player', shot_hand: 'left' });
      await load();
    } catch(e) { setError(e.message); }
    setSaving(false);
  };

  const handleAddGame = async () => {
    if (!gameForm.opponent.trim() || !gameForm.start_time) return;
    setSaving(true);
    try {
      await addTeamGame({ team_id: id, ...gameForm });
      setGameForm({ opponent: '', is_home: true, location: '', start_time: '', notes: '' });
      await load();
    } catch(e) { setError(e.message); }
    setSaving(false);
  };

  const handleApprove = async (req) => {
    await approveJoinRequest(req.id, { team_id: id, user_id: req.user_id });
    await load();
  };

  const handleDeny = async (req) => {
    await denyJoinRequest(req.id);
    await load();
  };

  const MANAGE_TABS = ['Roster', 'Schedule', 'Requests', 'Settings'];

  if (loading) return <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Loading...</div>;

  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>
      {/* Header */}
      <div style={{ background: C.navy, padding: '14px 16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => navigate('/team/' + id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← {team?.name}</button>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>MANAGE TEAM</div>
        <div style={{ width: 60 }} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: C.navy, borderBottom: '2px solid rgba(46,91,140,0.3)' }}>
        {MANAGE_TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ fontSize: 13, fontWeight: 700, padding: '10px 16px', color: '#FFFFFF', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '3px solid #D72638' : '3px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', opacity: activeTab === tab ? 1 : 0.5, transition: 'opacity 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.opacity = activeTab === tab ? '1' : '0.5'; }}>
            {tab} {tab === 'Requests' && requests.length > 0 ? `(${requests.length})` : ''}
          </button>
        ))}
      </div>

      <div style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
        {error && <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>}

        {/* ROSTER */}
        {activeTab === 'Roster' && (
          <>
            <SectionLabel>Bulk Roster Upload</SectionLabel>
            <Card>
              <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 12 }}>
                Got the whole team in a spreadsheet? Drop a CSV and we'll send every player
                a Rinkd signup invite. They'll appear on your roster as <strong style={{ color: '#F59E0B' }}>INVITED</strong> until they sign up.
              </div>
              <RosterUpload
                teamId={id}
                teamName={team?.name || 'your team'}
                invitedBy={profile?.name}
                onComplete={load}
              />
            </Card>

            <SectionLabel>Add Player</SectionLabel>
            <Card>
              <Row2>
                <Field label="Player Name *">
                  <input style={inputStyle} value={memberForm.name} onChange={e => setMemberForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                </Field>
                <Field label="Email (for invite)">
                  <input style={inputStyle} type="email" value={memberForm.email} onChange={e => setMemberForm(p => ({ ...p, email: e.target.value }))} placeholder="player@email.com" />
                </Field>
              </Row2>
              <Row2>
                <Field label="Jersey #"><input style={inputStyle} type="number" value={memberForm.jersey_number} onChange={e => setMemberForm(p => ({ ...p, jersey_number: e.target.value }))} placeholder="#" /></Field>
                <Field label="Position">
                  <select style={selectStyle} value={memberForm.position} onChange={e => setMemberForm(p => ({ ...p, position: e.target.value }))}>
                    {POSITIONS.map(pos => <option key={pos} value={pos}>{pos}</option>)}
                  </select>
                </Field>
              </Row2>
              <Row2>
                <Field label="Shot Hand">
                  <select style={selectStyle} value={memberForm.shot_hand} onChange={e => setMemberForm(p => ({ ...p, shot_hand: e.target.value }))}>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </Field>
                <Field label="Role">
                  <select style={selectStyle} value={memberForm.role} onChange={e => setMemberForm(p => ({ ...p, role: e.target.value }))}>
                    <option value="player">Player</option>
                    <option value="goalie">Goalie</option>
                    <option value="coach">Coach</option>
                  </select>
                </Field>
              </Row2>
              <ActionBtn onClick={handleAddMember}>+ Add to Roster</ActionBtn>
            </Card>

            <SectionLabel>Current Roster ({members.length})</SectionLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
              {members.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No players yet</div>}
              {members.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: 'rgba(244,247,250,0.3)', width: 24, textAlign: 'center', flexShrink: 0 }}>{m.jersey_number || '—'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                      {m.profile?.name || m.invite_name}
                      {m.status === 'pending' && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: 'rgba(245,158,11,0.2)', color: '#F59E0B' }}>INVITE PENDING</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)' }}>
                      {m.position}{m.profile?.handle ? ' · @' + m.profile.handle : m.invite_email ? ' · ' + m.invite_email : ''}
                    </div>
                  </div>
                  <button onClick={() => removeTeamMember(m.id).then(load)}
                    style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.2)', cursor: 'pointer', fontSize: 16 }}
                    onMouseEnter={e => e.currentTarget.style.color = C.red}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.2)'}>✕</button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* SCHEDULE */}
        {activeTab === 'Schedule' && (
          <>
            <SectionLabel>Add Game</SectionLabel>
            <Card>
              <Field label="Opponent"><input style={inputStyle} value={gameForm.opponent} onChange={e => setGameForm(p => ({ ...p, opponent: e.target.value }))} placeholder="e.g. Chicago Mission" /></Field>
              <Row2>
                <Field label="Home or Away">
                  <select style={selectStyle} value={gameForm.is_home ? 'home' : 'away'} onChange={e => setGameForm(p => ({ ...p, is_home: e.target.value === 'home' }))}>
                    <option value="home">Home</option>
                    <option value="away">Away</option>
                  </select>
                </Field>
                <Field label="Location"><input style={inputStyle} value={gameForm.location} onChange={e => setGameForm(p => ({ ...p, location: e.target.value }))} placeholder="Rink name" /></Field>
              </Row2>
              <Field label="Date & Time"><DateTimePicker value={gameForm.start_time} onChange={v => setGameForm(p => ({ ...p, start_time: v })) } placeholder="Select date & time" /></Field>
              <ActionBtn onClick={handleAddGame}>+ Add Game</ActionBtn>
            </Card>

            <SectionLabel>Schedule ({games.length} games)</SectionLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {games.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No games yet</div>}
              {games.map(g => {
                const date = new Date(g.start_time);
                const teamScore = g.is_home ? g.home_score : g.away_score;
                const oppScore = g.is_home ? g.away_score : g.home_score;
                return (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', width: 44, flexShrink: 0, lineHeight: 1.4 }}>
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{g.is_home ? 'vs.' : '@'} {g.opponent}</div>
                      {g.location && <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 1 }}>{g.location}</div>}
                    </div>
                    {g.status === 'final'
                      ? <div style={{ fontSize: 12, fontWeight: 700, color: teamScore > oppScore ? '#22C55E' : C.red }}>{teamScore > oppScore ? 'W' : 'L'} {teamScore}–{oppScore}</div>
                      : <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)' }}>{date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                    }
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* JOIN REQUESTS */}
        {activeTab === 'Requests' && (
          <>
            <SectionLabel>Pending Requests ({requests.length})</SectionLabel>
            {requests.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '30px 0' }}>No pending requests</div>}
            {requests.map(req => (
              <div key={req.id} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: req.message ? 10 : 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: req.profile?.avatar_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: '#fff' }}>
                    {req.profile?.avatar_initials || '?'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{req.profile?.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)' }}>@{req.profile?.handle}</div>
                  </div>
                </div>
                {req.message && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.6)', marginBottom: 12, fontStyle: 'italic' }}>"{req.message}"</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <ActionBtn onClick={() => handleApprove(req)}>✓ Approve</ActionBtn>
                  <ActionBtn onClick={() => handleDeny(req)} variant="danger" small>Deny</ActionBtn>
                </div>
              </div>
            ))}
          </>
        )}

        {/* SETTINGS */}
        {activeTab === 'Settings' && team && (
          <TeamSettings team={team} onSave={async (updates) => { await updateTeam(id, updates); await load(); }} />
        )}
      </div>
    </div>
  );
}

function TeamSettings({ team, onSave }) {
  const [form, setForm] = useState({ name: team.name, division: team.division || '', level: team.level || '', location: team.location || '', home_rink: team.home_rink || '', logo_color: team.logo_color || C.red, logo_initials: team.logo_initials || '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <>
      <SectionLabel>Team Settings</SectionLabel>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 10, background: form.logo_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: '#fff' }}>
            {form.logo_initials || form.name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase()}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LOGO_COLORS.map(col => (
              <div key={col} onClick={() => set('logo_color', col)}
                style={{ width: 22, height: 22, borderRadius: '50%', background: col, cursor: 'pointer', border: form.logo_color === col ? '2px solid #fff' : '2px solid transparent' }} />
            ))}
          </div>
        </div>
        <Field label="Team Name"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Logo Initials"><input style={inputStyle} value={form.logo_initials} onChange={e => set('logo_initials', e.target.value.toUpperCase().slice(0, 3))} placeholder="Auto from name" maxLength={3} /></Field>
        <Row2>
          <Field label="Division"><input style={inputStyle} value={form.division} onChange={e => set('division', e.target.value)} /></Field>
          <Field label="Level"><input style={inputStyle} value={form.level} onChange={e => set('level', e.target.value)} /></Field>
        </Row2>
        <Row2>
          <Field label="City / State"><input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} /></Field>
          <Field label="Home Rink"><input style={inputStyle} value={form.home_rink} onChange={e => set('home_rink', e.target.value)} /></Field>
        </Row2>
      </Card>
      <button onClick={handleSave} disabled={saving}
        style={{ width: '100%', padding: 13, background: C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', opacity: saving ? 0.7 : 1, transition: 'all 0.15s' }}
        onMouseEnter={e => { if (!saving) { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}}
        onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </>
  );
}

// ── ROUTER ────────────────────────────────────────────────────
export default function TeamManage({ profile }) {
  const { id } = useParams();
  const navigate = useNavigate();

  if (!id || id === 'create') return <Layout profile={profile}><CreateTeam profile={profile} navigate={navigate} /></Layout>;
  return <Layout profile={profile}><ManageTeam id={id} profile={profile} navigate={navigate} /></Layout>;
}
