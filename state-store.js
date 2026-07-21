(function exposeStateStore(globalScope) {
  "use strict";

  const DATABASE_NAME = "mojihokori-exhibition";
  const STORE_NAME = "daily-state";
  const DATABASE_VERSION = 1;

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  class DailyStateStore {
    constructor(indexedDB = globalScope.indexedDB) {
      this.indexedDB = indexedDB;
      this.databasePromise = null;
    }

    async open() {
      if (!this.indexedDB) {
        throw new Error("IndexedDB is not available");
      }
      if (!this.databasePromise) {
        this.databasePromise = new Promise((resolve, reject) => {
          const request = this.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
          request.addEventListener("upgradeneeded", () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
              database.createObjectStore(STORE_NAME, { keyPath: "dateKey" });
            }
          });
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
      }
      return this.databasePromise;
    }

    async load(dateKey = localDateKey()) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(dateKey);
        request.addEventListener("success", () => resolve(request.result || null));
        request.addEventListener("error", () => reject(request.error));
      });
    }

    async save(state, dateKey = localDateKey()) {
      const database = await this.open();
      const record = { ...state, dateKey, savedAt: Date.now() };
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(record);
        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("abort", () => reject(transaction.error));
        transaction.addEventListener("error", () => reject(transaction.error));
      });
      return record;
    }

    async clear(dateKey = localDateKey()) {
      const database = await this.open();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(dateKey);
        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("abort", () => reject(transaction.error));
        transaction.addEventListener("error", () => reject(transaction.error));
      });
    }

    async pruneExcept(dateKey = localDateKey()) {
      const database = await this.open();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor();
        request.addEventListener("success", () => {
          const cursor = request.result;
          if (!cursor) {
            return;
          }
          if (cursor.key !== dateKey) {
            cursor.delete();
          }
          cursor.continue();
        });
        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("abort", () => reject(transaction.error));
        transaction.addEventListener("error", () => reject(transaction.error));
      });
    }
  }

  const api = { DailyStateStore, localDateKey };
  globalScope.MojihokoriState = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
