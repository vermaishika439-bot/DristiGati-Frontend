const DB_NAME = "dristigati-evidence";
const DB_VERSION = 1;
const STORE = "screenshots";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window))
      return reject(new Error("IndexedDB is unavailable in this browser"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error || new Error("Could not open local screenshot storage"),
      );
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result?.result ?? result);
    };
    tx.onerror = () => {
      const error = tx.error || new Error("Local screenshot storage failed");
      db.close();
      reject(error);
    };
    tx.onabort = () => {
      const error =
        tx.error || new Error("Local screenshot storage was interrupted");
      db.close();
      reject(error);
    };
  });
}

export async function listEvidence() {
  const result = await withStore("readonly", (store) => store.getAll());
  return (result || []).sort((a, b) =>
    (b.capturedAt || "").localeCompare(a.capturedAt || ""),
  );
}

export async function saveEvidence(record) {
  await withStore("readwrite", (store) => store.put(record));
  return record;
}

export async function deleteEvidence(id) {
  await withStore("readwrite", (store) => store.delete(id));
}
