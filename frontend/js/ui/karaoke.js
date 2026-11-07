/** Modo karaoke a pantalla completa. */
import { $, esc } from "../core/utils.js";
import { bus } from "../core/bus.js";
import { settings } from "../core/settings.js";
import { engine } from "../subtitles/engine.js";
import { player } from "../player/player.js";

let el = null, offs = [];

export const karaoke = {
  isOpen: () => !!el,
  open() {
    if (el) return;
    el = document.createElement("div");
    el.className = "karaoke";
    document.body.appendChild(el);
    document.body.classList.add("karaoke-on");
    el.innerHTML = `
      <div class="k-bar">
        <button class="btn small" data-k="repeat">⟳ Repetir frase</button>
        <button class="btn small" data-k="prev">⏮ Frase anterior</button>
        <button class="btn small" data-k="next">Frase siguiente ⏭</button>
        <button class="btn small" data-k="slow">🐢 Lento</button>
        <button class="btn small" data-k="es">Traducción</button>
        <button class="btn small" data-k="pr">Pronunciación</button>
        <button class="btn small" data-k="close">✕ Salir (Esc)</button>
      </div>
      <div class="k-prev"></div>
      <div class="k-cur"></div>
      <div class="k-pr"></div>
      <div class="k-ipa"></div>
      <div class="k-es"></div>
      <div class="k-next"></div>
      <div class="k-progress"><div></div></div>
      <div class="k-title"></div>`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (b) act(b.dataset.k);
      const w = e.target.closest(".w[data-t]");
      if (w) player.seek(engine.absTime(+w.dataset.t));
    });
    offs = [bus.on("sub:index", draw), bus.on("sub:time", tick), bus.on("sub:loaded", draw), bus.on("settings", draw), bus.on("player:state", syncBtns)];
    draw();
    syncBtns();
  },
  close() {
    if (!el) return;
    offs.forEach((o) => o());
    el.remove();
    el = null;
    document.body.classList.remove("karaoke-on");
    bus.emit("karaoke", false);
  },
};

function act(k) {
  const i = engine.state.index;
  if (k === "close") return karaoke.close();
  if (k === "repeat") {
    if (player.state.loop) player.clearLoop();
    else engine.loopLine(Math.max(0, i));
  }
  if (k === "prev") engine.seekTo(Math.max(0, i - 1));
  if (k === "next") engine.seekTo(Math.min(engine.state.segs.length - 1, i + 1));
  if (k === "slow") player.setRate(player.state.rate < 1 ? 1 : 0.75);
  if (k === "es") settings.set("showTranslation", !settings.get("showTranslation"));
  if (k === "pr") settings.set("showPronunciation", !settings.get("showPronunciation"));
  syncBtns();
}

function syncBtns() {
  if (!el) return;
  el.querySelector('[data-k="repeat"]').classList.toggle("on", !!player.state.loop);
  el.querySelector('[data-k="slow"]').classList.toggle("on", player.state.rate < 1);
  el.querySelector('[data-k="slow"]').textContent = `🐢 Lento${player.state.rate < 1 ? ` (${String(player.state.rate).replace(".", ",")}x)` : ""}`;
  el.querySelector('[data-k="es"]').classList.toggle("on", settings.get("showTranslation"));
  el.querySelector('[data-k="pr"]').classList.toggle("on", settings.get("showPronunciation"));
}

export function wordSpans(seg) {
  if (seg.words?.length) return seg.words.map((w) => `<span class="w" data-t="${w.start}" data-e="${w.end}">${esc(w.word)}</span>`).join(" ");
  return esc(seg.text);
}

function draw() {
  if (!el) return;
  const { segs, index } = engine.state;
  const cur = segs[index];
  const nextIdx = index >= 0 ? index + 1 : segs.findIndex((s) => s.start > engine.state.time);
  el.classList.toggle("hide-es", !settings.get("showTranslation"));
  el.classList.toggle("hide-pr", !settings.get("showPronunciation"));
  el.classList.toggle("hide-ipa", !settings.get("showIPA"));
  el.querySelector(".k-prev").textContent = segs[index - 1]?.text || "";
  const c = el.querySelector(".k-cur");
  c.classList.toggle("nowords", !!cur && !cur.words?.length);
  c.innerHTML = cur ? wordSpans(cur) : segs.length ? (index < 0 && engine.state.time < (segs[0]?.start || 0) ? "♪ ♪ ♪" : "♪") : "Esta canción aún no tiene subtítulos";
  el.querySelector(".k-pr").textContent = cur?.pron || "";
  el.querySelector(".k-ipa").textContent = cur?.ipa ? `/${cur.ipa}/` : "";
  el.querySelector(".k-es").textContent = cur?.translation || "";
  el.querySelector(".k-next").textContent = segs[nextIdx]?.text || "";
  el.querySelector(".k-title").textContent = player.state.song ? `${player.state.song.title} · ${player.state.song.artist}${cur && !cur.words?.length ? " · (resaltado por frase: no hay tiempos por palabra)" : ""}` : "";
  if (cur && settings.get("showPronunciation") && !cur.pron) engine.ensurePron(cur).then(() => engine.current() === cur && draw());
}

function tick({ time, index }) {
  if (!el) return;
  const cur = engine.state.segs[index];
  if (!cur) return;
  const p = Math.max(0, Math.min(1, (time - cur.start) / Math.max(0.1, cur.end - cur.start)));
  el.querySelector(".k-progress div").style.width = `${p * 100}%`;
  if (cur.words?.length) el.querySelectorAll(".k-cur .w").forEach((w) => w.classList.toggle("sung", time >= +w.dataset.t));
  else el.querySelector(".k-cur").style.setProperty("--kp", `${p * 100}%`);
}

document.addEventListener("keydown", (e) => {
  if (el && e.key === "Escape") karaoke.close();
});
