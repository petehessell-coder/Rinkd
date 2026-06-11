import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Avatar } from '../components/Logos';
import { useFamily } from '../lib/familyContext';
import {
  createHousehold, createManagedProfile, createHouseholdInvite,
  decideGuardianshipClaim, cancelGuardianshipClaim, removeHouseholdMember,
} from '../lib/family';
import FamilyMoney from '../components/FamilyMoney';

// REG-2 — the family surface. Household plumbing reached from the switcher's
// "Family settings": per-person cards, add a kid, invite a co-parent, decide
// pending guardianship claims. No left-nav item — this is a destination, not a
// console (REGISTRATION_PARITY §3).

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
  green: '#22C55E', amber: '#F59E0B',
};

export default function Family({ profile }) {
  const navigate = useNavigate();
  const { household, managed, coGuardians, claims, refresh, loading } = useFamily();
  const managedIds = new Set(managed.map(m => m.profile_id));
  const myId = profile?.id;
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'add' | 'invite' | null
  const [err, setErr] = useState('');

  const startHousehold = async () => {
    setBusy(true); setErr('');
    try { await createHousehold(null); await refresh(); }
    catch (e) { setErr(e?.message || 'Could not start your family.'); }
    finally { setBusy(false); }
  };

  const onRemove = async (memberId, name) => {
    if (!window.confirm(`Remove ${name} from your family? Their profile and stats stay; they just leave this household.`)) return;
    setBusy(true); setErr('');
    try { await removeHouseholdMember(memberId); await refresh(); }
    catch (e) { setErr(e?.message || 'Could not remove this member.'); }
    finally { setBusy(false); }
  };

  const onDecide = async (claimId, approve) => {
    setBusy(true); setErr('');
    try { await decideGuardianshipClaim(claimId, approve); await refresh(); }
    catch (e) { setErr(e?.message || 'Could not update the request.'); }
    finally { setBusy(false); }
  };

  const onCancel = async (claimId) => {
    setBusy(true); setErr('');
    try { await cancelGuardianshipClaim(claimId); await refresh(); }
    catch (e) { setErr(e?.message || 'Could not cancel the request.'); }
    finally { setBusy(false); }
  };

  const wrap = { maxWidth: 720, margin: '0 auto', padding: '20px 16px 40px', fontFamily: "'Barlow', sans-serif" };
  const h1 = { fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, color: B.ice, margin: '0 0 4px' };

  // ── No household yet ──
  if (!loading && !household) {
    return (
      <Layout profile={profile}>
        <div style={wrap}>
          <h1 style={h1}>Your family</h1>
          <p style={{ color: B.steel, fontSize: 14, lineHeight: 1.6, maxWidth: 460 }}>
            Manage your kids' profiles, RSVP for them, and share access with a co-parent —
            all from one place. Start by creating your family.
          </p>
          {err && <Banner text={err} />}
          <button onClick={startHousehold} disabled={busy} style={primaryBtn(busy)}>
            {busy ? 'Setting up…' : 'Start my family'}
          </button>
        </div>
      </Layout>
    );
  }

  const myClaims = claims.filter(c => c.claimant_profile_id === myId);
  // I can actually decide a claim only when I'm an existing guardian of the
  // minor (the minor is in my managed set). Claims surfaced to me purely as a
  // rostering org admin (minor not in my managed set) show read-only so the UI
  // never offers Approve/Deny that the RPC would reject with a 42501.
  const toDecide = claims.filter(c => c.claimant_profile_id !== myId && managedIds.has(c.minor_profile_id));
  const awaiting = claims.filter(c => c.claimant_profile_id !== myId && !managedIds.has(c.minor_profile_id));

  return (
    <Layout profile={profile}>
      <div style={wrap}>
        <h1 style={h1}>Your family</h1>
        <p style={{ color: B.steel, fontSize: 13, margin: '0 0 18px' }}>
          {household?.name || 'Your household'} · {managed.length + coGuardians.length + 1} member{managed.length + coGuardians.length === 0 ? '' : 's'}
        </p>

        {err && <Banner text={err} />}

        {/* Pending requests */}
        {(toDecide.length > 0 || myClaims.length > 0 || awaiting.length > 0) && (
          <Section title="Requests">
            {toDecide.map(c => (
              <div key={c.id} style={claimRow}>
                <Avatar profile={c.minor} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: B.ice, fontWeight: 600 }}>
                    {c.claimant?.name || 'Someone'} wants to manage {c.minor?.name}
                  </div>
                  <div style={{ fontSize: 12, color: B.steel }}>They'll become a guardian once you approve.</div>
                </div>
                <button onClick={() => onDecide(c.id, true)} disabled={busy} style={miniBtn(B.green)}>Approve</button>
                <button onClick={() => onDecide(c.id, false)} disabled={busy} style={miniBtn(B.border)}>Deny</button>
              </div>
            ))}
            {myClaims.map(c => (
              <div key={c.id} style={claimRow}>
                <Avatar profile={c.minor} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: B.ice, fontWeight: 600 }}>Request to manage {c.minor?.name}</div>
                  <div style={{ fontSize: 12, color: B.amber }}>Pending another guardian's approval.</div>
                </div>
                <button onClick={() => onCancel(c.id)} disabled={busy} style={miniBtn(B.border)}>Cancel</button>
              </div>
            ))}
            {awaiting.map(c => (
              <div key={c.id} style={claimRow}>
                <Avatar profile={c.minor} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: B.ice, fontWeight: 600 }}>
                    {c.claimant?.name || 'Someone'} wants to manage {c.minor?.name}
                  </div>
                  <div style={{ fontSize: 12, color: B.steel }}>Awaiting a guardian's approval.</div>
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* People */}
        <Section title="People">
          {/* me */}
          <PersonRow profile={profile} subtitle="You" onOpen={() => navigate('/profile')} />
          {managed.map(m => (
            <PersonRow key={m.profile_id} profile={m.profile}
              subtitle={m.profile?.account_type === 'minor' ? 'Child' : 'Managed adult'}
              onOpen={() => navigate(`/family/${m.profile_id}`)}
              onRemove={() => onRemove(m.id, m.profile?.name)} />
          ))}
          {coGuardians.map(m => (
            <PersonRow key={m.profile_id} profile={m.profile} subtitle="Co-guardian" muted
              onOpen={() => navigate(`/profile/${m.profile_id}`)} />
          ))}
        </Section>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button onClick={() => setModal('add')} style={primaryBtn(false)}>＋ Add a family member</button>
          <button onClick={() => setModal('invite')} style={ghostBtn}>Invite a co-parent</button>
        </div>

        {/* REG-4: invoices (Pay now / Auto-Pay) + receipts — money woven in. */}
        <FamilyMoney />
      </div>

      {modal === 'add' && (
        <AddMemberModal household={household} onClose={() => setModal(null)} onDone={async () => { setModal(null); await refresh(); }} />
      )}
      {modal === 'invite' && (
        <InviteCoParentModal household={household} onClose={() => setModal(null)} />
      )}
    </Layout>
  );
}

// ── Add a managed profile (kid / dependent) ──
function AddMemberModal({ household, onClose, onDone }) {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [type, setType] = useState('minor');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [claimed, setClaimed] = useState(null);

  const submit = async () => {
    if (!name.trim()) { setErr('Please enter a name.'); return; }
    if (!dob) { setErr('Please enter a date of birth.'); return; }
    setBusy(true); setErr('');
    try {
      const { outcome } = await createManagedProfile(household.id, name.trim(), dob, type);
      if (outcome === 'claim_requested') { setClaimed(name.trim()); }
      else { await onDone(); }
    } catch (e) { setErr(e?.message || 'Could not add this person.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Add a family member">
      {claimed ? (
        <div>
          <p style={{ color: B.ice, fontSize: 14, lineHeight: 1.6 }}>
            <strong>{claimed}</strong> already exists in another family. We've sent a request to their
            guardian to share access — you'll see {claimed} here once it's approved.
          </p>
          <button onClick={onClose} style={primaryBtn(false)}>Got it</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <Banner text={err} />}
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Henry Hessell" style={input} />
          </Field>
          <Field label="Date of birth">
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} style={input} />
          </Field>
          <Field label="Type">
            <select value={type} onChange={e => setType(e.target.value)} style={input}>
              <option value="minor">Child (under 13, no login)</option>
              <option value="managed_adult">Adult I manage</option>
            </select>
          </Field>
          <p style={{ fontSize: 12, color: B.steel, lineHeight: 1.5, margin: 0 }}>
            They get a real, followable profile with no login. You manage it and can RSVP for them.
          </p>
          <button onClick={submit} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Adding…' : 'Add to my family'}</button>
        </div>
      )}
    </Modal>
  );
}

// ── Invite a co-parent (magic link) ──
function InviteCoParentModal({ household, onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const { token } = await createHouseholdInvite(household.id, email.trim());
      const url = `${window.location.origin}/accept-household-invite?token=${token}`;
      setLink(url);
    } catch (e) { setErr(e?.message || 'Could not create the invite.'); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (_) {}
  };

  return (
    <Modal onClose={onClose} title="Invite a co-parent">
      {link ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ color: B.ice, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Send this link to <strong>{email}</strong>. They sign in with that email and instantly share your
            household — same kids, same schedule.
          </p>
          <div style={{ ...input, wordBreak: 'break-all', fontSize: 12, color: B.steel }}>{link}</div>
          <button onClick={copy} style={primaryBtn(false)}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <Banner text={err} />}
          <Field label="Their email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="coparent@email.com" style={input} />
          </Field>
          <p style={{ fontSize: 12, color: B.steel, lineHeight: 1.5, margin: 0 }}>
            They must accept while signed in as this email — nothing changes until they do.
          </p>
          <button onClick={submit} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Creating…' : 'Create invite link'}</button>
        </div>
      )}
    </Modal>
  );
}

// ── small shared UI ──
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: B.steel, margin: '0 0 8px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}
function PersonRow({ profile, subtitle, onOpen, onRemove, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 12 }}>
      <button onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
        <Avatar profile={profile} size={40} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: B.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.name}</div>
          <div style={{ fontSize: 12, color: muted ? B.steel : B.blue }}>{subtitle}</div>
        </div>
      </button>
      {onRemove && (
        <button onClick={onRemove} aria-label="Remove" style={{ background: 'transparent', border: 'none', color: B.steel, cursor: 'pointer', fontSize: 18, padding: 6 }}>✕</button>
      )}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, color: B.steel, marginBottom: 5, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  );
}
function Banner({ text }) {
  return <div style={{ background: 'rgba(215,38,56,0.12)', border: '1px solid rgba(215,38,56,0.4)', color: '#FCA5A5', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{text}</div>;
}
function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: B.navy, border: `1px solid ${B.border}`, borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: B.ice }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: B.steel, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const input = { width: '100%', boxSizing: 'border-box', background: B.dark, border: `1px solid ${B.border}`, borderRadius: 10, padding: '10px 12px', color: B.ice, fontSize: 14, fontFamily: "'Barlow', sans-serif" };
function primaryBtn(busy) { return { background: busy ? B.border : B.red, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: "'Barlow', sans-serif" }; }
const ghostBtn = { background: 'transparent', color: B.ice, border: `1px solid ${B.border}`, borderRadius: 999, padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" };
function miniBtn(bg) { return { background: bg, color: '#fff', border: 'none', borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", flexShrink: 0 }; }
const claimRow = { display: 'flex', alignItems: 'center', gap: 10, background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 12 };
