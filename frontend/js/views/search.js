/** Página BUSCAR y buscador de la barra superior. */
import { search, suggestions, recentSearches, relatedArtists, genresIndex } from "../core/search.js";
import { library } from "../core/library.js";
import { esc, $, debounce } from "../core/utils.js";
import { rows, empty, songCard, toast } from "../ui/components.js";
import { artistGrid } from "./browse.js";
import { go, query, currentRoute, setPathSilently } from "../ui/router.js";
import { LEVELS } from "../data/catalog.js";
import { parseVideoId } from "../player/youtube-id.js";
import { importYouTube } from "../ui/add-media.js";
import { playSong } from "../ui/actions.js";
import { bus } from "../core/bus.js";

const ytSearch = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const looksLikeYouTube = (q) => /youtu\.?be/.test(q) && parseVideoId(q);

export function mountSearchBox() {
  const input = $("#search-input");
  const box = $("#search-suggest");
  let sel = -1;
  let seq = 0;
  const show = async () => {
    const my = ++seq;
    const q = input.value.trim();
    let items = [];
    if (!q) items = (await recentSearches.list()).slice(0, 6).map((t) => ({ t, hint: "reciente" }));
    if (my !== seq) return; // llegó otra pulsación mientras se leía el historial
    else if (looksLikeYouTube(q)) items = [{ t: q, hint: "cargar vídeo de YouTube", yt: true }];
    else items = suggestions(q).map((t) => ({ t, hint: "" }));
    sel = -1;
    box.hidden = !items.length || document.activeElement !== input;
    box.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" data-t="${esc(it.t)}">${it.yt ? "▶" : "⌕"} <span>${esc(it.yt ? "Cargar este vídeo de YouTube" : it.t)}</span><small>${esc(it.hint)}</small></button>`).join("");
  };
  const live = debounce(() => {
    const q = input.value.trim();
    if (currentRoute()?.name === "search" && !looksLikeYouTube(q)) setPathSilently(`#/buscar?q=${encodeURIComponent(q)}`), bus.emit("search:live", q);
  }, 120);
  input.addEventListener("input", () => { show(); live(); });
  input.addEventListener("focus", show);
  input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 150));
  input.addEventListener("keydown", (e) => {
    const btns = [...box.querySelectorAll("button")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle("sel", i === sel));
    } else if (e.key === "Enter" && sel >= 0 && btns[sel]) {
      e.preventDefault();
      btns[sel].click();
    } else if (e.key === "Escape") box.hidden = true;
  });
  box.addEventListener("mousedown", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    input.value = b.dataset.t;
    box.hidden = true;
    submit();
  });
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  async function submit() {
    const q = input.value.trim();
    box.hidden = true;
    if (looksLikeYouTube(q)) {
      try {
        const s = await importYouTube(q);
        input.value = "";
        playSong(s.id, null, true);
      } catch (err) {
        toast(err.message, "err");
      }
      return;
    }
    if (q) recentSearches.add(q);
    go(`#/buscar?q=${encodeURIComponent(q)}`);
  }
}

export async function searchView(el) {
  let type = "all", level = 0;
  const input = $("#search-input");
  const draw = async (qOverride) => {
    const q = qOverride ?? query().get("q") ?? "";
    if (input.value !== q && document.activeElement !== input) input.value = q;
    if (!q.trim()) {
      const recent = await recentSearches.list();
      el.innerHTML = `<h1>Buscar</h1>
        <p class="sub">Escribe arriba el título de una canción, un artista, un grupo, un álbum o un género. También puedes pegar un enlace de YouTube.</p>
        ${recent.length ? `<h2>Búsquedas recientes <button class="btn small ghost" data-clear>Borrar</button></h2><div class="row">${recent.map((r) => `<span class="chip"><a href="#/buscar?q=${encodeURIComponent(r)}">${esc(r)}</a><button class="icon-btn" style="width:22px;height:22px;font-size:12px" data-del="${esc(r)}" title="Quitar">✕</button></span>`).join("")}</div>` : ""}
        <h2>Sugerencias</h2><div class="row">${["Adele", "Queen", "Taylor Swift", "love", "Balada", "Rock", "Coldplay", "dance"].map((s) => `<a class="chip" href="#/buscar?q=${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}</div>
        <h2>Canciones populares</h2><div class="scroller" data-queue="${library.catalog().slice(0, 10).map((s) => s.id).join(",")}">${library.catalog().slice(0, 10).map((s) => songCard(s, { rank: true })).join("")}</div>
        <h2>Géneros</h2><div class="row">${genresIndex().map((g) => `<a class="chip" href="#/explorar/genero/${encodeURIComponent(g.name)}">${esc(g.name)}</a>`).join("")}</div>`;
      el.querySelector("[data-clear]")?.addEventListener("click", async () => { await recentSearches.clear(); draw(); });
      el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { await recentSearches.remove(b.dataset.del); draw(); }));
      return;
    }
    const r = search(q, { level });
    const total = r.songs.length + r.artists.length + r.albums.length + r.genres.length;
    const rel = r.artists[0] ? relatedArtists(r.artists[0].name) : [];
    const tab = (t, label, n) => `<button class="chip ${type === t ? "on" : ""}" data-type="${t}">${label}${n != null ? ` (${n})` : ""}</button>`;
    const sec = (t) => type === "all" || type === t;
    el.innerHTML = `
      <h1>Resultados para «${esc(q)}»</h1>
      <div class="toolbar">
        <div class="tabs" style="margin:0">${tab("all", "Todo", total)}${tab("songs", "Canciones", r.songs.length)}${tab("artists", "Artistas", r.artists.length)}${tab("albums", "Álbumes", r.albums.length)}${tab("genres", "Géneros", r.genres.length)}</div>
        <span class="spacer"></span>
        <select data-level><option value="0">Cualquier nivel</option>${[1, 2, 3].map((l) => `<option value="${l}" ${level === l ? "selected" : ""}>${LEVELS[l]}</option>`).join("")}</select>
        <a class="btn" target="_blank" rel="noopener" href="${ytSearch(q)}">⌕ Buscar «${esc(q)}» en YouTube</a>
      </div>
      ${!total ? empty("No está en el catálogo", "Puedes buscarla en YouTube (botón de arriba), copiar el enlace del vídeo y pegarlo en el buscador para cargarla aquí.") : ""}
      ${sec("artists") && r.artists.length ? `<h2>Artistas</h2>${artistGrid(r.artists.slice(0, type === "all" ? 6 : 50), type === "all")}` : ""}
      ${sec("songs") && r.songs.length ? `<h2>Canciones</h2>${rows(r.songs.slice(0, type === "all" ? 10 : 200))}` : ""}
      ${sec("albums") && r.albums.length ? `<h2>Álbumes</h2><div class="rows">${r.albums.map((a) => `<div class="card" style="margin-bottom:8px"><b>${esc(a.name)}</b> <span class="muted">· ${esc(a.artist)}</span>${rows(a.songs)}</div>`).join("")}</div>` : ""}
      ${sec("genres") && r.genres.length ? `<h2>Géneros</h2><div class="row">${r.genres.map((g) => `<a class="chip" href="#/explorar/genero/${encodeURIComponent(g.name)}">${esc(g.name)} (${g.songs.length})</a>`).join("")}</div>` : ""}
      ${type === "all" && rel.length ? `<h2>Artistas relacionados</h2>${artistGrid(rel, true)}` : ""}`;
    el.querySelectorAll("[data-type]").forEach((b) => (b.onclick = () => ((type = b.dataset.type), draw(q))));
    el.querySelector("[data-level]").onchange = (e) => ((level = Number(e.target.value)), draw(q));
  };
  await draw();
  const offs = [bus.on("search:live", (q) => draw(q)), bus.on("favorites", () => draw())];
  return () => offs.forEach((o) => o());
}
