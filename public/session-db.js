const DB_NAME = "ai-workspace";
const DB_VERSION = 1;
const STORE_NAME = "transcripts";

interface StoredTranscript {
  sessionId: string;
  messages[];
  updatedAt: number;
}

function openDatabase() {
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

export async function saveSessionMessages(sessionId: string, messages[]) {
  if (!messages.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ sessionId, messages: messages.slice(-100), updatedAt: Date.now() } );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save transcript."));
  });
  db.close();
}

export async function getSessionMessages(sessionId: string): Promise {
  const db = await openDatabase();
  const result = await new Promise<StoredTranscript | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read transcript."));
  });
  db.close();
  return result?.messages ?? [];
}
