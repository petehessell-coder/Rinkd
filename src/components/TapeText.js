import React from 'react';
import { colors } from '../lib/tokens';

const SUPPORTED = /^[A-Z]$/;

/**
 * Renders a string using the hand-taped letter art in /public/tapejob
 * ("tape job" font). Only A–Z glyphs exist, so the input is upper-cased,
 * spaces become gaps, and any unsupported character (digit / punctuation)
 * degrades to styled text rather than vanishing.
 *
 * The real string is exposed via aria-label and the letter <img>s are
 * aria-hidden, so headers stay accessible + indexable — the images are purely
 * decorative. Render at a fixed pixel height; only ever scale DOWN from the
 * source art (≈200px tall) to stay crisp.
 *
 * Intended for short, static, uppercase headers (FEED/CHIRPS, TEAMS,
 * NOTIFICATIONS, the wordmark) — not dynamic titles full of names/numbers.
 */
export default function TapeText({ children, height = 30, gap, style, className }) {
  const text = String(children == null ? '' : children);
  const g = gap != null ? gap : Math.round(height * 0.1);
  const chars = [...text.toUpperCase()];

  return (
    <span
      role="img"
      aria-label={text}
      className={className}
      style={{ display: 'inline-flex', alignItems: 'flex-end', gap: g, lineHeight: 0, ...style }}
    >
      {chars.map((ch, i) => {
        if (ch === ' ') {
          return <span key={i} aria-hidden="true" style={{ display: 'inline-block', width: height * 0.32 }} />;
        }
        if (SUPPORTED.test(ch)) {
          return (
            <img
              key={i}
              src={`/tapejob/${ch}.png`}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={{ height, width: 'auto', display: 'block', userSelect: 'none' }}
            />
          );
        }
        return (
          <span key={i} aria-hidden="true" style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
            fontSize: height * 0.92, lineHeight: 1, color: colors.ice, alignSelf: 'center',
          }}>{ch}</span>
        );
      })}
    </span>
  );
}
