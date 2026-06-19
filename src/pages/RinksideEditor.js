import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import {
  getArticleBySlug, createArticle, updateArticle, deleteArticle, renderMarkdown,
} from '../lib/rinkside';
import { useIsRinkdAdmin } from '../lib/userRole';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

function slugify(s) {
  return (s || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: C.navy, border: `1px solid ${C.border}`,
  color: C.ice, padding: '10px 12px', borderRadius: 8,
  fontSize: 14, fontFamily: 'Barlow, sans-serif', outline: 'none',
};

const labelStyle = {
  fontSize: 11, color: C.steel, letterSpacing: '0.1em',
  textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, display: 'block',
};

export default function RinksideEditor({ currentUser, profile }) {
  const navigate = useNavigate();
  const { slug } = useParams();
  const isNew = !slug;
  const isAdmin = useIsRinkdAdmin(currentUser?.id);

  const [loaded, setLoaded] = useState(isNew);
  const [articleId, setArticleId] = useState(null);
  const [title, setTitle] = useState('');
  const [autoSlug, setAutoSlug] = useState(true);
  const [slugValue, setSlugValue] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [authorName, setAuthorName] = useState(profile?.name || '');
  const [body, setBody] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [readMinutes, setReadMinutes] = useState(4);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data } = await getArticleBySlug(slug);
      if (data) {
        setArticleId(data.id);
        setTitle(data.title || '');
        setSlugValue(data.slug || '');
        setAutoSlug(false);
        setSubtitle(data.subtitle || '');
        setHeroImageUrl(data.hero_image_url || '');
        setCategory(data.category || '');
        setTags((data.tags || []).join(', '));
        setAuthorName(data.author_name || profile?.name || '');
        setBody(data.body_markdown || '');
        setIsFeatured(!!data.is_featured);
        setIsPublished(!!data.is_published);
        setReadMinutes(data.read_minutes || 4);
      }
      setLoaded(true);
    })();
  }, [slug, isNew, profile]);

  useEffect(() => {
    if (autoSlug) setSlugValue(slugify(title));
  }, [title, autoSlug]);

  // useIsRinkdAdmin returns null while the admin check is in flight (post-A1
  // refactor). Treat null as "loading" so a real staff member never sees the
  // access-denied screen flash. Mirror the AdminPanel / AdminFeedback /
  // AdminModeration pattern from the audit Batch 4 work.
  const canEdit = useMemo(() => isAdmin === true || (!isNew && articleId), [isAdmin, isNew, articleId]);
  const adminCheckLoading = isAdmin === null;

  if (adminCheckLoading) {
    return (
      <Layout profile={profile} currentPage="rinkside">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.steel, fontFamily: 'Barlow, sans-serif', fontSize: 14 }}>
          Getting the ice ready.
        </div>
      </Layout>
    );
  }

  if (loaded && !canEdit) {
    return (
      <Layout profile={profile} currentPage="rinkside">
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.ice, gap: 12 }}>
          <div>The Rinkside editor is Rinkd staff only.</div>
          <button onClick={() => navigate('/rinkside')} style={{ background: C.red, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Rinkside</button>
        </div>
      </Layout>
    );
  }

  const handleSave = async (publish = isPublished) => {
    if (!title.trim()) { alert('Add a title to continue.'); return; }
    if (!slugValue.trim()) { alert('Add a URL slug to continue.'); return; }
    setSaving(true);
    const fields = {
      slug: slugValue.trim(),
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      heroImageUrl: heroImageUrl.trim() || null,
      body,
      category: category.trim() || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      authorName: authorName.trim() || null,
      isFeatured,
      isPublished: publish,
      readMinutes: parseInt(readMinutes, 10) || null,
    };
    let res;
    if (isNew) {
      res = await createArticle(currentUser.id, fields);
    } else {
      res = await updateArticle(articleId, fields);
    }
    setSaving(false);
    if (res.error) { alert("That didn't save — " + res.error.message); return; }
    navigate(`/rinkside/${res.data.slug}`);
  };

  const handleDelete = async () => {
    if (!articleId || deleting) return;
    if (!window.confirm("Delete this article? This can't be undone.")) return;
    setDeleting(true);
    const { error } = await deleteArticle(articleId);
    if (error) {
      setDeleting(false);
      alert("That didn't delete — " + error.message);
      return;
    }
    navigate('/rinkside');
  };

  return (
    <Layout profile={profile} currentPage="rinkside">
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 80px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <button onClick={() => navigate('/rinkside')} style={{ background: 'transparent', color: C.steel, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer' }}>← Rinkside</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowPreview((v) => !v)}
                style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {showPreview ? 'Edit' : 'Preview'}
              </button>
              {!isNew && (
                <button onClick={handleDelete} disabled={deleting}
                  style={{ background: 'transparent', color: deleting ? C.steel : C.red, border: `1px solid ${deleting ? C.border : C.red}`, padding: '7px 14px', borderRadius: 999, cursor: deleting ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
              <button onClick={() => handleSave(false)} disabled={saving}
                style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, padding: '7px 14px', borderRadius: 999, cursor: saving ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600 }}>
                Save Draft
              </button>
              <button onClick={() => handleSave(true)} disabled={saving}
                style={{ background: C.red, color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 999, cursor: saving ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {saving ? 'Saving…' : 'Publish'}
              </button>
            </div>
          </div>

          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, textTransform: 'uppercase', marginBottom: 18 }}>
            {isNew ? 'New Article' : 'Edit Article'}
          </div>

          {showPreview ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              {category && <div style={{ fontSize: 11, color: C.red, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>{category}</div>}
              <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 36, lineHeight: 1.05, margin: 0, marginBottom: 10, textTransform: 'uppercase' }}>{title || 'Untitled'}</h1>
              {subtitle && <div style={{ fontSize: 17, color: C.steel, lineHeight: 1.5, marginBottom: 16 }}>{subtitle}</div>}
              <div style={{ fontSize: 12, color: C.steel, marginBottom: 22 }}>{authorName || 'Rinkside'} · {readMinutes} min read</div>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={labelStyle}>Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Article title" style={inputStyle} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Slug (URL)</label>
                  <input value={slugValue} onChange={(e) => { setAutoSlug(false); setSlugValue(slugify(e.target.value)); }} placeholder="article-slug" style={inputStyle} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.steel, paddingBottom: 12 }}>
                  <input type="checkbox" checked={autoSlug} onChange={(e) => setAutoSlug(e.target.checked)} />
                  Auto from title
                </label>
              </div>

              <div>
                <label style={labelStyle}>Subtitle / Dek</label>
                <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="One-sentence summary that appears under the headline" style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>Hero Image URL</label>
                <input value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
                {heroImageUrl && (
                  <div style={{ marginTop: 8, height: 160, background: `url(${heroImageUrl}) center/cover`, borderRadius: 8 }} />
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Category</label>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Features, Training…" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Tags (comma-separated)</label>
                  <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="goalie, training" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Author</label>
                  <input value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Byline" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Read minutes</label>
                  <input type="number" value={readMinutes} onChange={(e) => setReadMinutes(e.target.value)} min={1} max={60} style={inputStyle} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 18, padding: '10px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ice }}>
                  <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
                  ★ Featured (pinned to top of index)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ice }}>
                  <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
                  Published
                </label>
              </div>

              <div>
                <label style={labelStyle}>Body (Markdown)</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={22}
                  placeholder={`# Headline\n\nOpening paragraph.\n\n## Subheading\n\n- List item\n- Another item\n\n> Pull quote\n\n[Link text](https://example.com)`}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.55 }} />
                <div style={{ fontSize: 11, color: C.steel, marginTop: 6 }}>
                  Supports # ## ### headings, **bold**, *italic*, [links](url), ![images](url), lists, &gt; blockquotes, and --- separators.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
