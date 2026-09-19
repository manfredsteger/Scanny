import { getDb } from '../db.js';
import { processDocument } from './processDocument.js';

export { processDocument };

class DocumentQueue {
  private queue: number[] = [];
  private isProcessing = false;
  private enqueuedSet = new Set<number>();

  enqueue(id: number): void {
    if (this.enqueuedSet.has(id)) {
      return;
    }
    this.enqueuedSet.add(id);
    this.queue.push(id);
    // Asynchron anstoßen
    setTimeout(() => {
      this.processNext();
    }, 0);
  }

  get length(): number {
    return this.queue.length;
  }

  get busy(): boolean {
    return this.isProcessing;
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const docId = this.queue.shift()!;
    this.enqueuedSet.delete(docId);

    try {
      await processDocument(docId);
    } catch (err) {
      console.error(`[Queue] Unerwarteter Ausnahmefehler bei Dokument ${docId}:`, err);
    } finally {
      this.isProcessing = false;
      // Nächsten Auftrag mit kleiner Verzögerung starten
      setTimeout(() => {
        this.processNext();
      }, 50);
    }
  }
}

export const documentQueue = new DocumentQueue();

// Beim Serverstart aufrufen: Alle Dokumente mit status 'queued' oder 'processing' wieder einreihen
export function initQueue(): void {
  const db = getDb();
  const pending = db
    .prepare(`
      SELECT id, original_name, status
      FROM documents
      WHERE status IN ('queued', 'processing')
      ORDER BY id ASC
    `)
    .all() as { id: number; original_name: string; status: string }[];

  if (pending.length > 0) {
    console.log(`[Queue] Starte Wiederaufnahme von ${pending.length} noch nicht abgeschlossenen Dokumenten...`);
    for (const doc of pending) {
      // 'processing' auf 'queued' zurücksetzen für saubere Neuverarbeitung
      if (doc.status === 'processing') {
        db.prepare(`
          UPDATE documents
          SET status = 'queued',
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE id = ?
        `).run(doc.id);
      }
      documentQueue.enqueue(doc.id);
    }
  }
}
