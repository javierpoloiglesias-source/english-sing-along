/** Buscador instantáneo sobre el catálogo y las canciones propias. */
import { library } from "./library.js";
import { idb } from "./db.js";
import { normalize } from "./utils.js";

function score(hay, q, words) {
  if (!hay) return 0;
  if (hay === q) return 100;
  if (hay.startsWith(q)) return 80;
  if (hay.includes(` ${q}`)) return 65;
  if (hay.includes(q)) return 50;
  // todas las palabras presentes
  if (words.length > 1 && words.every((w) => hay.includes(w))) return 40;
  // tolerancia a una letra mal escrita en palabras de 4+ letras
  if (q.length >= 4 && hay.split(" ").some((h) => near(h, q))) return 25;
  return 0;
}

function near(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

export function artistsIndex() {
  const map = new Map();
  for (const s of library.all()) {
    for (const a of s.artists || [s.artist]) {
      const key = normalize(a);
      if (!map.has(key)) map.set(key, { name: a, key, songs: [], genres: new Set() });
      const e = map.get(key);
      e.songs.push(s);
      e.genres.add(s.genre);
    }
  }
  return [...map.values()].sort((a, b) => b.songs.length - a.songs.length || a.name.localeCompare(b.name));
}

export function genresIndex() {
  const map = new Map();
  for (const s of library.all()) {
    if (!s.genre) continue;
    if (!map.has(s.genre)) map.set(s.genre, []);
    map.get(s.genre).push(s);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, songs]) => ({ name, songs }));
}

export function albumsIndex() {
  const map = new Map();
  for (const s of library.all()) {
    if (!s.album) continue;
    const k = `${s.album}|${s.artists?.[0] || s.artist}`;
    if (!map.has(k)) map.set(k, { name: s.album, artist: s.artists?.[0] || s.artist, songs: [] });
    map.get(k).songs.push(s);
  }
  return [...map.values()];
}

/** filters: {type: all|songs|artists|albums|genres, level, genre} */
export function search(query, filters = {}) {
  const q = normalize(query);
  const words = q.split(" ").filter(Boolean);
  const res = { songs: [], artists: [], albums: [], genres: [] };
  const lvl = filters.level ? Number(filters.level) : 0;
  const okSong = (s) => (!lvl || s.level === lvl) && (!filters.genre || s.genre === filters.genre);
  if (!q) return res;

  for (const s of library.all()) {
    if (!okSong(s)) continue;
    const sc = Math.max(
      score(normalize(s.title), q, words) * 1.2,
      score(normalize(s.artist), q, words),
      score(normalize(`${s.artist} ${s.title}`), q, words),
      score(normalize(`${s.title} ${s.artist}`), q, words),
      score(normalize(s.album), q, words) * 0.6,
      score(normalize(s.genre), q, words) * 0.5,
    );
    if (sc > 0) res.songs.push({ item: s, sc: sc + (101 - (s.rank || 101)) / 200 });
  }
  for (const a of artistsIndex()) {
    const sc = score(a.key, q, words);
    if (sc > 0) res.artists.push({ item: a, sc });
  }
  for (const al of albumsIndex()) {
    const sc = score(normalize(al.name), q, words);
    if (sc > 0) res.albums.push({ item: al, sc });
  }
  for (const g of genresIndex()) {
    const sc = score(normalize(g.name), q, words);
    if (sc > 0) res.genres.push({ item: g, sc });
  }
  for (const k of Object.keys(res)) res[k] = res[k].sort((a, b) => b.sc - a.sc).map((x) => x.item);
  return res;
}

/** Sugerencias de autocompletado (títulos y artistas). */
export function suggestions(query, n = 6) {
  const q = normalize(query);
  if (!q) return [];
  const out = new Set();
  for (const a of artistsIndex()) if (a.key.startsWith(q) || a.key.includes(` ${q}`)) out.add(a.name);
  for (const s of library.all()) if (normalize(s.title).startsWith(q)) out.add(s.title);
  return [...out].slice(0, n);
}

export function relatedArtists(artistName, n = 6) {
  const idx = artistsIndex();
  const me = idx.find((a) => a.key === normalize(artistName));
  if (!me) return [];
  return idx
    .filter((a) => a.key !== me.key)
    .map((a) => ({ a, common: [...a.genres].filter((g) => me.genres.has(g)).length }))
    .filter((x) => x.common > 0)
    .sort((x, y) => y.common - x.common || y.a.songs.length - x.a.songs.length)
    .slice(0, n)
    .map((x) => x.a);
}

export const recentSearches = {
  async list() {
    return idb.getKV("recentSearches", []);
  },
  async add(q) {
    q = q.trim();
    if (q.length < 2) return;
    const list = (await recentSearches.list()).filter((x) => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    await idb.setKV("recentSearches", list.slice(0, 10));
  },
  async remove(q) {
    await idb.setKV("recentSearches", (await recentSearches.list()).filter((x) => x !== q));
  },
  async clear() {
    await idb.setKV("recentSearches", []);
  },
};
