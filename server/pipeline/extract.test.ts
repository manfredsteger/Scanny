import { describe, it, expect } from 'vitest';
import { detectDocument, extractAmount, extractDate, extractSender } from './extract.js';
import { classify, fuzzyPattern } from './classify.js';
import { buildTitle, shortSender } from './title.js';

const NOW = new Date('2026-09-19T12:00:00');

const RECHNUNG = `Deutsche Telekom GmbH · Postfach 1234 · 53105 Bonn
Herrn
Max Mustermann
Musterstraße 12
12345 Musterstadt

Rechnung
Rechnungsnummer 123 456 789
Kundennummer 987654
Rechnungsdatum 02.03.2026
Leistungszeitraum 01.02.2026 bis 28.02.2026

Beträge in EUR          Netto     MwSt     Brutto
MagentaZuhause M        33,61     6,39     40,00
Summe netto             33,61
Umsatzsteuer 19 %        6,39
Rechnungsbetrag         40,00 €
zahlbar bis 16.03.2026 per Lastschrift
IBAN DE12 3456 7890 1234 5678 90`;

const KASSENBON = `REWE Markt GmbH
Hauptstr. 5
80331 München
UID Nr.: DE812706034

BANANEN 1,99
VOLLMILCH 1,19
BROT 2,49
--------------------
SUMME EUR 5,67
Gegeben BAR 10,00
Rückgeld 4,33

MwSt 7% Netto 5,30
TSE-Signatur: abc
14.09.2026 18:42 Bon-Nr.: 4711`;

const KONTOAUSZUG = `Sparkasse Musterstadt
Kontoauszug 3/2026 vom 31.03.2026
IBAN DE12 3456 7890 1234 5678 90
Buchungstag Wert Vorgang Betrag
03.03. 03.03. Lastschrift Telekom -40,00
Alter Kontostand 1.234,56
Neuer Kontostand 1.194,56`;

const LOHN = `Muster Software GmbH
Verdienstabrechnung Februar 2026
Personalnummer 00042
Gesamtbrutto 3.500,00
Lohnsteuer 512,33
Rentenversicherung 325,50
Auszahlungsbetrag 2.281,17
Datum 27.02.2026`;

const SPENDE = `Tierschutzverein Musterstadt e.V.
Zuwendungsbestätigung
über Geldzuwendungen an eine gemeinnützige Körperschaft
Betrag der Zuwendung: 50,00 €
Tag der Zuwendung: 12.12.2025`;

const BRIEF = `Hans Beispiel
Am Hang 3
12345 Musterstadt

Musterstadt, den 01.09.2026

Sehr geehrte Frau Muster,
vielen Dank für Ihre Nachricht.
Mit freundlichen Grüßen`;

describe('classify', () => {
  it('erkennt eine Rechnung sicher', () => {
    const r = classify(RECHNUNG, { hasAmount: true });
    expect(r.type).toBe('rechnung');
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('erkennt einen Kassenbon, auch mit schmalem Layout', () => {
    expect(classify(KASSENBON).type).toBe('quittung');
    expect(classify(KASSENBON, { layout: 'fit' }).confidence).toBeGreaterThan(classify(KASSENBON).confidence);
  });

  it('erkennt Kontoauszug, Lohnabrechnung, Spende und Brief', () => {
    expect(classify(KONTOAUSZUG).type).toBe('kontoauszug');
    expect(classify(LOHN).type).toBe('lohnabrechnung');
    expect(classify(SPENDE).type).toBe('spendenquittung');
    expect(classify(BRIEF).type).toBe('brief');
  });

  it('toleriert OCR-Fehler wie "Rechnunq" und "Rechnungsnurnmer"', () => {
    const r = classify('Rechnunq\nRechnungsnurnmer 4711\nzahlbar bis 01.03.2026', { hasAmount: true });
    expect(r.type).toBe('rechnung');
  });

  it('fällt bei wenig Hinweisen auf "sonstiges" zurück und nennt den Kandidaten', () => {
    const r = classify('Irgendein Text mit IBAN');
    expect(r.type).toBe('sonstiges');
    expect(r.fallback).toBe(true);
    expect(r.runnerUp).toBe('rechnung');
  });

  it('zählt kurze Wörter nur als ganzes Wort', () => {
    expect(fuzzyPattern('bar', true).test('zahlbar bis')).toBe(false);
    expect(fuzzyPattern('bar', true).test('Gegeben BAR 10,00')).toBe(true);
  });
});

describe('extractDate', () => {
  it('nimmt das Datum nach "Rechnungsdatum", nicht den Leistungszeitraum', () => {
    expect(extractDate(RECHNUNG, NOW).date).toBe('2026-03-02');
  });

  it('nimmt "vom" und "den" als Hinweis', () => {
    expect(extractDate(KONTOAUSZUG, NOW).date).toBe('2026-03-31');
    expect(extractDate(BRIEF, NOW).date).toBe('2026-09-01');
  });

  it('versteht Monatsnamen und kurze Jahreszahlen', () => {
    expect(extractDate('Berlin, 3. Sept. 2026', NOW).date).toBe('2026-09-03');
    expect(extractDate('Datum: 15. März 2025', NOW).date).toBe('2025-03-15');
    expect(extractDate('Datum 05.01.24', NOW).date).toBe('2024-01-05');
  });

  it('ignoriert unplausible Daten (vor 2000, weit in der Zukunft, ungültig)', () => {
    expect(extractDate('geboren 01.01.1980', NOW).date).toBe(null);
    expect(extractDate('Datum 01.01.2030', NOW).date).toBe(null);
    expect(extractDate('Datum 31.02.2026', NOW).date).toBe(null);
  });

  it('verbindet kein Datum über einen Zeilenumbruch', () => {
    expect(extractDate('Pos 12.\n03.2026', NOW).date).toBe(null);
  });

  it('liefert die Fundstelle im Text', () => {
    const r = extractDate(RECHNUNG, NOW);
    expect(RECHNUNG.slice(r.span![0], r.span![1])).toBe('02.03.2026');
  });
});

describe('extractAmount', () => {
  it('bevorzugt "Rechnungsbetrag" vor Netto und MwSt', () => {
    const r = extractAmount(RECHNUNG);
    expect(r.cents).toBe(4000);
    expect(RECHNUNG.slice(r.span![0], r.span![1])).toBe('40,00');
  });

  it('nimmt beim Bon die Summe, nicht Gegeben/Rückgeld', () => {
    expect(extractAmount(KASSENBON).cents).toBe(567);
  });

  it('nimmt bei der Lohnabrechnung den Auszahlungsbetrag', () => {
    expect(extractAmount(LOHN).cents).toBe(228117);
  });

  it('liest Tausenderpunkte und Werte in der Folgezeile', () => {
    expect(extractAmount('Gesamtbetrag\n1.234,56 EUR').cents).toBe(123456);
  });

  it('verklebt keine Zahlen über Leerzeichen oder Zeilenumbrüche', () => {
    expect(extractAmount('Summe 3 119,00 EUR').cents).toBe(11900);
    expect(extractAmount('Gesamt Menge 3\n119,00').cents).toBe(11900); // nicht 311900
    expect(extractAmount('Gesamtbetrag 1.234,56 EUR').cents).toBe(123456);
  });

  it('nimmt Tabellenköpfe wie "Vorgang Betrag" nicht als Beschriftung', () => {
    expect(extractAmount('Buchungstag   Vorgang   Betrag\n03.07.2026 Lastschrift -79,14').cents).toBe(null);
  });

  it('fällt auf den größten €-Betrag zurück', () => {
    expect(extractAmount('Posten A 12,00 €\nPosten B 30,50 €\n19,00 %').cents).toBe(3050);
  });
});

describe('extractSender', () => {
  it('nimmt die Firma aus der Absenderzeile über dem Adressfeld', () => {
    expect(extractSender(RECHNUNG).sender).toBe('Deutsche Telekom GmbH');
  });

  it('nimmt beim Bon den Marktnamen, bei Vereinen das e.V.', () => {
    expect(extractSender(KASSENBON).sender).toBe('REWE Markt GmbH');
    expect(extractSender(SPENDE).sender).toBe('Tierschutzverein Musterstadt e.V.');
  });

  it('überspringt Empfänger, Straße, PLZ und Datum', () => {
    const r = extractSender('Herrn\nMax Mustermann\nMusterstraße 12\n12345 Musterstadt\nStadtwerke Musterstadt GmbH');
    expect(r.sender).toBe('Stadtwerke Musterstadt GmbH');
  });
});

describe('buildTitle', () => {
  it('baut Titel aus Typ, Absender und Monat', () => {
    expect(buildTitle('rechnung', 'BAUHAUS GmbH & Co. KG', '2026-03-02')).toBe('Rechnung Bauhaus');
    expect(buildTitle('kontoauszug', 'Sparkasse', '2026-03-31')).toBe('Kontoauszug Sparkasse März 2026');
    expect(buildTitle('lohnabrechnung', null, '2026-02-28')).toBe('Lohnabrechnung Februar 2026');
    expect(buildTitle('rechnung', null, '2026-03-02')).toBe('Rechnung 02.03.2026');
    expect(buildTitle('sonstiges', null, null)).toBe('');
  });

  it('kürzt Rechtsformen', () => {
    expect(shortSender('Deutsche Telekom GmbH')).toBe('Deutsche Telekom');
    expect(shortSender('Tierschutzverein Musterstadt e.V.')).toBe('Tierschutzverein Musterstadt');
  });
});

describe('detectDocument', () => {
  it('liefert alles in einem Schritt', () => {
    const d = detectDocument(RECHNUNG, null, NOW);
    expect(d.type).toBe('rechnung');
    expect(d.date).toBe('2026-03-02');
    expect(d.amountCents).toBe(4000);
    expect(d.title).toBe('Rechnung Deutsche Telekom');
  });

  it('Kontoauszug bekommt keinen Betrag', () => {
    const d = detectDocument(KONTOAUSZUG, null, NOW);
    expect(d.type).toBe('kontoauszug');
    expect(d.amountCents).toBe(null);
    expect(d.title).toBe('Kontoauszug Sparkasse Musterstadt März 2026');
  });

  it('Lohnabrechnung bekommt den Monat im Titel', () => {
    const d = detectDocument(LOHN, null, NOW);
    expect(d.type).toBe('lohnabrechnung');
    expect(d.title).toBe('Lohnabrechnung Muster Software Februar 2026');
  });
});
