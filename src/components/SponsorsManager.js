import React, { useCallback, useEffect, useState } from 'react';
import {
  listOwnerSponsors, createSponsor, updatePlacement, deleteSponsor,
  uploadCreativeImage, getAdReport, AD_CATEGORIES, AD_SLOTS, slotLabel,
  YOUTH_BLOCKED_CATEGORIES, isCategoryAllowedForYouth,
} from '../lib/ads';
import { classifyImage } from '../lib/imageModeration';
import { supabase } from '../lib/supabase';
import AdSlot from './AdSlot';

// ADS-1 · M2 — the Sponsors tab. One home for an event's on-page sponsor
// inventory. Phase 1 = the event banner (top of the league/tournament page).
// Writes are owner-gated by RLS; youth events block restricted categories.
//
//   <SponsorsManager ownerType="league" ownerId={id} isYouth={…} currentUser={…} />

const C = { ice: '#F4F7FA', steel: '#8BA3BE', dim: '#7C8B9F', card: '#0f2847', panel: '#11253E', border: 'rgba(46,91,140,0.45)', input: '#07111F', blue: '#2E5B8C', red: '#E26B6B' };
const inputStyle = { width: '100%', boxSizing: 'border-box', background: C.input, color: C.ice, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 11px', fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none' };
const label = { fontSize: 11, fontWeight: 700, color: C.steel, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 5 };

const prettyCat = (c) => c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

export default function SponsorsManager({ ownerType, ownerId, isYouth = false, settings = {}, onSaveSettings }) {
  const [userId, setUserId] = useState(null);
  const [sponsors, setSponsors] = useState(null); // null = loading
  const [form, setForm] = useState({ sponsor_name: '', link_url: '', category: '', image_url: '', slot: 'event_banner', weight: 1, starts_at: '', ends_at: '' });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [nonce, setNonce] = useState(0); // bumps each load → remounts the live preview
  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const flash = (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };

  const categories = AD_CATEGORIES.filter((c) => !isYouth || isCategoryAllowedForYouth(c));

  const load = useCallback(async () => {
    try { setSponsors(await listOwnerSponsors(ownerType, ownerId)); setNonce((n) => n + 1); }
    catch (e) { flash('err', e.message || 'Could not load sponsors'); setSponsors([]); }
  }, [ownerType, ownerId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null)); }, []);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !userId) { e.target.value = ''; return; }
    if (!file.type.startsWith('image/')) { flash('err', 'Creative must be an image.'); e.target.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { flash('err', `Image is ${(file.size / 1048576).toFixed(1)} MB — max 5 MB.`); e.target.value = ''; return; }
    setUploading(true);
    const verdict = await classifyImage(file);
    if (!verdict.ok) { setUploading(false); e.target.value = ''; flash('err', 'That image may violate Rinkd’s guidelines. Try another.'); return; }
    const { url, error } = await uploadCreativeImage(file, userId);
    setUploading(false); e.target.value = '';
    if (error || !url) { flash('err', `Upload failed: ${error?.message || 'unknown'}`); return; }
    setF('image_url', url);
    flash('ok', 'Creative uploaded — add the details and save.');
  };

  const add = async () => {
    if (!form.sponsor_name.trim()) { flash('err', 'Sponsor name is required.'); return; }
    if (isYouth && form.category && !isCategoryAllowedForYouth(form.category)) { flash('err', 'That category isn’t allowed on a youth event.'); return; }
    setBusy(true);
    try {
      await createSponsor({
        ownerType, ownerId,
        sponsorName: form.sponsor_name.trim(),
        imageUrl: form.image_url.trim() || null,
        linkUrl: form.link_url.trim() || null,
        category: form.category || null,
        slot: form.slot || 'event_banner',
        weight: Math.max(1, parseInt(form.weight, 10) || 1),
        startsAt: form.starts_at || null,
        endsAt: form.ends_at || null,
      });
      setForm({ sponsor_name: '', link_url: '', category: '', image_url: '', slot: 'event_banner', weight: 1, starts_at: '', ends_at: '' });
      await load();
      flash('ok', 'Sponsor added — live on the event page.');
    } catch (e) { flash('err', e.message || 'Could not add sponsor'); }
    setBusy(false);
  };

  const toggleActive = async (s, p) => {
    try { await updatePlacement(p.id, { is_active: !p.is_active }, ownerType, ownerId); await load(); }
    catch (e) { flash('err', e.message || 'Update failed'); }
  };
  const setWeight = async (p, w) => {
    try { await updatePlacement(p.id, { weight: Math.max(1, parseInt(w, 10) || 1) }, ownerType, ownerId); await load(); }
    catch (e) { flash('err', e.message || 'Update failed'); }
  };
  const remove = async (s) => {
    if (!window.confirm(`Remove ${s.sponsor_name}? This deletes the creative + its placement.`)) return;
    try { await deleteSponsor(s.id, ownerType, ownerId); await load(); flash('ok', 'Sponsor removed.'); }
    catch (e) { flash('err', e.message || 'Delete failed'); }
  };

  return (
    <div style={{ fontFamily: 'Barlow, sans-serif' }}>
      <div style={{ fontSize: 13, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
        Your event’s “digital dasher board.” Add a sponsor and choose a placement — a banner at the top of the page, or a “presented by” lockup on Standings / Schedule / Stats. Their inventory, your call. Impressions + taps are counted; see the report below.
        {isYouth && <span style={{ display: 'block', marginTop: 6, color: '#E0A93B' }}>Youth event: {YOUTH_BLOCKED_CATEGORIES.map(prettyCat).join(', ')} sponsors are not allowed.</span>}
      </div>

      {onSaveSettings && <ShareCardSponsors settings={settings} onSaveSettings={onSaveSettings} />}

      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.kind === 'ok' ? '#5BCF8E' : C.red }}>{msg.text}</div>}

      {/* Add sponsor */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 12 }}>Add a Sponsor</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label}>Banner image</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={form.image_url} onChange={(e) => setF('image_url', e.target.value)} placeholder="https://… or upload →" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
              <label style={{ ...inputStyle, width: 'auto', cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {uploading ? 'Uploading…' : '📷 Upload'}
                <input type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} disabled={uploading} />
              </label>
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 5 }}>Wide image works best (banner). PNG/JPG/WebP/SVG up to 5 MB.</div>
          </div>
          <div><label style={label}>Sponsor name *</label><input value={form.sponsor_name} onChange={(e) => setF('sponsor_name', e.target.value)} maxLength={50} placeholder="e.g. Little Caesars" style={inputStyle} /></div>
          <div><label style={label}>Link (tap-through)</label><input value={form.link_url} onChange={(e) => setF('link_url', e.target.value)} placeholder="https://sponsor.com" style={inputStyle} /></div>
          <div>
            <label style={label}>Placement</label>
            <select value={form.slot} onChange={(e) => setF('slot', e.target.value)} style={inputStyle}>
              {AD_SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 5 }}>{AD_SLOTS.find((s) => s.value === form.slot)?.hint}</div>
          </div>
          <div>
            <label style={label}>Category</label>
            <select value={form.category} onChange={(e) => setF('category', e.target.value)} style={inputStyle}>
              <option value="">— Select —</option>
              {categories.map((c) => <option key={c} value={c}>{prettyCat(c)}</option>)}
            </select>
          </div>
          <div><label style={label}>Weight (share of voice)</label><input type="number" min={1} max={20} value={form.weight} onChange={(e) => setF('weight', e.target.value)} style={inputStyle} /></div>
          <div><label style={label}>Starts (optional)</label><input type="date" value={form.starts_at} onChange={(e) => setF('starts_at', e.target.value)} style={inputStyle} /></div>
          <div><label style={label}>Ends (optional)</label><input type="date" value={form.ends_at} onChange={(e) => setF('ends_at', e.target.value)} style={inputStyle} /></div>
        </div>
        {form.image_url && /^https?:\/\//.test(form.image_url) && (
          <div style={{ marginTop: 12 }}>
            <label style={label}>Preview</label>
            <img src={form.image_url} alt="" style={{ maxHeight: 90, width: 'auto', borderRadius: 8, display: 'block', border: `1px solid ${C.border}` }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={add} disabled={busy || uploading} style={{ background: busy ? C.border : C.blue, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 22px', fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>{busy ? 'Adding…' : 'Add sponsor'}</button>
        </div>
      </div>

      {/* Existing sponsors */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>Active sponsors</div>
      {sponsors === null ? (
        <div style={{ color: C.dim, fontSize: 13, padding: '14px 0' }}>Loading…</div>
      ) : sponsors.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 13, padding: '14px 0' }}>No sponsors yet — add one above and it goes live on your event page.</div>
      ) : sponsors.map((s) => {
        const p = (s.placements || [])[0];
        return (
          <div key={s.id} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {s.image_url
              ? <img src={s.image_url} alt="" style={{ height: 44, width: 'auto', maxWidth: 120, borderRadius: 6, objectFit: 'cover' }} />
              : <div style={{ height: 44, width: 80, borderRadius: 6, background: C.input, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: C.dim }}>text</div>}
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ color: C.ice, fontWeight: 700, fontSize: 14 }}>{s.sponsor_name}</div>
              <div style={{ color: C.dim, fontSize: 12 }}>{p ? slotLabel(p.slot) : '—'}{s.category ? ` · ${prettyCat(s.category)}` : ''}{p ? ` · weight ${p.weight}` : ''}{p?.ends_at ? ` · ends ${new Date(p.ends_at).toLocaleDateString()}` : ''}</div>
            </div>
            {p && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.steel, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!p.is_active} onChange={() => toggleActive(s, p)} /> Active
                </label>
                <input type="number" min={1} max={20} defaultValue={p.weight} onBlur={(e) => setWeight(p, e.target.value)} title="Weight" style={{ ...inputStyle, width: 60, padding: '6px 8px' }} />
              </>
            )}
            <button onClick={() => remove(s)} style={{ background: 'transparent', border: `1px solid ${C.red}`, color: C.red, borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Remove</button>
          </div>
        );
      })}

      {/* Live preview of each active slot */}
      {(() => {
        const activeSlots = AD_SLOTS.map((s) => s.value).filter((slot) =>
          (sponsors || []).some((s) => (s.placements || []).some((p) => p.slot === slot && p.is_active)));
        if (activeSlots.length === 0) return null;
        return (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>Preview (as fans see it)</div>
            {activeSlots.map((slot) => (
              <div key={slot} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>{slotLabel(slot)}</div>
                <AdSlot key={`${slot}:${nonce}`} slot={slot} targetType={ownerType} targetId={ownerId} />
              </div>
            ))}
          </div>
        );
      })()}

      <SponsorReport ownerType={ownerType} ownerId={ownerId} nonce={nonce} />
    </div>
  );
}

// ADS-1 · M4 — the sponsor report: impressions / taps / CTR per placement over
// the trailing 30 days, owner-scoped via get_ad_report (signed-in only).
function SponsorReport({ ownerType, ownerId, nonce }) {
  const [rows, setRows] = useState(null); // null = loading, [] = none
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getAdReport(ownerType, ownerId, 30)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) { setErr(e.message || 'Could not load report'); setRows([]); } });
    return () => { cancelled = true; };
  }, [ownerType, ownerId, nonce]);

  const totalImp = (rows || []).reduce((s, r) => s + Number(r.impressions || 0), 0);
  const totalTap = (rows || []).reduce((s, r) => s + Number(r.taps || 0), 0);
  const ctr = (imp, tap) => (Number(imp) > 0 ? `${((Number(tap) / Number(imp)) * 100).toFixed(1)}%` : '—');
  const cell = { padding: '8px 10px', fontSize: 12, color: C.ice, borderTop: `1px solid ${C.border}` };
  const head = { padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.steel, textAlign: 'left' };
  const num = { textAlign: 'right' };

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 8 }}>Sponsor report · last 30 days</div>
      {rows === null ? (
        <div style={{ color: C.dim, fontSize: 13, padding: '10px 0' }}>Loading…</div>
      ) : err ? (
        <div style={{ color: C.red, fontSize: 13, padding: '10px 0' }}>{err}</div>
      ) : rows.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 13, padding: '10px 0' }}>No impressions yet — once a sponsor runs on your public page, delivery shows here.</div>
      ) : (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'rgba(46,91,140,0.18)' }}>
              <th style={head}>Sponsor</th><th style={head}>Placement</th>
              <th style={{ ...head, ...num }}>Impr.</th><th style={{ ...head, ...num }}>Taps</th><th style={{ ...head, ...num }}>CTR</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.placement_id}>
                  <td style={cell}>{r.sponsor_name}</td>
                  <td style={{ ...cell, color: C.steel }}>{slotLabel(r.slot)}</td>
                  <td style={{ ...cell, ...num }}>{Number(r.impressions || 0).toLocaleString()}</td>
                  <td style={{ ...cell, ...num }}>{Number(r.taps || 0).toLocaleString()}</td>
                  <td style={{ ...cell, ...num }}>{ctr(r.impressions, r.taps)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: 'rgba(46,91,140,0.1)' }}>
              <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>Total</td>
              <td style={{ ...cell, ...num, fontWeight: 700 }}>{totalImp.toLocaleString()}</td>
              <td style={{ ...cell, ...num, fontWeight: 700 }}>{totalTap.toLocaleString()}</td>
              <td style={{ ...cell, ...num, fontWeight: 700 }}>{ctr(totalImp, totalTap)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>On-page delivery. Pair with your recap-share reach for total “delivered + off-platform” impressions.</div>
    </div>
  );
}

// Recap + Game Puck "presented by" sponsors — live in the owner's settings JSONB
// (settings.recap_sponsor / settings.gamepuck_sponsor), shown on shared recap /
// Game Puck cards + the public game page. Moved here from the Settings tab so all
// sponsor management is one surface.
function ShareCardSponsors({ settings = {}, onSaveSettings }) {
  const blank = { name: '', url: '', logo_url: '' };
  const [recap, setRecap] = useState({ ...blank, ...(settings.recap_sponsor || {}) });
  const [puck, setPuck] = useState({ ...blank, ...(settings.gamepuck_sponsor || {}) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const setR = (k, v) => setRecap((p) => ({ ...p, [k]: v }));
  const setP = (k, v) => setPuck((p) => ({ ...p, [k]: v }));

  // Blank name clears the sponsor (-> null), so a saved sponsor can be removed.
  const clean = (s) => ((s.name || '').trim()
    ? { name: s.name.trim(), url: (s.url || '').trim() || null, logo_url: (s.logo_url || '').trim() || null }
    : null);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await onSaveSettings({ recap_sponsor: clean(recap), gamepuck_sponsor: clean(puck) });
      setMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e) { setMsg({ kind: 'err', text: e.message || 'Could not save' }); }
    setSaving(false); setTimeout(() => setMsg(null), 4000);
  };

  const fieldRow = (val, onChange, ph) => (
    <input value={val} onChange={(e) => onChange(e.target.value)} placeholder={ph} style={{ ...inputStyle, marginBottom: 8 }} />
  );

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, textTransform: 'uppercase', marginBottom: 6 }}>Recap &amp; Game Puck sponsors</div>
      <div style={{ fontSize: 12, color: C.steel, marginBottom: 14, lineHeight: 1.5 }}>
        Shown as “presented by …” on shared recap + Game Puck cards and the public game page. Blank recap → falls back to “presented by Rinkd.” Blank Game Puck → uses the recap sponsor.
      </div>
      {msg && <div style={{ marginBottom: 10, fontSize: 13, color: msg.kind === 'ok' ? '#5BCF8E' : C.red }}>{msg.text}</div>}

      <div style={{ marginBottom: 14 }}>
        <label style={label}>Recap sponsor</label>
        {fieldRow(recap.name, (v) => setR('name', v), 'Sponsor name — e.g. Little Caesars')}
        {fieldRow(recap.url, (v) => setR('url', v), 'Link (optional) — https://sponsor.com')}
        {fieldRow(recap.logo_url, (v) => setR('logo_url', v), 'Logo URL (optional)')}
      </div>
      <div>
        <label style={label}>Game Puck sponsor</label>
        {fieldRow(puck.name, (v) => setP('name', v), 'Sponsor name — defaults to the recap sponsor')}
        {fieldRow(puck.url, (v) => setP('url', v), 'Link (optional) — https://sponsor.com')}
        {fieldRow(puck.logo_url, (v) => setP('logo_url', v), 'Logo URL (optional)')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={save} disabled={saving} style={{ background: saving ? C.border : C.blue, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 22px', fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif' }}>{saving ? 'Saving…' : 'Save sponsors'}</button>
      </div>
    </div>
  );
}
