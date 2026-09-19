#!/usr/bin/env python3
"""
Scanny - Automatische Dokumenten-Bildaufbereitung
Verwendung:
  python3 scan.py --in <datei> --out <png> --mode bw|gray|color
          [--corners '<json [[x,y],[x,y],[x,y],[x,y]]>'] [--rotation 0|90|180|270]
          [--detect-only]

WICHTIG: Die Ecken (corners) beziehen sich IMMER auf das bereits gedrehte Arbeitsbild
(nach Anwendung von --rotation).

Gibt genau EINE JSON-Zeile auf stdout aus:
  {"ok":true,"corners":[[..],[..],[..],[..]],"detected":true,"width":2480,"height":3508,"layout":"a4"}
Bei Fehlern:
  {"ok":false,"error":"..."} und Exit-Code 1.
Alle Debug-Ausgaben erfolgen ausschließlich auf stderr.
"""

import sys
import os
import json
import argparse
import numpy as np

def log_debug(msg):
    sys.stderr.write(f"[scan.py] {msg}\n")
    sys.stderr.flush()

def order_points(pts):
    """
    Sortiert 4 Punkte in die Reihenfolge:
    0: oben-links (top-left)
    1: oben-rechts (top-right)
    2: unten-rechts (bottom-right)
    3: unten-links (bottom-left)
    """
    pts = np.asarray(pts, dtype=np.float32)
    rect = np.zeros((4, 2), dtype=np.float32)

    # Summe (x + y): oben-links hat die kleinste Summe, unten-rechts die größte Summe
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]

    # Differenz (y - x): oben-rechts hat die kleinste Differenz (großes x, kleines y),
    # unten-links hat die größte Differenz (kleines x, großes y)
    diff = np.diff(pts, axis=1).reshape(-1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]

    return rect

def find_document_corners(img):
    """
    Findet die 4 Ecken des Dokuments im Bild oder fällt auf Näherungen / Bildgrenzen zurück.
    Gibt (ordered_corners, detected_bool) zurück.
    Hinweis: Ecken beziehen sich auf das übergebene (bereits gedrehte) Bild.
    """
    import cv2

    h_orig, w_orig = img.shape[:2]
    max_dim = 1000.0
    scale = 1.0

    if max(h_orig, w_orig) > max_dim:
        scale = max(h_orig, w_orig) / max_dim
        new_w = int(round(w_orig / scale))
        new_h = int(round(h_orig / scale))
        small = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    else:
        small = img.copy()
        new_w, new_h = w_orig, h_orig

    # Graustufen & Glättung
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Kanten & Morphologie
    edges = cv2.Canny(blurred, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    dilated = cv2.dilate(edges, kernel, iterations=2)
    morph = cv2.morphologyEx(dilated, cv2.MORPH_CLOSE, kernel, iterations=1)

    # Konturen finden (RETR_LIST)
    contours, _ = cv2.findContours(morph, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]

    img_area = float(new_w * new_h)
    min_area = 0.08 * img_area  # Mindestfläche 8 % (unterstützt auch schmale Kassenbelege)
    found_corners = None
    detected = False

    # Die 10 größten Konturen prüfen mit iterativ aufgeweichtem epsilon (0.02, 0.03, 0.04, 0.05 * Umfang)
    for c in contours:
        peri = cv2.arcLength(c, True)
        if peri <= 0:
            continue
        for eps_factor in [0.02, 0.03, 0.04, 0.05]:
            approx = cv2.approxPolyDP(c, eps_factor * peri, True)
            area = cv2.contourArea(approx)
            if len(approx) == 4 and cv2.isContourConvex(approx) and area > min_area:
                found_corners = approx.reshape(4, 2).astype(np.float32)
                detected = True
                break
        if found_corners is not None:
            break

    # Erster Fallback: minAreaRect der größten Kontur, falls > 8% Fläche
    # Setzt detected=false, damit die UI "Ränder nicht sicher erkannt – bitte prüfen" anzeigt
    if found_corners is None:
        if contours:
            rect = cv2.minAreaRect(contours[0])
            box = cv2.boxPoints(rect)
            area = cv2.contourArea(box)
            if area > min_area:
                found_corners = box.astype(np.float32)
                detected = False

    # Zweiter Fallback: Ganzes Bild als Ecken nehmen
    if found_corners is None:
        found_corners = np.array([
            [0.0, 0.0],
            [float(new_w - 1), 0.0],
            [float(new_w - 1), float(new_h - 1)],
            [0.0, float(new_h - 1)]
        ], dtype=np.float32)
        detected = False

    # Ecken auf Originalgröße hochskalieren
    if scale != 1.0:
        found_corners = found_corners * scale

    # Innerhalb der Originalbildgrenzen begrenzen
    found_corners[:, 0] = np.clip(found_corners[:, 0], 0.0, float(w_orig - 1))
    found_corners[:, 1] = np.clip(found_corners[:, 1], 0.0, float(h_orig - 1))

    ordered = order_points(found_corners)
    return ordered, detected

def main():
    try:
        import cv2
    except ImportError as e:
        sys.stdout.write(json.dumps({"ok": False, "error": f"OpenCV (cv2) ist nicht installiert: {e}"}) + "\n")
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Scanny Document Image Enhancement")
    parser.add_argument("--in", dest="input_path", required=True, help="Pfad zum Eingabebild")
    parser.add_argument("--out", dest="output_path", default=None, help="Pfad zum Ausgabebild (PNG)")
    parser.add_argument("--mode", choices=["bw", "gray", "color"], default="bw", help="Farbmodus: bw, gray oder color")
    parser.add_argument("--corners", default=None, help="Vorgegebene Ecken als JSON [[x,y],[x,y],[x,y],[x,y]]")
    parser.add_argument("--rotation", type=int, choices=[0, 90, 180, 270], default=0, help="Drehwinkel im Uhrzeigersinn")
    parser.add_argument("--detect-only", action="store_true", help="Nur Ecken erkennen und abbrechen")

    args = parser.parse_args()

    if not os.path.exists(args.input_path):
        sys.stdout.write(json.dumps({"ok": False, "error": f"Eingabedatei nicht gefunden: {args.input_path}"}) + "\n")
        sys.exit(1)

    try:
        # 1. Einlesen mit cv2.imread
        img = cv2.imread(args.input_path)
        if img is None:
            sys.stdout.write(json.dumps({"ok": False, "error": f"Bild konnte nicht geladen werden: {args.input_path}"}) + "\n")
            sys.exit(1)

        # 2. Optional Rotation anwenden
        if args.rotation == 90:
            img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        elif args.rotation == 180:
            img = cv2.rotate(img, cv2.ROTATE_180)
        elif args.rotation == 270:
            img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)

        h_orig, w_orig = img.shape[:2]

        # 3. Ecken finden (falls keine --corners übergeben)
        # HINWEIS: corners beziehen sich IMMER auf das bereits gedrehte Arbeitsbild (img).
        detected = False
        ordered_corners = None

        if args.corners:
            try:
                raw_corners = json.loads(args.corners)
                if isinstance(raw_corners, list) and len(raw_corners) == 4:
                    pts = np.array(raw_corners, dtype=np.float32)
                    ordered_corners = order_points(pts)
                    detected = True
            except Exception as ex:
                log_debug(f"Konnte übergebene Ecken nicht parsen: {ex}")

        if ordered_corners is None:
            ordered_corners, detected = find_document_corners(img)

        # Bei --detect-only hier abbrechen
        if args.detect_only:
            result = {
                "ok": True,
                "corners": [[float(round(p[0], 2)), float(round(p[1], 2))] for p in ordered_corners],
                "detected": detected,
                "width": w_orig,
                "height": h_orig
            }
            sys.stdout.write(json.dumps(result) + "\n")
            sys.exit(0)

        if not args.output_path:
            sys.stdout.write(json.dumps({"ok": False, "error": "Kein Ausgabepfad (--out) angegeben."}) + "\n")
            sys.exit(1)

        # 4. Perspektive entzerren
        tl, tr, br, bl = ordered_corners
        width_a = np.hypot(br[0] - bl[0], br[1] - bl[1])
        width_b = np.hypot(tr[0] - tl[0], tr[1] - tl[1])
        target_w = max(int(round(max(width_a, width_b))), 100)

        height_a = np.hypot(tr[0] - br[0], tr[1] - br[1])
        height_b = np.hypot(tl[0] - bl[0], tl[1] - bl[1])
        target_h = max(int(round(max(height_a, height_b))), 100)

        dst = np.array([
            [0.0, 0.0],
            [float(target_w - 1), 0.0],
            [float(target_w - 1), float(target_h - 1)],
            [0.0, float(target_h - 1)]
        ], dtype=np.float32)

        M = cv2.getPerspectiveTransform(ordered_corners, dst)
        warped = cv2.warpPerspective(img, M, (target_w, target_h), flags=cv2.INTER_CUBIC)

        # Nach warpPerspective mind. 12 px bzw. 1 % des Randes je Seite abschneiden (nur wenn detected),
        # um verbleibende Papierkantenlinien sauber zu entfernen
        if detected:
            crop_x = max(int(round(target_w * 0.01)), 12)
            crop_y = max(int(round(target_h * 0.01)), 12)
            if target_w > 2 * crop_x + 10 and target_h > 2 * crop_y + 10:
                warped = warped[crop_y:target_h - crop_y, crop_x:target_w - crop_x]

        # 5. Zielgröße und Layout bestimmen: ZUERST auf Zielgröße skalieren,
        # damit danach keine Kantenglättung/Interpolation den S/W-Modus verfälscht!
        pw = warped.shape[1]
        ph = warped.shape[0]
        is_landscape = pw > ph

        if is_landscape:
            a4_w = 3508
            a4_h = 2480
            target_ratio = 3508.0 / 2480.0
        else:
            a4_w = 2480
            a4_h = 3508
            target_ratio = 2480.0 / 3508.0

        current_ratio = float(pw) / float(ph)
        ratio_diff = abs(current_ratio - target_ratio) / target_ratio

        if ratio_diff < 0.15:
            # Verhältnis nah an A4 (< 15% Abweichung): layout "a4"
            layout = "a4"
            interp = cv2.INTER_AREA if (pw > a4_w or ph > a4_h) else cv2.INTER_CUBIC
            work_img = cv2.resize(warped, (a4_w, a4_h), interpolation=interp)
        else:
            # Schmaler Beleg (z. B. Kassenbon): layout "fit"
            layout = "fit"
            margin_x = int(round(a4_w * 0.05))
            margin_y = int(round(a4_h * 0.05))
            avail_w = a4_w - (2 * margin_x)
            avail_h = a4_h - (2 * margin_y)

            # Schmaler Beleg prüfen (Verhältnis > 2:1): max. ~945 px breit bei 300 dpi (80mm Bonbreite)
            is_narrow = (float(ph) / float(pw) > 2.0) if not is_landscape else (float(pw) / float(ph) > 2.0)
            if is_narrow and not is_landscape:
                max_w = min(avail_w, 945)
            else:
                max_w = avail_w

            max_h = avail_h
            scale_fit = min(float(max_w) / float(pw), float(max_h) / float(ph))

            fit_w = max(int(round(pw * scale_fit)), 1)
            fit_h = max(int(round(ph * scale_fit)), 1)

            interp = cv2.INTER_AREA if scale_fit < 1.0 else cv2.INTER_CUBIC
            work_img = cv2.resize(warped, (fit_w, fit_h), interpolation=interp)

        # 6. Schattenausgleich & Farbmodus auf das bereits skalierte Bild anwenden
        cur_w = work_img.shape[1]

        # Kernel-Größen relativ zur Bildbreite wählen:
        # dilate ca. Breite/350, ungerade, mind. 7
        d_k = int(round(cur_w / 350.0))
        if d_k % 2 == 0:
            d_k += 1
        if d_k < 7:
            d_k = 7
        k_bg = cv2.getStructuringElement(cv2.MORPH_RECT, (d_k, d_k))

        # medianBlur ca. Breite/120, ungerade, mind. 21
        m_k = int(round(cur_w / 120.0))
        if m_k % 2 == 0:
            m_k += 1
        if m_k < 21:
            m_k = 21

        gray = cv2.cvtColor(work_img, cv2.COLOR_BGR2GRAY)
        dilated_bg = cv2.dilate(gray, k_bg)
        bg = cv2.medianBlur(dilated_bg, m_k)

        diff = cv2.absdiff(gray, bg)
        norm = 255 - diff
        normalized_gray = cv2.normalize(norm, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_8U)

        if args.mode == "bw":
            # adaptiveThreshold (ADAPTIVE_THRESH_GAUSSIAN_C, THRESH_BINARY,
            # blockSize aus der A4-Seitenbreite berechnen: a4_w / 80, ungerade, mind. 15; C = 10)
            block_size = int(round(a4_w / 80.0))
            if block_size % 2 == 0:
                block_size += 1
            if block_size < 15:
                block_size = 15

            thresh = cv2.adaptiveThreshold(
                normalized_gray,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                block_size,
                10
            )

            # kleine Punkte entfernen (connectedComponentsWithStats, Komponenten < 12 px Fläche weiß machen)
            inv = cv2.bitwise_not(thresh)
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
            for i in range(1, num_labels):
                area = stats[i, cv2.CC_STAT_AREA]
                if area < 12:
                    thresh[labels == i] = 255

            processed = thresh
        elif args.mode == "gray":
            # normalisiertes Graustufenbild, Kontrast via CLAHE (clipLimit 2.0)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            processed = clahe.apply(normalized_gray)
        else: # "color"
            # Im LAB-Farbraum Luminanz (L) durch normalized_gray ersetzen
            lab = cv2.cvtColor(work_img, cv2.COLOR_BGR2LAB)
            lab[:, :, 0] = normalized_gray
            processed = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

        # 7. Finales Bild zusammensetzen (im bw-Modus garantiert nur 0 und 255)
        if layout == "a4":
            final_img = processed
        else:
            # layout "fit": mittig oben auf weiße A4-Leinwand setzen
            if len(processed.shape) == 2:
                canvas = np.full((a4_h, a4_w), 255, dtype=np.uint8)
            else:
                canvas = np.full((a4_h, a4_w, 3), 255, dtype=np.uint8)

            fit_w = processed.shape[1]
            fit_h = processed.shape[0]
            offset_x = (a4_w - fit_w) // 2
            margin_y = int(round(a4_h * 0.05))
            offset_y = margin_y
            canvas[offset_y:offset_y + fit_h, offset_x:offset_x + fit_w] = processed
            final_img = canvas

        # 8. Als PNG speichern
        out_dir = os.path.dirname(os.path.abspath(args.output_path))
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        success = cv2.imwrite(args.output_path, final_img)
        if not success:
            sys.stdout.write(json.dumps({"ok": False, "error": f"Konnte Bild nicht schreiben: {args.output_path}"}) + "\n")
            sys.exit(1)

        result = {
            "ok": True,
            "corners": [[float(round(p[0], 2)), float(round(p[1], 2))] for p in ordered_corners],
            "detected": detected,
            "width": a4_w,
            "height": a4_h,
            "layout": layout
        }
        sys.stdout.write(json.dumps(result) + "\n")
        sys.exit(0)

    except Exception as ex:
        sys.stdout.write(json.dumps({"ok": False, "error": str(ex)}) + "\n")
        sys.exit(1)

if __name__ == "__main__":
    main()

