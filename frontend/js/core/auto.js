/**
 * Modo automático: al reproducir una canción se buscan solos la letra
 * sincronizada, el vídeo que encaja con ella, la traducción y la pronunciación.
 */
import { api } from "./api.js";
import { bus } from "./bus.js";
import { library } from "./library.js";
import { settings } from "./settings.js";
import { subtitleStore } from "../subtitles/store.js";
import { player } from "../player/player.js";

const states = new Map(); // songId -> {status, message, progress}
const running = new Map();

export const autoState = (id) => states.get(id) || { status: "idle", message: "" };

function set(id, status, message = "", progress = 0) {
  states.set(id, { status, message, progress });
  bus.emit("auto:status", { id, status, message, progress });
}

export function autoPrepare(song, { force = false } = {}) {
  if (!song) return Promise.resolve(null);
  if (running.has(song.id) && !force) return running.get(song.id);
  const p = run(song, force).finally(() => running.delete(song.id));
  running.set(song.id, p);
  return p;
}

const RETRY_MS = 3 * 24 * 3600 * 1000; // si no se encontró letra, no reintentar en 3 días
const MAX_WAIT_MS = 60000;

/** ¿Hace falta preparar esta canción (letra sincronizada / vídeo)? */
export async function needsPrepare(song) {
  // Catálogo y enlaces de YouTube pegados; los archivos propios usan Whisper.
  if (!song || (song.source !== "catalog" && song.source !== "youtube")) return false;
  const existing = await subtitleStore.get(song.id);
  const hasSubs = existing?.segments?.some((s) => s.start != null);
  const hasVideo = !!library.youtubeId(song) || !!song.mediaUrl || !!song.blob || !!song.tempUrl;
  const noTr = existing?.segments?.some((s) => s.text && !s.translation && !s.translationFailed);
  if (hasSubs && hasVideo && !noTr) return false;
  if (song.autoChecked && Date.now() - song.autoChecked < RETRY_MS) return false;
  return true;
}

/** Gancho del reproductor: se espera antes de empezar a sonar. */
export async function prepareHook(song) {
  if (!(await needsPrepare(song))) return;
  const h = await api.health();
  if (!h.ok || h.auto === false) {
    set(song.id, "offline", window.ESA_DEMO ? "En esta versión web de prueba la letra y el vídeo no se buscan solos: eso funciona en la app gratuita para Windows." : h.ok ? "Falta un componente: vuelve a ejecutar instalar.bat." : "Arranca la app con iniciar.bat para que la letra y el vídeo se busquen solos.");
    return;
  }
  // En un enlace pegado el vídeo ya existe: suena ya y la letra aparece cuando está lista.
  if (song.source === "youtube") { autoPrepare(song); return; }
  await Promise.race([autoPrepare(song), new Promise((r) => setTimeout(r, MAX_WAIT_MS))]);
}

async function run(song, force) {
  const h = await api.health();
  if (!h.ok) {
    set(song.id, "offline", "Arranca la app con iniciar.bat para que la letra y el vídeo se busquen solos.");
    return null;
  }
  const existing = await subtitleStore.get(song.id);
  const hasSubs = existing?.segments?.some((s) => s.start != null);
  if (hasSubs && !force && song.source !== "catalog" && existing.segments.some((s) => s.text && !s.translation)) {
    // ya hay letra (pegada o importada) pero sin traducción: se traduce sola
    set(song.id, "working", "Traduciendo la letra al español…", 0.3);
    try {
      const todo = existing.segments.filter((s) => s.text && !s.translation);
      const { translations } = await api.translate(todo.map((s) => s.text), settings.get("sourceLang") || "en", settings.get("targetLang") || "es");
      todo.forEach((s, i) => (s.translation = translations[i]));
      await subtitleStore.save(song.id, existing);
      set(song.id, "done", "");
    } catch (e) {
      set(song.id, "error", `No se pudo traducir: ${e.message}`);
    }
    return null;
  }
  set(song.id, "working", song.source === "youtube" ? "Reconociendo la canción del enlace…" : "Buscando la letra y el vídeo…", 0.05);
  let result;
  try {
    const r = await api.auto({ artist: song.artist, title: song.title, candidate: song.ytCandidate || song.yt || null, video_id: song.source === "youtube" ? song.yt : null, target: settings.get("targetLang") || "es", force });
    if (r.cached) result = r.result;
    else result = await api.waitJob(r.job.id, (j) => set(song.id, "working", j.message || "Preparando…", j.progress || 0));
  } catch (e) {
    set(song.id, "error", `No se pudo preparar la canción: ${e.message}`);
    return null;
  }
  const lines = result.segments?.length ? result.segments : result.plain || [];
  const patch = { autoChecked: lines.length ? 0 : Date.now() };
  // 1) vídeo que encaja con la letra
  const canChangeVideo = song.source === "catalog" && !song.userYt;
  if (result.video && song.source === "youtube") patch.autoYtSynced = !!result.video.synced;
  if (result.video && canChangeVideo) {
    patch.autoYt = result.video.id;
    patch.autoYtSynced = !!result.video.synced;
  }
  if (song.source === "youtube" && result.lyrics_source) {
    // nombre limpio de la canción en lugar del título largo del vídeo
    if (result.title) patch.title = result.title;
    if (result.artist) { patch.artist = result.artist; patch.artists = [result.artist]; }
  }
  await library.updateSong(song.id, patch);
  // 2) letra con traducción y pronunciación
  if (lines.length && (!hasSubs || force)) {
    await subtitleStore.save(song.id, { source: result.segments?.length ? "lrclib" : "lrclib-plain", segments: lines, offset: 0, lyrics: result.lyrics_source });
  }
  const fresh = library.get(song.id) || song;
  const warn = (result.warnings || []).join(" ");
  if (!lines.length) set(song.id, "nolyrics", `No he encontrado la letra de esta canción.${warn ? " " + warn : ""}`);
  else if (!result.segments?.length) set(song.id, "nosync", "Letra encontrada, pero sin tiempos: se muestra completa sin sincronizar.");
  else if (!library.youtubeId(fresh) && !fresh.mediaUrl) set(song.id, "novideo", "Letra lista, pero no encontré un vídeo que se pueda reproducir aquí.");
  else set(song.id, "done", warn);
  return result;
}

/** Vuelve a buscar letra y vídeo (botón «Buscar de nuevo»). */
export async function autoRetry(song) {
  await library.updateSong(song.id, { autoChecked: 0 });
  await autoPrepare(library.get(song.id), { force: true });
  if (player.state.song?.id === song.id) player.load(song.id, { autoplay: true, prepare: false });
}

export function initAuto() {
  player.setPrepareHook(prepareHook);
}
