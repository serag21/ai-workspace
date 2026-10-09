import type { SessionMessage } from "./types";

const DB_NAME = "ai-workspace";
const DB_VERSION = 1;
const STORE_NAME = "transcripts";

interface StoredTranscript {
  sessionId: string;
  messages: SessionMessage[];
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local session database."));
  });
}

export async function saveSessionMessages(sessionId: string, messages: SessionMessage[]): Promise<void> {
  if (!messages.length) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ sessionId, messages: messages.slice(-100), updatedAt: Date.now() } satisfies StoredTranscript);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save transcript."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Transcript save was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const db = await openDatabase();
  try {
    const result = await new Promise<StoredTranscript | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read transcript."));
    });
    return result?.messages ?? [];
  } finally {
    db.close();
  }
}

/**
 * Search locally cached transcript text without loading the entire conversation
 * library into memory. This runs only when the user enters a search term.
 */
export async function searchSessionIds(query: string): Promise<string[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 3) return [];

  const db = await openDatabase();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const matches: string[] = [];
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();

      request.onerror = () => reject(request.error ?? new Error("Could not search cached transcripts."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(matches);
          return;
        }

        const transcript = cursor.value as StoredTranscript;
        const found = transcript.messages?.some((message) => message.text.toLocaleLowerCase().includes(needle));
        if (found) matches.push(transcript.sessionId);
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }
}


/**
 * Re-key a transcript when a provider replaces a temporary draft URL with its
 * canonical conversation URL. Prefer the more complete/newer cached snapshot.
 */
export async function migrateSessionMessages(fromSessionId: string, toSessionId: string): Promise<void> {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return;

  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const fromRequest = store.get(fromSessionId);
      const toRequest = store.get(toSessionId);
      let sourceReady = false;
      let targetReady = false;
      let applied = false;

      const apply = () => {
        if (!sourceReady || !targetReady || applied) return;
        applied = true;

        const source = fromRequest.result as StoredTranscript | undefined;
        const target = toRequest.result as StoredTranscript | undefined;
        if (!source) return;

        const useSource = !target ||
          source.messages.length > target.messages.length ||
          (source.messages.length === target.messages.length && source.updatedAt > target.updatedAt);
        const chosen = useSource ? source : target!;
        store.put({
          sessionId: toSessionId,
          messages: chosen.messages.slice(-100),
          updatedAt: Date.now(),
        } satisfies StoredTranscript);
        store.delete(fromSessionId);
      };

      fromRequest.onsuccess = () => {
        sourceReady = true;
        apply();
      };
      toRequest.onsuccess = () => {
        targetReady = true;
        apply();
      };
      fromRequest.onerror = () => reject(fromRequest.error ?? new Error("Could not read draft transcript."));
      toRequest.onerror = () => reject(toRequest.error ?? new Error("Could not read destination transcript."));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not migrate transcript."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Transcript migration was aborted."));
    });
  } finally {
    db.close();
  }
}
