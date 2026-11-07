/** Acciones globales por delegación de eventos (play, favorito, menú…). */
import { library } from "../core/library.js";
import { player } from "../player/player.js";
import { menu, modal, prompt, toast, confirmBox } from "./components.js";
import { esc } from "../core/utils.js";
import { go } from "./router.js";
import { openAddDialog } from "./add-media.js";

function queueFrom(el) {
  const q = el.closest("[data-queue]")?.dataset.queue;
  return q ? q.split(",").filter(Boolean) : null;
}

export async function playSong(id, queue = null, openPage = false) {
  const song = library.get(id);
  if (!song) return;
  // Siempre se abre la pantalla de la canción: vídeo + letra + traducción juntos.
  const p = player.play(id, queue); // marca la canción actual antes de abrir su pantalla
  go(`#/cancion/${encodeURIComponent(id)}`);
  await p;
}

export function addToPlaylistDialog(songId) {
  const lists = library.playlists();
  modal(
    `<h2>Añadir a una lista</h2>
     <div class="rows">${lists.map((p) => `<button class="btn ghost" style="justify-content:flex-start" data-pl="${p.id}">☰ ${esc(p.name)} <span class="dim small">(${p.songIds.length})</span></button>`).join("") || '<p class="muted">Aún no tienes listas.</p>'}</div>
     <div class="acts"><button class="btn" data-new>＋ Nueva lista</button><button class="btn ghost" data-close>Cerrar</button></div>`,
    {
      onMount(box, close) {
        box.querySelectorAll("[data-pl]").forEach((b) =>
          b.addEventListener("click", async () => {
            const ok = await library.addToPlaylist(b.dataset.pl, songId);
            toast(ok ? "Añadida a la lista" : "Ya estaba en esa lista");
            close();
          }),
        );
        box.querySelector("[data-new]").addEventListener("click", async () => {
          close();
          const name = await prompt("Nueva lista", "", { placeholder: "Ej.: Para practicar en el coche", ok: "Crear" });
          if (!name) return;
          const p = await library.createPlaylist(name);
          await library.addToPlaylist(p.id, songId);
          toast(`Creada «${p.name}» con la canción`);
        });
      },
    },
  );
}

export function songMenu(anchor, songId, extra = []) {
  const s = library.get(songId);
  if (!s) return;
  const items = [
    { label: "▶  Reproducir", run: () => playSong(songId, null) },
    { label: "⏭  Reproducir a continuación", run: () => { player.state.queue.splice(player.state.index + 1, 0, songId); toast("Se reproducirá a continuación"); } },
    { label: "☰  Añadir a una lista…", run: () => addToPlaylistDialog(songId) },
    { label: library.isFavorite(songId) ? "♡  Quitar de favoritos" : "♥  Añadir a favoritos", run: () => library.toggleFavorite(songId) },
    "-",
    { label: `♪  Ir a ${s.artists?.[0] || s.artist}`, run: () => go(`#/artista/${encodeURIComponent(s.artists?.[0] || s.artist)}`) },
    { label: "📁  Vincular mi archivo de audio/vídeo…", run: () => openAddDialog({ linkTo: songId }) },
    { label: "⌕  Buscar en YouTube (nueva pestaña)", run: () => {
      const a = document.createElement("a");
      a.href = s.searchUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${s.artist} ${s.title}`)}`;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } },
    ...extra,
  ];
  if (s.source !== "catalog")
    items.push("-", {
      label: "🗑  Quitar de mi biblioteca",
      run: async () => {
        if (await confirmBox("Quitar canción", `¿Quitar «${s.title}» de tu biblioteca? Se borrarán también sus subtítulos guardados en el navegador.`, "Quitar"))
          library.removeSong(songId);
      },
    });
  menu(anchor, items);
}

export function installActions() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (b) {
      e.stopPropagation();
      const id = b.dataset.id;
      switch (b.dataset.act) {
        case "play": return playSong(id, queueFrom(b));
        case "open": return playSong(id, queueFrom(b), true);
        case "fav": {
          const on = await library.toggleFavorite(id);
          toast(on ? "Añadida a favoritos ♥" : "Quitada de favoritos");
          return;
        }
        case "menu": return songMenu(b, id);
        case "add-pl": return addToPlaylistDialog(id);
      }
      return;
    }
    const card = e.target.closest(".song-card,.song-row");
    if (card && !e.target.closest("button,a,input,select")) {
      const id = card.dataset.song;
      // un clic en una fila reproduce; doble clic o clic en tarjeta abre la canción
      if (card.classList.contains("song-card")) playSong(id, queueFrom(card), true);
      else playSong(id, queueFrom(card));
    }
  });
  document.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".song-row");
    if (row && !e.target.closest("button")) go(`#/cancion/${encodeURIComponent(row.dataset.song)}`);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches(".song-card,.song-row")) playSong(e.target.dataset.song, queueFrom(e.target), true);
  });
}
