import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Top-of-page tab strip shared by /teams and /volunteer-coordinator. The
 * Volunteer Coordinator surface used to live inside the More drawer's
 * Manager section; promoting it to a Teams page tab makes it discoverable
 * for any user — the VolunteerCoordinator page itself surfaces a friendly
 * "managers only" empty state for users without a team to manage.
 *
 * Tabs navigate between full pages (URL-driven) rather than swapping content
 * inline. Keeps URLs clean + lets each page own its own layout/header.
 *
 * `active` is one of 'teams' | 'volunteer'.
 */
export default function TeamsHeaderTabs({ active }) {
  const navigate = useNavigate();
  const tabs = [
    { id: 'teams',     label: 'Teams',     path: '/teams' },
    { id: 'volunteer', label: 'Volunteer', path: '/volunteer-coordinator' },
  ];
  return (
    <div style={{
      display: 'flex',
      gap: 4,
      background: '#0f2847',
      border: '0.5px solid rgba(46,91,140,0.4)',
      borderRadius: 10,
      padding: 4,
      marginBottom: 16,
    }}>
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => { if (!isActive) navigate(t.path); }}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 7,
              border: 'none',
              background: isActive ? '#2E5B8C' : 'transparent',
              color: isActive ? '#F4F7FA' : '#8BA3BE',
              fontFamily: "'Barlow', sans-serif",
              fontWeight: isActive ? 700 : 500,
              fontSize: 14,
              cursor: isActive ? 'default' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
