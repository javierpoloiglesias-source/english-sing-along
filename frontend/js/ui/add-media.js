/** Abrir archivo local o enlace de YouTube → canción propia en la biblioteca. */
import { api } from "../core/api.js";
import { library } from "../core/library.js";
import { esc } from "../core/utils.js";
import { modal, toast } from "./components.js";
import { parseVideoId } from "../player/youtube-id.js";

const MEDIA_ACCEPT = "audio/*,video/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.mp4,.webm,.mkv,.mov,.m4v";

function guessMeta(name) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].replace(/\((official|lyrics?|audio|video).*?\)/gi, "").trim() } : { artist: "", title: base };
}

/**
 * Guarda un archivo local: si hay servidor se copia a la carpeta de datos
 * local (necesario para Whisper); si no, se guarda en el navegador.
 */
export async function importLocalFile(file, { title, artist, linkTo = null, onProgress } = {}) {
  const meta = { ...guessMeta(file.name), ...(title ? { title } : {}), ...(artist ? { artist } : {}) };
  const h = await api.health();
  let mediaInfo = {};
  if (h.ok) {
    const m = await api.uploadMedia(file, meta, onProgress);
    mediaInfo = { mediaHash: m.hash, mediaUrl: m.url, mediaName: file.name, mediaMime: m.mime };
  } else {
    mediaInfo = { blob: file, mediaName: file.name, mediaMime: file.type };
  }
  if (linkTo) {
    await library.updateSong(linkTo, { ...(h.ok ? mediaInfo : { tempUrl: URL.createObjectURL(file) }), preferSource: "local" });
    if (!h.ok) toast("Sin servidor local: el archivo se usará solo durante esta sesión");
    return library.get(linkTo);
  }
  const id = mediaInfo.mediaHash ? `local:${mediaInfo.mediaHash}` : `local:${Date.now().toString(36)}`;
  const isVideo = (file.type || "").startsWith("video") || /\.(mp4|webm|mkv|mov|m4v)$/i.test(file.name);
  return library.addSong({
    id, source: "local", title: meta.title || file.name, artist: meta.artist || "Archivo local", artists: [meta.artist || "Archivo local"],
    genre: "Mis archivos", year: null, level: null, album: "", isVideo, addedAt: Date.now(), ...mediaInfo,
  });
}

export async function importYouTube(url, { title = "", artist = "" } = {}) {
  const id = parseVideoId(url);
  if (!id) throw new Error("No reconozco ese enlace de YouTube");
  let info = { title: title || `Vídeo de YouTube ${id}`, author: artist || "YouTube" };
  const h = await api.health();
  if (h.ok) {
    try {
      const r = await api.youtubeInfo(id);
      if (r.ok) info = { title: title || r.title, author: artist || r.author };
      else if (r.ok === false) toast("YouTube indica que el vídeo no existe o no permite inserción; se intentará igualmente", "err");
    } catch {}
  }
  const guess = guessMeta(`${info.title}.x`);
  const songId = `yt:${id}`;
  if (library.get(songId)) return library.get(songId);
  return library.addSong({
    id: songId, source: "youtube", yt: id, title: title || guess.title || info.title, artist: artist || guess.artist || info.author,
    artists: [artist || guess.artist || info.author], genre: "YouTube", year: null, level: null, album: "", addedAt: Date.now(),
    cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  });
}

export function openAddDialog({ linkTo = null, onDone } = {}) {
  const linked = linkTo && library.get(linkTo);
  modal(
    `<h2>${linked ? `Vincular a «${esc(linked.title)}»` : "Abrir archivo o enlace"}</h2>
     <div class="tabs"><button class="chip on" data-tab="file">Archivo local</button><button class="chip" data-tab="yt">Enlace de YouTube</button></div>
     <section data-pane="file">
       <div class="drop" id="drop">
         <p><b>Arrastra aquí un MP3, WAV, MP4…</b><br/><span class="small">o</span></p>
         <label class="btn primary">Elegir archivo<input type="file" accept="${MEDIA_ACCEPT}" hidden /></label>
         <p class="small dim" style="margin-top:12px">El archivo se queda en tu ordenador (carpeta de datos local). Úsalo solo con música que tengas derecho a usar.</p>
       </div>
       <div class="progress" style="margin-top:12px" hidden><div></div></div>
     </section>
     <section data-pane="yt" hidden>
       <form id="ytf">
         <label>Enlace o identificador del vídeo</label>
         <input type="url" name="url" placeholder="https://www.youtube.com/watch?v=…" required style="margin:6px 0 10px" />
         <div class="row"><div style="flex:1"><label>Título (opcional)</label><input type="text" name="title" /></div><div style="flex:1"><label>Artista (opcional)</label><input type="text" name="artist" /></div></div>
         <p class="small dim">Se usa el reproductor oficial de YouTube. Si el propietario no permite insertarlo, no se podrá reproducir aquí.
         YouTube no permite acceder al audio, así que los subtítulos se crean pegando la letra y sincronizándola, o con un archivo local.</p>
         <div class="acts"><button class="btn primary">Añadir y reproducir</button></div>
       </form>
     </section>`,
    {
      onMount(box, close) {
        box.querySelectorAll("[data-tab]").forEach((t) =>
          t.addEventListener("click", () => {
            box.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === t));
            box.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
          }),
        );
        if (linked) box.querySelector('[data-tab="yt"]').textContent = "Otro vídeo de YouTube";
        const drop = box.querySelector("#drop");
        const input = box.querySelector("input[type=file]");
        const prog = box.querySelector(".progress");
        const handle = async (file) => {
          if (!file) return;
          prog.hidden = false;
          try {
            const song = await importLocalFile(file, {
              linkTo,
              onProgress: (p) => (prog.firstElementChild.style.width = `${Math.round(p * 100)}%`),
            });
            close();
            toast("Archivo listo");
            onDone?.(song);
          } catch (e) {
            prog.hidden = true;
            toast(e.message, "err");
          }
        };
        input.addEventListener("change", () => handle(input.files[0]));
        drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
        drop.addEventListener("dragleave", () => drop.classList.remove("over"));
        drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); handle(e.dataTransfer.files[0]); });
        box.querySelector("#ytf").addEventListener("submit", async (e) => {
          e.preventDefault();
          const f = new FormData(e.target);
          try {
            if (linked) {
              const id = parseVideoId(f.get("url"));
              if (!id) throw new Error("No reconozco ese enlace de YouTube");
              await library.updateSong(linkTo, { userYt: id, preferSource: "youtube" });
              close();
              onDone?.(library.get(linkTo));
              return;
            }
            const song = await importYouTube(f.get("url"), { title: f.get("title"), artist: f.get("artist") });
            close();
            onDone?.(song);
          } catch (err) {
            toast(err.message, "err");
          }
        });
      },
    },
  );
}
