/** Vocabulario guardado y frases marcadas (difíciles / guardadas). */
import { idb } from "../core/db.js";
import { bus } from "../core/bus.js";
import { api } from "../core/api.js";

export const vocab = {
  async list() {
    return (await idb.all("vocab")).sort((a, b) => b.addedAt - a.addedAt);
  },
  async get(word) {
    return idb.get("vocab", word.toLowerCase());
  },
  async add({ word, translation = "", context = "", songId = null, ipa = "", approx = "" }) {
    const w = word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/gi, "");
    if (!w) return null;
    const old = await idb.get("vocab", w);
    const rec = { word: w, translation, context, songId, ipa, approx, learned: false, reviews: 0, addedAt: Date.now(), ...(old || {}) };
    if (translation && !old?.translation) rec.translation = translation;
    await idb.put("vocab", rec);
    bus.emit("vocab", { word: w });
    if (!rec.translation && api.cachedHealth.argos) {
      // la traducción se completa después, sin retrasar el guardado
      api.translate([w]).then(({ translations }) => translations[0] && vocab.update(w, { translation: translations[0] })).catch(() => {});
    }
    return rec;
  },
  async update(word, patch) {
    const rec = await idb.get("vocab", word);
    if (!rec) return;
    Object.assign(rec, patch);
    await idb.put("vocab", rec);
    bus.emit("vocab", { word });
  },
  async remove(word) {
    await idb.del("vocab", word);
    bus.emit("vocab", { word });
  },
};

export const phrases = {
  key: (songId, seg) => `${songId}@${Number(seg.start ?? 0).toFixed(2)}`,
  async list() {
    return (await idb.all("phrases")).sort((a, b) => b.addedAt - a.addedAt);
  },
  async get(songId, seg) {
    return idb.get("phrases", phrases.key(songId, seg));
  },
  async toggle(songId, seg, flag = "difficult") {
    const id = phrases.key(songId, seg);
    const old = await idb.get("phrases", id);
    const rec = old || { id, songId, start: seg.start, end: seg.end, text: seg.text, translation: seg.translation || "", addedAt: Date.now(), difficult: false, saved: false, practiced: 0 };
    rec[flag] = !rec[flag];
    if (!rec.difficult && !rec.saved) await idb.del("phrases", id);
    else await idb.put("phrases", rec);
    bus.emit("phrases", { id });
    return rec[flag];
  },
  async practiced(id) {
    const rec = await idb.get("phrases", id);
    if (!rec) return;
    rec.practiced = (rec.practiced || 0) + 1;
    rec.lastPracticed = Date.now();
    await idb.put("phrases", rec);
  },
  async remove(id) {
    await idb.del("phrases", id);
    bus.emit("phrases", { id });
  },
};
