/** Componentes reutilizables: tarjetas, filas, modales, menús y avisos. */
import { esc, fmtTime, $ } from "../core/utils.js";
import { library } from "../core/library.js";
import { LEVELS } from "../data/catalog.js";
import { player } from "../player/player.js";

export function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), type === "err" ? 5000 : 2600);
}

export const levelTag = (l) => (l ? `<span class="tag lvl-${l}">${LEVELS[l]}</span>` : "");

const YT_LABEL = {
  verified: ["▶ YouTube", "Vídeo oficial verificado en tu PC"],
  pending: ["◌ sin verificar", "Se verificará con el servidor local; mientras, se usa la búsqueda"],
  mismatch: ["⌕ búsqueda", "El vídeo candidato no coincide: se usa la búsqueda de YouTube"],
  unavailable: ["⌕ búsqueda", "El vídeo candidato no existe o no permite inserción"],
  offline: ["◌ sin conexión", "No se pudo comprobar (sin conexión)"],
  none: ["⌕ búsqueda", "Sin vídeo verificado: usa la búsqueda de YouTube"],
};
export function ytBadge(song) {
  if (song.mediaUrl || song.blob) return `<span class="tag" title="Archivo local">♫ archivo</span>`;
  const st = library.ytState(song);
  const [t, title] = YT_LABEL[st] || YT_LABEL.none;
  return `<span class="tag yt-state" title="${esc(title)}">${t}</span>`;
}

export function coverImg(song, cls = "") {
  return `<img class="${cls}" loading="lazy" src="${esc(library.cover(song))}" data-fallback="${esc(library.fallbackCover(song))}" alt="" />`;
}

/** Si una portada remota falla, se usa la generada. */
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName === "IMG" && img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
}, true);

export function heartBtn(song, extra = "") {
  const on = library.isFavorite(song.id);
  return `<button class="icon-btn heart ${on ? "on" : ""} ${extra}" data-act="fav" data-id="${song.id}" title="${on ? "Quitar de favoritos" : "Añadir a favoritos"}" aria-pressed="${on}">${on ? "♥" : "♡"}</button>`;
}

export function songCard(song, { rank = false } = {}) {
  return `<article class="song-card" data-song="${song.id}" tabindex="0">
    <div class="cover">${coverImg(song)}${rank && song.rank ? `<span class="rank">#${song.rank}</span>` : ""}
      <button class="play-fab" data-act="play" data-id="${song.id}" aria-label="Reproducir ${esc(song.title)}">▶</button>
    </div>
    ${heartBtn(song)}
    <div class="t" title="${esc(song.title)}">${esc(song.title)}</div>
    <div class="a">${esc(song.artist)}</div>
    <div class="meta">${levelTag(song.level)}${song.year ? `<span class="tag">${song.year}</span>` : ""}</div>
  </article>`;
}

export function songRow(song, n, { extraActs = "", queueAttr = "" } = {}) {
  const d = library.duration(song.id);
  const playing = player.state.song?.id === song.id;
  return `<div class="song-row ${playing ? "playing" : ""}" data-song="${song.id}" ${queueAttr} tabindex="0">
    <span class="n">${n ?? ""}</span>
    ${coverImg(song)}
    <div style="min-width:0"><div class="t">${esc(song.title)}</div><div class="a">${esc(song.artist)}${song.genre ? ` · ${esc(song.genre)}` : ""}</div></div>
    <div class="al">${esc(song.album || "")}${song.year ? ` · ${song.year}` : ""}</div>
    <div class="lv">${levelTag(song.level)} ${ytBadge(song)}</div>
    <div class="d">${d ? fmtTime(d) : "—"}</div>
    <div class="acts">${heartBtn(song)}<button class="icon-btn" data-act="menu" data-id="${song.id}" title="Más opciones">⋯</button>${extraActs}</div>
  </div>`;
}

export function grid(songs, opts) {
  return songs.length ? `<div class="grid">${songs.map((s) => songCard(s, opts)).join("")}</div>` : "";
}

export function rows(songs, opts = {}) {
  return `<div class="rows" data-queue="${esc(songs.map((s) => s.id).join(","))}">${songs.map((s, i) => songRow(s, i + 1, opts)).join("")}</div>`;
}

export function empty(title, text, action = "") {
  return `<div class="empty"><b>${esc(title)}</b>${esc(text)}${action ? `<div style="margin-top:16px">${action}</div>` : ""}</div>`;
}

// ---- modales -------------------------------------------------------------
export function modal(html, { onMount, wide = false } = {}) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? "width:min(820px,100%)" : ""}">${html}</div>`;
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  back.addEventListener("click", (e) => {
    if (e.target === back || e.target.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey, true);
  $("#modal-root").appendChild(back);
  const box = back.firstElementChild;
  onMount?.(box, close);
  box.querySelector("input,textarea,select,button.primary")?.focus();
  return { box, close };
}

export function prompt(title, value = "", { placeholder = "", ok = "Guardar" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const { close } = modal(
      `<h2>${esc(title)}</h2><form><input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="80" />
       <div class="acts"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">${esc(ok)}</button></div></form>`,
      {
        onMount(box, close) {
          const input = box.querySelector("input");
          setTimeout(() => input.select(), 0);
          box.querySelector("form").onsubmit = (e) => {
            e.preventDefault();
            done = true;
            close();
            resolve(input.value.trim() || null);
          };
          box.querySelector("[data-close]").addEventListener("click", () => !done && resolve(null));
        },
      },
    );
    void close;
  });
}

export function confirmBox(title, text, ok = "Aceptar", danger = true) {
  return new Promise((resolve) => {
    modal(
      `<h2>${esc(title)}</h2><p class="sub">${esc(text)}</p>
       <div class="acts"><button class="btn ghost" data-r="0">Cancelar</button><button class="btn ${danger ? "danger" : "primary"}" data-r="1">${esc(ok)}</button></div>`,
      {
        onMount(box, close) {
          box.querySelectorAll("[data-r]").forEach((b) =>
            b.addEventListener("click", () => {
              close();
              resolve(b.dataset.r === "1");
            }),
          );
        },
      },
    );
  });
}

// ---- menú contextual -----------------------------------------------------
export function menu(anchor, items) {
  document.querySelector(".menu")?.remove();
  const m = document.createElement("div");
  m.className = "menu";
  m.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : `<button data-i="${i}" ${it.disabled ? "disabled" : ""}>${esc(it.label)}</button>`)).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  const off = (e) => {
    if (!m.contains(e.target)) {
      m.remove();
      document.removeEventListener("mousedown", off, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", off, true));
  m.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    m.remove();
    document.removeEventListener("mousedown", off, true);
    items[b.dataset.i].run();
  });
}
