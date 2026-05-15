import React from 'react';
import { buildMapsUrl, rinkToQuery, openMaps } from '../lib/maps';

/**
 * Renders a tappable rink label. Click → opens Apple Maps on iOS,
 * Google Maps on Android, web Google Maps on desktop.
 *
 * Props:
 *   rink           — joined rink row (preferred). Uses maps_url / address / name+sub_rink.
 *   text           — free-form fallback (e.g. team.home_rink text field).
 *   icon           — leading icon (default 📍).
 *   underline      — show underline on hover.
 *   style, className — pass-through.
 *   onClickExtra   — extra side-effect (e.g. analytics).
 */
export default function MapLink({ rink, text, icon = '📍', children, style, className, onClickExtra }) {
  const target = rink || text;
  const url = buildMapsUrl(target);
  const label = children !== undefined && children !== null
    ? children
    : (rink
        ? [rink.sub_rink, rink.name].filter(Boolean).join(' · ') || rink.address
        : rinkToQuery(text));

  if (!label) return null;

  // No usable target → render as plain text, not a link
  if (!url) {
    return <span style={style} className={className}>{icon ? `${icon} ` : ''}{label}</span>;
  }

  const handleClick = (e) => {
    e.stopPropagation();
    // Let modified clicks (cmd/ctrl/shift/middle) fall through to the native
    // href so "open in new tab" works. Only a plain click gets the
    // platform-aware openMaps() routing.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    if (onClickExtra) onClickExtra();
    openMaps(target);
  };

  return (
    <a href={url} onClick={handleClick}
      target="_blank" rel="noopener noreferrer"
      style={{
        color: 'inherit', textDecoration: 'none', cursor: 'pointer',
        ...style,
      }}
      className={className}>
      {icon ? `${icon} ` : ''}{label}
    </a>
  );
}
