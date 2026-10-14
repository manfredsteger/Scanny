/**
 * Antwort als JSON lesen – auch wenn der Server (z. B. bei zu großen Uploads) eine HTML-Fehlerseite
 * liefert. Dann kommt { error: "<Statusmeldung>" } zurück statt "Unexpected token '<'".
 */
export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: res.ok ? 'Unerwartete Antwort vom Server.' : `Serverfehler ${res.status} (${res.statusText || 'unbekannt'})` };
  }
}

/** Übersprungene Dateien aus /tools/prepare-session als lesbarer Hinweis. */
export function skippedNotice(skipped: { name: string; reason: string }[] | undefined): string | null {
  if (!skipped || skipped.length === 0) return null;
  return `Nicht übernommen: ${skipped.map((s) => `${s.name} – ${s.reason}`).join(' · ')}`;
}
