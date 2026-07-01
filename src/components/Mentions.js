import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from './Logos';
import { searchMentionable, HANDLE_RE } from '../lib/mentions';
import { C } from '../lib/tokens';

// Preserved local drift (C01): dropdown border ran alpha .5 vs the token's .4.
const LOCAL_BORDER = 'rgba(46,91,140,0.5)';

// Find the @token the caret is currently sitting inside (if any). Returns the
// partial query (without '@') and the index of the '@' so we can splice a
// resolved handle back in. Only triggers after a word boundary so emails and
// mid-word @'s don't open the menu.
function activeMentionQuery(text, caret) {
  const upto = text.slice(0, caret);
  const m = upto.match(/(?:^|\s)@([a-zA-Z0-9_]{0,30})$/);
  if (!m) return null;
  return { query: m[1], at: caret - m[1].length - 1 };
}

/**
 * Textarea with @-mention autocomplete. Controlled on `value`. Tracks which
 * @handles the user actually picked from the menu (resolvedRef) and emits the
 * resolved user-id list via onMentionsChange whenever the set changes — so the
 * parent stores exact ids (never a regex over display text). Handles that are
 * deleted from the text are pruned automatically.
 */
export function MentionInput({
  value, onChange, onMentionsChange, placeholder, rows = 2,
  maxLength = 500, disabled = false, style, textareaStyle, autoFocus = false,
}) {
  const taRef = useRef(null);
  const resolvedRef = useRef(new Map()); // handleLower -> userId
  const caretRef = useRef(null);         // pending caret to restore after a splice
  const [menu, setMenu] = useState(null); // { at } | null
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  const emitMentions = useCallback((text) => {
    const present = new Set();
    const re = new RegExp(HANDLE_RE.source, 'g');
    let m;
    while ((m = re.exec(text))) present.add(m[1].toLowerCase());
    for (const h of [...resolvedRef.current.keys()]) {
      if (!present.has(h)) resolvedRef.current.delete(h);
    }
    onMentionsChange?.([...resolvedRef.current.values()]);
  }, [onMentionsChange]);

  const runSearch = useCallback(async (query) => {
    const mySeq = ++seq.current;
    const rows = await searchMentionable(query, 6);
    if (mySeq !== seq.current) return; // a newer keystroke superseded this one
    setResults(rows);
    setActive(0);
  }, []);

  // Debounced search whenever the active @query changes.
  const debounceRef = useRef(null);
  const onTextChange = (raw) => {
    const text = raw.slice(0, maxLength);
    onChange?.(text);
    emitMentions(text);
    const caret = taRef.current?.selectionStart ?? text.length;
    const q = activeMentionQuery(text, caret);
    if (q && q.query.length >= 1) {
      setMenu({ at: q.at });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runSearch(q.query), 160);
    } else {
      setMenu(null);
      setResults([]);
    }
  };

  const pick = (profile) => {
    const ta = taRef.current;
    const text = value || '';
    const caret = ta?.selectionStart ?? text.length;
    const q = activeMentionQuery(text, caret);
    const at = q ? q.at : (menu?.at ?? caret);
    const before = text.slice(0, at);
    const after = text.slice(caret);
    const insert = `@${profile.handle} `;
    const next = (before + insert + after).slice(0, maxLength);
    resolvedRef.current.set(String(profile.handle).toLowerCase(), profile.id);
    caretRef.current = (before + insert).length;
    onChange?.(next);
    emitMentions(next);
    setMenu(null);
    setResults([]);
  };

  // Restore caret after a programmatic splice (controlled value re-render).
  useLayoutEffect(() => {
    if (caretRef.current != null && taRef.current) {
      const pos = caretRef.current;
      caretRef.current = null;
      taRef.current.focus();
      try { taRef.current.setSelectionRange(pos, pos); } catch { /* noop */ }
    }
  }, [value]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const onKeyDown = (e) => {
    if (!menu || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape') { setMenu(null); setResults([]); }
  };

  const showMenu = menu && results.length > 0;

  return (
    <div style={{ position: 'relative', ...style }}>
      <textarea
        ref={taRef}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => { setMenu(null); setResults([]); }, 150)}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', outline: 'none', ...textareaStyle }}
      />
      {showMenu && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 40, marginTop: 4,
          background: C.card, border: `1px solid ${LOCAL_BORDER}`, borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 240, overflowY: 'auto',
        }}>
          {results.map((p, i) => (
            <button
              key={p.id}
              type="button"
              // onMouseDown (not onClick) so the pick fires before the textarea's
              // onBlur tears the menu down.
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none', cursor: 'pointer',
                background: i === active ? 'rgba(91,159,226,0.18)' : 'transparent',
                fontFamily: "'Barlow', sans-serif",
              }}
            >
              <Avatar profile={p} size={28} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || p.handle}</span>
                <span style={{ display: 'block', fontSize: 11, color: C.steel }}>@{p.handle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Match http(s):// URLs and bare www. links up to the next whitespace. We only
// autolink explicit web URLs (never bare "foo.com") so handles and prices don't
// get swept up. Trailing sentence punctuation is trimmed off the link below.
const URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

/**
 * Render plain post/comment/bio text, linkifying (a) @handles that were
 * actually resolved + stored (passed in `mentions`: handleLower -> userId) and
 * (b) explicit web URLs. Stray "@text" and bare "foo.com" stay plain. URLs open
 * in a new tab with rel="noopener noreferrer nofollow ugc" (user content — not
 * an endorsement, no SEO juice). Returns inline nodes — caller owns container.
 */
export function MentionText({ text, mentions, linkColor = '#5B9FE2' }) {
  if (!text) return null;
  const map = mentions || {};

  // Collect link tokens from both patterns, then walk the text left-to-right.
  const tokens = [];
  const urlRe = new RegExp(URL_RE.source, URL_RE.flags);
  let u;
  while ((u = urlRe.exec(text))) {
    tokens.push({ start: u.index, end: u.index + u[0].length, type: 'url', raw: u[0] });
  }
  const handleRe = new RegExp(HANDLE_RE.source, 'g');
  let m;
  while ((m = handleRe.exec(text))) {
    const id = map[m[1].toLowerCase()];
    if (!id) continue; // unresolved — leave embedded in a later text slice
    tokens.push({ start: m.index, end: m.index + m[0].length, type: 'mention', id, handle: m[1] });
  }
  if (tokens.length === 0) return <>{text}</>;
  tokens.sort((a, b) => a.start - b.start);

  const out = [];
  let last = 0; let key = 0;
  for (const t of tokens) {
    if (t.start < last) continue; // overlap (e.g. an @ sitting inside a URL)
    if (t.start > last) out.push(text.slice(last, t.start));
    if (t.type === 'mention') {
      out.push(
        <Link
          key={key++}
          to={`/profile/${t.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ color: linkColor, fontWeight: 600, textDecoration: 'none' }}
        >@{t.handle}</Link>
      );
    } else {
      // Trailing punctuation is almost always sentence punctuation, not part of
      // the URL — peel it off and render it as plain text after the link.
      let raw = t.raw;
      const trail = (raw.match(/[.,!?;:'")\]}]+$/) || [''])[0];
      if (trail) raw = raw.slice(0, raw.length - trail.length);
      const href = raw.startsWith('http') ? raw : `https://${raw}`;
      out.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          onClick={(e) => e.stopPropagation()}
          style={{ color: linkColor, fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-all' }}
        >{raw}</a>
      );
      if (trail) out.push(trail);
    }
    last = t.end;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
