/**
 * Stichwort-Konfiguration für die Dokumenttyp-Erkennung (classify.ts).
 *
 * Erweitern: einfach Einträge ergänzen. Jedes Stichwort zählt pro Dokument einmal
 * mit seinem Gewicht. Schreibweise wie im Dokument (Groß/klein egal); typische
 * OCR-Verwechslungen (g/q, l/1/I, o/0, ü/u, m/rn …) werden automatisch toleriert.
 *   word:  Stichwort oder kurze Wortfolge (Leerzeichen/Bindestriche flexibel)
 *   weight: Punkte, wenn gefunden
 *   whole: nur als ganzes Wort (für kurze Wörter wie "bar", "TSE", damit "zahlbar"
 *          nicht als "bar" zählt)
 */

export interface KeywordRule {
  word: string;
  weight: number;
  whole?: boolean;
}

export interface TypeRule {
  keywords: KeywordRule[];
  /** Zusatzpunkte, wenn ein Betrag gefunden wurde */
  amountBonus?: number;
  /** Zusatzpunkte, wenn scan.py einen schmalen Beleg erkannt hat (layout "fit") */
  narrowBonus?: number;
}

export const CLASSIFY_RULES: Record<string, TypeRule> = {
  rechnung: {
    amountBonus: 1,
    keywords: [
      { word: 'Rechnung', weight: 2 },
      { word: 'Rechnungsnummer', weight: 3 },
      { word: 'Rechnungs-Nr', weight: 3 },
      { word: 'Rechnung Nr', weight: 3 },
      { word: 'Rechnungsdatum', weight: 2 },
      { word: 'Leistungsdatum', weight: 2 },
      { word: 'Leistungszeitraum', weight: 2 },
      { word: 'USt-IdNr', weight: 1.5 },
      { word: 'USt-ID', weight: 1.5 },
      { word: 'zahlbar bis', weight: 2 },
      { word: 'zahlbar innerhalb', weight: 2 },
      { word: 'Zahlungsziel', weight: 2 },
      { word: 'Kundennummer', weight: 1 },
      { word: 'Nettobetrag', weight: 1 },
      { word: 'zzgl', weight: 1, whole: true },
      { word: 'IBAN', weight: 0.5, whole: true },
    ],
  },
  quittung: {
    narrowBonus: 2,
    keywords: [
      { word: 'Kassenbon', weight: 3 },
      { word: 'Kassenbeleg', weight: 3 },
      { word: 'Bon-Nr', weight: 3 },
      { word: 'Bonnummer', weight: 3 },
      { word: 'Beleg-Nr', weight: 1.5 },
      { word: 'Quittung', weight: 2.5, whole: true },
      { word: 'bar', weight: 1, whole: true },
      { word: 'Bargeld', weight: 1 },
      { word: 'EC-Karte', weight: 2 },
      { word: 'girocard', weight: 2 },
      { word: 'Kartenzahlung', weight: 2 },
      { word: 'Rückgeld', weight: 2.5 },
      { word: 'Gegeben', weight: 1.5, whole: true },
      { word: 'MwSt', weight: 0.5, whole: true },
      { word: 'Summe', weight: 1, whole: true },
      { word: 'TSE', weight: 2, whole: true },
      { word: 'Kasse', weight: 1, whole: true },
    ],
  },
  kontoauszug: {
    keywords: [
      { word: 'Kontoauszug', weight: 4 },
      { word: 'Alter Kontostand', weight: 3 },
      { word: 'Neuer Kontostand', weight: 3 },
      { word: 'Buchungstag', weight: 2 },
      { word: 'Kontostand', weight: 1.5 },
      { word: 'Auszug Nr', weight: 1.5 },
      { word: 'Wertstellung', weight: 1 },
      { word: 'Valuta', weight: 1, whole: true },
    ],
  },
  vertrag: {
    keywords: [
      { word: 'Vertrag', weight: 2, whole: true },
      { word: 'Vertragsnummer', weight: 3 },
      { word: 'Vertragsbeginn', weight: 2 },
      { word: 'Vertragspartner', weight: 2 },
      { word: 'Laufzeit', weight: 1.5 },
      { word: 'Kündigung', weight: 1.5 },
      { word: 'Kündigungsfrist', weight: 1 },
      { word: 'Unterschrift', weight: 1 },
    ],
  },
  bescheid: {
    keywords: [
      { word: 'Bescheid', weight: 3 },
      { word: 'Steuerbescheid', weight: 2 },
      { word: 'Finanzamt', weight: 3 },
      { word: 'Steuernummer', weight: 1.5 },
      { word: 'Festsetzung', weight: 2 },
      { word: 'festgesetzt', weight: 2 },
      { word: 'Rechtsbehelf', weight: 2.5 },
      { word: 'Einspruch', weight: 1 },
      { word: 'Einkommensteuer', weight: 1.5 },
    ],
  },
  lohnabrechnung: {
    keywords: [
      { word: 'Verdienstabrechnung', weight: 4 },
      { word: 'Entgeltabrechnung', weight: 4 },
      { word: 'Gehaltsabrechnung', weight: 4 },
      { word: 'Lohnabrechnung', weight: 4 },
      { word: 'Brutto', weight: 1, whole: true },
      { word: 'Netto', weight: 1, whole: true },
      { word: 'Lohnsteuer', weight: 2 },
      { word: 'Sozialversicherung', weight: 1.5 },
      { word: 'Rentenversicherung', weight: 1 },
      { word: 'Arbeitslosenversicherung', weight: 1 },
      { word: 'Auszahlungsbetrag', weight: 2 },
      { word: 'Personalnummer', weight: 1.5 },
    ],
  },
  spendenquittung: {
    keywords: [
      { word: 'Zuwendungsbestätigung', weight: 5 },
      { word: 'Spendenbescheinigung', weight: 4 },
      { word: 'Spendenquittung', weight: 4 },
      { word: 'Spende', weight: 2.5, whole: true },
      { word: 'gemeinnützig', weight: 2 },
      { word: 'steuerbegünstigt', weight: 1.5 },
    ],
  },
  versicherung: {
    keywords: [
      { word: 'Versicherungsschein', weight: 4 },
      { word: 'Police', weight: 2.5, whole: true },
      { word: 'Policennummer', weight: 2.5 },
      { word: 'Versicherungsnummer', weight: 2.5 },
      { word: 'Versicherungsnehmer', weight: 2.5 },
      { word: 'Beitragsrechnung', weight: 1.5 },
      { word: 'Beitrag', weight: 1, whole: true },
      { word: 'Versicherung', weight: 1, whole: true },
    ],
  },
  brief: {
    keywords: [
      { word: 'Sehr geehrte', weight: 1.5 },
      { word: 'Mit freundlichen Grüßen', weight: 1.5 },
    ],
  },
};
