/**
 * Adaptador para el reproductor OFICIAL de YouTube (IFrame Player API).
 * No se accede al audio del vídeo: YouTube no lo permite (origen cruzado y
 * condiciones de uso). Por eso los subtítulos de YouTube se crean con la
 * herramienta de sincronización manual o con un archivo local autorizado.
 */
let apiPromise = null;

export function loadYouTubeAPI() {
  if (window.ESA_DEMO) return Promise.reject(new Error("La versión web compartida no puede insertar vídeos de YouTube. Usa «Buscar en YouTube» o abre un archivo de audio tuyo."));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("No se pudo cargar YouTube (¿sin conexión a internet?)"));
    };
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("YouTube tarda demasiado en responder")), 20000);
  });
  return apiPromise;
}

const YT_ERRORS = {
  2: "Identificador de vídeo no válido",
  5: "Error del reproductor HTML5 de YouTube",
  100: "El vídeo no existe o es privado",
  101: "El propietario no permite insertar este vídeo fuera de YouTube",
  150: "El propietario no permite insertar este vídeo fuera de YouTube",
  153: "YouTube rechazó la inserción del vídeo",
};

export class YouTubeAdapter {
  constructor(host, events) {
    this.host = host;
    this.kind = "youtube";
    this.events = events;
    this.player = null;
    this.ready = null;
    this.state = -1;
    this.pendingRate = 1;
    this.volume = 100;
    this.muted = false;
  }
  async ensure() {
    if (this.ready) return this.ready;
    this.ready = loadYouTubeAPI().then(
      (YT) =>
        new Promise((resolve) => {
          const div = document.createElement("div");
          this.host.innerHTML = "";
          this.host.appendChild(div);
          this.player = new YT.Player(div, {
            width: "100%",
            height: "100%",
            playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin, enablejsapi: 1 },
            events: {
              onReady: () => resolve(this.player),
              onStateChange: (e) => this.onState(e.data),
              onError: (e) => this.events.onError(YT_ERRORS[e.data] || `Error de YouTube (${e.data})`, e.data),
              onPlaybackRateChange: (e) => this.events.onRate?.(e.data),
            },
          });
        }),
    );
    this.ready.catch(() => (this.ready = null));
    return this.ready;
  }
  onState(s) {
    this.state = s;
    if (s === 1) {
      this.events.onState("playing");
      this.events.onReady(this.duration());
      if (this.player.getPlaybackRate() !== this.pendingRate) this.player.setPlaybackRate(this.pendingRate);
    } else if (s === 2) this.events.onState("paused");
    else if (s === 3) this.events.onState("buffering");
    else if (s === 0) this.events.onEnded();
  }
  async load(videoId, autoplay = true, start = 0) {
    await this.ensure();
    this.player.setVolume(this.volume);
    this.muted ? this.player.mute() : this.player.unMute();
    if (autoplay) this.player.loadVideoById({ videoId, startSeconds: start });
    else this.player.cueVideoById({ videoId, startSeconds: start });
  }
  unload() {
    try { this.player?.stopVideo(); } catch {}
  }
  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  seek(t) { this.player?.seekTo(Math.max(0, t), true); }
  time() { try { return this.player?.getCurrentTime() || 0; } catch { return 0; } }
  duration() { try { return this.player?.getDuration() || 0; } catch { return 0; } }
  isPlaying() { return this.state === 1 || this.state === 3; }
  setRate(r) {
    this.pendingRate = r;
    try { this.player?.setPlaybackRate(r); } catch {}
  }
  setVolume(v) {
    this.volume = Math.round(v * 100);
    try { this.player?.setVolume(this.volume); } catch {}
  }
  setMuted(m) {
    this.muted = m;
    try { m ? this.player?.mute() : this.player?.unMute(); } catch {}
  }
  hasVideo() { return true; }
}
