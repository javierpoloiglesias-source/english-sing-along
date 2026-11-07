/** APRENDER INGLÉS: práctica por nivel, frases, vocabulario y repaso. */
import { library } from "../core/library.js";
import { api } from "../core/api.js";
import { bus } from "../core/bus.js";
import { esc, fmtTime, downloadFile } from "../core/utils.js";
import { LEVELS } from "../data/catalog.js";
import { rows, empty, toast, confirmBox } from "../ui/components.js";
import { vocab, phrases } from "../learn/study.js";
import { speak, pronounce } from "../learn/pronunciation.js";
import { subtitleStore } from "../subtitles/store.js";
import { playSong } from "../ui/actions.js";
import { player } from "../player/player.js";
import { query, go } from "../ui/router.js";

let tab = "levels";

export async function learnView(el) {
  const nivel = Number(query().get("nivel") || 0);
  if (nivel) tab = "levels";
  let level = nivel || 1;
  const draw = async () => {
    const [words, phr, subs] = await Promise.all([vocab.list(), phrases.list(), subtitleStore.list()]);
    const learned = words.filter((w) => w.learned);
    el.innerHTML = `
      <h1>Aprender inglés</h1>
      <p class="sub">Practica con las canciones: escucha cada frase, repítela, mira su pronunciación y guarda las palabras nuevas.</p>
      <div class="stats">
        <div class="stat"><b>${subs.length}</b><span class="small muted">canciones con subtítulos</span></div>
        <div class="stat"><b>${words.length}</b><span class="small muted">palabras guardadas</span></div>
        <div class="stat"><b>${learned.length}</b><span class="small muted">palabras aprendidas</span></div>
        <div class="stat"><b>${phr.filter((p) => p.difficult).length}</b><span class="small muted">frases difíciles</span></div>
      </div>
      <div class="tabs" style="margin-top:20px">
        ${[["levels", "Practicar por nivel"], ["phrases", "Frases marcadas"], ["vocab", "Vocabulario"], ["learned", "Palabras aprendidas"], ["review", "Repaso"]].map(([t, l]) => `<button class="chip ${tab === t ? "on" : ""}" data-tab="${t}">${l}</button>`).join("")}
      </div>
      <div id="learn-body"></div>`;
    el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
    const body = el.querySelector("#learn-body");
    if (tab === "levels") drawLevels(body, level, subs, (l) => { level = l; draw(); });
    if (tab === "phrases") drawPhrases(body, phr);
    if (tab === "vocab") drawVocab(body, words.filter((w) => !w.learned), false);
    if (tab === "learned") drawVocab(body, learned, true);
    if (tab === "review") drawReview(body, words.filter((w) => !w.learned));
  };
  await draw();
  const offs = [bus.on("favorites", draw)];
  return () => offs.forEach((o) => o());
}

function drawLevels(body, level, subs, setLevel) {
  const withSubs = new Set(subs.map((s) => s.songId));
  const list = library.all().filter((s) => s.level === level);
  const ready = list.filter((s) => withSubs.has(s.id));
  body.innerHTML = `
    <div class="tabs">${[1, 2, 3].map((l) => `<button class="chip ${l === level ? "on" : ""}" data-l="${l}">${LEVELS[l]}</button>`).join("")}</div>
    <p class="small muted">${{ 1: "Letras lentas y claras, vocabulario cotidiano.", 2: "Ritmo normal, expresiones coloquiales.", 3: "Rápidas, rap o vocabulario complejo." }[level]}
    El nivel es una estimación editorial.</p>
    ${ready.length ? `<h3>Listas para practicar (ya tienen subtítulos)</h3>${rows(ready)}` : ""}
    <h3>Todas las canciones de nivel ${LEVELS[level].toLowerCase()} (${list.length})</h3>
    <p class="small dim">Abre una canción y en «Crear subtítulos» genera la letra con Whisper desde tu archivo, pégala o impórtala.</p>
    ${rows(list)}`;
  body.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => setLevel(Number(b.dataset.l))));
}

function drawPhrases(body, list) {
  let filter = "difficult";
  const draw = () => {
    const items = list.filter((p) => (filter === "all" ? true : p[filter]));
    body.innerHTML = `
      <div class="tabs">${[["difficult", "Difíciles ⚑"], ["saved", "Guardadas ★"], ["all", "Todas"]].map(([f, l]) => `<button class="chip ${f === filter ? "on" : ""}" data-f="${f}">${l}</button>`).join("")}</div>
      ${items.length ? items.map((p) => {
        const s = library.get(p.songId);
        return `<div class="card" style="margin-bottom:8px" data-id="${esc(p.id)}">
          <div style="font-size:18px;font-weight:700">${esc(p.text)}</div>
          <div class="pr" style="color:var(--pron);font-style:italic" data-pr></div>
          <div style="color:var(--es)">${esc(p.translation)}</div>
          <div class="row small muted" style="margin-top:8px">${s ? `${esc(s.title)} · ${esc(s.artist)} · ${fmtTime(p.start)}` : "Canción eliminada"} ${p.practiced ? `· practicada ${p.practiced} ${p.practiced === 1 ? "vez" : "veces"}` : ""}
            <span class="spacer"></span>
            ${s ? `<button class="btn small" data-a="song">▶ En la canción</button><button class="btn small" data-a="loop">⟳ Repetir</button>` : ""}
            <button class="btn small" data-a="tts">🔊 Voz</button><button class="btn small" data-a="slow">🐢</button><button class="btn small" data-a="pron">Pronunciación</button><button class="btn small danger" data-a="del">✕</button></div></div>`;
      }).join("") : empty("Nada por aquí", "En la letra de una canción, marca frases con ⚑ (difícil) o ★ (guardar).")}`;
    body.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
    body.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
      const card = b.closest("[data-id]");
      const p = list.find((x) => x.id === card.dataset.id);
      const a = b.dataset.a;
      if (a === "song" || a === "loop") {
        await player.play(p.songId, null, { start: Math.max(0, p.start - 0.2) });
        if (a === "loop") setTimeout(() => player.setLoop(p.start - 0.1, p.end + 0.15, p.text), 1200);
        phrases.practiced(p.id);
      }
      if (a === "tts" || a === "slow") { speak(p.text, a === "slow" ? { rate: 0.6 } : {}).catch((e) => toast(e.message, "err")); phrases.practiced(p.id); }
      if (a === "pron") {
        const r = await pronounce(p.text);
        card.querySelector("[data-pr]").textContent = r ? `${r.approx}   /${r.ipa}/` : "Arranca el servidor local para ver la pronunciación.";
      }
      if (a === "del") { await phrases.remove(p.id); list.splice(list.indexOf(p), 1); draw(); }
    }));
  };
  draw();
}

function drawVocab(body, words, learnedView) {
  body.innerHTML = `
    <div class="toolbar">
      <form id="addw" class="row" style="flex:1"><input type="text" name="w" placeholder="Añadir palabra en inglés…" style="max-width:280px" /><button class="btn">＋ Añadir</button></form>
      ${words.length ? `<button class="btn small" data-csv>⬇ Exportar CSV</button>` : ""}
    </div>
    ${words.length ? words.map((w) => `<div class="vocab-item ${w.learned ? "learned" : ""}" data-w="${esc(w.word)}">
        <div><div class="wd">${esc(w.word)}</div><div class="small" style="color:var(--pron)">${esc(w.approx || "")} ${w.ipa ? `<span style="color:#c6b7ff">/${esc(w.ipa)}/</span>` : ""}</div>${w.context ? `<div class="small dim">«${esc(w.context)}»</div>` : ""}</div>
        <input type="text" value="${esc(w.translation || "")}" placeholder="Traducción" data-tr />
        <div class="row" style="gap:2px"><button class="icon-btn" data-a="say" title="Escuchar">🔊</button>
          <button class="icon-btn ${w.learned ? "on" : ""}" data-a="learn" title="${w.learned ? "Volver a pendientes" : "Marcar como aprendida"}">✓</button>
          <button class="icon-btn" data-a="del" title="Borrar">✕</button></div></div>`).join("") : empty(learnedView ? "Aún no has marcado palabras como aprendidas" : "Tu vocabulario está vacío", learnedView ? "Marca palabras con ✓ en Vocabulario o en Repaso." : "Pulsa cualquier palabra de una letra y elige «Guardar en vocabulario».")}`;
  body.querySelector("#addw").onsubmit = async (e) => {
    e.preventDefault();
    const w = new FormData(e.target).get("w").trim();
    if (!w) return;
    const p = await pronounce(w);
    await vocab.add({ word: w, ipa: p?.ipa || "", approx: p?.approx || "" });
    toast("Palabra añadida");
    go("#/aprender");
  };
  body.querySelector("[data-csv]")?.addEventListener("click", () => {
    const csv = ["palabra;traduccion;pronunciacion;ipa;contexto;aprendida", ...words.map((w) => [w.word, w.translation, w.approx, w.ipa, w.context, w.learned ? "si" : "no"].map((x) => `"${String(x || "").replace(/"/g, '""')}"`).join(";"))].join("\n");
    downloadFile("vocabulario-english-sing-along.csv", "﻿" + csv, "text/csv");
  });
  body.querySelectorAll(".vocab-item").forEach((item) => {
    const w = item.dataset.w;
    item.querySelector("[data-tr]").onchange = (e) => vocab.update(w, { translation: e.target.value.trim() });
    item.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.a === "say") speak(w).catch((e) => toast(e.message, "err"));
      if (b.dataset.a === "learn") {
        const rec = await vocab.get(w);
        await vocab.update(w, { learned: !rec.learned });
        item.remove();
        toast(rec.learned ? "Vuelve a pendientes" : "¡Aprendida! ✓");
      }
      if (b.dataset.a === "del" && (await confirmBox("Borrar palabra", `¿Borrar «${w}» de tu vocabulario?`, "Borrar"))) {
        await vocab.remove(w);
        item.remove();
      }
    }));
  });
}

function drawReview(body, words) {
  if (!words.length) {
    body.innerHTML = empty("No hay palabras para repasar", "Guarda palabras desde las letras de las canciones.");
    return;
  }
  const deck = [...words].sort((a, b) => (a.reviews || 0) - (b.reviews || 0) || Math.random() - 0.5);
  let i = 0, shown = false;
  const draw = () => {
    const w = deck[i];
    if (!w) {
      body.innerHTML = `<div class="flash"><div class="big">🎉</div><p>Has repasado todas las palabras.</p><button class="btn primary" data-again>Repasar otra vez</button></div>`;
      body.querySelector("[data-again]").onclick = () => drawReview(body, words);
      return;
    }
    body.innerHTML = `<div class="flash">
      <div class="small dim">${i + 1} / ${deck.length}</div>
      <div class="big">${esc(w.word)}</div>
      <button class="btn small" data-say style="margin:8px 0">🔊 Escuchar</button>
      ${shown ? `<div style="color:var(--pron);font-style:italic;font-size:20px">${esc(w.approx || "")}</div><div style="color:#c6b7ff">${w.ipa ? `/${esc(w.ipa)}/` : ""}</div><div style="color:var(--es);font-size:26px;font-weight:800;margin-top:10px">${esc(w.translation || "(sin traducción)")}</div>${w.context ? `<p class="small dim">«${esc(w.context)}»</p>` : ""}
        <div class="row" style="justify-content:center;margin-top:16px"><button class="btn" data-again1>↻ Otra vez</button><button class="btn primary" data-know>✓ Me la sé</button></div>`
      : `<div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" data-show>Ver traducción</button></div>`}
    </div>`;
    body.querySelector("[data-say]").onclick = () => speak(w.word).catch((e) => toast(e.message, "err"));
    body.querySelector("[data-show]")?.addEventListener("click", () => { shown = true; draw(); });
    body.querySelector("[data-again1]")?.addEventListener("click", async () => { await vocab.update(w.word, { reviews: (w.reviews || 0) + 1 }); deck.push(w); i++; shown = false; draw(); });
    body.querySelector("[data-know]")?.addEventListener("click", async () => { await vocab.update(w.word, { reviews: (w.reviews || 0) + 1, learned: true }); i++; shown = false; draw(); });
  };
  draw();
}

export { playSong };
