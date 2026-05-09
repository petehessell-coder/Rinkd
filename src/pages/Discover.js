import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';
export default function Discover({ currentUser, profile }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    supabase.from('profiles').select('*').order('points', { ascending: false }).then(({ data }) => setUsers(data || []));
  }, []);
  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.handle?.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <Layout profile={profile} currentPage="discover">
      <div style={{ padding: '16px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search players..." style={{ width: '100%', padding: '12px 16px', background: '#112236', border: '1px solid #1E3A5C', borderRadius: 8, color: '#F4F7FA', fontSize: 15, fontFamily: "'Barlow', sans-serif", marginBottom: 16, boxSizing: 'border-box' }} />
        {filtered.map(u => (
          <a key={u.id} href={"/profile/" + u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px', background: '#112236', border: '1px solid #1E3A5C', borderRadius: 10, marginBottom: 8, textDecoration: 'none' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: u.avatar_color || '#2E5B8C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, color: '#fff', fontSize: 16, flexShrink: 0 }}>{u.avatar_initials || (u.name || 'U').slice(0,2).toUpperCase()}</div>
            <div>
              <div style={{ color: '#F4F7FA', fontWeight: 600, fontSize: 14 }}>{u.name}</div>
              <div style={{ color: '#8BA3BE', fontSize: 12 }}>@{u.handle} · {u.points || 0} pts</div>
            </div>
          </a>
        ))}
      </div>
    </Layout>
  );
}