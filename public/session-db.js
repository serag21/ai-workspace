const DB_NAME = "ai-workspace";
const DB_VERSION = 1;
const STORE_NAME = "transcripts";

const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 15000;
const MAX_TRANSCRIPT_CHARS = 400000;

function boundMessages(messages) {
  const recent = messages.slice(-MAX_MESSAGES);
  const bounded = [];
  let totalChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const remaining = MAX_TRANSCRIPT_CHARS - totalChars;
    if (remaining <= 0) break;

    const limit = Math.min(MAX_MESSAGE_CHARS, remaining);
    const marker = " …[message truncated]";
    const text = message.text.length <= limit
      ? message.text
      : limit > marker.length
        ? message.text.slice(0, limit - marker.length) + marker
        : message.text.slice(0, limit);
    bounded.unshift({ ...message, text });
    totalChars += text.length;
  }

  return bounded;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local session database."));
  });
}

export async function saveSessionMessages(sessionId, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return;

  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        sessionId,
        messages: boundMessages(messages),
        updatedAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save transcript."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Transcript save was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function getSessionMessages(sessionId) {
  const db = await openDatabase();
  try {
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read transcript."));
    });
    return result?.messages ?? [];
  } finally {
    db.close();
  }
}
