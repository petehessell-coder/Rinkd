import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Avatar } from '../components/Logos';
import RsvpBlock from '../components/RsvpBlock';
import { supabase } from '../lib/supabase';
import { useFamily } from '../lib/familyContext';
import { getPersonTeams, getPersonUpcomingGames } from '../lib/family';

// REG-2 — one person = one card that's everything (REGISTRATION_PARITY §3).
// The acting-as destination: a managed person's teams + upcoming games, each
// with RSVP-on-behalf. Reached from the switcher (which also sets acting-as)
// or directly; either way we engage acting-as for the people I manage.

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
};

function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob); if (isNaN(d)) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

export default function PersonCard({ profile }) {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { managed, setActingAs } = useFamily();
  const [person, setPerson] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const iManage = managed.some(m => m.profile_id === profileId);

  // Engage acting-as for people I manage. Acting-as is a persistent mode (the
  // app-wide banner + "RSVPing as X" reflect it); the user leaves it via the
  // banner's "switch back to you" or by picking You in the switcher — NOT by
  // navigating away. So we set on mount but deliberately don't reset on unmount.
  useEffect(() => {
    if (iManage) setActingAs(profileId);
  }, [iManage, profileId, setActingAs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setNotFound(false);
      try {
        const { data: p } = await supabase
          .from('profiles')
          .select('id, name, handle, avatar_color, avatar_initials, avatar_url, account_type, date_of_birth, position, level')
          .eq('id', profileId).maybeSingle();
        if (cancelled) return;
        if (!p) { setNotFound(true); setLoading(false); return; }
        setPerson(p);
        const t = await getPersonTeams(profileId);
        if (cancelled) return;
        setTeams(t);
        const g = await getPersonUpcomingGames(t.map(x => x.team_id));
        if (cancelled) return;
        setGames(g);
      } catch (_) {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  const wrap = { maxWidth: 720, margin: '0 auto', padding: '20px 16px 40px', fontFamily: "'Barlow', sans-serif" };

  if (loading) {
    return <Layout profile={profile}><div style={wrap}><div style={{ color: B.steel }}>Loading…</div></div></Layout>;
  }
  if (notFound) {
    return <Layout profile={profile}><div style={wrap}><div style={{ color: B.steel }}>We couldn't find that person.</div></div></Layout>;
  }

  const age = ageFrom(person.date_of_birth);
  const teamById = Object.fromEntries(teams.map(t => [t.team_id, t.team]));
  const fmt = (iso) => { try { return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

  return (
    <Layout profile={profile}>
      <div style={wrap}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <Avatar profile={person} size={64} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, color: B.ice }}>{person.name}</div>
            <div style={{ fontSize: 13, color: B.steel }}>
              {person.account_type === 'minor' ? 'Child' : person.account_type === 'managed_adult' ? 'Managed' : `@${person.handle}`}
              {age != null && ` · age ${age}`}
              {person.position ? ` · ${person.position}` : ''}
            </div>
          </div>
        </div>

        {!iManage && person.account_type !== 'adult' && (
          <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#FCD34D', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 16 }}>
            You're viewing this profile but don't manage it, so you can't RSVP on their behalf.
          </div>
        )}

        {/* Teams */}
        <SectionLabel>Teams</SectionLabel>
        {teams.length === 0 ? (
          <Empty text="Not on any teams yet." />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {teams.map(t => (
              <button key={t.team_id} onClick={() => navigate(`/team/${t.team_id}`)} style={chip}>
                {t.team?.name || 'Team'}{t.jersey_number ? ` · #${t.jersey_number}` : ''}
              </button>
            ))}
          </div>
        )}

        {/* Upcoming games with RSVP-on-behalf */}
        <SectionLabel>Upcoming</SectionLabel>
        {games.length === 0 ? (
          <Empty text="No upcoming games scheduled." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {games.map(g => (
              <div key={g.id} style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: B.ice }}>
                  {teamById[g.team_id]?.name || 'Team'} {g.is_home ? 'vs.' : '@'} {g.opponent || 'TBD'}
                </div>
                <div style={{ fontSize: 12, color: B.steel, marginTop: 2 }}>
                  {fmt(g.start_time)}{g.location ? ` · ${g.location}` : ''}
                </div>
                {iManage && <RsvpBlock gameId={g.id} actingForProfile={person} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: B.steel, margin: '0 0 8px' }}>{children}</div>;
}
function Empty({ text }) {
  return <div style={{ color: B.steel, fontSize: 14, marginBottom: 18 }}>{text}</div>;
}
const chip = { background: B.card, border: `1px solid ${B.border}`, borderRadius: 999, padding: '7px 14px', fontSize: 13, color: B.ice, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", fontWeight: 600 };
