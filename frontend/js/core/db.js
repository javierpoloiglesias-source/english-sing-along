/**
 * Almacenamiento local con IndexedDB (sin cuenta, sin servidor externo).
 * Los datos sobreviven al cerrar el navegador.
 */
const DB_NAME = "english-sing-along";
const DB_VERSION = 1;
const STORES = {
  kv: { keyPath: "key" },
  favorites: { keyPath: "songId" },
  playlists: { keyPath: "id" },
  history: { keyPath: "id", autoIncrement: true },
  subtitles: { keyPath: "songId" },
  vocab: { keyPath: "word" },
  phrases: { keyPath: "id" },
  songs: { keyPath: "id" }, // canciones propias: archivos locales y vídeos de YouTube añadidos
};

let dbPromise = null;

/** Si el navegador no deja usar IndexedDB, los datos se guardan solo en memoria. */
function memoryDB() {
  const data = Object.fromEntries(Object.keys(STORES).map((n) => [n, new Map()]));
  let auto = 1;
  const store = (name) => {
    const m = data[name];
    const key = (v) => {
      const kp = STORES[name].keyPath;
      if (v[kp] == null && STORES[name].autoIncrement) v[kp] = auto++;
      return v[kp];
    };
    const done = (result) => {
      const r = { result };
      setTimeout(() => r.onsuccess?.());
      return r;
    };
    return {
      get: (k) => done(m.get(k)),
      getAll: () => done([...m.values()]),
      put: (v) => done(m.set(key(v), structuredClone(v)) && key(v)),
      delete: (k) => done(m.delete(k)),
      clear: () => done(m.clear()),
    };
  };
  return {
    memory: true,
    transaction(name) {
      const t = { objectStore: () => store(name) };
      setTimeout(() => setTimeout(() => t.oncomplete?.()));
      return t;
    },
  };
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(memoryDB());
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, opts);
          if (name === "history") s.createIndex("playedAt", "playedAt");
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(memoryDB());
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && "onsuccess" in r) r.onsuccess = () => (result = r.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const idb = {
  get: (store, key) => tx(store, "readonly", (s) => s.get(key)),
  all: (store) => tx(store, "readonly", (s) => s.getAll()),
  put: (store, value) => tx(store, "readwrite", (s) => s.put(value)),
  del: (store, key) => tx(store, "readwrite", (s) => s.delete(key)),
  clear: (store) => tx(store, "readwrite", (s) => s.clear()),
  async getKV(key, fallback = null) {
    const r = await idb.get("kv", key);
    return r ? r.value : fallback;
  },
  setKV: (key, value) => idb.put("kv", { key, value }),
};

/** Exporta todo a un objeto JSON (copia de seguridad). */
export async function exportAll() {
  const out = { app: "english-sing-along", version: DB_VERSION, exportedAt: new Date().toISOString() };
  for (const name of Object.keys(STORES)) out[name] = await idb.all(name);
  return out;
}

export async function importAll(data) {
  if (!data || data.app !== "english-sing-along") throw new Error("Archivo de copia no válido");
  for (const name of Object.keys(STORES)) {
    if (!Array.isArray(data[name])) continue;
    for (const item of data[name]) await idb.put(name, item);
  }
}

export async function wipeAll() {
  for (const name of Object.keys(STORES)) await idb.clear(name);
}

export const STORE_NAMES = Object.keys(STORES);
