import { supabase } from './supabase';

/**
 * Rinkside = "The Content" brand. Editorial articles authored in markdown,
 * stored in rinkside_articles, rendered with the lightweight transformer below
 * so we don't ship a markdown library (50–100KB on the wire we don't need).
 */

export async function listArticles({ category, limit = 30 } = {}) {
  let q = supabase
    .from('rinkside_articles')
    .select('*')
    .eq('is_published', true)
    .order('is_featured', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(limit);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function getArticleBySlug(slug) {
  const { data, error } = await supabase
    .from('rinkside_articles')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return { data, error };
}

export async function listCategories() {
  const { data } = await supabase
    .from('rinkside_articles')
    .select('category')
    .eq('is_published', true)
    .not('category', 'is', null);
  const set = new Set();
  for (const r of data || []) if (r.category) set.add(r.category);
  return Array.from(set).sort();
}

export async function incrementView(articleId) {
  // Best-effort increment — failures (e.g. anon user, RLS) are silent on purpose.
  try {
    await supabase.rpc('rinkside_inc_view', { p_id: articleId });
  } catch { /* swallow */ }
}

export async function createArticle(authorId, fields) {
  const payload = {
    author_id: authorId,
    slug: fields.slug,
    title: fields.title,
    subtitle: fields.subtitle || null,
    hero_image_url: fields.heroImageUrl || null,
    body_markdown: fields.body || '',
    category: fields.category || null,
    tags: fields.tags || [],
    author_name: fields.authorName || null,
    is_featured: !!fields.isFeatured,
    is_published: !!fields.isPublished,
    read_minutes: fields.readMinutes || null,
    published_at: fields.isPublished ? new Date().toISOString() : null,
  };
  const { data, error } = await supabase
    .from('rinkside_articles')
    .insert(payload)
    .select()
    .single();
  return { data, error };
}

export async function updateArticle(id, fields) {
  const payload = {};
  for (const [k, v] of Object.entries(fields)) {
    const map = {
      slug: 'slug', title: 'title', subtitle: 'subtitle',
      heroImageUrl: 'hero_image_url', body: 'body_markdown',
      category: 'category', tags: 'tags', authorName: 'author_name',
      isFeatured: 'is_featured', isPublished: 'is_published',
      readMinutes: 'read_minutes',
    };
    if (map[k]) payload[map[k]] = v;
  }
  if (fields.isPublished === true && !fields.published_at) {
    payload.published_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('rinkside_articles')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function deleteArticle(id) {
  const { error } = await supabase.from('rinkside_articles').delete().eq('id', id);
  return { error };
}

// ---------------------------------------------------------------------------
// Tiny markdown → HTML transformer. Handles the subset we actually use in
// articles: # / ## / ### headings, paragraphs, bold, italic, inline code,
// links, images, unordered + ordered lists, blockquotes, horizontal rules.
// Sanitizes HTML by escaping first, then re-inserting our own tags.
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderInline(s) {
  let out = escapeHtml(s);
  // Images ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) =>
    `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:10px;display:block;margin:18px 0;" />`);
  // Links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#2E5B8C;text-decoration:underline;">${txt}</a>`);
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code style="background:rgba(46,91,140,0.18);padding:1px 6px;border-radius:4px;font-size:0.9em;">$1</code>');
  return out;
}

export function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr style="border:none;border-top:1px solid rgba(46,91,140,0.4);margin:24px 0;" />');
      i++; continue;
    }

    // Heading
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = { 1: '28px', 2: '22px', 3: '18px' };
      const margins = { 1: '32px 0 14px', 2: '28px 0 12px', 3: '22px 0 8px' };
      out.push(`<h${level} style="font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:900;font-size:${sizes[level]};line-height:1.15;letter-spacing:-0.01em;color:#F4F7FA;margin:${margins[level]};text-transform:uppercase;">${renderInline(h[2])}</h${level}>`);
      i++; continue;
    }

    // Blockquote (one or more consecutive > lines)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote style="margin:20px 0;padding:14px 18px;border-left:3px solid #D72638;background:rgba(215,38,56,0.06);color:#F4F7FA;font-size:17px;font-style:italic;line-height:1.55;border-radius:0 8px 8px 0;">${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out.push(`<ul style="margin:14px 0;padding-left:22px;color:#F4F7FA;line-height:1.7;font-size:16px;">${items.map((it) => `<li style="margin-bottom:6px;">${renderInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(`<ol style="margin:14px 0;padding-left:22px;color:#F4F7FA;line-height:1.7;font-size:16px;">${items.map((it) => `<li style="margin-bottom:6px;">${renderInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) { i++; continue; }

    // Paragraph (gather until blank line)
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,3}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+|---+\s*$)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p style="font-size:17px;line-height:1.7;color:#F4F7FA;margin:0 0 16px;">${renderInline(buf.join(' '))}</p>`);
  }

  return out.join('');
}
