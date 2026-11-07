/**
 * Controlador único del reproductor persistente.
 *
 * Arquitectura (separa tres cosas distintas):
 *  1. Reproducción multimedia → MediaAdapter (archivos locales) o
 *     YouTubeAdapter (reproductor oficial).
 *  2. Acceso al audio para reconocimiento → SOLO archivos locales, que se
 *     envían al servidor LOCAL (127.0.0.1). YouTube no expone su audio.
 *  3. Subtítulos → subtitles/engine.js escucha el evento "time" de aquí.
 */
import { bus } from "../core/bus.js";
import { library } from "../core/library.js";
import { settings } from "../core/settings.js";
import { MediaAdapter } from "./media-adapter.js";
import { YouTubeAdapter } from "./youtube-adapter.js";

export const RATES = [0.5, 0.75, 1, 1.25, 1.5];

const state = {
  queue: [],
  index: -1,
  song: null,
  source: null, // "local" | "youtube"
  status: "idle",
  rate: 1,
  volume: 0.9,
  muted: false,
  repeat: "off", // off | one | all
  loop: null, // {a, b, label}
  error: null,
};

let media, yt, active = null;
let prepareHook = null; // modo automático: prepara letra y vídeo antes de sonar
let loadSeq = 0;
let raf = 0, lastEmit = 0;

function events(kind) {
  return {
    onState: (s) => {
      if (active?.kind !== kind) return;
      state.status = s;
      bus.emit("player:state", { ...state });
    },
    onEnded: () => active?.kind === kind && onEnded(),
    onReady: (d) => {
      if (active?.kind !== kind) return;
      if (state.song) library.setDuration(state.song.id, d);
      bus.emit("player:ready", { duration: d });
    },
    onError: (msg, code) => {
      if (active?.kind !== kind) return;
      state.error = msg;
      state.status = "error";
      bus.emit("player:error", { message: msg, code, song: state.song });
      bus.emit("player:state", { ...state });
    },
    onRate: (r) => {
      state.rate = r;
      bus.emit("player:state", { ...state });
    },
  };
}

function tick() {
  raf = requestAnimationFrame(tick);
  if (!active) return;
  const now = performance.now();
  if (now - lastEmit < 50) return; // 20 veces por segundo es suficiente
  lastEmit = now;
  const t = active.time();
  if (state.loop && active.isPlaying() && t >= state.loop.b) active.seek(state.loop.a);
  bus.emit("player:time", { time: t, duration: active.duration() });
}

function onEnded() {
  if (state.repeat === "one") {
    active.seek(0);
    active.play();
    return;
  }
  if (state.index < state.queue.length - 1) player.next();
  else if (state.repeat === "all" && state.queue.length) player.playIndex(0);
  else {
    state.status = "ended";
    bus.emit("player:state", { ...state });
  }
}

/** Fuente reproducible de una canción: archivo local primero si el usuario lo eligió. */
export function sourcesFor(song) {
  const out = [];
  const url = song.mediaUrl || (song.blob ? URL.createObjectURL(song.blob) : song.tempUrl);
  if (url) out.push({ type: "local", url });
  const ytId = library.youtubeId(song);
  if (ytId) out.push({ type: "youtube", id: ytId });
  if (song.preferSource === "youtube") out.sort((a) => (a.type === "youtube" ? -1 : 1));
  return out;
}

export const player = {
  state,
  RATES,
  init({ videoEl, ytHost }) {
    media = new MediaAdapter(videoEl, events("media"));
    yt = new YouTubeAdapter(ytHost, events("youtube"));
    state.rate = settings.get("playbackRate") || 1;
    cancelAnimationFrame(raf);
    tick();
  },
  get adapter() { return active; },
  time: () => active?.time() || 0,
  duration: () => active?.duration() || 0,
  isPlaying: () => !!active?.isPlaying(),

  /** Reproduce una canción; `queue` opcional (lista de ids). */
  async play(songId, queue = null, opts = {}) {
    if (queue) {
      state.queue = [...queue];
      state.index = Math.max(0, state.queue.indexOf(songId));
    } else if (!state.queue.includes(songId)) {
      state.queue.splice(state.index + 1, 0, songId);
      state.index = state.queue.indexOf(songId);
    } else state.index = state.queue.indexOf(songId);
    return player.load(songId, opts);
  },
  /** Registra una función async (song) => void que se espera antes de reproducir. */
  setPrepareHook(fn) { prepareHook = fn; },
  async load(songId, { source = null, autoplay = true, start = 0, prepare = true } = {}) {
    let song = library.get(songId);
    if (!song) return;
    const seq = ++loadSeq;
    if (prepare && prepareHook) {
      active?.pause();
      state.song = song;
      state.status = "preparing";
      state.error = null;
      bus.emit("player:song", { song, source: state.source });
      bus.emit("player:state", { ...state });
      try { await prepareHook(song); } catch { /* sin preparación: se reproduce igual */ }
      if (seq !== loadSeq) return; // el usuario eligió otra canción mientras tanto
      song = library.get(songId) || song;
    }
    const srcs = sourcesFor(song);
    const src = (source && srcs.find((s) => s.type === source)) || srcs[0];
    state.song = song;
    state.loop = null;
    state.error = null;
    if (!src) {
      active?.pause();
      state.source = null;
      state.status = "nosource";
      bus.emit("player:song", { song, source: null });
      bus.emit("player:state", { ...state });
      return;
    }
    const next = src.type === "youtube" ? yt : media;
    if (active && active !== next) active.unload();
    active = next;
    state.source = src.type;
    state.status = "loading";
    document.body.dataset.source = src.type;
    bus.emit("player:song", { song, source: src.type });
    bus.emit("player:state", { ...state });
    try {
      if (src.type === "youtube") await yt.load(src.id, autoplay, start);
      else media.load(src.url, autoplay);
      active.setRate(state.rate);
      active.setVolume(state.volume);
      active.setMuted(state.muted);
      if (start && src.type === "local") media.el.addEventListener("loadedmetadata", () => media.seek(start), { once: true });
      library.addHistory(song.id);
    } catch (e) {
      events(next.kind).onError(e.message);
    }
  },
  toggle() {
    if (state.status === "preparing") return;
    if (!active) {
      if (state.song) player.load(state.song.id);
      return;
    }
    active.isPlaying() ? active.pause() : active.play();
  },
  pauseIfPlaying() { if (active?.isPlaying()) active.pause(); },
  resume() { active?.play(); },
  seek(t) { active?.seek(t); bus.emit("player:time", { time: t, duration: player.duration() }); },
  skip(delta) { player.seek(player.time() + delta); },
  next() {
    if (state.index < state.queue.length - 1) player.playIndex(state.index + 1);
  },
  prev() {
    if (player.time() > 4 || state.index <= 0) player.seek(0);
    else player.playIndex(state.index - 1);
  },
  playIndex(i) {
    state.index = i;
    player.load(state.queue[i]);
  },
  setRate(r) {
    state.rate = r;
    active?.setRate(r);
    settings.set("playbackRate", r);
    bus.emit("player:state", { ...state });
  },
  setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v));
    active?.setVolume(state.volume);
    if (state.muted && v > 0) player.setMuted(false);
    bus.emit("player:state", { ...state });
  },
  setMuted(m) {
    state.muted = m;
    active?.setMuted(m);
    bus.emit("player:state", { ...state });
  },
  setRepeat(mode) {
    state.repeat = mode;
    bus.emit("player:state", { ...state });
  },
  cycleRepeat() {
    state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
    bus.emit("player:state", { ...state });
  },
  /** Repetir fragmento A-B (por ejemplo, una frase). */
  setLoop(a, b, label = "") {
    if (a == null || b == null || b - a < 0.3) state.loop = null;
    else state.loop = { a: Math.max(0, a), b, label };
    bus.emit("player:state", { ...state });
    if (state.loop) {
      player.seek(state.loop.a);
      if (!player.isPlaying()) active?.play();
    }
  },
  clearLoop() {
    state.loop = null;
    bus.emit("player:state", { ...state });
  },
  /** Reproduce un tramo una vez y se detiene (para "escuchar la frase"). */
  playSegment(a, b) {
    state.loop = null;
    player.seek(a);
    active?.play();
    const stopAt = b;
    const off = bus.on("player:time", ({ time }) => {
      if (time >= stopAt || time < a - 1) {
        off();
        if (time >= stopAt) active?.pause();
      }
    });
  },
};
