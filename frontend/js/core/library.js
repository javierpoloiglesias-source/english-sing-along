/**
 * Biblioteca: catálogo + canciones propias, favoritos, listas e historial.
 * Todo se guarda automáticamente en IndexedDB.
 */
import { CATALOG } from "../data/catalog.js";
import { idb } from "./db.js";
import { bus } from "./bus.js";
import { uid, coverSVG } from "./utils.js";
import { api } from "./api.js";

const songs = new Map(CATALOG.map((s) => [s.id, s]));
let favorites = new Map();
let playlists = [];
let ytStatus = {}; // id canción -> {state: verified|mismatch|unavailable, title}
let durations = {};

export const library = {
  async init() {
    for (const s of await idb.all("songs")) songs.set(s.id, s);
    favorites = new Map((await idb.all("favorites")).map((f) => [f.songId, f]));
    playlists = (await idb.all("playlists")).sort((a, b) => a.createdAt - b.createdAt);
    ytStatus = await idb.getKV("ytStatus", {});
    durations = await idb.getKV("durations", {});
  },

  // ---- canciones -------------------------------------------------------
  get: (id) => songs.get(id),
  catalog: () => CATALOG,
  custom: () => [...songs.values()].filter((s) => s.source !== "catalog"),
  all: () => [...songs.values()],
  async addSong(song) {
    songs.set(song.id, song);
    await idb.put("songs", song);
    bus.emit("library", { type: "song", id: song.id });
    return song;
  },
  async updateSong(id, patch) {
    const s = songs.get(id);
    if (!s) return;
    Object.assign(s, patch);
    if (s.source !== "catalog") await idb.put("songs", s);
    else {
      // datos del usuario sobre una canción del catálogo (archivo vinculado, vídeo elegido)
      const links = await idb.getKV("catalogLinks", {});
      links[id] = { ...(links[id] || {}), ...patch };
      await idb.setKV("catalogLinks", links);
    }
    bus.emit("library", { type: "song", id });
  },
  async loadCatalogLinks() {
    const links = await idb.getKV("catalogLinks", {});
    for (const [id, patch] of Object.entries(links)) if (songs.has(id)) Object.assign(songs.get(id), patch);
  },
  async removeSong(id) {
    const s = songs.get(id);
    if (!s || s.source === "catalog") return;
    songs.delete(id);
    await idb.del("songs", id);
    await idb.del("subtitles", id);
    if (favorites.has(id)) await library.toggleFavorite(id);
    for (const p of playlists) if (p.songIds.includes(id)) await library.removeFromPlaylist(p.id, id);
    bus.emit("library", { type: "song", id });
  },

  /** Vídeo de YouTube utilizable (verificado o elegido por el usuario). */
  youtubeId(song) {
    if (!song) return null;
    if (song.userYt) return song.userYt;
    if (song.source === "youtube") return song.yt;
    if (song.autoYt) return song.autoYt;
    const st = ytStatus[song.id];
    if (song.ytCandidate && st?.state === "verified") return song.ytCandidate;
    return null;
  },
  ytState: (song) => (song.userYt || song.autoYt || song.source === "youtube" ? "verified" : ytStatus[song.id]?.state || (song.ytCandidate ? "pending" : "none")),
  cover(song) {
    if (song.cover) return song.cover;
    const yt = library.youtubeId(song);
    if (yt) return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
    return coverSVG(song.title, song.artist);
  },
  fallbackCover: (song) => coverSVG(song.title, song.artist),

  /** Comprueba los IDs candidatos del catálogo en el PC del usuario. */
  async verifyCatalog({ force = false } = {}) {
    const h = await api.health();
    if (!h.ok) return { skipped: "sin servidor" };
    const pending = CATALOG.filter((s) => s.ytCandidate && (force || !ytStatus[s.id] || ytStatus[s.id].state === "offline"));
    if (!pending.length) return { checked: 0 };
    let checked = 0;
    for (let i = 0; i < pending.length; i += 20) {
      const batch = pending.slice(i, i + 20);
      try {
        const { results } = await api.verifyYouTube(batch.map((s) => ({ id: s.ytCandidate, title: s.title, artist: s.artist })));
        results.forEach((r, j) => {
          const s = batch[j];
          ytStatus[s.id] = {
            state: r.ok ? (r.matches ? "verified" : "mismatch") : r.reason?.includes("conexión") ? "offline" : "unavailable",
            title: r.video_title || null,
            checkedAt: Date.now(),
          };
        });
        checked += batch.length;
      } catch {
        break;
      }
    }
    await idb.setKV("ytStatus", ytStatus);
    bus.emit("library", { type: "yt" });
    return { checked };
  },
  ytSummary() {
    const c = { verified: 0, mismatch: 0, unavailable: 0, pending: 0, offline: 0 };
    for (const s of CATALOG) if (s.ytCandidate) c[ytStatus[s.id]?.state || "pending"]++;
    return c;
  },

  duration: (id) => durations[id],
  async setDuration(id, d) {
    if (!d || !isFinite(d) || Math.abs((durations[id] || 0) - d) < 1) return;
    durations[id] = Math.round(d);
    await idb.setKV("durations", durations);
  },

  // ---- favoritos -------------------------------------------------------
  isFavorite: (id) => favorites.has(id),
  favorites: () => [...favorites.values()].sort((a, b) => b.addedAt - a.addedAt).map((f) => songs.get(f.songId)).filter(Boolean),
  async toggleFavorite(id) {
    if (favorites.has(id)) {
      favorites.delete(id);
      await idb.del("favorites", id);
    } else {
      const f = { songId: id, addedAt: Date.now() };
      favorites.set(id, f);
      await idb.put("favorites", f);
    }
    bus.emit("favorites", { id, value: favorites.has(id) });
    return favorites.has(id);
  },

  // ---- listas ----------------------------------------------------------
  playlists: () => playlists,
  playlist: (id) => playlists.find((p) => p.id === id),
  async createPlaylist(name) {
    const p = { id: uid(), name: name.trim() || "Nueva lista", songIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    playlists.push(p);
    await idb.put("playlists", p);
    bus.emit("playlists", { id: p.id });
    return p;
  },
  async savePlaylist(p) {
    p.updatedAt = Date.now();
    await idb.put("playlists", p);
    bus.emit("playlists", { id: p.id });
  },
  async renamePlaylist(id, name) {
    const p = library.playlist(id);
    if (!p || !name.trim()) return;
    p.name = name.trim();
    await library.savePlaylist(p);
  },
  async deletePlaylist(id) {
    playlists = playlists.filter((p) => p.id !== id);
    await idb.del("playlists", id);
    bus.emit("playlists", { id });
  },
  async addToPlaylist(id, songId) {
    const p = library.playlist(id);
    if (!p || p.songIds.includes(songId)) return false;
    p.songIds.push(songId);
    await library.savePlaylist(p);
    return true;
  },
  async removeFromPlaylist(id, songId) {
    const p = library.playlist(id);
    if (!p) return;
    p.songIds = p.songIds.filter((s) => s !== songId);
    await library.savePlaylist(p);
  },
  async movePlaylistSong(id, from, to) {
    const p = library.playlist(id);
    if (!p || to < 0 || to >= p.songIds.length) return;
    const [x] = p.songIds.splice(from, 1);
    p.songIds.splice(to, 0, x);
    await library.savePlaylist(p);
  },

  // ---- historial -------------------------------------------------------
  async addHistory(songId) {
    const all = await idb.all("history");
    const last = all[all.length - 1];
    if (last && last.songId === songId && Date.now() - last.playedAt < 60_000) return;
    await idb.put("history", { songId, playedAt: Date.now() });
    if (all.length > 500) for (const h of all.slice(0, all.length - 500)) await idb.del("history", h.id);
    bus.emit("history", { songId });
  },
  async history() {
    return (await idb.all("history")).sort((a, b) => b.playedAt - a.playedAt);
  },
  async recent(n = 12) {
    const seen = new Set();
    const out = [];
    for (const h of await library.history()) {
      if (seen.has(h.songId) || !songs.has(h.songId)) continue;
      seen.add(h.songId);
      out.push(songs.get(h.songId));
      if (out.length >= n) break;
    }
    return out;
  },
  async clearHistory() {
    await idb.clear("history");
    bus.emit("history", {});
  },
  async deleteHistoryEntry(id) {
    await idb.del("history", id);
    bus.emit("history", {});
  },
};
