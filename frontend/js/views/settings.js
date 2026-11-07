/** CONFIGURACIÓN */
import { settings, DEFAULT_SETTINGS } from "../core/settings.js";
import { api } from "../core/api.js";
import { library } from "../core/library.js";
import { exportAll, importAll, wipeAll } from "../core/db.js";
import { esc, downloadFile } from "../core/utils.js";
import { toast, confirmBox } from "../ui/components.js";
import { englishVoices, speak } from "../learn/pronunciation.js";
import { RATES } from "../player/player.js";
import { refreshServerStatus } from "../main.js";

const LANGS = { en: "Inglés", es: "Español", fr: "Francés", de: "Alemán", it: "Italiano", pt: "Portugués" };
const sw = (key) => `<label class="switch"><input type="checkbox" data-set="${key}" ${settings.get(key) ? "checked" : ""}/><span></span></label>`;
const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

export async function settingsView(el) {
  const h = await api.health(true);
  const storage = h.ok ? await api.storage().catch(() => null) : null;
  const media = h.ok ? await api.listMedia().catch(() => []) : [];
  const est = (await navigator.storage?.estimate?.()) || {};
  const persisted = await navigator.storage?.persisted?.();
  const ys = library.ytSummary();
  const voices = englishVoices();
  const item = (label, help, control) => `<div class="set-item"><div class="lbl">${label}${help ? `<small>${help}</small>` : ""}</div>${control}</div>`;
  el.innerHTML = `
    <h1>Configuración</h1>
    <p class="sub">Todo se guarda automáticamente en tu ordenador.</p>
    <div class="set-grid">
      <section class="card"><h3>Idiomas</h3>
        ${item("Idioma original", "Idioma de las canciones (Whisper)", `<select data-sel="sourceLang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${settings.get("sourceLang") === k ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
        ${item("Idioma de traducción", "Argos descarga el paquete de idioma la primera vez", `<select data-sel="targetLang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${settings.get("targetLang") === k ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
      </section>
      <section class="card"><h3>Subtítulos</h3>
        ${item("Tamaño de subtítulos", `${settings.get("subtitleSize")} %`, `<input type="range" min="70" max="180" step="10" value="${settings.get("subtitleSize")}" data-range="subtitleSize" style="width:160px" />`)}
        ${item("Mostrar traducción", "", sw("showTranslation"))}
        ${item("Mostrar pronunciación aproximada", "Orientativa, no es una transcripción exacta", sw("showPronunciation"))}
        ${item("Mostrar IPA", "Alfabeto fonético internacional", sw("showIPA"))}
        ${item("Abrir en modo karaoke", "Al abrir una canción con subtítulos", sw("karaokeDefault"))}
        ${item("Ajuste global de sincronía", "Segundos (positivo = subtítulos más tarde)", `<input type="number" step="0.1" value="${settings.get("subtitleOffset")}" data-num="subtitleOffset" style="width:90px" />`)}
      </section>
      <section class="card"><h3>Reproducción y voz</h3>
        ${item("Velocidad por defecto", "", `<select data-sel="playbackRate" data-numeric>${RATES.map((r) => `<option value="${r}" ${settings.get("playbackRate") === r ? "selected" : ""}>${String(r).replace(".", ",")}x</option>`).join("")}</select>`)}
        ${item("Motor de voz para pronunciación", h.espeak ? "eSpeak NG detectado" : "eSpeak NG no instalado (opcional)", `<select data-sel="ttsEngine"><option value="browser" ${settings.get("ttsEngine") === "browser" ? "selected" : ""}>Voz de Windows/navegador</option><option value="espeak" ${settings.get("ttsEngine") === "espeak" ? "selected" : ""} ${h.espeak ? "" : "disabled"}>eSpeak NG</option></select>`)}
        ${item("Voz inglesa", voices.length ? `${voices.length} voces disponibles` : "No se encontraron voces inglesas en el sistema", `<select data-sel="ttsVoice"><option value="">Automática</option>${voices.map((v) => `<option ${settings.get("ttsVoice") === v.name ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>`)}
        ${item("Velocidad de la voz", `${settings.get("ttsRate")}x`, `<input type="range" min="0.5" max="1.3" step="0.1" value="${settings.get("ttsRate")}" data-range="ttsRate" style="width:140px" />`)}
        <button class="btn small" data-testvoice>🔊 Probar: “How are you?”</button>
      </section>
      <section class="card"><h3>Procesamiento (IA local)</h3>
        ${item("Calidad de Whisper", "Más calidad = más lento y más memoria", `<select data-sel="whisperModel">${["tiny", "base", "small", "medium", "large-v3"].map((m) => `<option ${settings.get("whisperModel") === m ? "selected" : ""}>${m}</option>`).join("")}</select>`)}
        ${item("Traducir automáticamente al generar", "", sw("autoTranslate"))}
        <div class="small" style="line-height:1.9;margin-top:8px">
          ${status("Servidor local", h.ok, h.ok ? `v${h.version}` : "no responde: arranca con iniciar.bat")}
          ${status("Whisper (faster-whisper)", h.whisper, h.whisper ? (h.device?.device === "cuda" ? "GPU NVIDIA" : "CPU") : "no instalado")}
          ${status("Argos Translate", h.argos, h.argos ? `paquetes: ${(h.argos_pairs || []).join(", ") || "ninguno aún"}` : "no instalado")}
          ${status("Diccionario de pronunciación CMU", h.cmudict, "")}
          ${status("eSpeak NG", !!h.espeak, h.espeak ? "" : "opcional")}
        </div>
        ${h.argos && !(h.argos_pairs || []).includes(`${settings.get("sourceLang")}-${settings.get("targetLang")}`) ? `<button class="btn small" data-install>⬇ Descargar paquete ${settings.get("sourceLang")}→${settings.get("targetLang")} (gratis, una vez)</button>` : ""}
      </section>
      <section class="card"><h3>YouTube</h3>
        <p class="small muted">Los vídeos del catálogo se comprueban en tu PC con el servicio público oEmbed de YouTube (solo título y autor). No se descarga vídeo ni audio.</p>
        ${item("Verificar vídeos al iniciar", "", sw("verifyYouTube"))}
        <p class="small">Verificados: <b>${ys.verified}</b> · pendientes: ${ys.pending + ys.offline} · no coinciden: ${ys.mismatch} · no disponibles: ${ys.unavailable}</p>
        <button class="btn small" data-verify ${h.ok ? "" : "disabled"}>↻ Verificar ahora</button>
      </section>
      <section class="card"><h3>Ubicación de los archivos</h3>
        ${storage ? `<p class="small muted">Carpeta de datos del servidor (archivos subidos, modelos de IA y base de datos SQLite):</p>
          <input type="text" id="datadir" value="${esc(storage.data_dir)}" />
          <div class="row" style="margin-top:8px"><button class="btn small" data-setdir>Cambiar carpeta</button><span class="small dim">${storage.media_count} archivos · ${fmtBytes(storage.media_bytes)} en medios · ${fmtBytes(storage.total_bytes)} en total</span></div>` : `<p class="small muted">Arranca el servidor local para ver y cambiar la carpeta de datos.</p>`}
        ${media.length ? `<h3>Archivos locales</h3>${media.map((m) => `<div class="set-item"><div class="lbl" style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(m.filename)}<small>${fmtBytes(m.size)}${m.has_transcript ? " · con transcripción" : ""}</small></div><button class="btn small danger" data-delmedia="${m.hash}">Borrar</button></div>`).join("")}` : ""}
      </section>
      <section class="card"><h3>Preferencias de almacenamiento</h3>
        <p class="small muted">Favoritos, listas, historial, subtítulos y vocabulario se guardan en el navegador (IndexedDB). Uso actual: ${est.usage ? fmtBytes(est.usage) : "desconocido"}.</p>
        ${item("Protección contra borrado automático", persisted ? "Activada" : "Pide al navegador que no borre los datos", persisted ? "✓" : `<button class="btn small" data-persist>Activar</button>`)}
        <div class="row" style="margin-top:10px">
          <button class="btn small" data-export>⬇ Exportar copia de seguridad</button>
          <label class="btn small">⬆ Importar copia<input type="file" accept=".json" hidden data-import /></label>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn small" data-reset>Restablecer ajustes</button><button class="btn small danger" data-wipe>Borrar todos mis datos</button></div>
      </section>
    </div>
    <p class="small dim" style="margin-top:24px">English Sing Along · 100 % gratuito y local. Sin cuentas, sin telemetría, sin claves de API. Whisper, Argos Translate, CMUdict y eSpeak NG son proyectos de código abierto.</p>`;

  el.querySelectorAll("[data-set]").forEach((i) => (i.onchange = () => settings.set(i.dataset.set, i.checked)));
  el.querySelectorAll("[data-sel]").forEach((s) => (s.onchange = () => { settings.set(s.dataset.sel, s.hasAttribute("data-numeric") ? Number(s.value) : s.value); if (s.dataset.sel === "targetLang" || s.dataset.sel === "sourceLang") settingsView(el); }));
  el.querySelectorAll("[data-range]").forEach((r) => (r.oninput = () => { settings.set(r.dataset.range, Number(r.value)); r.closest(".set-item").querySelector("small").textContent = r.dataset.range === "ttsRate" ? `${r.value}x` : `${r.value} %`; }));
  el.querySelectorAll("[data-num]").forEach((r) => (r.onchange = () => settings.set(r.dataset.num, Number(r.value) || 0)));
  el.querySelector("[data-testvoice]").onclick = () => speak("How are you?").catch((e) => toast(e.message, "err"));
  el.querySelector("[data-install]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Descargando… (puede tardar unos minutos)";
    try {
      await api.installPair(settings.get("sourceLang"), settings.get("targetLang"));
      toast("Paquete de idioma instalado");
      settingsView(el);
      refreshServerStatus();
    } catch (err) {
      toast(err.message, "err");
      e.target.disabled = false;
    }
  });
  el.querySelector("[data-verify]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Verificando…";
    const r = await library.verifyCatalog({ force: true });
    toast(r.skipped ? `No se pudo verificar: ${r.skipped}` : `Comprobados ${r.checked} vídeos`);
    settingsView(el);
  });
  el.querySelector("[data-setdir]")?.addEventListener("click", async () => {
    try {
      const r = await api.setStorage(el.querySelector("#datadir").value.trim());
      toast(r.note);
    } catch (err) {
      toast(err.message, "err");
    }
  });
  el.querySelectorAll("[data-delmedia]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox("Borrar archivo", "Se borrará la copia local del archivo y su transcripción del servidor.", "Borrar"))) return;
    await api.deleteMedia(b.dataset.delmedia);
    for (const s of library.all()) if (s.mediaHash === b.dataset.delmedia) {
      if (s.source === "local") await library.removeSong(s.id);
      else await library.updateSong(s.id, { mediaHash: null, mediaUrl: null, preferSource: null });
    }
    settingsView(el);
  }));
  el.querySelector("[data-persist]")?.addEventListener("click", async () => {
    const ok = await navigator.storage.persist();
    toast(ok ? "Protección activada" : "El navegador no lo ha permitido");
    settingsView(el);
  });
  el.querySelector("[data-export]").onclick = async () => {
    const data = await exportAll();
    data.songs = data.songs.map(({ blob, ...s }) => s); // los archivos no se incluyen
    downloadFile(`english-sing-along-copia-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
  };
  el.querySelector("[data-import]").onchange = async (e) => {
    try {
      await importAll(JSON.parse(await e.target.files[0].text()));
      toast("Copia importada. Recargando…");
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast(err.message, "err");
    }
  };
  el.querySelector("[data-reset]").onclick = async () => { await settings.reset(); settingsView(el); toast("Ajustes restablecidos"); };
  el.querySelector("[data-wipe]").onclick = async () => {
    if (!(await confirmBox("Borrar todos mis datos", "Se borrarán favoritos, listas, historial, subtítulos, vocabulario y ajustes de este navegador. No se puede deshacer.", "Borrar todo"))) return;
    await wipeAll();
    location.reload();
  };
  void DEFAULT_SETTINGS;
}

function status(name, ok, extra) {
  return `<div><span class="dot ${ok ? "ok" : "err"}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ok ? "var(--ok)" : "var(--err)"};margin-right:6px"></span>${esc(name)}${extra ? ` <span class="dim">— ${esc(extra)}</span>` : ""}</div>`;
}
