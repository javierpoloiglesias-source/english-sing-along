/**
 * Motor de sincronización: une el reproductor con los subtítulos de la
 * canción actual. Emite "sub:index" (frase actual) y "sub:time".
 */
import { bus } from "../core/bus.js";
import { settings } from "../core/settings.js";
import { subtitleStore, findIndex, timedSegments } from "./store.js";
import { player } from "../player/player.js";
import { pronounce } from "../learn/pronunciation.js";
import { $, esc } from "../core/utils.js";

const st = { songId: null, rec: null, segs: [], index: -1, time: 0 };

export const engine = {
  state: st,
  /** Tiempo del reproductor corregido con el desfase de la canción. */
  adjusted: (t) => t - (st.rec?.offset || 0) - (settings.get("subtitleOffset") || 0),
  async loadFor(songId) {
    st.songId = songId;
    st.rec = songId ? await subtitleStore.get(songId) : null;
    st.segs = timedSegments(st.rec);
    st.index = -1;
    bus.emit("sub:loaded", { ...st });
    update(player.time());
  },
  async setRecord(rec) {
    st.rec = rec;
    st.segs = timedSegments(rec);
    st.index = -1;
    bus.emit("sub:loaded", { ...st });
    update(player.time());
  },
  async setOffset(off) {
    if (!st.rec) return;
    st.rec.offset = Math.round(off * 100) / 100;
    await subtitleStore.save(st.songId, st.rec, { silent: true });
    update(player.time());
  },
  current: () => st.segs[st.index] || null,
  /** Añade pronunciación (aprox. + IPA) a un segmento y la guarda. */
  async ensurePron(seg) {
    if (!seg || seg.pron || !seg.text) return seg;
    const p = await pronounce(seg.text);
    if (p) {
      seg.pron = p.approx;
      seg.ipa = p.ipa;
      clearTimeout(engine._saveT);
      engine._saveT = setTimeout(() => st.rec && subtitleStore.save(st.songId, st.rec, { silent: true }), 1500);
    }
    return seg;
  },
  seekTo(i, play = true) {
    const s = st.segs[i];
    if (!s) return;
    const off = (st.rec?.offset || 0) + (settings.get("subtitleOffset") || 0);
    player.seek(Math.max(0, s.start + off - 0.05));
    if (play && !player.isPlaying()) player.resume();
  },
  /** Repite en bucle la frase i. */
  loopLine(i) {
    const s = st.segs[i];
    if (!s) return;
    const off = (st.rec?.offset || 0) + (settings.get("subtitleOffset") || 0);
    player.setLoop(s.start + off - 0.1, s.end + off + 0.15, s.text);
  },
  playLine(i) {
    const s = st.segs[i];
    if (!s) return;
    const off = (st.rec?.offset || 0) + (settings.get("subtitleOffset") || 0);
    player.playSegment(s.start + off - 0.1, s.end + off + 0.15);
  },
  absTime(t) {
    return t + (st.rec?.offset || 0) + (settings.get("subtitleOffset") || 0);
  },
};

function update(rawTime) {
  const t = engine.adjusted(rawTime);
  st.time = t;
  const i = st.segs.length ? findIndex(st.segs, t) : -1;
  if (i !== st.index) {
    st.index = i;
    bus.emit("sub:index", { index: i, seg: st.segs[i] || null });
    renderOverlay();
  }
  bus.emit("sub:time", { time: t, index: i });
}

function renderOverlay() {
  const el = $("#stage-subs");
  if (!el) return;
  const s = st.segs[st.index];
  if (!s) {
    el.innerHTML = "";
    return;
  }
  const showEs = settings.get("showTranslation");
  const showPr = settings.get("showPronunciation");
  el.innerHTML = `<span class="en">${esc(s.text)}</span>${showPr && s.pron ? `<span class="pr">${esc(s.pron)}</span>` : ""}${showEs && s.translation ? `<span class="es">${esc(s.translation)}</span>` : ""}`;
  if (showPr && !s.pron) engine.ensurePron(s).then(() => st.segs[st.index] === s && renderOverlay());
}

bus.on("player:time", ({ time }) => update(time));
bus.on("player:song", ({ song }) => engine.loadFor(song.id));
bus.on("settings", renderOverlay);
bus.on("subtitles:changed", ({ songId }) => {
  if (songId === st.songId) subtitleStore.get(songId).then((rec) => {
    st.rec = rec;
    st.segs = timedSegments(rec);
    st.index = -1;
    bus.emit("sub:loaded", { ...st });
    update(player.time());
  });
});
