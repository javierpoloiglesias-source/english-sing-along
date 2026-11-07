/** Inicio, Top 100, Explorar, Artistas y Artista. */
import { library } from "../core/library.js";
import { artistsIndex, genresIndex, relatedArtists } from "../core/search.js";
import { esc, normalize, coverSVG } from "../core/utils.js";
import { grid, rows, empty, songCard } from "../ui/components.js";
import { LEVELS } from "../data/catalog.js";
import { bus } from "../core/bus.js";
import { subtitleStore } from "../subtitles/store.js";
import { playSong } from "../ui/actions.js";

const GENRE_COLORS = ["#e13300", "#1e3264", "#8d67ab", "#e8115b", "#148a08", "#bc5900", "#0d73ec", "#af2896", "#509bf5", "#27856a", "#ba5d07", "#477d95", "#e91429", "#7358ff"];

function refreshOn(events, fn) {
  const offs = events.map((e) => bus.on(e, fn));
  return () => offs.forEach((o) => o());
}

export async function homeView(el) {
  const draw = async () => {
    const recent = await library.recent(10);
    const favs = library.favorites().slice(0, 10);
    const custom = library.custom().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 10);
    const subs = await subtitleStore.list();
    const withSubs = subs.map((s) => library.get(s.songId)).filter(Boolean).slice(0, 10);
    const beginners = library.catalog().filter((s) => s.level === 1).slice(0, 10);
    el.innerHTML = `
      <section class="hero">
        <h1>Aprende inglés cantando</h1>
        <div class="hero-steps">
          <div><b>1. Elige</b>una canción de la lista</div>
          <div><b>2. Pulsa ▶</b>y espera unos segundos</div>
          <div><b>3. Canta</b>la letra sale sola, con traducción y pronunciación</div>
        </div>
        ${window.ESA_DEMO ? `<div class="notice" style="margin-top:6px;max-width:680px">Esta es la <b>versión web de prueba</b>. Los vídeos, la letra automática, la traducción y la pronunciación funcionan en la app gratuita para Windows.</div>` : ""}
      </section>
      <h2>Elige una canción <a class="btn small ghost" href="#/top">Ver las 100</a></h2>
      <div class="grid" data-queue="${library.catalog().slice(0, 18).map((s) => s.id).join(",")}">${library.catalog().slice(0, 18).map((s) => songCard(s, { rank: true })).join("")}</div>
      ${recent.length ? `<h2>Escuchado recientemente <a class="btn small ghost" href="#/historial">Ver historial</a></h2><div class="scroller" data-queue="${recent.map((s) => s.id).join(",")}">${recent.map((s) => songCard(s)).join("")}</div>` : ""}
      ${withSubs.length ? `<h2>Con subtítulos listos</h2><div class="scroller" data-queue="${withSubs.map((s) => s.id).join(",")}">${withSubs.map((s) => songCard(s)).join("")}</div>` : ""}
      ${custom.length ? `<h2>Mis archivos y vídeos</h2><div class="scroller">${custom.map((s) => songCard(s)).join("")}</div>` : ""}
      ${favs.length ? `<h2>Tus favoritos <a class="btn small ghost" href="#/favoritos">Ver todos</a></h2><div class="scroller" data-queue="${favs.map((s) => s.id).join(",")}">${favs.map((s) => songCard(s)).join("")}</div>` : ""}
      <h2>Para empezar (nivel principiante)</h2>
      <div class="scroller" data-queue="${beginners.map((s) => s.id).join(",")}">${beginners.map((s) => songCard(s)).join("")}</div>
      <h2>Artistas</h2>
      ${artistGrid(artistsIndex().slice(0, 12), true)}
      <p class="small dim" style="margin-top:30px">El Top 100 Global es una selección editorial de grandes éxitos internacionales, no un ranking oficial en tiempo real.</p>`;
  };
  await draw();
  return refreshOn(["favorites", "history", "library"], draw);
}

export function artistGrid(artists, scroller = false) {
  const cards = artists
    .map((a) => {
      const s = a.songs[0];
      return `<a class="artist-card" href="#/artista/${encodeURIComponent(a.name)}"><div class="av"><img loading="lazy" src="${esc(library.cover(s))}" data-fallback="${esc(coverSVG(a.name, a.name))}" alt="" /></div><div class="t">${esc(a.name)}</div><div class="small muted">${a.songs.length} ${a.songs.length === 1 ? "canción" : "canciones"}</div></a>`;
    })
    .join("");
  return `<div class="${scroller ? "scroller" : "grid"}">${cards}</div>`;
}

export async function topView(el) {
  let level = 0, genre = "", sort = "rank", mode = "list";
  const draw = () => {
    let list = library.catalog().filter((s) => (!level || s.level === level) && (!genre || s.genre === genre));
    if (sort === "year") list = [...list].sort((a, b) => (b.year || 0) - (a.year || 0));
    if (sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "artist") list = [...list].sort((a, b) => a.artist.localeCompare(b.artist));
    const genres = [...new Set(library.catalog().map((s) => s.genre))].sort();
    const ys = library.ytSummary();
    el.innerHTML = `
      <h1>Top 100 Global</h1>
      <p class="sub">Selección editorial de 100 grandes éxitos internacionales en inglés, de distintas épocas y géneros. No es un ranking oficial en tiempo real.</p>
      <div class="toolbar">
        <button class="btn primary" data-playall>▶ Reproducir todo</button>
        <div class="tabs" style="margin:0">${[0, 1, 2, 3].map((l) => `<button class="chip ${level === l ? "on" : ""}" data-level="${l}">${l ? LEVELS[l] : "Todos los niveles"}</button>`).join("")}</div>
        <span class="spacer"></span>
        <select data-genre><option value="">Todos los géneros</option>${genres.map((g) => `<option ${g === genre ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
        <select data-sort>${[["rank", "Orden editorial"], ["year", "Más recientes"], ["title", "Título A-Z"], ["artist", "Artista A-Z"]].map(([v, t]) => `<option value="${v}" ${v === sort ? "selected" : ""}>${t}</option>`).join("")}</select>
        <button class="icon-btn" data-mode title="Cambiar vista">${mode === "list" ? "▦" : "☰"}</button>
      </div>
      <p class="small dim">Vídeos oficiales verificados en tu PC: ${ys.verified} · pendientes: ${ys.pending + ys.offline} · sustituidos por búsqueda: ${ys.mismatch + ys.unavailable}. ${list.length} canciones mostradas.</p>
      ${list.length ? (mode === "list" ? rows(list) : `<div data-queue="${list.map((s) => s.id).join(",")}">${grid(list, { rank: true })}</div>`) : empty("Sin resultados", "No hay canciones con esos filtros.")}`;
    el.querySelectorAll("[data-level]").forEach((b) => (b.onclick = () => ((level = Number(b.dataset.level)), draw())));
    el.querySelector("[data-genre]").onchange = (e) => ((genre = e.target.value), draw());
    el.querySelector("[data-sort]").onchange = (e) => ((sort = e.target.value), draw());
    el.querySelector("[data-mode]").onclick = () => ((mode = mode === "list" ? "grid" : "list"), draw());
    el.querySelector("[data-playall]").onclick = () => list.length && playSong(list[0].id, list.map((s) => s.id));
  };
  draw();
  return refreshOn(["favorites", "library", "player:song"], draw);
}

export async function exploreView(el, params) {
  const genres = genresIndex();
  if (params.genre) {
    const g = genres.find((x) => normalize(x.name) === normalize(params.genre));
    el.innerHTML = g
      ? `<a class="btn small ghost" href="#/explorar">← Explorar</a><h1>${esc(g.name)}</h1><p class="sub">${g.songs.length} canciones</p>${rows(g.songs)}`
      : empty("Género no encontrado", "");
    return refreshOn(["favorites"], () => exploreView(el, params));
  }
  const decades = {};
  for (const s of library.catalog()) if (s.year) (decades[`${Math.floor(s.year / 10) * 10}s`] ||= []).push(s);
  const decadeKeys = Object.keys(decades).sort();
  el.innerHTML = `
    <h1>Explorar</h1>
    <p class="sub">Descubre música por género, época o nivel de inglés.</p>
    <h2>Géneros</h2>
    <div class="grid">${genres.map((g, i) => `<a class="genre-tile" style="background:linear-gradient(135deg, ${GENRE_COLORS[i % GENRE_COLORS.length]}, #111)" href="#/explorar/genero/${encodeURIComponent(g.name)}">${esc(g.name)}<small>${g.songs.length} canciones</small></a>`).join("")}</div>
    <h2>Por nivel de inglés</h2>
    <div class="grid">${[1, 2, 3].map((l) => `<a class="genre-tile" style="background:linear-gradient(135deg, ${["", "#148a08", "#bc5900", "#e91429"][l]}, #111)" href="#/aprender?nivel=${l}">${LEVELS[l]}<small>${library.catalog().filter((s) => s.level === l).length} canciones</small></a>`).join("")}</div>
    <h2>Por épocas</h2>
    ${decadeKeys.map((d) => `<h3>Años ${d.replace("s", "")}</h3><div class="scroller" data-queue="${decades[d].map((s) => s.id).join(",")}">${decades[d].map((s) => songCard(s)).join("")}</div>`).join("")}`;
}

export async function artistsView(el) {
  let filter = "";
  const all = artistsIndex();
  const draw = () => {
    const list = all.filter((a) => !filter || a.key.includes(normalize(filter)));
    el.querySelector("#artist-list").innerHTML = list.length ? artistGrid(list) : empty("Sin artistas", "Prueba con otro nombre.");
  };
  el.innerHTML = `<h1>Artistas</h1><p class="sub">${all.length} cantantes y grupos.</p>
    <div class="toolbar"><input type="search" placeholder="Filtrar artistas…" style="max-width:320px" /></div><div id="artist-list"></div>`;
  el.querySelector("input").oninput = (e) => ((filter = e.target.value), draw());
  draw();
}

export async function artistView(el, { name }) {
  const draw = () => {
    const a = artistsIndex().find((x) => x.key === normalize(name));
    if (!a) {
      el.innerHTML = empty("Artista no encontrado", `No hay canciones de «${name}» en tu biblioteca.`);
      return;
    }
    const rel = relatedArtists(a.name);
    el.innerHTML = `
      <div class="artist-head"><div class="av"><img src="${esc(library.cover(a.songs[0]))}" data-fallback="${esc(coverSVG(a.name, a.name))}" alt="" /></div>
        <div><div class="small muted">ARTISTA</div><h1 style="margin:4px 0">${esc(a.name)}</h1><div class="muted">${[...a.genres].map(esc).join(" · ")} · ${a.songs.length} canciones</div>
        <div class="row" style="margin-top:14px"><button class="btn primary" data-playall>▶ Reproducir</button>
        <a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(a.name)}">⌕ Buscar en YouTube</a></div></div></div>
      <h2>Canciones</h2>${rows(a.songs)}
      ${rel.length ? `<h2>Artistas relacionados</h2>${artistGrid(rel, true)}` : ""}`;
    el.querySelector("[data-playall]").onclick = () => playSong(a.songs[0].id, a.songs.map((s) => s.id));
  };
  draw();
  return refreshOn(["favorites", "player:song"], draw);
}
