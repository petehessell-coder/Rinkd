#!/usr/bin/env python3
"""Build the branded Rinkd × Nickel City partnership PDF.

One-shot: reads the markdown source, downloads Barlow + Barlow Condensed
from Google Fonts (cached at ~/.cache/rinkd_pdf_fonts), and renders with
the Rinkd brand palette + wordmark.
"""

import pathlib, re, urllib.request, sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    Table, TableStyle, HRFlowable, NextPageTemplate,
)

# ─── paths ────────────────────────────────────────────────────────────────
ROOT = pathlib.Path("/Users/petehessel/Downloads/rinkd_live")
MD_PATH = ROOT / "docs/Rinkd_x_NickelCity_Partnership_Proposal.md"
PDF_PATH = ROOT / "docs/Rinkd_x_NickelCity_Partnership_Proposal.pdf"
WORDMARK = ROOT / "public/rinkd-wordmark.png"
FONT_CACHE = pathlib.Path.home() / ".cache" / "rinkd_pdf_fonts"
FONT_CACHE.mkdir(parents=True, exist_ok=True)

# ─── brand palette ────────────────────────────────────────────────────────
NAVY   = colors.HexColor("#0B1F3A")
RED    = colors.HexColor("#D72638")
BLUE   = colors.HexColor("#2E5B8C")
ICE    = colors.HexColor("#F4F7FA")
STEEL  = colors.HexColor("#8BA3BE")
DARK   = colors.HexColor("#07111F")
CALLOUT_BG = colors.HexColor("#EEF3F9")

# ─── fonts: try Barlow from Google Fonts, fall back to Helvetica ──────────
GF = "https://raw.githubusercontent.com/google/fonts/main/ofl"
FONT_URLS = {
    "BarlowCondensed-Regular":    f"{GF}/barlowcondensed/BarlowCondensed-Regular.ttf",
    "BarlowCondensed-Bold":       f"{GF}/barlowcondensed/BarlowCondensed-Bold.ttf",
    "BarlowCondensed-Italic":     f"{GF}/barlowcondensed/BarlowCondensed-Italic.ttf",
    "BarlowCondensed-BoldItalic": f"{GF}/barlowcondensed/BarlowCondensed-BoldItalic.ttf",
    "Barlow-Regular":             f"{GF}/barlow/Barlow-Regular.ttf",
    "Barlow-Bold":                f"{GF}/barlow/Barlow-Bold.ttf",
    "Barlow-Italic":              f"{GF}/barlow/Barlow-Italic.ttf",
    "Barlow-BoldItalic":          f"{GF}/barlow/Barlow-BoldItalic.ttf",
}

def fetch_font(name, url):
    out = FONT_CACHE / f"{name}.ttf"
    if out.exists() and out.stat().st_size > 1000:
        return out
    print(f"  fetching {name}...", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r, open(out, "wb") as f:
        f.write(r.read())
    return out

# Font roles — assigned after we know whether Barlow downloaded.
F = {
    "body":     "Helvetica",            # body normal (used as base; <b>/<i> switch via family)
    "body_b":   "Helvetica-Bold",
    "body_i":   "Helvetica-Oblique",
    "h_bold":   "Helvetica-Bold",       # heading bold
    "h_bi":     "Helvetica-BoldOblique" # heading bold italic
}

try:
    for name, url in FONT_URLS.items():
        p = fetch_font(name, url)
        pdfmetrics.registerFont(TTFont(name, str(p)))
    pdfmetrics.registerFontFamily(
        "BarlowCondensed",
        normal="BarlowCondensed-Regular",
        bold="BarlowCondensed-Bold",
        italic="BarlowCondensed-Italic",
        boldItalic="BarlowCondensed-BoldItalic",
    )
    pdfmetrics.registerFontFamily(
        "Barlow",
        normal="Barlow-Regular",
        bold="Barlow-Bold",
        italic="Barlow-Italic",
        boldItalic="Barlow-BoldItalic",
    )
    # PostScript-style names — these ARE in _ps2tt_map after registerFontFamily,
    # which lets <b>/<i> markup auto-resolve via the family lookup.
    F = {
        "body":   "Barlow-Regular",
        "body_b": "Barlow-Bold",
        "body_i": "Barlow-Italic",
        "h_bold": "BarlowCondensed-Bold",
        "h_bi":   "BarlowCondensed-BoldItalic",
    }
    print("Fonts: Barlow + BarlowCondensed registered")
except Exception as e:
    print(f"Font download failed ({e}); using Helvetica fallback", file=sys.stderr)

# ─── styles ───────────────────────────────────────────────────────────────
S = {}
S["H2"] = ParagraphStyle(
    "H2", fontName=F["h_bold"], fontSize=15, leading=19,
    textColor=NAVY, alignment=TA_LEFT,
    spaceBefore=4, spaceAfter=8,
)
S["H3"] = ParagraphStyle(
    "H3", fontName=F["body_b"],
    fontSize=11.5, leading=15, textColor=NAVY, alignment=TA_LEFT,
    spaceBefore=12, spaceAfter=4,
)
S["Body"] = ParagraphStyle(
    "Body", fontName=F["body"], fontSize=10.5, leading=15,
    textColor=DARK, alignment=TA_LEFT, spaceAfter=6,
)
S["Bullet"] = ParagraphStyle(
    "Bullet", parent=S["Body"],
    leftIndent=20, firstLineIndent=-12, spaceAfter=3,
)
S["CalloutBody"] = ParagraphStyle(
    "CalloutBody", parent=S["Body"], textColor=NAVY, fontName=F["body_b"],
)

# ─── inline markdown → reportlab markup ──────────────────────────────────
RE_BOLD = re.compile(r"\*\*(.+?)\*\*")
RE_ITALIC = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")
RE_CODE = re.compile(r"`([^`]+)`")

def inline(text):
    text = (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))
    text = RE_BOLD.sub(r"<b>\1</b>", text)
    text = RE_ITALIC.sub(r"<i>\1</i>", text)
    text = RE_CODE.sub(r"<font name='Courier' color='#0B1F3A'>\1</font>", text)
    return text

def callout(text):
    p = Paragraph(inline(text), S["CalloutBody"])
    tbl = Table([[p]], colWidths=[6.4*inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), CALLOUT_BG),
        ("LINEBEFORE", (0,0), (0,-1), 3, RED),
        ("LEFTPADDING", (0,0), (-1,-1), 12),
        ("RIGHTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING", (0,0), (-1,-1), 10),
        ("BOTTOMPADDING", (0,0), (-1,-1), 10),
    ]))
    return tbl

# ─── markdown parser ─────────────────────────────────────────────────────
def parse_md(md):
    story = []
    lines = md.split("\n")
    i = 0
    # Skip cover front-matter — render starts at the first `## `
    while i < len(lines) and not lines[i].startswith("## "):
        i += 1
    while i < len(lines):
        line = lines[i].rstrip()
        if line.strip() == "---":
            story.append(Spacer(1, 6))
            i += 1; continue
        if line.startswith("## "):
            story.append(HRFlowable(width="100%", thickness=2, color=RED,
                                     spaceBefore=14, spaceAfter=2))
            story.append(Paragraph(inline(line[3:].upper()), S["H2"]))
            i += 1; continue
        if line.startswith("### "):
            story.append(Paragraph(inline(line[4:]), S["H3"]))
            i += 1; continue
        if line.startswith("- "):
            while i < len(lines) and lines[i].rstrip().startswith("- "):
                b = lines[i].rstrip()[2:]
                story.append(Paragraph(
                    f"<font color='#D72638' size='13'>•</font>&nbsp;&nbsp;{inline(b)}",
                    S["Bullet"],
                ))
                i += 1
            continue
        if not line.strip():
            i += 1; continue
        # Callout: the founding-partner status line in §6
        if line.startswith("**Founding Tournament Partner status"):
            story.append(callout(line))
            i += 1; continue
        story.append(Paragraph(inline(line), S["Body"]))
        i += 1
    return story

# ─── page templates ──────────────────────────────────────────────────────
PAGE_W, PAGE_H = letter
MX = 0.85 * inch
COVER_H = 1.55 * inch        # navy bar height
META_BLOCK_H = 0.95 * inch   # FOR / FROM / DATE block below the bar
FOOTER_H = 0.85 * inch

def draw_footer(canv, page_num):
    canv.setFillColor(STEEL)
    canv.setFont(F["body"], 8)
    canv.drawString(MX, 0.45*inch, "Rinkd LLC  ·  hello@rinkd.app  ·  rinkd.app")
    canv.drawRightString(PAGE_W - MX, 0.45*inch, f"Page {page_num}")

def on_first(canv, doc):
    canv.saveState()
    # navy bar
    canv.setFillColor(NAVY)
    canv.rect(0, PAGE_H - COVER_H, PAGE_W, COVER_H, fill=1, stroke=0)
    # red rule below the bar
    canv.setStrokeColor(RED)
    canv.setLineWidth(3)
    canv.line(0, PAGE_H - COVER_H, PAGE_W, PAGE_H - COVER_H)
    # wordmark left
    try:
        wm = ImageReader(str(WORDMARK))
        iw, ih = wm.getSize()
        target_h = 0.55 * inch
        target_w = iw * (target_h / ih)
        canv.drawImage(wm, MX, PAGE_H - COVER_H + (COVER_H - target_h)/2,
                       width=target_w, height=target_h, mask='auto')
    except Exception as e:
        print(f"  warn: wordmark draw failed ({e})")
    # title right
    canv.setFillColor(colors.white)
    canv.setFont(F["h_bi"], 20)
    title = "STRATEGIC PARTNERSHIP PROPOSAL"
    tw = canv.stringWidth(title, F["h_bi"], 20)
    canv.drawString(PAGE_W - MX - tw, PAGE_H - COVER_H + 0.78*inch, title)
    # subtitle right
    canv.setFillColor(ICE)
    canv.setFont(F["body_i"], 11)
    sub = "Rinkd LLC  ×  Nickel City Hockey Tournaments"
    sw = canv.stringWidth(sub, F["body_i"], 11)
    canv.drawString(PAGE_W - MX - sw, PAGE_H - COVER_H + 0.50*inch, sub)
    # FOR / FROM / DATE meta block (below the bar, above the body)
    y = PAGE_H - COVER_H - 0.50*inch
    rows = [
        ("FOR",  "Matt Peters, Founder · Nickel City Hockey"),
        ("FROM", "Rinkd LLC"),
        ("DATE", "May 2026"),
    ]
    for label, val in rows:
        canv.setFillColor(STEEL)
        canv.setFont(F["h_bold"], 9)
        canv.drawString(MX, y, label)
        canv.setFillColor(NAVY)
        canv.setFont(F["body"], 10.5)
        canv.drawString(MX + 0.55*inch, y, val)
        y -= 0.22*inch
    draw_footer(canv, canv.getPageNumber())
    canv.restoreState()

def on_later(canv, doc):
    canv.saveState()
    canv.setStrokeColor(RED)
    canv.setLineWidth(1.2)
    canv.line(MX, PAGE_H - 0.52*inch, PAGE_W - MX, PAGE_H - 0.52*inch)
    try:
        wm = ImageReader(str(WORDMARK))
        iw, ih = wm.getSize()
        target_h = 0.22 * inch
        target_w = iw * (target_h / ih)
        canv.drawImage(wm, MX, PAGE_H - 0.45*inch,
                       width=target_w, height=target_h, mask='auto')
    except Exception:
        pass
    canv.setFillColor(NAVY)
    canv.setFont(F["h_bold"], 9)
    canv.drawRightString(PAGE_W - MX, PAGE_H - 0.40*inch,
                          "PARTNERSHIP PROPOSAL  ·  MAY 2026")
    draw_footer(canv, canv.getPageNumber())
    canv.restoreState()

# ─── build ────────────────────────────────────────────────────────────────
def main():
    md = MD_PATH.read_text(encoding="utf-8")
    story = parse_md(md)

    first_top = COVER_H + META_BLOCK_H + 0.10*inch     # space taken by cover + meta
    frame_first = Frame(
        MX, FOOTER_H,
        PAGE_W - 2*MX,
        PAGE_H - FOOTER_H - first_top,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        id="first",
    )
    later_top = 0.75 * inch
    frame_later = Frame(
        MX, FOOTER_H,
        PAGE_W - 2*MX,
        PAGE_H - FOOTER_H - later_top,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        id="later",
    )

    doc = BaseDocTemplate(
        str(PDF_PATH), pagesize=letter,
        title="Rinkd × Nickel City — Strategic Partnership Proposal",
        author="Rinkd LLC",
        subject="Founding Tournament Partner proposal",
        creator="Rinkd LLC",
    )
    doc.addPageTemplates([
        PageTemplate(id="first", frames=[frame_first], onPage=on_first),
        PageTemplate(id="later", frames=[frame_later], onPage=on_later),
    ])
    story = [NextPageTemplate("later")] + story
    doc.build(story)
    sz = PDF_PATH.stat().st_size / 1024
    print(f"\n✅ wrote {PDF_PATH}")
    print(f"   {sz:.1f} KB")

if __name__ == "__main__":
    main()
