/** Favoritos, Mis listas, Lista e Historial. */
import { library } from "../core/library.js";
import { search } from "../core/search.js";
import { bus } from "../core/bus.js";
import { esc, fmtDate, coverSVG } from "../core/utils.js";
import { rows, empty, prompt, confirmBox, toast, coverImg, songRow } from "../ui/components.js";
import { playSong } from "../ui/actions.js";
import { go } from "../ui/router.js";

const on = (evs, fn) => {
  const offs = evs.map((e) => bus.on(e, fn));
  return () => offs.forEach((o) => o());
};

export async function favoritesView(el) {
  const draw = () => {
    const favs = library.favorites();
    el.innerHTML = `<h1>Favoritos</h1><p class="sub">${favs.length} canciones marcadas con ♥. Se guardan automáticamente en este navegador.</p>
      ${favs.length ? `<div class="toolbar"><button class="btn primary" data-playall>▶ Reproducir favoritos</button><button class="btn" data-shuffle>⤮ Aleatorio</button></div>${rows(favs)}` : empty("Aún no tienes favoritos", "Pulsa el corazón ♡ de cualquier canción para guardarla aquí.", '<a class="btn primary" href="#/top">Ir al Top 100</a>')}`;
    el.querySelector("[data-playall]")?.addEventListener("click", () => playSong(favs[0].id, favs.map((s) => s.id)));
    el.querySelector("[data-shuffle]")?.addEventListener("click", () => {
      const ids = favs.map((s) => s.id).sort(() => Math.random() - 0.5);
      playSong(ids[0], ids);
    });
  };
  draw();
  return on(["favorites", "player:song"], draw);
}

function plCover(p) {
  const s = library.get(p.songIds[0]);
  return s ? library.cover(s) : coverSVG(p.name, "☰ Lista");
}

export async function playlistsView(el) {
  const draw = () => {
    const lists = library.playlists();
    el.innerHTML = `<h1>Mis listas</h1><p class="sub">Crea listas para practicar. Se guardan automáticamente.</p>
      <div class="toolbar"><button class="btn primary" data-new>＋ Nueva lista</button></div>
      ${lists.length ? `<div class="grid">${lists.map((p) => `<a class="song-card" style="display:block" href="#/lista/${p.id}"><div class="cover"><img src="${esc(plCover(p))}" data-fallback="${esc(coverSVG(p.name, "Lista"))}" alt=""/></div><div class="t">${esc(p.name)}</div><div class="a">${p.songIds.length} canciones</div></a>`).join("")}</div>` : empty("No tienes listas todavía", "Crea una lista y añade canciones desde el menú ⋯ de cada canción.")}`;
    el.querySelector("[data-new]").onclick = async () => {
      const name = await prompt("Nueva lista", "", { placeholder: "Nombre de la lista", ok: "Crear" });
      if (name) go(`#/lista/${(await library.createPlaylist(name)).id}`);
    };
  };
  draw();
  return on(["playlists"], draw);
}

export async function playlistView(el, { id }) {
  let adding = "";
  let dragFrom = -1;
  const draw = () => {
    const p = library.playlist(id);
    if (!p) {
      el.innerHTML = empty("Lista no encontrada", "Puede que la hayas eliminado.", '<a class="btn" href="#/listas">Volver a Mis listas</a>');
      return;
    }
    const songs = p.songIds.map((sid) => library.get(sid)).filter(Boolean);
    const results = adding ? search(adding).songs.filter((s) => !p.songIds.includes(s.id)).slice(0, 8) : [];
    el.innerHTML = `
      <a class="btn small ghost" href="#/listas">← Mis listas</a>
      <div class="artist-head"><div class="av" style="border-radius:16px"><img src="${esc(plCover(p))}" alt=""/></div>
        <div><div class="small muted">LISTA</div><h1 style="margin:4px 0">${esc(p.name)}</h1><div class="muted">${songs.length} canciones · actualizada ${fmtDate(p.updatedAt)}</div>
        <div class="row" style="margin-top:14px">
          <button class="btn primary" data-playall ${songs.length ? "" : "disabled"}>▶ Reproducir</button>
          <button class="btn" data-rename>✎ Cambiar nombre</button>
          <button class="btn danger" data-delete>🗑 Eliminar lista</button>
        </div></div></div>
      <h2>Canciones</h2>
      ${songs.length ? `<p class="small dim">Arrastra las filas o usa ↑ ↓ para reordenar.</p><div class="rows" data-queue="${songs.map((s) => s.id).join(",")}">${songs
        .map((s, i) => songRow(s, i + 1, { extraActs: `<button class="icon-btn" data-up="${i}" title="Subir">↑</button><button class="icon-btn" data-down="${i}" title="Bajar">↓</button><button class="icon-btn" data-rm="${s.id}" title="Quitar de la lista">✕</button>` }).replace('class="song-row', `draggable="true" data-idx="${i}" class="song-row`))
        .join("")}</div>` : empty("Lista vacía", "Busca canciones abajo para añadirlas.")}
      <h2>Añadir canciones</h2>
      <input type="search" id="pl-add" placeholder="Busca por título o artista…" value="${esc(adding)}" style="max-width:420px" />
      <div class="rows" style="margin-top:10px">${results.map((s) => `<div class="song-row" data-song="${s.id}">${"<span class='n'></span>"}${coverImg(s)}<div><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div></div><div class="al"></div><div class="lv"></div><div class="d"></div><div class="acts"><button class="btn small" data-addsong="${s.id}">＋ Añadir</button></div></div>`).join("")}</div>`;
    el.querySelector("[data-playall]").onclick = () => playSong(songs[0].id, songs.map((s) => s.id));
    el.querySelector("[data-rename]").onclick = async () => {
      const name = await prompt("Cambiar nombre de la lista", p.name);
      if (name) await library.renamePlaylist(id, name);
    };
    el.querySelector("[data-delete]").onclick = async () => {
      if (await confirmBox("Eliminar lista", `¿Eliminar «${p.name}»? Las canciones no se borran.`, "Eliminar")) {
        await library.deletePlaylist(id);
        toast("Lista eliminada");
        go("#/listas");
      }
    };
    el.querySelectorAll("[data-up]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); library.movePlaylistSong(id, +b.dataset.up, +b.dataset.up - 1); }));
    el.querySelectorAll("[data-down]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); library.movePlaylistSong(id, +b.dataset.down, +b.dataset.down + 1); }));
    el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); library.removeFromPlaylist(id, b.dataset.rm); }));
    el.querySelectorAll("[data-addsong]").forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); await library.addToPlaylist(id, b.dataset.addsong); toast("Añadida"); }));
    const add = el.querySelector("#pl-add");
    add.oninput = () => {
      adding = add.value;
      const pos = add.selectionStart;
      draw();
      const n = el.querySelector("#pl-add");
      n.focus();
      n.setSelectionRange(pos, pos);
    };
    el.querySelectorAll("[draggable]").forEach((r) => {
      r.addEventListener("dragstart", () => (dragFrom = +r.dataset.idx));
      r.addEventListener("dragover", (e) => e.preventDefault());
      r.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragFrom >= 0) library.movePlaylistSong(id, dragFrom, +r.dataset.idx);
        dragFrom = -1;
      });
    });
  };
  draw();
  return on(["playlists", "favorites", "player:song"], draw);
}

export async function historyView(el) {
  const draw = async () => {
    const hist = await library.history();
    const groups = {};
    for (const h of hist) {
      const s = library.get(h.songId);
      if (!s) continue;
      const day = new Date(h.playedAt).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
      (groups[day] ||= []).push({ h, s });
    }
    el.innerHTML = `<h1>Historial</h1><p class="sub">Lo que has escuchado, guardado solo en este navegador.</p>
      ${hist.length ? `<div class="toolbar"><button class="btn danger" data-clear>Borrar historial</button></div>` : ""}
      ${Object.keys(groups).length ? Object.entries(groups).map(([day, items]) => `<h3 style="text-transform:capitalize">${esc(day)}</h3><div class="rows" data-queue="${items.map((x) => x.s.id).join(",")}">${items
        .map(({ h, s }) => songRow(s, new Date(h.playedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), { extraActs: `<button class="icon-btn" data-delh="${h.id}" title="Quitar del historial">✕</button>` }))
        .join("")}</div>`).join("") : empty("Historial vacío", "Las canciones que reproduzcas aparecerán aquí.")}`;
    el.querySelector("[data-clear]")?.addEventListener("click", async () => {
      if (await confirmBox("Borrar historial", "Se borrará todo el historial de reproducción.", "Borrar")) library.clearHistory();
    });
    el.querySelectorAll("[data-delh]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); library.deleteHistoryEntry(Number(b.dataset.delh)); }));
  };
  await draw();
  return on(["history", "favorites"], draw);
}
