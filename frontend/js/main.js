/** Punto de entrada de English Sing Along. */
import { settings } from "./core/settings.js";
import { library } from "./core/library.js";
import { api } from "./core/api.js";
import { bus } from "./core/bus.js";
import { $ } from "./core/utils.js";
import { player } from "./player/player.js";
import { engine } from "./subtitles/engine.js";
import { initAuto } from "./core/auto.js";
import { exportAll, importAll } from "./core/db.js";
window.__esaEngine = engine;
import { route, startRouter, go } from "./ui/router.js";
import { mountPlayerBar } from "./ui/playerbar.js";
import { installActions, playSong } from "./ui/actions.js";
import { openAddDialog } from "./ui/add-media.js";
import { toast } from "./ui/components.js";
import { karaoke } from "./ui/karaoke.js";
import { homeView, topView, exploreView, artistsView, artistView } from "./views/browse.js";
import { searchView, mountSearchBox } from "./views/search.js";
import { favoritesView, playlistsView, playlistView, historyView } from "./views/collections.js";
import { songView } from "./views/song.js";
import { learnView } from "./views/learn.js";
import { settingsView } from "./views/settings.js";

export async function refreshServerStatus() {
  const h = await api.health(true);
  const el = $("#server-status");
  if (!h.ok && window.ESA_DEMO) {
    el.innerHTML = `<span class="dot warn"></span><b>Versión web de prueba</b><br/>Catálogo, buscador, favoritos, listas, tus archivos de audio, letras y karaoke funcionan aquí. YouTube, Whisper, traducción y pronunciación necesitan la app de Windows.`;
    return h;
  }
  if (!h.ok) {
    el.innerHTML = `<span class="dot err"></span><b>Servidor local apagado</b><br/>Música, favoritos y listas funcionan. Para Whisper y traducción, arranca <b>iniciar.bat</b>.`;
    return h;
  }
  const ia = h.whisper && h.argos;
  el.innerHTML = `<span class="dot ${ia ? "ok" : "warn"}"></span><b>Servidor local activo</b><br/>Whisper: ${h.whisper ? "sí" : "no"} · Traducción: ${h.argos ? "sí" : "no"}<br/>Pronunciación: ${h.cmudict || h.espeak ? "sí" : "no"}`;
  return h;
}

/**
 * YouTube rechaza los vídeos musicales (error 150) en páginas servidas desde
 * una IP como http://127.0.0.1. Si la app se abre así, se pasan los datos
 * guardados (favoritos, listas…) al servidor local y se recarga en
 * http://localhost, donde los vídeos sí se reproducen.
 * Devuelve true si la página se está redirigiendo.
 */
async function moveToLocalhost() {
  if (window.ESA_DEMO || location.hostname !== "127.0.0.1") return false;
  const base = `${location.protocol}//localhost:${location.port}`;
  try {
    // ¿responde "localhost"? (sin CORS: basta con que no falle la conexión)
    await fetch(`${base}/api/health`, { mode: "no-cors", cache: "no-store" });
  } catch {
    return false; // localhost no resuelve en este equipo: seguimos aquí
  }
  try {
    const data = await exportAll();
    const hasData = ["favorites", "playlists", "history", "subtitles", "vocab", "phrases", "songs"].some((k) => data[k]?.length);
    if (hasData) {
      for (const s of data.songs || []) delete s.blob; // los archivos no viajan en JSON
      await fetch("/api/migrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    }
  } catch (e) {
    console.warn("No se pudieron traspasar los datos a localhost", e);
  }
  location.replace(`${base}${location.pathname}${location.search}${location.hash}`);
  return true;
}

/** Recoge (una vez) los datos que dejó la versión abierta en 127.0.0.1. */
async function importMigrated() {
  if (window.ESA_DEMO || location.hostname !== "localhost") return;
  try {
    const r = await fetch("/api/migrate", { cache: "no-store" });
    if (!r.ok) return;
    const { data } = await r.json();
    if (data) await importAll(data);
  } catch { /* servidor apagado o sin datos */ }
}

async function boot() {
  if (await moveToLocalhost()) return;
  await importMigrated();
  await settings.load();
  await library.init();
  await library.loadCatalogLinks();
  player.init({ videoEl: $("#media"), ytHost: $("#yt-host") });
  initAuto();
  mountPlayerBar();
  mountSearchBox();
  installActions();

  route("/", "home", homeView);
  route("/top", "top", topView);
  route("/explorar", "explore", exploreView);
  route("/explorar/genero/:genre", "explore", exploreView);
  route("/buscar", "search", searchView);
  route("/artistas", "artists", artistsView);
  route("/artista/:name", "artists", artistView);
  route("/favoritos", "favorites", favoritesView);
  route("/listas", "playlists", playlistsView);
  route("/lista/:id", "playlists", playlistView);
  route("/historial", "history", historyView);
  route("/aprender", "learn", learnView);
  route("/ajustes", "settings", settingsView);
  route("/cancion/:id", "song", songView);
  startRouter();

  $("#add-btn").onclick = () => openAddDialog({ onDone: (s) => playSong(s.id, null, true) });
  document.addEventListener("click", (e) => e.target.closest("[data-open-add]") && openAddDialog({ onDone: (s) => playSong(s.id, null, true) }));
  $("#menu-btn").onclick = () => document.body.classList.toggle("menu-open");

  bus.on("player:error", ({ message }) => toast(message, "err"));

  // Atajos de teclado
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector(".modal-back")) return;
    const k = e.key;
    if (k === " " || k === "k") { e.preventDefault(); player.toggle(); }
    else if (k === "ArrowLeft") { e.preventDefault(); player.skip(-5); }
    else if (k === "ArrowRight") { e.preventDefault(); player.skip(5); }
    else if (k === "ArrowUp" && e.shiftKey) player.setVolume(player.state.volume + 0.1);
    else if (k === "ArrowDown" && e.shiftKey) player.setVolume(player.state.volume - 0.1);
    else if (k === "r" || k === "R") { const i = (window.__esaEngine?.state.index ?? -1); if (player.state.loop) player.clearLoop(); else if (i >= 0) window.__esaEngine.loopLine(i); }
    else if (k === "m" || k === "M") player.setMuted(!player.state.muted);
    else if (k === "/") { e.preventDefault(); $("#search-input").focus(); }
  });

  const h = await refreshServerStatus();
  if (!window.ESA_DEMO) setInterval(refreshServerStatus, 30000);
  if (h.ok && settings.get("verifyYouTube")) library.verifyCatalog().catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persisted().then((p) => !p && navigator.storage.persist()).catch(() => {});
  window.__esa = { player, library, settings, api, karaoke, go };
}

boot().catch((e) => {
  console.error(e);
  $("#view").innerHTML = `<div class="empty"><b>No se pudo iniciar la aplicación</b>${e.message}</div>`;
});
