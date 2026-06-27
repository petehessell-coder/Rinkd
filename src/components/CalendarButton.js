import React from 'react';
import { buildIcs, downloadIcs } from '../lib/ics';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE',
};

/**
 * "📅 Add to Calendar" pill. Generates an .ics for the game and triggers a
 * download — iOS/macOS auto-opens in Apple Calendar, Android opens in Google
 * Calendar via the import flow, desktop browsers download the .ics file.
 *
 * Props:
 *   game        — the game row. Reads start_time, opponent/home_team/away_team,
 *                 rink, location.
 *   homeName, awayName  — overrides for the title (handy when caller already
 *                 normalized league_teams ↔ teams names).
 *   teamLabel   — e.g. "Test Team 1 vs. taco" when used on a Team schedule row
 *                 where we know which side we're on. Skips home/away inference.
 *   style       — extra inline style for the button.
 *   icon        — leading icon (default 📅).
 *   label       — button text (default "Add to Calendar").
 *   onClickExtra — analytics hook.
 */
export default function CalendarButton({ game, teamLabel, homeName, awayName, style, icon = '📅', label = 'Add to Calendar', onClickExtra }) {
  if (!game || !game.start_time) return null;

  const handleClick = (e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }

    // Build a nice title
    let title = teamLabel;
    if (!title) {
      const home = homeName || game.home_lt?.team?.name || game.home_lt?.team_name || game.home_team?.team_name;
      const away = awayName || game.away_lt?.team?.name || game.away_lt?.team_name || game.away_team?.team_name;
      if (home && away) title = `${home} vs. ${away}`;
      else if (game.opponent) title = `${game.is_home ? 'vs.' : '@'} ${game.opponent}`;
      else title = 'Rinkd game';
    }
    title = `🏒 ${title}`;

    // Location: prefer joined rink address, then rink name, then raw location
    const venueParts = [];
    if (game.rink) {
      const rinkName = [game.rink.sub_rink, game.rink.name].filter(Boolean).join(' · ');
      if (rinkName) venueParts.push(rinkName);
      if (game.rink.address) venueParts.push(game.rink.address);
    } else if (game.location) {
      venueParts.push(game.location);
    }
    const location = venueParts.join(' — ');

    const descLines = [];
    if (game._league_name)      descLines.push(`League: ${game._league_name}`);
    if (game.tournament?.name)  descLines.push(`Tournament: ${game.tournament.name}`);
    if (game.league?.name)      descLines.push(`League: ${game.league.name}`);
    descLines.push('Added from Rinkd · rinkd.app');
    const description = descLines.join('\n');

    const ics = buildIcs({
      uid: `${game.id}@rinkd.app`,
      title,
      start: game.start_time,
      // Practices/events carry an explicit end_time; games fall back to 90 min.
      end: game.end_time || undefined,
      durationMinutes: 90,
      location,
      description,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    });

    const filenameSafe = (title || 'rinkd-game').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '');
    downloadIcs(ics, `${filenameSafe || 'rinkd-game'}.ics`);
    if (onClickExtra) onClickExtra();
  };

  return (
    <button onClick={handleClick}
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
        padding: '3px 9px', borderRadius: 999,
        background: 'rgba(46,91,140,0.25)',
        border: '0.5px solid rgba(46,91,140,0.6)',
        color: B.ice, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: "'Barlow', sans-serif",
        whiteSpace: 'nowrap',
        ...style,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = B.ice; e.currentTarget.style.color = B.navy; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.25)'; e.currentTarget.style.color = B.ice; }}>
      {icon && <span>{icon}</span>}
      <span>{label}</span>
    </button>
  );
}
