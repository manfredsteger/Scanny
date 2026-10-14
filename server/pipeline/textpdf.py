#!/usr/bin/env python3
"""
Setzt eine Textdatei (.txt oder Markdown) als A4-PDF und hängt die Quelldatei an.

Aufruf:  python3 textpdf.py <quelle.utf8> <ziel.pdf> <md|txt> <anzeigename>
Ausgabe: JSON auf stdout, z. B. {"ok": true, "pages": 2, "mode": "md"}

Alles lokal: Roh-HTML im Markdown wird NICHT ausgewertet (erscheint als Text), Bilder werden
NIE geladen (Platzhalter "[Bild: …]"), Links erscheinen nur als Text.
"""
import html
import json
import os
import re
import sys
from html.entities import name2codepoint
from xml.etree import ElementTree as ET

import markdown
import pikepdf
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"


def register(name, *candidates):
    """Ersten vorhandenen Schnitt registrieren – fehlt z. B. Kursiv, wird der normale Schnitt genommen."""
    for candidate in candidates:
        path = os.path.join(FONT_DIR, candidate)
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
            return
    raise FileNotFoundError(f"Keine Schrift für {name} gefunden ({', '.join(candidates)})")


register("DV", "DejaVuSans.ttf")
register("DVB", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf")
register("DVI", "DejaVuSans-Oblique.ttf", "DejaVuSans.ttf")
register("DVBI", "DejaVuSans-BoldOblique.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf")
register("DVM", "DejaVuSansMono.ttf", "DejaVuSans.ttf")
registerFontFamily("DV", normal="DV", bold="DVB", italic="DVI", boldItalic="DVBI")

GREY = colors.HexColor("#555555")
BODY = ParagraphStyle("body", fontName="DV", fontSize=10.5, leading=15, spaceAfter=5)
HEADINGS = {
    f"h{level}": ParagraphStyle(
        f"h{level}", parent=BODY, fontName="DVB", fontSize=size, leading=size * 1.3, spaceBefore=10, spaceAfter=5
    )
    for level, size in zip(range(1, 7), [19, 15.5, 13, 11.5, 10.5, 10.5])
}
QUOTE = ParagraphStyle("quote", parent=BODY, leftIndent=12, textColor=GREY, fontName="DVI")
CODE = ParagraphStyle("code", fontName="DVM", fontSize=8.8, leading=11.5)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=9.5, leading=12.5, spaceAfter=0)
CELL_HEAD = ParagraphStyle("cellhead", parent=CELL, fontName="DVB")


def esc(text):
    return html.escape(text or "", quote=False)


def inline(el):
    """Inline-Markup eines Elements → reportlab-Paragraph-Markup (nur b/i/strike/font/br)."""
    out = esc(el.text)
    for child in el:
        inner = inline(child)
        tag = child.tag
        if tag in ("strong", "b"):
            out += f"<b>{inner}</b>"
        elif tag in ("em", "i"):
            out += f"<i>{inner}</i>"
        elif tag in ("del", "s"):
            out += f"<strike>{inner}</strike>"
        elif tag == "code":
            out += f'<font name="DVM" size="9.5">{inner}</font>'
        elif tag == "br":
            out += "<br/>"
        elif tag == "img":
            out += esc(f"[Bild: {child.get('alt') or child.get('src') or ''}]")
        elif tag in ("ul", "ol", "p", "pre", "blockquote", "table"):
            # Blockelemente in Listeneinträgen werden von blocks() behandelt
            pass
        else:
            out += inner
        out += esc(child.tail)
    return out


def checkbox(text):
    """Aufgabenlisten: "[ ] …" / "[x] …" → ☐ / ☑."""
    return re.sub(r"^\[ \]\s*", "☐ ", re.sub(r"^\[[xX]\]\s*", "☑ ", text))


def list_flowable(el, depth=0):
    items = []
    for li in el:
        if li.tag != "li":
            continue
        flow = []
        text = checkbox(inline(li).strip())
        if text:
            flow.append(Paragraph(text, BODY))
        for child in li:
            if child.tag in ("ul", "ol"):
                flow.append(list_flowable(child, depth + 1))
            elif child.tag == "p":
                flow.append(Paragraph(checkbox(inline(child)), BODY))
            elif child.tag == "pre":
                flow.append(code_block("".join(child.itertext())))
        items.append(ListItem(flow or [Paragraph("", BODY)]))
    numbered = el.tag == "ol"
    return ListFlowable(
        items,
        bulletType="1" if numbered else "bullet",
        bulletFormat="%s." if numbered else None,
        start=el.get("start", "1") if numbered else ("•" if depth % 2 == 0 else "◦"),
        bulletFontName="DV",
        bulletFontSize=9.5,
        leftIndent=16,
    )


def table_flowable(el, width):
    rows = []
    for tr in el.iter("tr"):
        cells = [Paragraph(inline(c), CELL_HEAD if c.tag == "th" else CELL) for c in tr if c.tag in ("td", "th")]
        if cells:
            rows.append(cells)
    if not rows:
        return None
    cols = max(len(r) for r in rows)
    rows = [r + [Paragraph("", CELL)] * (cols - len(r)) for r in rows]
    table = Table(rows, colWidths=[width / cols] * cols, repeatRows=1)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def blocks(parent, width):
    flow = []
    for el in parent:
        tag = el.tag
        if tag in HEADINGS:
            flow.append(Paragraph(inline(el), HEADINGS[tag]))
        elif tag == "p":
            flow.append(Paragraph(checkbox(inline(el)), BODY))
        elif tag == "pre":
            flow.extend([code_block("".join(el.itertext())), Spacer(1, 8)])
        elif tag == "blockquote":
            for child in el:
                flow.append(Paragraph(inline(child) if child.tag == "p" else esc("".join(child.itertext())), QUOTE))
        elif tag in ("ul", "ol"):
            flow.append(list_flowable(el))
            flow.append(Spacer(1, 4))
        elif tag == "hr":
            flow.append(HRFlowable(width="100%", color=colors.HexColor("#bbbbbb"), spaceBefore=6, spaceAfter=8))
        elif tag == "table":
            table = table_flowable(el, width)
            if table is not None:
                flow.extend([table, Spacer(1, 8)])
        else:
            text = "".join(el.itertext()).strip()
            if text:
                flow.append(Paragraph(esc(text), BODY))
    return flow


LIST_MARKER = re.compile(r"^( *)([-*+]|\d+[.)])\s+")


def normalize_lists(source):
    """
    Markdown, wie Menschen es schreiben (GitHub-Stil), für python-markdown aufbereiten:
    - Verschachtelung über einen Einrückungsstapel bestimmen und auf 4 Leerzeichen je Ebene bringen
      (python-markdown verlangt 4; 2 oder 3 Leerzeichen würden sonst flach)
    - Leerzeile vor einer Liste, die direkt auf einen Absatz folgt oder die Art wechselt (• ↔ 1.)
    Inhalte von ```-Codeblöcken bleiben unangetastet.
    """
    out = []
    in_code = False
    stack = []          # Einrückungen der offenen Listenebenen (Original-Leerzeichen)
    kinds = {}          # Ebene → "ul" | "ol" der zuletzt gesehenen Liste
    prev = "blank"      # "blank" | "text" | "list"
    for line in source.split("\n"):
        if line.lstrip().startswith("```") and not stack:
            in_code = not in_code
            out.append(line)
            prev = "text"
            continue
        if in_code:
            out.append(line)
            continue
        match = LIST_MARKER.match(line)
        if match:
            indent = len(match.group(1))
            while stack and indent < stack[-1]:
                stack.pop()
            if not stack or indent > stack[-1]:
                stack.append(indent)
            level = len(stack) - 1
            kind = "ol" if match.group(2)[0].isdigit() else "ul"
            if out and out[-1].strip() and (prev == "text" or (level in kinds and kinds[level] != kind)):
                out.append("")
            for deeper in [k for k in kinds if k > level]:
                del kinds[deeper]
            kinds[level] = kind
            out.append(" " * (4 * level) + line.lstrip(" "))
            prev = "list"
        elif not line.strip():
            out.append(line)
            prev = "blank"
        elif stack and line.startswith(" ") and prev in ("list", "blank"):
            # Fortsetzung eines Listenpunkts: unter dessen Text einrücken
            out.append(" " * (4 * len(stack)) + line.lstrip(" "))
        else:
            stack, kinds = [], {}
            out.append(line)
            prev = "text"
    return "\n".join(out)


def code_block(text):
    """Codeblock mit grauem Hintergrund; überlange Zeilen werden umbrochen statt abgeschnitten."""
    pre = Preformatted(text.rstrip("\n"), CODE, maxLineLength=84, newLineChars="↪ ")
    box = Table([[pre]], colWidths=["100%"])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f2f2f2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return box


def markdown_flow(source, width):
    md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"], output_format="xhtml")
    # Kein Roh-HTML: sonst kämen <img src="http://…"> & Co. ungefiltert durch
    md.preprocessors.deregister("html_block")
    md.inlinePatterns.deregister("html")
    body = md.convert(normalize_lists(source))
    # Benannte HTML-Entities (&copy; …) kennt der XML-Parser nicht → numerisch
    body = re.sub(
        r"&([A-Za-z][A-Za-z0-9]*);",
        lambda m: m.group(0) if m.group(1) in ("amp", "lt", "gt", "quot", "apos")
        else (f"&#{name2codepoint[m.group(1)]};" if m.group(1) in name2codepoint else f"&amp;{m.group(1)};"),
        body,
    )
    root = ET.fromstring("<root>" + body + "</root>")
    return blocks(root, width)


def text_flow(source):
    """Reiner Text: Zeilen bleiben Zeilen, Leerzeilen trennen Absätze, Einrückungen bleiben."""
    flow = []
    for paragraph in re.split(r"\n\s*\n", source.strip("\n")):
        lines = []
        for line in paragraph.split("\n"):
            indent = len(line) - len(line.lstrip(" "))
            lines.append("&nbsp;" * indent + esc(line.strip()))
        flow.append(Paragraph("<br/>".join(lines), BODY))
    return flow


def main():
    src_path, out_path, mode, display_name = sys.argv[1:5]
    with open(src_path, encoding="utf-8") as fh:
        source = fh.read()

    margin = 20 * mm
    width = A4[0] - 2 * margin

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("DV", 7.5)
        canvas.setFillColor(colors.HexColor("#888888"))
        canvas.drawString(margin, 10 * mm, f"{display_name} · aus Textdatei erzeugt")
        canvas.drawRightString(A4[0] - margin, 10 * mm, f"Seite {doc.page}")
        canvas.restoreState()

    used = mode
    try:
        flow = markdown_flow(source, width) if mode == "md" else text_flow(source)
    except Exception as err:  # Markdown nicht sauber lesbar → schlicht als Text setzen statt scheitern
        sys.stderr.write(f"Markdown-Fallback: {err}\n")
        flow, used = text_flow(source), "txt-fallback"
    if not flow:
        flow = [Paragraph("<i>(leere Datei)</i>", BODY)]

    doc = SimpleDocTemplate(
        out_path, pagesize=A4, leftMargin=margin, rightMargin=margin, topMargin=18 * mm, bottomMargin=18 * mm,
        title=display_name, creator="Scanny",
    )
    doc.build(flow, onFirstPage=footer, onLaterPages=footer)

    # Quelldatei als Anhang ins PDF – das Archiv-PDF ist damit in sich vollständig
    pdf = pikepdf.open(out_path, allow_overwriting_input=True)
    mime = "text/markdown" if mode == "md" else "text/plain"
    with open(src_path, "rb") as fh:
        pdf.attachments[display_name] = pikepdf.AttachedFileSpec(pdf, fh.read(), mime_type=mime, description="Quelltext")
    pages = len(pdf.pages)
    pdf.save(out_path)
    print(json.dumps({"ok": True, "pages": pages, "mode": used}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
