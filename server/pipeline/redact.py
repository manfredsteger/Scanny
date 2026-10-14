#!/usr/bin/env python3
"""
Echtes Schwärzen: Inhalte unter den markierten Bereichen werden ENTFERNT, nicht nur übermalt.

Aufruf:  python3 redact.py <eingang.pdf> <ausgang.pdf> <boxen.json>
boxen.json: [{"page": 0, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.05}, ...]
            Koordinaten als Anteile (0..1) der Seite, wie sie angezeigt wird (oben links = 0,0,
            Seitendrehung /Rotate bereits angewendet).
Ausgabe: JSON auf stdout.

Ablauf je Seite mit Markierungen:
  1. Wörter unter den Markierungen merken (für die Prüfung am Ende)
  2. Seite mit Ghostscript als Bild rendern, schwarze Flächen ins Bild brennen,
     Originalseite durch dieses Bild ersetzen → Text, Vektoren, Anmerkungen der Seite sind weg
  3. Danach ocrmypdf --skip-text: nur die neu gerasterten Seiten bekommen per OCR wieder eine
     Textebene (für das, was noch sichtbar ist); unberührte Seiten bleiben wie sie sind
  4. Prüfen, dass kein geschwärztes Wort mehr im Text der Seite steckt
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import cv2
import img2pdf
import pikepdf
from pdfminer.high_level import extract_pages, extract_text
from pdfminer.layout import LTChar

DPI = 200
PAD = 3  # Pixel Sicherheitsrand um jede Markierung


def box_rect_layout(box, bbox):
    """
    Anzeige-Anteile → Koordinaten im pdfminer-Layout. pdfminer wendet /Rotate bereits an, sein
    Layout liegt also wie die Anzeige (nur mit Ursprung unten links) – das gilt für jede Drehung.
    """
    bx0, by0, bx1, by1 = bbox
    w, h = bx1 - bx0, by1 - by0
    return (bx0 + box["x"] * w, by1 - (box["y"] + box["h"]) * h,
            bx0 + (box["x"] + box["w"]) * w, by1 - box["y"] * h)


def tokens(text):
    """Wörter, die für die Prüfung taugen: mind. 3 Zeichen, mit Buchstaben oder Ziffern."""
    return {t.lower() for t in re.findall(r"[\wäöüÄÖÜß@.\-]{3,}", text) if re.search(r"[\wäöüß]", t)}


def chars_of_page(path, index):
    """Alle Zeichen der Seite und die Seitengrenzen im (gedrehten) Layout."""
    chars, bbox = [], (0, 0, 1, 1)
    for layout in extract_pages(path, page_numbers=[index]):
        bbox = layout.bbox

        def walk(obj):
            if isinstance(obj, LTChar):
                chars.append(obj)
            elif hasattr(obj, "__iter__"):
                for child in obj:
                    walk(child)
        walk(layout)
    return chars, bbox


def split_text_by_boxes(chars, rects):
    """Text der Seite getrennt nach 'unter einer Markierung' und 'außerhalb'."""
    inside, outside = [], []
    for ch in chars:
        cx, cy = (ch.x0 + ch.x1) / 2, (ch.y0 + ch.y1) / 2
        hit = any(r[0] <= cx <= r[2] and r[1] <= cy <= r[3] for r in rects)
        (inside if hit else outside).append(ch.get_text())
    return "".join(inside), "".join(outside)


def main():
    src, dst, boxes_path = sys.argv[1:4]
    with open(boxes_path, encoding="utf-8") as fh:
        boxes = json.load(fh)

    pdf = pikepdf.open(src)
    by_page = {}
    for box in boxes:
        page = int(box["page"])
        if 0 <= page < len(pdf.pages) and box["w"] > 0 and box["h"] > 0:
            by_page.setdefault(page, []).append(box)
    if not by_page:
        print(json.dumps({"ok": False, "error": "Keine gültigen Markierungen."}))
        sys.exit(1)

    work = tempfile.mkdtemp(prefix="schwaerzen_")
    secret_words = {}  # Seite → Wörter, die NUR unter Markierungen standen
    for index, page_boxes in sorted(by_page.items()):
        chars, bbox = chars_of_page(src, index)
        rects = [box_rect_layout(b, bbox) for b in page_boxes]
        inside, outside = split_text_by_boxes(chars, rects)
        secret_words[index] = sorted(tokens(inside) - tokens(outside))

        png = os.path.join(work, f"seite_{index}.png")
        subprocess.run(
            ["gs", "-q", "-sDEVICE=png16m", f"-r{DPI}", f"-dFirstPage={index + 1}", f"-dLastPage={index + 1}",
             "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4", "-o", png, src],
            check=True, timeout=120,
        )
        img = cv2.imread(png)
        height, width = img.shape[:2]
        for b in page_boxes:
            left = max(0, int(b["x"] * width) - PAD)
            top = max(0, int(b["y"] * height) - PAD)
            right = min(width, int((b["x"] + b["w"]) * width) + PAD)
            bottom = min(height, int((b["y"] + b["h"]) * height) + PAD)
            cv2.rectangle(img, (left, top), (right, bottom), (0, 0, 0), thickness=-1)
        jpg = os.path.join(work, f"seite_{index}.jpg")
        cv2.imwrite(jpg, img, [cv2.IMWRITE_JPEG_QUALITY, 90])

        page_pdf = os.path.join(work, f"seite_{index}.pdf")
        with open(page_pdf, "wb") as fh:
            fh.write(img2pdf.convert(jpg, layout_fun=img2pdf.get_fixed_dpi_layout_fun((DPI, DPI))))
        replacement = pikepdf.open(page_pdf)
        pdf.pages[index] = replacement.pages[0]

    # Dokument-Metadaten können Inhalte wiederholen (Titel, Betreff) – sicherheitshalber leeren
    with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
        for key in list(meta.keys()):
            del meta[key]
    for key in ("/Title", "/Subject", "/Keywords"):
        if key in pdf.docinfo:
            del pdf.docinfo[key]

    raster = os.path.join(work, "geschwaerzt.pdf")
    pdf.save(raster)

    # Sichtbaren Rest der gerasterten Seiten wieder durchsuchbar machen
    ocr_ok = True
    try:
        subprocess.run(
            ["ocrmypdf", "-q", "--skip-text", "--rotate-pages", "-l", "deu", "--output-type", "pdf", raster, dst],
            check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        ocr_ok = False
        os.replace(raster, dst)

    # Prüfung: steckt ein geschwärztes Wort noch im Text der Seite?
    leaked = []
    removed = 0
    for index, words in secret_words.items():
        removed += len(words)
        # Ohne Leerzeichen vergleichen: bei gedrehten Seiten liefert pdfminer Wörter zusammengeklebt
        remaining = re.sub(r"\s+", "", extract_text(dst, page_numbers=[index]).lower())
        leaked += [w for w in words if re.sub(r"\s+", "", w) in remaining]

    print(json.dumps({
        "ok": True,
        "pages": sorted(i + 1 for i in by_page),
        "removedWords": removed,
        "leaked": leaked,
        "searchable": ocr_ok,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
