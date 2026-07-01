import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DateTimePicker from '../components/DateTimePicker';
import { getTeam, getTeamMembers, getTeamGames, getJoinRequests, createTeam, updateTeam, addTeamMember, removeTeamMember, updateTeamMember, addScheduleItem, generatePracticeSeries, deleteSeries, deleteScheduleItem, approveJoinRequest, denyJoinRequest, getUnclaimedSlots, getTeamContacts } from '../lib/teams';
import { supabase } from '../lib/supabase';
import { TeamLogo } from '../components/Logos';
import RosterUpload from '../components/RosterUpload';
import { uploadMedia } from '../lib/posts';
import { classifyImage } from '../lib/imageModeration';
import { listTeamManagers, addTeamManagerByInput, removeTeamManager, demoteTeamManager } from '../lib/teamManagers';
import { SCHEDULE_TYPES, eventMeta, scheduleTitle } from '../lib/scheduleMeta';
import { C, colors } from '../lib/tokens';

const inputStyle = { width:'100%', background:C.dark, border:`0.5px solid ${C.border}`, borderRadius:8, padding:'10px 12px', color:C.ice, fontFamily:'Barlow, sans-serif', fontSize:14, outline:'none' };
const selectStyle = { ...inputStyle };

const LOGO_COLORS = [C.red, C.blue, colors.success, colors.warning, colors.premium, '#0EA5E9', '#EC4899', C.navy];
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
  // is_youth defaults to true (conservative = private/invite-only). The DB
  // trigger enforces it; the selector below makes the choice explicit so adult
  // teams are born public and youth teams are protected from the first save.
  const [form, setForm] = useState({ name: '', division: '', level: '', location: '', home_rink: '', logo_color: C.red, logo_initials: '', logo_url: '', is_youth: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCreate = async () => {
    if (!form.name.trim()) { setError('Add a team name to continue.'); return; }
    setSaving(true); setError(null);
    try {
      const team = await createTeam(form);
      navigate('/team/' + team.id + '/manage');
    } catch(e) { setError(e.message); setSaving(false); }
  };

  // Same upload pattern as profile avatars: 5MB cap, NSFW pre-check via
  // classifyImage, then uploadMedia → public URL into form state. The team
  // hasn't been saved yet here, so the URL is pinned by setForm and persists
  // when Create is clicked.
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(`That logo's ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 5 MB and upload again.`);
      e.target.value = '';
      return;
    }
    const verdict = await classifyImage(file);
    if (!verdict.ok) {
      alert("That image doesn't pass our community guidelines — pick a different one.");
      e.target.value = '';
      return;
    }
    setUploadingLogo(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { url, error: upErr } = await uploadMedia(file, user.id);
    setUploadingLogo(false);
    if (upErr || !url) { alert("That upload didn't go through — check your connection and try again."); return; }
    set('logo_url', url);
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
        <TeamLogo team={{ name: form.name, logo_url: form.logo_url, logo_color: form.logo_color, logo_initials: initials }} size={64} radius={12} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Logo</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ cursor: 'pointer', fontSize: 11, color: '#9BB5D6', padding: '4px 10px', borderRadius: 999, background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)' }}>
              {uploadingLogo ? 'Uploading…' : form.logo_url ? '📷 Replace' : '📷 Upload'}
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} disabled={uploadingLogo} />
            </label>
            {form.logo_url && (
              <button type="button" onClick={() => set('logo_url', '')} style={{ background: 'transparent', border: 'none', color: colors.redSoft, fontSize: 11, cursor: 'pointer', padding: 0 }}>Remove</button>
            )}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 12, marginBottom: 6 }}>{form.logo_url ? 'Fallback Color' : 'Logo Color'}</div>
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
        <Field label="Who plays on this team?">
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ v: false, label: 'Adults', sub: '18 & over' }, { v: true, label: 'Youth', sub: 'Under 18' }].map(opt => {
              const active = form.is_youth === opt.v;
              return (
                <button key={String(opt.v)} type="button" onClick={() => set('is_youth', opt.v)}
                  style={{ flex: 1, minHeight: 56, borderRadius: 12, cursor: 'pointer',
                    border: active ? `1.5px solid ${C.red}` : `1px solid ${C.border}`,
                    background: active ? 'rgba(215,38,56,0.12)' : 'transparent', color: C.ice,
                    fontFamily: 'Barlow, sans-serif', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{active ? '✓ ' : ''}{opt.label}</span>
                  <span style={{ fontSize: 11, color: colors.muted }}>{opt.sub}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <div style={{ fontSize: 12, color: form.is_youth ? C.gold : colors.muted, margin: '-6px 0 12px', lineHeight: 1.45 }}>
          {form.is_youth
            ? '🔒 Youth teams are private. Only rostered members, their parents/guardians, and coaches can see the roster, schedule, and locations — never the public.'
            : 'Adult teams are public and discoverable. Personal contact info (email/phone) still stays members-only.'}
        </div>
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
        {saving ? 'Creating…' : '🏒 Create Team'}
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
  const [unclaimedSlots, setUnclaimedSlots] = useState([]);
  const [contacts, setContacts] = useState({}); // YOUTH-PRIVACY: member_id -> contact (insider-only RPC)
  const [slotChoice, setSlotChoice] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Roster');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null); // transient confirmation (e.g. "Added 24 practices")

  // Add member form
  const [memberForm, setMemberForm] = useState({ name: '', email: '', jersey_number: '', position: 'Center', role: 'player', shot_hand: 'left' });
  // Add-to-schedule form (one flow for game / practice / event)
  const [scheduleForm, setScheduleForm] = useState({
    event_type: 'game',
    opponent: '', is_home: true,
    title: '', location: '', start_time: '', end_time: '', notes: '',
    // recurrence (practice/event only) — time_of_day/end_of_day are 'HH:MM'
    repeat: false, days_of_week: [], start_date: '', end_date: '', time_of_day: '', end_of_day: '',
  });

  const load = useCallback(async () => {
    try {
      const [t, m, g, r, slots, contactRows] = await Promise.all([getTeam(id), getTeamMembers(id), getTeamGames(id), getJoinRequests(id), getUnclaimedSlots(id), getTeamContacts(id).catch(() => [])]);
      setTeam(t); setMembers(m); setGames(g); setRequests(r); setUnclaimedSlots(slots);
      // YOUTH-PRIVACY: roster contact emails come from the insider-gated RPC
      // (invite_email is column-revoked). Keyed by member id for the row render.
      setContacts(Object.fromEntries((contactRows || []).map(c => [c.member_id, c.invite_email || c.account_email])));
      // Pre-select a ghost slot whose name matches each requester (manager can change).
      setSlotChoice(prev => {
        const next = { ...prev };
        for (const req of r) {
          if (next[req.id] !== undefined) continue;
          const nm = (req.profile?.name || '').trim().toLowerCase();
          const match = nm ? slots.find(s => (s.invite_name || '').trim().toLowerCase() === nm) : null;
          next[req.id] = match ? match.id : '';
        }
        return next;
      });
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleAddMember = async () => {
    if (!memberForm.name.trim()) { setError('Add a player name to add them to the roster.'); return; }
    setSaving(true); setError(null);
    try {
      let userId = null;
      const email = memberForm.email.trim().toLowerCase();
      if (email) {
        // YOUTH-PRIVACY: profiles.email is column-revoked — resolve an existing
        // account by email via the SECURITY DEFINER RPC (returns identity only,
        // never echoes the address). null => no account yet (placeholder + invite).
        const { data: match } = await supabase.rpc('find_account_by_email', { p_email: email });
        if (match && match[0]) userId = match[0].id;
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

      // Fire the team_invite email when we added a placeholder by email
      // (no matching profile). The link_invited_player trigger will
      // auto-flip user_id + status=active when they sign up with this
      // email, so the email just needs to motivate the signup. Skipped
      // when no email given (no way to reach them) or when the email
      // matched an existing user (they're already on Rinkd; we'd want
      // a different "you've been added" notification eventually — not
      // shipped yet, low priority).
      if (email && !userId) {
        try {
          await supabase.functions.invoke('send-invite', {
            body: {
              type: 'team_invite',
              to_email: email,
              to_name: memberForm.name.trim(),
              team_name: team?.name || null,
              invited_by: profile?.name || null,
            },
          });
        } catch (e) {
          // Non-fatal — the row is on the roster either way. Log so we
          // can see this if/when it ever surfaces.
          // eslint-disable-next-line no-console
          console.warn('[team] invite email send failed; roster row created anyway:', e?.message || e);
        }
      }

      setMemberForm({ name: '', email: '', jersey_number: '', position: 'Center', role: 'player', shot_hand: 'left' });
      await load();
    } catch(e) { setError(e.message); }
    setSaving(false);
  };

  const resetScheduleForm = () => setScheduleForm({
    event_type: scheduleForm.event_type, // keep the toggle where the user left it
    opponent: '', is_home: true,
    title: '', location: '', start_time: '', end_time: '', notes: '',
    repeat: false, days_of_week: [], start_date: '', end_date: '', time_of_day: '', end_of_day: '',
  });

  const handleAddScheduleItem = async () => {
    const f = scheduleForm;
    setError(null); setSuccess(null);

    // Recurring practice/event → generate the whole series.
    if (f.event_type !== 'game' && f.repeat) {
      if (!f.days_of_week.length || !f.time_of_day || !f.start_date || !f.end_date) {
        setError('Pick at least one weekday, a time, and a start + end date for the repeat.');
        return;
      }
      setSaving(true);
      try {
        const { count } = await generatePracticeSeries({
          team_id: id,
          event_type: f.event_type,
          daysOfWeek: f.days_of_week,
          startTime: f.time_of_day,
          endTime: f.end_of_day || null,
          startDate: f.start_date,
          endDate: f.end_date,
          location: f.location,
          title: f.title,
        });
        setError(null);
        const label = eventMeta(f.event_type).label.toLowerCase();
        setSuccess(`Added ${count} ${label}${count === 1 ? '' : 's'} to the schedule.`);
        resetScheduleForm();
        await load();
      } catch (e) { setError(e.message); }
      setSaving(false);
      return;
    }

    // Single item.
    if (f.event_type === 'game') {
      if (!f.opponent.trim() || !f.start_time) { setError('Add an opponent and a date & time.'); return; }
    } else {
      if (!f.start_time) { setError('Pick a date & time.'); return; }
    }
    setSaving(true);
    try {
      await addScheduleItem({
        team_id: id,
        event_type: f.event_type,
        opponent: f.event_type === 'game' ? f.opponent : null,
        is_home: f.event_type === 'game' ? f.is_home : null,
        title: f.event_type === 'game' ? null : f.title,
        location: f.location,
        start_time: f.start_time,
        end_time: f.event_type === 'game' ? null : (f.end_time || null),
        notes: f.notes,
      });
      setSuccess(`Added ${f.event_type === 'game' ? 'game' : eventMeta(f.event_type).label.toLowerCase()} to the schedule.`);
      resetScheduleForm();
      await load();
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  const handleDeleteItem = async (g) => {
    if (!window.confirm(`Remove this ${g.event_type === 'game' ? 'game' : g.event_type === 'practice' ? 'practice' : 'event'} from the schedule?`)) return;
    setError(null);
    try { await deleteScheduleItem(g.id); await load(); }
    catch (e) { setError(`Couldn't remove it: ${e?.message || 'try again'}`); }
  };

  const handleDeleteSeries = async (seriesId, label) => {
    if (!window.confirm(`Cancel every occurrence in this ${label} series? This removes all of them.`)) return;
    setError(null);
    try { await deleteSeries(seriesId); await load(); }
    catch (e) { setError(`Couldn't cancel the series: ${e?.message || 'try again'}`); }
  };

  const handleApprove = async (req) => {
    setError(null);
    try {
      await approveJoinRequest(req.id, { member_id: slotChoice[req.id] || null });
      await load();
    } catch (e) {
      setError(`Couldn't approve ${req.profile?.name || 'this request'}: ${e?.message || 'try again'}`);
    }
  };

  const handleDeny = async (req) => {
    setError(null);
    try {
      await denyJoinRequest(req.id);
      await load();
    } catch (e) {
      setError(`Couldn't deny ${req.profile?.name || 'this request'}: ${e?.message || 'try again'}`);
    }
  };

  const MANAGE_TABS = ['Roster', 'Schedule', 'Requests', 'Settings'];

  if (loading) return <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Getting the ice ready.</div>;

  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>
      {/* Header */}
      <div style={{ background: C.navy, padding: '14px 16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => navigate('/team/' + id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← {team?.name}</button>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>MANAGE TEAM</div>
        <div style={{ width: 60 }} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', background: C.navy, borderBottom: '2px solid rgba(46,91,140,0.3)' }}>
        {MANAGE_TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ fontSize: 13, fontWeight: 700, padding: '10px 16px', color: '#FFFFFF', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? `3px solid ${C.red}` : '3px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', flexShrink: 0, opacity: activeTab === tab ? 1 : 0.5, transition: 'opacity 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = C.navy; e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.opacity = activeTab === tab ? '1' : '0.5'; }}>
            {tab} {tab === 'Requests' && requests.length > 0 ? `(${requests.length})` : ''}
          </button>
        ))}
      </div>

      <div style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
        {error && <div style={{ background: 'rgba(215,38,56,0.15)', border: '0.5px solid rgba(215,38,56,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>}
        {success && <div style={{ background: 'rgba(34,197,94,0.12)', border: '0.5px solid rgba(34,197,94,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: colors.success }}>{success}</div>}

        {/* ROSTER */}
        {activeTab === 'Roster' && (
          <>
            <ManagersSection teamId={id} foundingManagerId={team?.manager_id} />

            <SectionLabel>Bulk Roster Upload</SectionLabel>
            <Card>
              <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6, marginBottom: 12 }}>
                Got the whole team in a spreadsheet? Drop a CSV and every player gets a Rinkd
                signup invite. They show up on your roster as <strong style={{ color: colors.warning }}>INVITED</strong> until they sign up.
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
                <Field label="Jersey #"><input style={inputStyle} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={memberForm.jersey_number} onChange={e => setMemberForm(p => ({ ...p, jersey_number: e.target.value.replace(/[^\d]/g, '').slice(0, 3) }))} placeholder="#" /></Field>
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
              {members.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No players yet — add one above or upload your roster.</div>}
              {members.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: 'rgba(244,247,250,0.3)', width: 24, textAlign: 'center', flexShrink: 0 }}>{m.jersey_number || '—'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                      {m.profile?.name || m.invite_name}
                      {m.status === 'pending' && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: 'rgba(245,158,11,0.2)', color: colors.warning }}>INVITE PENDING</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)' }}>
                      {m.position}{m.profile?.handle ? ' · @' + m.profile.handle : contacts[m.id] ? ' · ' + contacts[m.id] : ''}
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

        {/* SCHEDULE — one flow for games, practices & events */}
        {activeTab === 'Schedule' && (
          <>
            <SectionLabel>Add to Schedule</SectionLabel>
            <Card>
              {/* Event-type toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {SCHEDULE_TYPES.map(t => {
                  const meta = eventMeta(t);
                  const active = scheduleForm.event_type === t;
                  return (
                    <button key={t} type="button"
                      onClick={() => setScheduleForm(p => ({ ...p, event_type: t, repeat: t === 'game' ? false : p.repeat }))}
                      style={{ flex: 1, minHeight: 44, borderRadius: 10, cursor: 'pointer',
                        border: active ? `1.5px solid ${meta.accent}` : `1px solid ${C.border}`,
                        background: active ? meta.accentBg : 'transparent', color: C.ice,
                        fontFamily: 'Barlow, sans-serif', fontWeight: 800, fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <span>{meta.icon}</span>{meta.label}
                    </button>
                  );
                })}
              </div>

              {scheduleForm.event_type === 'game' ? (
                <>
                  <Field label="Opponent"><input style={inputStyle} value={scheduleForm.opponent} onChange={e => setScheduleForm(p => ({ ...p, opponent: e.target.value }))} placeholder="e.g. Chicago Mission" /></Field>
                  <Row2>
                    <Field label="Home or Away">
                      <select style={selectStyle} value={scheduleForm.is_home ? 'home' : 'away'} onChange={e => setScheduleForm(p => ({ ...p, is_home: e.target.value === 'home' }))}>
                        <option value="home">Home</option>
                        <option value="away">Away</option>
                      </select>
                    </Field>
                    <Field label="Location"><input style={inputStyle} value={scheduleForm.location} onChange={e => setScheduleForm(p => ({ ...p, location: e.target.value }))} placeholder="Rink name" /></Field>
                  </Row2>
                  <Field label="Date & Time"><DateTimePicker value={scheduleForm.start_time} onChange={v => setScheduleForm(p => ({ ...p, start_time: v }))} placeholder="Select date & time" /></Field>
                </>
              ) : (
                <>
                  <Row2>
                    <Field label="Title"><input style={inputStyle} value={scheduleForm.title} onChange={e => setScheduleForm(p => ({ ...p, title: e.target.value }))} placeholder={scheduleForm.event_type === 'practice' ? 'Practice' : 'e.g. Team Meeting'} /></Field>
                    <Field label="Location"><input style={inputStyle} value={scheduleForm.location} onChange={e => setScheduleForm(p => ({ ...p, location: e.target.value }))} placeholder="Rink / address" /></Field>
                  </Row2>

                  {/* Repeat toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, cursor: 'pointer', marginBottom: scheduleForm.repeat ? 8 : 4 }}>
                    <input type="checkbox" checked={scheduleForm.repeat} onChange={e => setScheduleForm(p => ({ ...p, repeat: e.target.checked }))}
                      style={{ width: 18, height: 18, accentColor: C.blue, cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>Repeat weekly</span>
                    <span style={{ fontSize: 11, color: C.steel }}>· generate the whole season at once</span>
                  </label>

                  {!scheduleForm.repeat ? (
                    <>
                      <Field label="Date & Time"><DateTimePicker value={scheduleForm.start_time} onChange={v => setScheduleForm(p => ({ ...p, start_time: v }))} placeholder="Select date & time" /></Field>
                      <Field label="Ends (optional)"><DateTimePicker value={scheduleForm.end_time} onChange={v => setScheduleForm(p => ({ ...p, end_time: v }))} placeholder="Select end (optional)" /></Field>
                    </>
                  ) : (
                    <>
                      <Field label="Repeat on">
                        <div style={{ display: 'flex', gap: 6 }}>
                          {[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]].map(([lbl, d]) => {
                            const on = scheduleForm.days_of_week.includes(d);
                            return (
                              <button key={d} type="button"
                                onClick={() => setScheduleForm(p => ({ ...p, days_of_week: on ? p.days_of_week.filter(x => x !== d) : [...p.days_of_week, d] }))}
                                title={lbl}
                                style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 8, cursor: 'pointer',
                                  border: on ? `1.5px solid ${C.blue}` : `1px solid ${C.border}`,
                                  background: on ? 'rgba(46,91,140,0.25)' : 'transparent',
                                  color: on ? C.ice : C.steel, fontFamily: 'Barlow, sans-serif', fontWeight: 800, fontSize: 12 }}>
                                {lbl[0]}
                              </button>
                            );
                          })}
                        </div>
                      </Field>
                      <Row2>
                        <Field label="Start time"><input type="time" style={{ ...inputStyle, colorScheme: 'dark', minHeight: 44 }} value={scheduleForm.time_of_day} onChange={e => setScheduleForm(p => ({ ...p, time_of_day: e.target.value }))} /></Field>
                        <Field label="End time"><input type="time" style={{ ...inputStyle, colorScheme: 'dark', minHeight: 44 }} value={scheduleForm.end_of_day} onChange={e => setScheduleForm(p => ({ ...p, end_of_day: e.target.value }))} /></Field>
                      </Row2>
                      <Row2>
                        <Field label="First week"><input type="date" style={{ ...inputStyle, colorScheme: 'dark', minHeight: 44 }} value={scheduleForm.start_date} onChange={e => setScheduleForm(p => ({ ...p, start_date: e.target.value }))} /></Field>
                        <Field label="Last week"><input type="date" style={{ ...inputStyle, colorScheme: 'dark', minHeight: 44 }} value={scheduleForm.end_date} onChange={e => setScheduleForm(p => ({ ...p, end_date: e.target.value }))} /></Field>
                      </Row2>
                    </>
                  )}
                </>
              )}

              <ActionBtn onClick={handleAddScheduleItem}>
                {saving ? 'Saving…'
                  : scheduleForm.event_type === 'game' ? '+ Add Game'
                  : scheduleForm.repeat ? `+ Generate ${eventMeta(scheduleForm.event_type).label} Series`
                  : `+ Add ${eventMeta(scheduleForm.event_type).label}`}
              </ActionBtn>
            </Card>

            <SectionLabel>Schedule ({games.length})</SectionLabel>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {games.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>Nothing scheduled yet — add a game, practice, or event above.</div>}
              {games.map(g => {
                const type = g.event_type || 'game';
                const meta = eventMeta(type);
                const isLeague = g._source === 'league';
                const editable = !isLeague; // league games live in league_games, not team_games
                const date = new Date(g.start_time);
                const teamScore = g.is_home ? g.home_score : g.away_score;
                const oppScore = g.is_home ? g.away_score : g.home_score;
                return (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', width: 44, flexShrink: 0, lineHeight: 1.4 }}>
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {type !== 'game' && (
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', padding: '1px 6px', borderRadius: 4, background: meta.accentBg, color: meta.badgeText }}>{meta.badge}</span>
                        )}
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scheduleTitle(g)}</span>
                        {g.series_id && <span style={{ fontSize: 9, color: C.steel }}>· weekly</span>}
                      </div>
                      {g.location && <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.location}</div>}
                    </div>
                    {g.status === 'final'
                      ? <div style={{ fontSize: 12, fontWeight: 700, color: teamScore > oppScore ? colors.success : C.red }}>{teamScore > oppScore ? 'W' : 'L'} {teamScore}–{oppScore}</div>
                      : <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)' }}>{date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                    }
                    {editable && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                        <button onClick={() => handleDeleteItem(g)} title="Remove"
                          style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.25)', cursor: 'pointer', fontSize: 15, lineHeight: 1, minWidth: 44, minHeight: 44 }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red}
                          onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.25)'}>✕</button>
                        {g.series_id && (
                          <button onClick={() => handleDeleteSeries(g.series_id, meta.label.toLowerCase())}
                            style={{ background: 'none', border: 'none', color: C.steel, cursor: 'pointer', fontSize: 11, padding: '6px 4px', whiteSpace: 'nowrap' }}>
                            cancel all
                          </button>
                        )}
                      </div>
                    )}
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
            {requests.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '30px 0' }}>No requests right now — they'll land here when players ask to join.</div>}
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
                {unclaimedSlots.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Assign to roster spot</label>
                    <select value={slotChoice[req.id] ?? ''} onChange={e => setSlotChoice(s => ({ ...s, [req.id]: e.target.value }))} style={{ ...selectStyle, fontSize: 13, padding: '8px 10px' }}>
                      <option value="">➕ New roster spot</option>
                      {unclaimedSlots.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.invite_name || 'Unnamed'}{s.position ? ` · ${s.position}` : ''}{s.jersey_number ? ` · #${s.jersey_number}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
  const [form, setForm] = useState({ name: team.name, division: team.division || '', level: team.level || '', location: team.location || '', home_rink: team.home_rink || '', logo_color: team.logo_color || C.red, logo_initials: team.logo_initials || '', logo_url: team.logo_url || '' });
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  // Mirrors the Create flow's uploader. The team is already saved here, so
  // the URL goes into local form state and ships with the next Save Changes.
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(`That logo's ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 5 MB and upload again.`);
      e.target.value = '';
      return;
    }
    const verdict = await classifyImage(file);
    if (!verdict.ok) {
      alert("That image doesn't pass our community guidelines — pick a different one.");
      e.target.value = '';
      return;
    }
    setUploadingLogo(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { url, error: upErr } = await uploadMedia(file, user.id);
    setUploadingLogo(false);
    if (upErr || !url) { alert("That upload didn't go through — check your connection and try again."); return; }
    set('logo_url', url);
  };

  return (
    <>
      <SectionLabel>Team Settings</SectionLabel>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <TeamLogo team={{ name: form.name, logo_url: form.logo_url, logo_color: form.logo_color, logo_initials: form.logo_initials }} size={56} radius={10} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ cursor: 'pointer', fontSize: 11, color: '#9BB5D6', padding: '4px 10px', borderRadius: 999, background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)' }}>
                {uploadingLogo ? 'Uploading…' : form.logo_url ? '📷 Replace logo' : '📷 Upload logo'}
                <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} disabled={uploadingLogo} />
              </label>
              {form.logo_url && (
                <button type="button" onClick={() => set('logo_url', '')} style={{ background: 'transparent', border: 'none', color: colors.redSoft, fontSize: 11, cursor: 'pointer', padding: 0 }}>Remove</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {LOGO_COLORS.map(col => (
                <div key={col} onClick={() => set('logo_color', col)}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: col, cursor: 'pointer', border: form.logo_color === col ? '2px solid #fff' : '2px solid transparent' }} />
              ))}
            </div>
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
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </>
  );
}

// ── MANAGERS SECTION (multi-manager support) ──────────────────
// Lives at the top of the Roster tab. Mirrors the Directors section
// on TournamentManage's Scorers tab. The founding manager
// (teams.manager_id) gets a "Founder" badge and cannot be removed —
// RLS enforces this server-side too.
function ManagersSection({ teamId, foundingManagerId }) {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await listTeamManagers(teamId);
    setManagers(data);
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!input.trim() || busy) return;
    setBusy(true); setMsg(null);
    const res = await addTeamManagerByInput({ teamId, input });
    setBusy(false);
    if (res.status === 'added') {
      setMsg({ ok: true, text: `Added ${res.profile.name || '@' + res.profile.handle} as a manager.` });
      setInput(''); load();
    } else if (res.status === 'promoted') {
      if (res.previousRole === 'manager') {
        setMsg({ ok: true, text: `${res.profile.name || '@' + res.profile.handle} is already a manager.` });
      } else {
        setMsg({ ok: true, text: `Promoted ${res.profile.name || '@' + res.profile.handle} from ${res.previousRole} to manager.` });
      }
      setInput(''); load();
    } else if (res.status === 'no_account') {
      setMsg({ ok: false, text: `No Rinkd account for "${res.input}". Managers must sign up first — share the link and add them once they've joined.` });
    } else {
      setMsg({ ok: false, text: res.message || "Couldn't add that manager — double-check the handle or email and try again." });
    }
  };

  const handleRemove = async (memberId, name) => {
    if (!window.confirm(`Remove ${name} as a manager? They'll lose management access. (To keep them on the roster as a player, use Demote instead.)`)) return;
    const { error } = await removeTeamManager(memberId);
    if (error) { alert(`Couldn't remove them: ${error.message}`); return; }
    load();
  };

  const handleDemote = async (memberId, name) => {
    if (!window.confirm(`Demote ${name} to player? They'll stay on the roster but lose management access.`)) return;
    const { error } = await demoteTeamManager(memberId);
    if (error) { alert(`Couldn't demote them: ${error.message}`); return; }
    load();
  };

  return (
    <>
      <SectionLabel>Managers</SectionLabel>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 10, lineHeight: 1.5 }}>
        Managers have full management access — edit settings, roster, schedule, volunteer slots, and add or remove other managers. Add by Rinkd handle or email.
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="@handle or email"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={handleAdd} disabled={busy}
            style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '0 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {busy ? 'Adding…' : '+ Add'}
          </button>
        </div>
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12, color: msg.ok ? colors.success : C.red, lineHeight: 1.5 }}>{msg.text}</div>
        )}
      </Card>

      {loading ? (
        <div style={{ color: C.steel, fontSize: 13, padding: '16px 0', textAlign: 'center' }}>Warming up.</div>
      ) : managers.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.steel, padding: '20px 0', fontSize: 13 }}>
          No extra managers yet — add one above to share the load. (The founder is set on the team itself, not listed here.)
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
          {managers.map((m, i) => {
            const p = m.profile || {};
            const name = p.name || (p.handle ? '@' + p.handle : m.invite_name || 'Unknown');
            const isFounder = m.user_id === foundingManagerId;
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: p.avatar_color || C.navy, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, color: '#fff' }}>
                  {p.avatar_initials || (name[0] || '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>
                    {name}
                    {isFounder && (
                      <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', background: 'rgba(245,158,11,0.18)', color: colors.warning, borderRadius: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        Founder
                      </span>
                    )}
                  </div>
                  {p.handle && <div style={{ fontSize: 12, color: C.steel }}>@{p.handle}</div>}
                </div>
                {isFounder ? (
                  <div style={{ fontSize: 11, color: C.steel }}>Can't remove</div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => handleDemote(m.id, name)}
                      style={{ background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 999, color: C.steel, fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Demote
                    </button>
                    <button onClick={() => handleRemove(m.id, name)}
                      style={{ background: 'transparent', border: `0.5px solid ${C.red}40`, borderRadius: 999, color: C.red, fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
