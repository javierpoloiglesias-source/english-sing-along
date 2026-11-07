/** Subtítulos por canción guardados en IndexedDB (y en SQLite si vienen de Whisper). */
import { idb } from "../core/db.js";
import { bus } from "../core/bus.js";

export const subtitleStore = {
  async get(songId) {
    return idb.get("subtitles", songId);
  },
  async save(songId, data, { silent = false } = {}) {
    const rec = { songId, offset: 0, ...data, updatedAt: Date.now() };
    rec.segments = (rec.segments || []).map(clean);
    await idb.put("subtitles", rec);
    if (!silent) bus.emit("subtitles:changed", { songId });
    return rec;
  },
  async remove(songId) {
    await idb.del("subtitles", songId);
    bus.emit("subtitles:changed", { songId });
  },
  async list() {
    return idb.all("subtitles");
  },
};

function clean(s) {
  const o = {
    start: s.start == null ? null : Math.round(Number(s.start) * 1000) / 1000,
    end: s.end == null ? null : Math.round(Number(s.end) * 1000) / 1000,
    text: String(s.text || "").trim(),
    translation: String(s.translation || "").trim(),
  };
  if (Array.isArray(s.words) && s.words.length) o.words = s.words;
  if (s.pron) o.pron = s.pron;
  if (s.ipa) o.ipa = s.ipa;
  return o;
}

/** Índice de la frase que suena en `t` (búsqueda binaria). -1 si ninguna. */
export function findIndex(segs, t) {
  let lo = 0, hi = segs.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (ans >= 0 && t > segs[ans].end + 0.15) {
    // entre frases: se mantiene la anterior resaltada hasta 1,5 s
    return t - segs[ans].end < 1.5 ? ans : -1;
  }
  return ans;
}

export function timedSegments(rec) {
  return (rec?.segments || []).filter((s) => s.start != null && s.end != null).sort((a, b) => a.start - b.start);
}
