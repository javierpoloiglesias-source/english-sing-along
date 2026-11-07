/** Adaptador para archivos locales (MP4, WebM, MP3, WAV, OGG, M4A…) con <video>. */
export class MediaAdapter {
  constructor(el, events) {
    this.el = el;
    this.kind = "media";
    this.events = events;
    el.addEventListener("play", () => events.onState("playing"));
    el.addEventListener("pause", () => events.onState("paused"));
    el.addEventListener("ended", () => events.onEnded());
    el.addEventListener("loadedmetadata", () => events.onReady(el.duration));
    el.addEventListener("error", () => {
      const code = el.error?.code;
      const msg = code === 4 ? "El navegador no puede reproducir este formato" : "No se pudo cargar el archivo";
      events.onError(msg);
    });
  }
  load(url, autoplay = true) {
    this.el.src = url;
    this.el.load();
    if (autoplay) this.play();
  }
  unload() {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }
  play() {
    return this.el.play().catch((e) => this.events.onError(e.name === "NotAllowedError" ? "Pulsa reproducir para empezar" : e.message));
  }
  pause() { this.el.pause(); }
  seek(t) { this.el.currentTime = Math.max(0, t); }
  time() { return this.el.currentTime || 0; }
  duration() { return this.el.duration || 0; }
  isPlaying() { return !this.el.paused && !this.el.ended; }
  setRate(r) { this.el.playbackRate = r; this.el.preservesPitch = true; }
  setVolume(v) { this.el.volume = v; }
  setMuted(m) { this.el.muted = m; }
  hasVideo() { return this.el.videoWidth > 0; }
}
