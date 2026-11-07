/**
 * Cliente del servidor local (http://127.0.0.1:8765). Si la página se abre
 * sin servidor, las funciones de IA se desactivan con un aviso claro.
 */
let health = null;

async function req(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json", ...(opts.headers || {}) } : opts.headers,
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      detail = (await r.json()).detail || detail;
    } catch {}
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = r.status;
    throw err;
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.blob();
}

export const api = {
  async health(force = false) {
    if (health && !force) return health;
    if (window.ESA_DEMO) return (health = { ok: false, demo: true });
    try {
      health = await req("/api/health");
    } catch {
      health = { ok: false };
    }
    return health;
  },
  get cachedHealth() {
    return health || { ok: false };
  },
  uploadMedia(file, meta = {}, onProgress) {
    // XHR para poder mostrar progreso de subida (al servidor LOCAL, no a internet)
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", meta.title || "");
      fd.append("artist", meta.artist || "");
      const x = new XMLHttpRequest();
      x.open("POST", "/api/media");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        let body = {};
        try { body = JSON.parse(x.responseText); } catch {}
        x.status < 300 ? resolve(body) : reject(new Error(body.detail || `Error ${x.status}`));
      };
      x.onerror = () => reject(new Error("No se pudo contactar con el servidor local"));
      x.send(fd);
    });
  },
  listMedia: () => req("/api/media"),
  deleteMedia: (hash) => req(`/api/media/${hash}`, { method: "DELETE" }),
  transcribe: (body) => req("/api/transcribe", { method: "POST", body: JSON.stringify(body) }),
  job: (id) => req(`/api/jobs/${id}`),
  cancelJob: (id) => req(`/api/jobs/${id}`, { method: "DELETE" }),
  transcript: (hash) => req(`/api/transcripts/${hash}`),
  saveTranscript: (hash, segments) => req(`/api/transcripts/${hash}`, { method: "PUT", body: JSON.stringify({ segments }) }),
  translate: (texts, source = "en", target = "es") =>
    req("/api/translate", { method: "POST", body: JSON.stringify({ texts, source, target }) }),
  installPair: (source = "en", target = "es") =>
    req("/api/translate/install", { method: "POST", body: JSON.stringify({ source, target }) }),
  pronounce: (text) => req("/api/pronounce", { method: "POST", body: JSON.stringify({ text }) }),
  ttsUrl: (text, speed = 150) => `/api/tts?text=${encodeURIComponent(text)}&speed=${speed}`,
  verifyYouTube: (items) => req("/api/youtube/verify", { method: "POST", body: JSON.stringify({ items }) }),
  youtubeInfo: (url) => req(`/api/youtube/info?url=${encodeURIComponent(url)}`),
  auto: (body) => req("/api/auto", { method: "POST", body: JSON.stringify(body) }),
  storage: () => req("/api/storage"),
  setStorage: (data_dir) => req("/api/storage", { method: "PUT", body: JSON.stringify({ data_dir }) }),

  /** Espera a que termine un trabajo, informando del progreso. */
  async waitJob(id, onProgress, signal) {
    for (;;) {
      if (signal?.aborted) throw new Error("Cancelado");
      const j = await api.job(id);
      onProgress?.(j);
      if (j.status === "done") return j.result;
      if (j.status === "error" || j.status === "cancelled") throw new Error(j.error || "Proceso detenido");
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
};
