/** Barra de reproducción persistente y escenario de vídeo flotante. */
import { $, esc, fmtTime } from "../core/utils.js";
import { bus } from "../core/bus.js";
import { library } from "../core/library.js";
import { player, RATES } from "../player/player.js";
import { coverImg, heartBtn } from "./components.js";
import { go, currentRoute } from "./router.js";

let seeking = false;

export function mountPlayerBar() {
  const bar = $("#playerbar");
  bar.innerHTML = `
    <div class="pb-song" id="pb-song"><img alt="" /><div style="min-width:0"><div class="t">Elige una canción</div><div class="a">English Sing Along</div></div></div>
    <div class="pb-center">
      <div class="pb-buttons">
        <button class="icon-btn" id="pb-back" title="Retroceder 5 s (←)">⟲</button>
        <button class="icon-btn" id="pb-prev" title="Anterior">⏮</button>
        <button class="icon-btn play" id="pb-play" title="Reproducir / pausa (espacio)">▶</button>
        <button class="icon-btn" id="pb-next" title="Siguiente">⏭</button>
        <button class="icon-btn" id="pb-fwd" title="Avanzar 5 s (→)">⟳</button>
        <button class="icon-btn" id="pb-repeat" title="Repetir: no">🔁</button>
      </div>
      <div class="pb-progress"><span id="pb-cur">0:00</span><input id="pb-seek" type="range" min="0" max="1000" value="0" aria-label="Posición" /><span id="pb-dur">0:00</span></div>
    </div>
    <div class="pb-right">
      <span id="pb-loop" class="loop-pill" hidden></span>
      <button class="icon-btn rate-btn" id="pb-rate" title="Velocidad de reproducción">1x</button>
      <span id="pb-heart"></span>
      <button class="icon-btn hide-sm-btn" id="pb-mute" title="Silenciar">🔊</button>
      <input class="vol" id="pb-vol" type="range" min="0" max="100" value="90" aria-label="Volumen" />
      <button class="icon-btn hide-sm-btn" id="pb-full" title="Pantalla completa">⛶</button>
    </div>`;

  $("#pb-play").onclick = () => player.toggle();
  $("#pb-prev").onclick = () => player.prev();
  $("#pb-next").onclick = () => player.next();
  $("#pb-back").onclick = () => player.skip(-5);
  $("#pb-fwd").onclick = () => player.skip(5);
  $("#pb-repeat").onclick = () => player.cycleRepeat();
  $("#pb-rate").onclick = () => {
    const i = RATES.indexOf(player.state.rate);
    player.setRate(RATES[(i + 1) % RATES.length]);
  };
  $("#pb-mute").onclick = () => player.setMuted(!player.state.muted);
  $("#pb-vol").oninput = (e) => {
    player.setVolume(e.target.value / 100);
    paintRange(e.target);
  };
  $("#pb-full").onclick = () => fullscreen();
  $("#pb-loop").onclick = () => player.clearLoop();
  $("#pb-song").onclick = (e) => {
    if (e.target.closest("button")) return;
    if (player.state.song) go(`#/cancion/${encodeURIComponent(player.state.song.id)}`);
  };
  const seek = $("#pb-seek");
  seek.addEventListener("input", () => {
    seeking = true;
    paintRange(seek);
    $("#pb-cur").textContent = fmtTime((seek.value / 1000) * player.duration());
  });
  seek.addEventListener("change", () => {
    player.seek((seek.value / 1000) * player.duration());
    seeking = false;
  });
  paintRange($("#pb-vol"));

  bus.on("player:time", ({ time, duration }) => {
    if (seeking) return;
    $("#pb-cur").textContent = fmtTime(time);
    $("#pb-dur").textContent = fmtTime(duration);
    seek.value = duration ? (time / duration) * 1000 : 0;
    paintRange(seek);
  });
  bus.on("player:state", updateState);
  bus.on("player:song", ({ song }) => {
    const box = $("#pb-song");
    box.innerHTML = `${coverImg(song)}<div style="min-width:0"><div class="t">${esc(song.title)}</div><div class="a">${esc(song.artist)}</div></div>`;
    $("#pb-heart").innerHTML = heartBtn(song);
    document.title = `${song.title} · ${song.artist} — English Sing Along`;
    updateStage();
    // Si se está viendo la página de una canción y empieza otra (⏭, ⏮, fin de
    // la canción), la página pasa a la nueva para que letra y vídeo coincidan.
    // Se espera un instante: playSong() ya cambia la ruta justo después.
    setTimeout(() => {
      const m = location.hash.match(/^#\/cancion\/([^/?]+)/);
      if (m && decodeURIComponent(m[1]) !== song.id && player.state.song?.id === song.id)
        go(`#/cancion/${encodeURIComponent(song.id)}`);
    }, 0);
  });
  bus.on("favorites", () => player.state.song && ($("#pb-heart").innerHTML = heartBtn(player.state.song)));
  bus.on("route", updateStage);
  bus.on("player:ready", updateStage);
  $("#stage-expand").onclick = () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    player.state.song && go(`#/cancion/${encodeURIComponent(player.state.song.id)}`);
  };
  addEventListener("resize", positionStage);
  $("#view").addEventListener("scroll", positionStage, { passive: true });
  updateState(player.state);
}

function paintRange(r) {
  r.style.setProperty("--p", `${(r.value / r.max) * 100}%`);
}

function updateState(s) {
  const playing = s.status === "playing" || s.status === "buffering";
  const preparing = s.status === "preparing";
  $("#pb-play").textContent = preparing ? "⏳" : playing ? "⏸" : "▶";
  $("#pb-play").title = preparing ? "Preparando la canción…" : playing ? "Pausa (espacio)" : "Reproducir (espacio)";
  $("#pb-play").classList.toggle("busy", preparing);
  $("#pb-rate").textContent = `${String(s.rate).replace(".", ",")}x`;
  $("#pb-rate").classList.toggle("on", s.rate !== 1);
  $("#pb-repeat").classList.toggle("on", s.repeat !== "off");
  $("#pb-repeat").textContent = s.repeat === "one" ? "🔂" : "🔁";
  $("#pb-repeat").title = { off: "Repetir: no", all: "Repetir: toda la cola", one: "Repetir: esta canción" }[s.repeat];
  $("#pb-mute").textContent = s.muted || s.volume === 0 ? "🔇" : "🔊";
  const lp = $("#pb-loop");
  lp.hidden = !s.loop;
  if (s.loop) lp.textContent = `⟳ ${fmtTime(s.loop.a)}–${fmtTime(s.loop.b)} ✕`;
  lp.title = "Repitiendo fragmento. Pulsa para quitar.";
  document.body.classList.toggle("is-playing", playing);
}

// ---- escenario de vídeo ---------------------------------------------------
let slotObserver = null;

export function updateStage() {
  const stage = $("#stage");
  const s = player.state;
  const slot = $("#stage-slot");
  const audioOnly = s.source === "local" && player.adapter && !player.adapter.hasVideo();
  stage.classList.toggle("audio-only", !!audioOnly);
  if (s.song) $("#stage-cover").src = library.cover(s.song);
  if (!s.source) {
    stage.className = "stage hidden";
    return;
  }
  if (slot && currentRoute()?.name === "song") {
    stage.classList.remove("hidden", "mini");
    stage.classList.add("in-slot");
    slotObserver?.disconnect();
    slotObserver = new ResizeObserver(positionStage);
    slotObserver.observe(slot);
    positionStage();
  } else {
    stage.classList.remove("in-slot");
    stage.style.cssText = "";
    // audio local sin vídeo: no hace falta mostrar nada flotando
    if (audioOnly) stage.classList.add("hidden");
    else stage.classList.remove("hidden");
    stage.classList.toggle("mini", !audioOnly);
  }
}

export function positionStage() {
  const stage = $("#stage");
  const slot = $("#stage-slot");
  if (!slot || !stage.classList.contains("in-slot") || document.fullscreenElement) return;
  const r = slot.getBoundingClientRect();
  const top = Math.max(r.top, $("#view").getBoundingClientRect().top);
  const visibleH = Math.max(0, r.bottom - top);
  Object.assign(stage.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    clipPath: visibleH < r.height ? `inset(${top - r.top}px 0 0 0 round 14px)` : "" });
}

export function fullscreen() {
  const stage = $("#stage");
  if (document.fullscreenElement) return document.exitFullscreen();
  if (!player.state.source) return;
  stage.classList.remove("hidden");
  stage.requestFullscreen?.().catch(() => {});
}
document.addEventListener("fullscreenchange", () => setTimeout(() => { updateStage(); positionStage(); }, 50));
