/**
 * Página de canción: vídeo/audio + subtítulos sincronizados inglés/español,
 * pronunciación, repetición de frases, karaoke, generación (Whisper),
 * importación, edición y sincronización manual.
 */
import { library } from "../core/library.js";
import { settings } from "../core/settings.js";
import { api } from "../core/api.js";
import { bus } from "../core/bus.js";
import { esc, fmtTime, downloadFile } from "../core/utils.js";
import { player, RATES, sourcesFor } from "../player/player.js";
import { engine } from "../subtitles/engine.js";
import { subtitleStore, timedSegments } from "../subtitles/store.js";
import { parseAny, toSRT, toLRC, toVTT, fillEnds } from "../subtitles/format.js";
import { coverImg, heartBtn, levelTag, toast, confirmBox, ytBadge } from "../ui/components.js";
import { updateStage, positionStage, fullscreen } from "../ui/playerbar.js";
import { karaoke } from "../ui/karaoke.js";
import { wordPopup } from "../ui/word-popup.js";
import { openAddDialog } from "../ui/add-media.js";
import { songMenu, addToPlaylistDialog } from "../ui/actions.js";
import { speak } from "../learn/pronunciation.js";
import { phrases } from "../learn/study.js";
import { go } from "../ui/router.js";
import { autoState, autoRetry } from "../core/auto.js";

const SOURCE_LABEL = { lrclib: "Letra sincronizada (LRCLIB)", "lrclib-plain": "Letra (LRCLIB, sin tiempos)", whisper: "Whisper (automático, local)", manual: "Letra pegada", sync: "Sincronizada a mano", lrc: "Archivo LRC", srt: "Archivo SRT/VTT", json: "Archivo JSON", edited: "Editada a mano" };

let tab = "lyrics";
let activeJob = null;

export async function songView(el, { id }) {
  const song = library.get(id);
  if (!song) {
    el.innerHTML = `<div class="empty"><b>Canción no encontrada</b><a class="btn" href="#/">Volver al inicio</a></div>`;
    return;
  }
  // Elegir una canción = reproducirla. Todo lo demás (letra, vídeo, traducción) es automático.
  if (player.state.song?.id !== id) player.play(id, null, { autoplay: true });
  await engine.loadFor(id);
  await importServerTranscript(song);
  pickMode = false;
  const adv = () => !!settings.get("advancedMode");
  if (!adv()) tab = "lyrics";
  else tab = engine.state.segs.length ? (tab === "generate" ? "lyrics" : tab) : "generate";
  if (settings.get("karaokeDefault") && engine.state.segs.length) setTimeout(() => karaoke.open(), 300);

  const draw = () => {
    const srcs = sourcesFor(library.get(id) || song);
    const h = api.cachedHealth;
    const simple = !adv();
    const preparing = player.state.status === "preparing" && player.state.song?.id === id;
    el.innerHTML = `
      <div class="song-head">
        ${coverImg(song)}
        <div style="min-width:0;flex:1">
          <h1>${esc(song.title)}</h1>
          <div class="muted"><a href="#/artista/${encodeURIComponent(song.artists?.[0] || song.artist)}">${esc(song.artist)}</a>${song.album ? ` · ${esc(song.album)}` : ""}${song.year ? ` · ${song.year}` : ""} ${levelTag(song.level)} ${simple ? "" : ytBadge(song)}</div>
        </div>
        ${heartBtn(song)}
        <button class="icon-btn" data-addpl title="Añadir a una lista">☰</button>
        <button class="icon-btn" data-more title="Más opciones">⋯</button>
      </div>
      <div class="song-page ${simple ? "simple" : ""}">
        <div class="song-left">
          <div class="stage-slot" id="stage-slot">${preparing ? preparingHTML(id) : srcs.length ? "" : noSourceHTML(song, simple)}</div>
          ${!simple && srcs.length > 1 ? `<div class="row" style="margin-top:10px"><span class="small muted">Fuente:</span>${srcs.map((s) => `<button class="chip ${player.state.source === s.type ? "on" : ""}" data-src="${s.type}">${s.type === "local" ? "♫ Mi archivo" : "▶ YouTube"}</button>`).join("")}</div>` : ""}
          ${simple ? `
          <div class="learn-bar lb-top">
            <button class="btn small ${player.state.rate < 1 ? "on" : ""}" data-slow title="Reproducir más despacio (0,75x)">🐢 Más lento</button>
            <button class="btn small ${player.state.loop ? "on" : ""}" data-loopline title="Repite en bucle la frase que está sonando">⟳ Repetir frase</button>
            <button class="btn small primary" data-karaoke ${engine.state.segs.length ? "" : "disabled"}>🎤 Karaoke</button>
            <button class="btn small" data-full>⛶ Pantalla completa</button>
          </div>
          <div class="learn-bar lb-top">
            ${toggle("showTranslation", "Traducción")}${toggle("showPronunciation", "Pronunciación")}
            <button class="chip" data-advanced title="Velocidades, A-B, IPA, crear o editar subtítulos…">⚙ Opciones avanzadas</button>
          </div>
          ${engine.state.segs.length ? syncBarHTML(song) : ""}` : `
          <div class="learn-bar">
            ${RATES.map((r) => `<button class="chip ${player.state.rate === r ? "on" : ""}" data-rate="${r}">${String(r).replace(".", ",")}x</button>`).join("")}
          </div>
          <div class="learn-bar">
            <button class="btn small ${player.state.loop ? "on" : ""}" data-loopline title="Repite en bucle la frase actual">⟳ Repetir frase</button>
            <button class="btn small" data-ab title="Marca el inicio y el final de un fragmento para repetirlo">A-B ${abLabel()}</button>
            <button class="btn small ${player.state.repeat === "one" ? "on" : ""}" data-repsong>🔂 Repetir canción</button>
            <button class="btn small primary" data-karaoke ${engine.state.segs.length ? "" : "disabled"}>🎤 Karaoke</button>
            <button class="btn small" data-full>⛶ Pantalla completa</button>
          </div>
          <div class="learn-bar">
            ${toggle("showTranslation", "Traducción")}${toggle("showPronunciation", "Pronunciación")}${toggle("showIPA", "IPA")}
            <button class="chip ${document.getElementById("stage").classList.contains("subs-on") ? "on" : ""}" data-overlay>Subtítulos sobre el vídeo</button>
            <button class="chip on" data-advanced title="Volver a la vista sencilla">⚙ Vista sencilla</button>
          </div>
          ${engine.state.segs.length ? `<div class="learn-bar small muted">Desfase de subtítulos: <button class="chip" data-off="-0.5">−0,5 s</button><b>${(engine.state.rec?.offset || 0).toFixed(1).replace(".", ",")} s</b><button class="chip" data-off="0.5">+0,5 s</button><span class="dim">(si la letra va adelantada o atrasada)</span></div>` : ""}
          ${sourceNotice(song, h)}`}
        </div>
        <div class="subs-panel" id="subs-panel">
          <div id="auto-status">${autoStatusHTML(id)}</div>
          ${simple ? "" : `<div class="tabs">
            ${[["lyrics", "Letra"], ["generate", "Crear subtítulos"], ["edit", "Editar"], ["sync", "Sincronizar"]].map(([t, l]) => `<button class="chip ${tab === t ? "on" : ""}" data-tab="${t}">${l}</button>`).join("")}
          </div>`}
          <div class="subs-body" id="subs-body"></div>
        </div>
      </div>`;
    bind(el, song);
    drawTab(song);
    updateStage();
    positionStage();
  };

  let hadSubs = engine.state.segs.length > 0;
  const offs = [
    bus.on("sub:loaded", () => {
      const has = engine.state.segs.length > 0;
      if (has && !hadSubs && tab === "generate") tab = "lyrics";
      hadSubs = has;
      draw();
    }),
    bus.on("sub:index", ({ index }) => highlight(index)),
    bus.on("sub:time", ({ time, index }) => wordProgress(time, index)),
    bus.on("player:state", (s) => {
      syncControls(el, s);
      // al terminar de preparar (o fallar), redibujar para mostrar el vídeo
      const wasPrep = el.querySelector(".preparing-box");
      if (wasPrep && s.status !== "preparing") draw();
    }),
    bus.on("auto:status", (a) => {
      if (a.id !== id) return;
      const box = el.querySelector("#auto-status");
      if (box) box.innerHTML = autoStatusHTML(id);
      const pm = el.querySelector(".preparing-box .msg");
      if (pm) pm.textContent = a.message || "Preparando…";
      const pb = el.querySelector(".preparing-box .bar i");
      if (pb) pb.style.width = `${Math.round((a.progress || 0) * 100)}%`;
      if (["nolyrics", "error", "novideo", "nosync", "offline"].includes(a.status)) drawTab(library.get(id) || song);
    }),
    bus.on("favorites", () => { const b = el.querySelector(".song-head .heart"); if (b) b.outerHTML = heartBtn(song); }),
    bus.on("library", (e) => e.id === song.id && draw()),
    bus.on("settings", (e) => (e?.key === "advancedMode" ? draw() : applyToggles(el))),
  ];
  draw();
  return () => {
    offs.forEach((o) => o());
    karaoke.close();
    updateStage();
  };
}

// ---------------------------------------------------------------------------
function toggle(key, label) {
  return `<button class="chip ${settings.get(key) ? "on" : ""}" data-toggle="${key}">${label}</button>`;
}

let abStart = null;
function abLabel() {
  return abStart != null ? `(A=${fmtTime(abStart)}, pulsa para B)` : "";
}

let pickMode = false;

async function syncToLine(seg) {
  const off = player.time() - 0.25 - seg.start - (settings.get("subtitleOffset") || 0); // 0,25 s de reacción
  await engine.setOffset(off);
  document.querySelector(".sync-bar b")?.replaceChildren(`${off.toFixed(1).replace(".", ",")} s`);
  toast("Letra sincronizada con lo que estás oyendo");
}

function syncBarHTML(song) {
  const off = engine.state.rec?.offset || 0;
  const warn = library.get(song.id)?.autoYtSynced === false;
  return `${warn ? `<div class="notice warn" style="margin:6px 0">⏱ En este vídeo la letra puede ir algo desfasada. Arréglalo en un toque: cuando oigas una frase, pulsa su botón <b>🎯</b> en la lista de la derecha, o usa los botones de abajo.</div>` : ""}
    <div class="learn-bar sync-bar"><span class="small muted">⏱ ¿La letra no va a tiempo?</span>
      <button class="chip" data-off="-0.5" title="La letra sale antes">◀ Antes</button><b>${off.toFixed(1).replace(".", ",")} s</b><button class="chip" data-off="0.5" title="La letra sale después">Después ▶</button>
      <button class="chip" data-off-reset title="Quitar el ajuste">↺</button>
      <button class="chip" data-off="-5">−5 s</button><button class="chip" data-off="5">+5 s</button>
      <button class="chip primary" data-pick title="Toca después la frase que estás oyendo ahora">🎯 Elegir la frase que oigo</button></div>`;
}

function preparingHTML(id) {
  const a = autoState(id);
  return `<div class="preparing-box"><div>
    <div class="spinner" style="margin:0 auto 12px"></div>
    <p><b>Preparando la canción…</b></p>
    <p class="small muted msg">${esc(a.message || "Buscando la letra y el vídeo")}</p>
    <div class="auto-status" style="background:none;padding:0"><div class="bar"><i style="width:${Math.round((a.progress || 0) * 100)}%"></i></div></div>
    <p class="small dim">Solo tarda la primera vez; después es instantáneo.</p>
  </div></div>`;
}

function autoStatusHTML(id) {
  const a = autoState(id);
  if (a.status === "working") return `<div class="auto-status"><div class="spinner"></div><span>${esc(a.message || "Preparando…")}</span><div class="bar"><i style="width:${Math.round((a.progress || 0) * 100)}%"></i></div></div>`;
  if (a.status === "offline") return `<div class="auto-status warn">⚠ ${esc(a.message)}</div>`;
  if (a.status === "error") return `<div class="auto-status err">⚠ ${esc(a.message)} <button class="btn small" data-retry>Reintentar</button></div>`;
  if (a.status === "nolyrics" || a.status === "novideo" || a.status === "nosync") return `<div class="auto-status warn">ℹ ${esc(a.message)} <button class="btn small" data-retry>Buscar de nuevo</button></div>`;
  return "";
}

function noSourceHTML(song, simple = false) {
  return `<div class="nosrc"><div>
    <p><b>No he encontrado un vídeo que se pueda reproducir aquí</b></p>
    <p class="small">${simple ? "Puedes buscarlo tú en YouTube y pegar el enlace, o usar tu propio archivo." : "Busca el vídeo oficial en YouTube, copia su enlace y pégalo aquí, o usa tu propio archivo de audio/vídeo."}</p>
    <div class="row" style="justify-content:center">
      ${simple ? `<button class="btn primary" data-retry>⟳ Buscar de nuevo</button>` : ""}
      <a class="btn ${simple ? "" : "primary"}" target="_blank" rel="noopener" href="${esc(song.searchUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(song.artist + " " + song.title)}`)}">⌕ Buscar en YouTube</a>
      <button class="btn" data-link-yt>🔗 Pegar enlace</button>
      <button class="btn" data-link-file>📁 Mi archivo</button>
    </div></div></div>`;
}

function sourceNotice(song, h) {
  const src = player.state.source;
  if (src === "youtube")
    return `<div class="notice" style="margin-top:6px">▶ Reproductor oficial de YouTube. YouTube no permite que otras webs accedan a su audio, por eso aquí no se puede transcribir automáticamente.
      Para crear subtítulos: pega la letra y sincronízala, importa un LRC/SRT o <a href="#" data-link-file style="text-decoration:underline">vincula tu archivo de audio</a> para usar Whisper.</div>`;
  if (src === "local" && !song.mediaHash)
    return `<div class="notice warn" style="margin-top:6px">El servidor local no estaba activo al abrir este archivo: se reproduce desde el navegador, pero Whisper necesita el servidor. Arranca la aplicación con <b>iniciar.bat</b> y vuelve a abrir el archivo.</div>`;
  if (src === "local" && !h.whisper)
    return `<div class="notice warn" style="margin-top:6px">Whisper no está instalado. Ejecuta <b>instalar.bat</b> (opción IA) para generar subtítulos automáticos.</div>`;
  return "";
}

async function importServerTranscript(song) {
  if (!song.mediaHash || engine.state.segs.length) return;
  try {
    const t = await api.transcript(song.mediaHash);
    if (t?.segments?.length) {
      const rec = await subtitleStore.save(song.id, { segments: t.segments, source: t.edited ? "edited" : "whisper", mediaHash: song.mediaHash, model: t.model }, { silent: true });
      await engine.setRecord(rec);
    }
  } catch {}
}

function bind(el, song) {
  el.querySelector("[data-more]").onclick = (e) => songMenu(e.currentTarget, song.id);
  el.querySelector("[data-addpl]").onclick = () => addToPlaylistDialog(song.id);
  el.querySelectorAll("[data-link-yt]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); openAddDialog({ linkTo: song.id, onDone: () => player.load(song.id, { source: "youtube" }) }); setTimeout(() => document.querySelector('.modal [data-tab="yt"]')?.click(), 0); }));
  el.querySelectorAll("[data-link-file]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); openAddDialog({ linkTo: song.id, onDone: () => player.load(song.id, { source: "local" }) }); }));
  el.querySelectorAll("[data-src]").forEach((b) => (b.onclick = async () => {
    await library.updateSong(song.id, { preferSource: b.dataset.src });
    player.load(song.id, { source: b.dataset.src });
  }));
  el.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = () => player.setRate(Number(b.dataset.rate))));
  el.querySelectorAll(".nosrc [data-retry]").forEach((b) => (b.onclick = () => { b.disabled = true; autoRetry(library.get(song.id) || song); }));
  el.querySelector("#auto-status").onclick = (e) => {
    if (e.target.closest("[data-retry]")) { e.target.disabled = true; autoRetry(library.get(song.id) || song); }
  };
  const slow = el.querySelector("[data-slow]");
  if (slow) slow.onclick = () => player.setRate(player.state.rate < 1 ? 1 : 0.75);
  const advB = el.querySelector("[data-advanced]");
  if (advB) advB.onclick = () => settings.set("advancedMode", !settings.get("advancedMode"));
  el.querySelector("[data-loopline]").onclick = () => {
    if (player.state.loop) return player.clearLoop();
    const i = engine.state.index;
    if (i >= 0) engine.loopLine(i);
    else {
      const t = player.time();
      player.setLoop(Math.max(0, t - 4), t + 1, "fragmento");
      toast(engine.state.segs.length ? "Repitiendo los últimos segundos" : "Sin subtítulos: se repiten los últimos 5 segundos");
    }
  };
  const abB = el.querySelector("[data-ab]");
  if (abB) abB.onclick = (e) => {
    const t = player.time();
    if (abStart == null) {
      abStart = t;
      e.currentTarget.textContent = `A-B ${abLabel()}`;
      toast("Punto A marcado. Pulsa otra vez al final del fragmento.");
    } else {
      player.setLoop(Math.min(abStart, t), Math.max(abStart, t), "A-B");
      abStart = null;
      e.currentTarget.textContent = "A-B";
    }
  };
  const rep = el.querySelector("[data-repsong]");
  if (rep) rep.onclick = () => player.setRepeat(player.state.repeat === "one" ? "off" : "one");
  el.querySelector("[data-karaoke]").onclick = () => karaoke.open();
  el.querySelector("[data-full]").onclick = () => {
    document.getElementById("stage").classList.add("subs-on");
    fullscreen();
  };
  el.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = () => settings.set(b.dataset.toggle, !settings.get(b.dataset.toggle))));
  const ov = el.querySelector("[data-overlay]");
  if (ov) ov.onclick = (e) => {
    const on = document.getElementById("stage").classList.toggle("subs-on");
    e.currentTarget.classList.toggle("on", on);
  };
  el.querySelector("[data-pick]")?.addEventListener("click", () => {
    pickMode = !pickMode;
    document.getElementById("subs-body")?.classList.toggle("picking", pickMode);
    if (pickMode) toast("Toca la frase que estás oyendo ahora mismo");
  });
  el.querySelector("[data-off-reset]")?.addEventListener("click", async (e) => {
    const bar = e.currentTarget.parentElement;
    await engine.setOffset(0);
    bar.querySelector("b").textContent = "0,0 s";
  });
  el.querySelectorAll("[data-off]").forEach((b) => (b.onclick = async () => {
    await engine.setOffset((engine.state.rec?.offset || 0) + Number(b.dataset.off));
    b.parentElement.querySelector("b").textContent = `${engine.state.rec.offset.toFixed(1).replace(".", ",")} s`;
  }));
  el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    el.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
    drawTab(song);
  }));
  applyToggles(el);
}

function applyToggles(el) {
  const panel = el.querySelector("#subs-panel");
  if (!panel) return;
  panel.classList.toggle("hide-es", !settings.get("showTranslation"));
  panel.classList.toggle("hide-pr", !settings.get("showPronunciation"));
  panel.classList.toggle("hide-ipa", !settings.get("showIPA"));
  el.querySelectorAll("[data-toggle]").forEach((b) => b.classList.toggle("on", !!settings.get(b.dataset.toggle)));
  if (settings.get("showPronunciation") && tab === "lyrics") fillPronunciations();
}

function syncControls(el, s) {
  el.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("on", Number(b.dataset.rate) === s.rate));
  el.querySelector("[data-loopline]")?.classList.toggle("on", !!s.loop);
  el.querySelector("[data-slow]")?.classList.toggle("on", s.rate < 1);
  el.querySelector("[data-repsong]")?.classList.toggle("on", s.repeat === "one");
  el.querySelectorAll("[data-src]").forEach((b) => b.classList.toggle("on", b.dataset.src === s.source));
}

// ---------------------------------------------------------------------------
function drawTab(song) {
  const body = document.getElementById("subs-body");
  if (!body) return;
  if (tab === "lyrics") return drawLyrics(body, song);
  if (tab === "generate") return drawGenerate(body, song);
  if (tab === "edit") return drawEditor(body, song);
  if (tab === "sync") return drawSync(body, song);
}

function drawLyrics(body, song) {
  const segs = engine.state.segs;
  const rec = engine.state.rec;
  if (!segs.length) {
    const untimed = (rec?.segments || []).filter((s) => s.start == null);
    const simple = !settings.get("advancedMode");
    const st = autoState(song.id).status;
    if (simple && !untimed.length && song.source !== "catalog" && song.source !== "youtube") {
      body.innerHTML = `<div class="empty" style="margin:10px"><b>Esta canción aún no tiene letra</b>La app puede escucharla y escribir la letra sola (Whisper), o puedes pegarla tú.<div style="margin-top:12px"><button class="btn primary" data-mk>✨ Crear la letra</button></div></div>`;
      body.querySelector("[data-mk]").onclick = () => { tab = "generate"; settings.set("advancedMode", true); };
      return;
    }
    if (simple && !untimed.length) {
      body.innerHTML = st === "working" || (player.state.status === "preparing" && player.state.song?.id === song.id)
        ? `<div class="empty" style="margin:10px"><div class="spinner" style="margin:0 auto 10px"></div><b>Buscando la letra…</b>Aparecerá aquí con la traducción y la pronunciación.</div>`
        : `<div class="empty" style="margin:10px"><b>No hay letra para esta canción</b>Pulsa «Buscar de nuevo» o, si la tienes, pégala desde «⚙ Opciones avanzadas».<div style="margin-top:12px"><button class="btn primary" data-retry2>⟳ Buscar de nuevo</button></div></div>`;
      body.querySelector("[data-retry2]")?.addEventListener("click", (e) => { e.target.disabled = true; autoRetry(library.get(song.id) || song); });
      return;
    }
    body.innerHTML = untimed.length
      ? `<div class="notice">${simple ? "Esta letra no trae tiempos, así que no se puede seguir línea a línea." : "Tienes la letra pero sin tiempos. Ve a <b>Sincronizar</b> para marcar cuándo empieza cada frase."}</div>${untimed.map((s) => `<div class="line" style="opacity:.8"><div class="en">${esc(s.text)}</div><div class="pr">${esc(s.pron || "")}</div><div class="es">${esc(s.translation || "")}</div></div>`).join("")}`
      : `<div class="empty" style="margin:10px"><b>Sin subtítulos todavía</b>Ve a «Crear subtítulos» para generarlos con Whisper, pegar la letra o importar un archivo.<div style="margin-top:12px"><button class="btn primary" data-go-gen>Crear subtítulos</button></div></div>`;
    body.querySelector("[data-go-gen]")?.addEventListener("click", () => document.querySelector('[data-tab="generate"]').click());
    return;
  }
  const hasWords = segs.some((s) => s.words?.length);
  body.innerHTML = !settings.get("advancedMode") ? `<div class="timing-note">Pulsa una frase para ir a ella · pulsa una palabra para oír cómo se pronuncia.</div>` + linesHTML(segs) : `<div class="timing-note">${esc(SOURCE_LABEL[rec?.source] || "Subtítulos")}${rec?.model ? ` · modelo ${esc(rec.model)}` : ""} · ${segs.length} frases${hasWords ? " · tiempos por palabra" : ""}. Pulsa una frase para saltar; una palabra para ver su pronunciación.</div>` +
    linesHTML(segs);
  body.onclick = async (e) => {
    const line = e.target.closest(".line[data-i]");
    if (!line) return;
    const i = Number(line.dataset.i);
    const seg = segs[i];
    const w = e.target.closest(".w");
    const la = e.target.closest("[data-la]")?.dataset.la;
    if (pickMode && !la) {
      pickMode = false;
      body.classList.remove("picking");
      return syncToLine(seg);
    }
    if (la === "here") return syncToLine(seg);
    if (la === "play") return engine.playLine(i);
    if (la === "loop") return engine.loopLine(i);
    if (la === "tts" || la === "ttsslow") {
      player.pauseIfPlaying();
      return speak(seg.text, la === "ttsslow" ? { rate: 0.6 } : {}).catch((err) => toast(err.message, "err"));
    }
    if (la === "hard" || la === "save") {
      const on = await phrases.toggle(song.id, seg, la === "hard" ? "difficult" : "saved");
      e.target.closest("[data-la]").classList.toggle("on", on);
      return toast(on ? (la === "hard" ? "Marcada como difícil" : "Frase guardada") : "Quitada");
    }
    if (w) return wordPopup(w.textContent, { context: seg.text, songId: song.id });
    engine.seekTo(i);
  };
  // estado de frases marcadas
  segs.forEach(async (s, i) => {
    const p = await phrases.get(song.id, s);
    if (!p) return;
    const line = body.querySelector(`.line[data-i="${i}"]`);
    line?.querySelector('[data-la="hard"]')?.classList.toggle("on", !!p.difficult);
    line?.querySelector('[data-la="save"]')?.classList.toggle("on", !!p.saved);
  });
  highlight(engine.state.index, true);
  if (settings.get("showPronunciation") || settings.get("showIPA")) fillPronunciations();
}

function linesHTML(segs) {
  return segs.map((s, i) => `<div class="line" data-i="${i}">
        <span class="tm">${fmtTime(s.start)}</span>
        <div class="en">${lineWords(s)}</div>
        <div class="pr">${esc(s.pron || "")}</div>
        <div class="ipa">${s.ipa ? `/${esc(s.ipa)}/` : ""}</div>
        <div class="es">${esc(s.translation || "")}</div>
        <div class="line-acts">
          <button class="icon-btn" data-la="here" title="Es la frase que suena ahora: sincroniza toda la letra con ella">🎯</button>
          <button class="icon-btn" data-la="play" title="Escuchar esta frase de la canción">▶</button>
          <button class="icon-btn" data-la="loop" title="Repetir esta frase en bucle">⟳</button>
          <button class="icon-btn" data-la="tts" title="Escuchar la pronunciación (voz)">🔊</button>
          <button class="icon-btn" data-la="ttsslow" title="Pronunciación lenta">🐢</button>
          <button class="icon-btn" data-la="hard" title="Marcar como difícil">⚑</button>
          <button class="icon-btn" data-la="save" title="Guardar frase">★</button>
        </div></div>`).join("");
}

function lineWords(s) {
  if (s.words?.length) return s.words.map((w) => `<span class="w" data-t="${w.start}">${esc(w.word)}</span>`).join(" ");
  return s.text.split(/(\s+)/).map((t) => (/\S/.test(t) ? `<span class="w">${esc(t)}</span>` : t)).join("");
}

let fillRunning = false;
async function fillPronunciations() {
  if (fillRunning || !api.cachedHealth.ok) return;
  fillRunning = true;
  try {
    const segs = engine.state.segs;
    // primero la actual y las cercanas
    const order = [...segs.keys()].sort((a, b) => Math.abs(a - Math.max(0, engine.state.index)) - Math.abs(b - Math.max(0, engine.state.index)));
    for (const i of order) {
      const s = segs[i];
      if (s.pron) continue;
      await engine.ensurePron(s);
      const line = document.querySelector(`#subs-body .line[data-i="${i}"]`);
      if (!line) break; // se cambió de pestaña o de página
      line.querySelector(".pr").textContent = s.pron || "";
      line.querySelector(".ipa").textContent = s.ipa ? `/${s.ipa}/` : "";
    }
  } finally {
    fillRunning = false;
  }
}

function highlight(index, instant = false) {
  const body = document.getElementById("subs-body");
  if (!body || tab !== "lyrics") return;
  body.querySelectorAll(".line.cur, .line.near").forEach((l) => l.classList.remove("cur", "near"));
  const cur = body.querySelector(`.line[data-i="${index}"]`);
  if (!cur) return;
  cur.classList.add("cur");
  body.querySelector(`.line[data-i="${index - 1}"]`)?.classList.add("near");
  body.querySelector(`.line[data-i="${index + 1}"]`)?.classList.add("near");
  const top = cur.offsetTop - body.clientHeight * 0.3;
  body.scrollTo({ top, behavior: instant ? "auto" : "smooth" });
}

function wordProgress(time, index) {
  if (tab !== "lyrics") return;
  const cur = document.querySelector(`#subs-body .line.cur`);
  if (!cur) return;
  cur.querySelectorAll(".w[data-t]").forEach((w) => w.classList.toggle("sung", time >= +w.dataset.t));
}

// ---------------------------------------------------------------------------
// Crear subtítulos
function drawGenerate(body, song) {
  const h = api.cachedHealth;
  const rec = engine.state.rec;
  const hasLocal = !!song.mediaHash;
  const missingTr = (rec?.segments || []).filter((s) => s.text && !s.translation).length;
  body.innerHTML = `
    <div style="padding:6px 8px">
      <h3>1 · Automático con Whisper (local)</h3>
      ${!h.ok ? `<div class="notice warn">El servidor local no está activo. Arranca la app con <b>iniciar.bat</b>.</div>`
        : !h.whisper ? `<div class="notice warn">faster-whisper no está instalado. Ejecuta <b>instalar.bat</b> y elige instalar la IA.</div>`
        : !hasLocal ? `<p class="small muted">Whisper necesita el archivo de audio o vídeo (YouTube no deja acceder a su audio). Elige un archivo de esta canción que tengas en tu PC.</p><button class="btn" data-link-file2>📁 Elegir archivo de audio/vídeo</button>`
        : `<p class="small muted">Archivo: <b>${esc(song.mediaName || "local")}</b>. El análisis se hace en tu ordenador. Con música de fondo el reconocimiento puede tener errores: luego puedes corregirlo en «Editar».</p>
           <div class="row"><label>Calidad</label><select id="wmodel" style="width:auto">${(h.whisper_models || []).map((m) => `<option value="${m}" ${m === settings.get("whisperModel") ? "selected" : ""}>${modelLabel(m)}</option>`).join("")}</select>
           <label class="row small"><input type="checkbox" id="wtr" ${settings.get("autoTranslate") ? "checked" : ""} ${h.argos ? "" : "disabled"}/> Traducir al español</label></div>
           <div class="row" style="margin-top:10px"><button class="btn primary" data-whisper>✨ Generar subtítulos</button>${rec?.segments?.length ? '<span class="small dim">Sustituirá los actuales</span>' : ""}</div>
           <div id="wprog" hidden style="margin-top:12px"><div class="progress"><div></div></div><p class="small muted" id="wmsg"></p><button class="btn small" data-cancel>Cancelar</button></div>
           ${h.device ? `<p class="small dim">Procesando con ${h.device.device === "cuda" ? "tarjeta gráfica NVIDIA" : "CPU"}.</p>` : ""}`}
      <h3>2 · Pegar la letra</h3>
      <p class="small muted">Pega la letra (una frase por línea). Después podrás sincronizarla con la música en «Sincronizar». Funciona también con vídeos de YouTube.</p>
      <textarea id="lyrics-in" placeholder="Hello, it's me&#10;I was wondering if after all these years you'd like to meet…"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn" data-paste>Usar esta letra</button></div>
      <h3>3 · Importar archivo</h3>
      <p class="small muted">LRC (letras sincronizadas), SRT, VTT, TXT o JSON exportado por esta app.</p>
      <label class="btn">📄 Elegir archivo de subtítulos<input type="file" accept=".lrc,.srt,.vtt,.txt,.json" hidden id="sub-file" /></label>
      ${rec?.segments?.length ? `
      <h3>Traducción</h3>
      <p class="small muted">${missingTr ? `${missingTr} frases sin traducir.` : "Todas las frases tienen traducción."}</p>
      <div class="row"><button class="btn" data-translate ${h.argos ? "" : "disabled"}>🌐 ${missingTr ? "Traducir frases pendientes" : "Volver a traducir todo"} (Argos)</button>${h.argos ? "" : '<span class="small dim">Requiere Argos Translate</span>'}</div>
      <h3>Exportar y borrar</h3>
      <div class="row"><button class="btn small" data-exp="srt">SRT</button><button class="btn small" data-exp="vtt">VTT</button><button class="btn small" data-exp="lrc">LRC</button><button class="btn small" data-exp="json">JSON</button><button class="btn small danger" data-delsubs>Borrar subtítulos</button></div>` : ""}
    </div>`;
  body.onclick = null;
  body.querySelector("[data-link-file2]")?.addEventListener("click", () => openAddDialog({ linkTo: song.id, onDone: () => { player.load(song.id, { source: "local", autoplay: false }); } }));
  body.querySelector("[data-whisper]")?.addEventListener("click", () => runWhisper(body, song));
  body.querySelector("[data-cancel]")?.addEventListener("click", () => activeJob && api.cancelJob(activeJob));
  body.querySelector("[data-paste]").onclick = async () => {
    const txt = body.querySelector("#lyrics-in").value;
    const { segments } = parseAny(txt, "letra.txt");
    if (!segments.length) return toast("Pega primero la letra", "err");
    await saveSegments(song, segments, "manual");
    if (api.cachedHealth.argos) await translateMissing(song);
    tab = "sync";
    toast("Letra guardada. Ahora sincronízala con la música.");
    bus.emit("sub:loaded", {});
  };
  body.querySelector("#sub-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const { kind, segments } = parseAny(await f.text(), f.name);
      if (!segments.length) throw new Error("No encontré frases en el archivo");
      await saveSegments(song, segments, kind);
      toast(`Importadas ${segments.length} frases`);
      if (api.cachedHealth.argos && segments.some((s) => !s.translation)) await translateMissing(song);
      tab = segments.some((s) => s.start == null) ? "sync" : "lyrics";
      bus.emit("sub:loaded", {});
    } catch (err) {
      toast(err.message, "err");
    }
  };
  body.querySelector("[data-translate]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Traduciendo…";
    await translateMissing(song, !missingTr);
    drawTab(song);
  });
  body.querySelectorAll("[data-exp]").forEach((b) => (b.onclick = () => {
    const segs = timedSegments(engine.state.rec);
    const base = `${song.artist} - ${song.title}`.replace(/[\\/:*?"<>|]+/g, "");
    const k = b.dataset.exp;
    if (k === "srt") downloadFile(`${base}.srt`, toSRT(segs), "text/plain");
    if (k === "vtt") downloadFile(`${base}.vtt`, toVTT(segs), "text/vtt");
    if (k === "lrc") downloadFile(`${base}.lrc`, toLRC(segs, song), "text/plain");
    if (k === "json") downloadFile(`${base}.json`, JSON.stringify(engine.state.rec, null, 2));
  }));
  body.querySelector("[data-delsubs]")?.addEventListener("click", async () => {
    if (!(await confirmBox("Borrar subtítulos", "Se borrarán los subtítulos de esta canción en el navegador.", "Borrar"))) return;
    await subtitleStore.remove(song.id);
  });
}

const modelLabel = (m) => ({ tiny: "Muy rápida (tiny, ~75 MB)", base: "Rápida (base, ~145 MB)", small: "Equilibrada (small, ~480 MB)", medium: "Precisa (medium, ~1,5 GB)", "large-v3": "Máxima (large-v3, ~3 GB)" })[m] || m;

async function runWhisper(body, song) {
  const model = body.querySelector("#wmodel").value;
  const translate = body.querySelector("#wtr").checked;
  settings.set("whisperModel", model);
  const prog = body.querySelector("#wprog");
  const bar = prog.querySelector(".progress div");
  const msg = body.querySelector("#wmsg");
  prog.hidden = false;
  body.querySelector("[data-whisper]").disabled = true;
  try {
    const r = await api.transcribe({ hash: song.mediaHash, model, translate, language: settings.get("sourceLang"), target: settings.get("targetLang"), force: true });
    let result;
    if (r.cached) result = { transcript: r.transcript };
    else {
      activeJob = r.job.id;
      result = await api.waitJob(r.job.id, (j) => {
        bar.style.width = `${Math.round(j.progress * 100)}%`;
        msg.textContent = j.message;
      });
    }
    if (result.warning) toast(result.warning, "err");
    const segs = result.transcript.segments;
    if (!segs.length) throw new Error("Whisper no detectó voz en este archivo");
    await saveSegments(song, segs, "whisper", { model, mediaHash: song.mediaHash });
    tab = "lyrics";
    toast(`Subtítulos generados: ${segs.length} frases`);
    bus.emit("sub:loaded", {});
  } catch (e) {
    toast(e.message, "err");
    msg.textContent = `Error: ${e.message}`;
    body.querySelector("[data-whisper]").disabled = false;
  } finally {
    activeJob = null;
  }
}

async function saveSegments(song, segments, source, extra = {}) {
  const old = engine.state.rec;
  const rec = await subtitleStore.save(song.id, { offset: old?.offset || 0, ...extra, segments: fillEndsIfTimed(segments), source }, { silent: true });
  await engine.setRecord(rec);
  if (song.mediaHash && api.cachedHealth.ok && source !== "whisper") api.saveTranscript(song.mediaHash, rec.segments).catch(() => {});
  return rec;
}

function fillEndsIfTimed(segs) {
  return segs.every((s) => s.start != null) ? fillEnds(segs.map((s) => ({ ...s }))) : segs;
}

async function translateMissing(song, all = false) {
  const rec = engine.state.rec;
  if (!rec) return;
  const todo = rec.segments.filter((s) => s.text && (all || !s.translation));
  if (!todo.length) return;
  try {
    const { translations } = await api.translate(todo.map((s) => s.text), settings.get("sourceLang"), settings.get("targetLang"));
    todo.forEach((s, i) => (s.translation = translations[i]));
    await saveSegments(song, rec.segments, rec.source, { model: rec.model, mediaHash: rec.mediaHash });
    toast("Traducción lista (Argos Translate)");
  } catch (e) {
    toast(`No se pudo traducir: ${e.message}`, "err");
  }
}

// ---------------------------------------------------------------------------
// Editor manual
function drawEditor(body, song) {
  const rec = engine.state.rec;
  const segs = (rec?.segments || []).map((s) => ({ ...s }));
  const row = (s, i) => `<div class="ed-row" data-i="${i}">
      <input type="text" data-f="start" value="${s.start == null ? "" : s.start.toFixed(2)}" placeholder="inicio" title="Inicio (segundos)" />
      <input type="text" data-f="end" value="${s.end == null ? "" : s.end.toFixed(2)}" placeholder="fin" title="Fin (segundos)" />
      <div class="txts"><input type="text" data-f="text" value="${esc(s.text)}" placeholder="Inglés" /><input type="text" data-f="translation" value="${esc(s.translation || "")}" placeholder="Español" /></div>
      <div style="display:flex;flex-direction:column;gap:2px"><button class="icon-btn" data-now="${i}" title="Poner el tiempo actual como inicio">⏱</button><button class="icon-btn" data-del="${i}" title="Borrar línea">✕</button><button class="icon-btn" data-ins="${i}" title="Insertar línea debajo">＋</button></div>
    </div>`;
  body.innerHTML = `<div style="padding:6px 8px">
    <p class="small muted">Corrige el texto, la traducción o los tiempos (en segundos). Si cambias una frase en inglés, borra su traducción y pulsa «Traducir vacías» para retraducirla.</p>
    <div class="row" style="margin-bottom:8px"><button class="btn primary small" data-save>💾 Guardar cambios</button><button class="btn small" data-add>＋ Añadir línea</button><button class="btn small" data-trans ${api.cachedHealth.argos ? "" : "disabled"}>🌐 Traducir vacías</button></div>
    <div id="ed-rows">${segs.map(row).join("") || '<p class="muted">No hay líneas. Añade una o pega la letra en «Crear subtítulos».</p>'}</div></div>`;
  const read = () =>
    [...body.querySelectorAll(".ed-row")].map((r) => {
      const v = (f) => r.querySelector(`[data-f="${f}"]`).value.trim();
      const num = (x) => (x === "" ? null : Number(x.replace(",", ".")));
      const orig = segs[Number(r.dataset.i)] || {};
      const text = v("text");
      return { ...orig, start: num(v("start")), end: num(v("end")), text, translation: v("translation"), ...(text !== orig.text ? { words: undefined, pron: undefined, ipa: undefined } : {}) };
    }).filter((s) => s.text);
  const redraw = (list) => {
    segs.splice(0, segs.length, ...list);
    body.querySelector("#ed-rows").innerHTML = segs.map(row).join("");
  };
  body.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.save != null) {
      const list = read();
      if (list.some((s) => s.start != null && (isNaN(s.start) || (s.end != null && s.end < s.start)))) return toast("Revisa los tiempos: hay alguno no válido", "err");
      list.sort((a, b2) => (a.start ?? 1e9) - (b2.start ?? 1e9));
      await saveSegments(song, list, "edited", { model: rec?.model, mediaHash: rec?.mediaHash || song.mediaHash });
      toast("Cambios guardados");
    } else if (b.dataset.add != null) {
      const list = read();
      list.push({ start: player.time() ? Math.round(engine.adjusted(player.time()) * 100) / 100 : null, end: null, text: "Nueva línea", translation: "" });
      redraw(list);
    } else if (b.dataset.del != null) {
      const list = read();
      list.splice(Number(b.dataset.del), 1);
      redraw(list);
    } else if (b.dataset.ins != null) {
      const list = read();
      list.splice(Number(b.dataset.ins) + 1, 0, { start: null, end: null, text: "", translation: "" });
      redraw(list);
      body.querySelectorAll(".ed-row")[Number(b.dataset.ins) + 1]?.querySelector('[data-f="text"]').focus();
    } else if (b.dataset.now != null) {
      const r = body.querySelectorAll(".ed-row")[Number(b.dataset.now)];
      r.querySelector('[data-f="start"]').value = engine.adjusted(player.time()).toFixed(2);
    } else if (b.dataset.trans != null) {
      const list = read();
      const todo = list.filter((s) => !s.translation);
      if (!todo.length) return toast("No hay líneas sin traducir");
      try {
        const { translations } = await api.translate(todo.map((s) => s.text));
        todo.forEach((s, i) => (s.translation = translations[i]));
        redraw(list);
        toast("Traducidas. Pulsa Guardar para conservarlas.");
      } catch (err) {
        toast(err.message, "err");
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Sincronización manual ("tap to sync")
function drawSync(body, song) {
  const rec = engine.state.rec;
  const lines = (rec?.segments || []).filter((s) => s.text);
  if (!lines.length) {
    body.innerHTML = `<div class="empty" style="margin:10px"><b>Primero necesitas la letra</b>Pégala o impórtala en «Crear subtítulos».</div>`;
    return;
  }
  let pos = 0;
  const marks = lines.map((s) => s.start);
  const work = lines.map((s) => ({ text: s.text, translation: s.translation || "" }));
  body.innerHTML = `<div class="sync-box">
      <p class="small muted">Reproduce la canción y pulsa <span class="kbd">Marcar</span> (o la tecla <span class="kbd">S</span>) justo cuando empieza cada frase. <span class="kbd">Z</span> deshace la última marca. Puedes bajar la velocidad a 0,75x para hacerlo más fácil; los tiempos se guardan igual.</p>
      <div class="row" style="justify-content:center"><button class="btn" data-restart>⏮ Empezar desde el principio</button><button class="btn" data-toggleplay>⏯ Reproducir/pausa</button></div>
      <div class="small dim" style="margin-top:14px" id="sy-count"></div>
      <div class="now" id="sy-now"></div>
      <div class="nxt" id="sy-next"></div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn" data-undo>↶ Deshacer (Z)</button><button class="btn primary" data-mark style="padding:16px 36px;font-size:18px">Marcar (S)</button><button class="btn" data-skip>Saltar línea</button></div>
      <div class="row" style="justify-content:center;margin-top:18px"><button class="btn primary" data-finish>💾 Guardar sincronización</button></div>
    </div>`;
  const view = () => {
    body.querySelector("#sy-count").textContent = `Frase ${Math.min(pos + 1, work.length)} de ${work.length} · marcadas ${marks.filter((m) => m != null).length}`;
    body.querySelector("#sy-now").textContent = pos < work.length ? work[pos].text : "✓ Has llegado al final. Pulsa Guardar.";
    body.querySelector("#sy-next").textContent = work[pos + 1]?.text || "";
  };
  const mark = () => {
    if (pos >= work.length) return;
    marks[pos] = Math.round(engine.adjusted(player.time()) * 100) / 100;
    pos++;
    view();
  };
  const undo = () => {
    if (pos === 0) return;
    pos--;
    marks[pos] = null;
    view();
  };
  body.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mark != null) mark();
    if (b.dataset.undo != null) undo();
    if (b.dataset.skip != null) { pos = Math.min(work.length, pos + 1); view(); }
    if (b.dataset.restart != null) { pos = 0; marks.fill(null); player.seek(0); player.resume(); view(); }
    if (b.dataset.toggleplay != null) player.toggle();
    if (b.dataset.finish != null) {
      const timed = work.map((w, i) => ({ ...w, start: marks[i] })).filter((s) => s.start != null);
      if (!timed.length) return toast("No has marcado ninguna frase", "err");
      const untimed = work.filter((_, i) => marks[i] == null).length;
      const segs = fillEnds(timed.sort((a, b2) => a.start - b2.start));
      await saveSegments(song, segs, "sync", { mediaHash: song.mediaHash });
      toast(`Sincronización guardada${untimed ? ` (${untimed} frases sin marcar se han omitido)` : ""}`);
      tab = "lyrics";
      bus.emit("sub:loaded", {});
    }
  };
  const key = (e) => {
    if (tab !== "sync" || e.target.matches("input,textarea,select")) return;
    if (e.key === "s" || e.key === "S") { e.preventDefault(); mark(); }
    if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
  };
  document.addEventListener("keydown", key);
  const off = bus.on("route", () => { document.removeEventListener("keydown", key); off(); });
  const off2 = bus.on("sub:loaded", () => { document.removeEventListener("keydown", key); off2(); });
  view();
}

export { go };
