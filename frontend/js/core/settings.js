import { idb } from "./db.js";
import { bus } from "./bus.js";

export const DEFAULT_SETTINGS = {
  sourceLang: "en",
  targetLang: "es",
  subtitleSize: 100, // %
  playbackRate: 1,
  showTranslation: true,
  showPronunciation: true,
  advancedMode: false,
  showIPA: false,
  karaokeDefault: false,
  whisperModel: "small",
  subtitleOffset: 0, // segundos, ajuste global
  ttsEngine: "browser", // browser | espeak
  ttsRate: 0.9,
  verifyYouTube: true,
  autoTranslate: true,
};

let current = { ...DEFAULT_SETTINGS };

export const settings = {
  async load() {
    current = { ...DEFAULT_SETTINGS, ...(await idb.getKV("settings", {})) };
    apply();
    return current;
  },
  get: (k) => current[k],
  all: () => ({ ...current }),
  async set(k, v) {
    current[k] = v;
    await idb.setKV("settings", current);
    apply();
    bus.emit("settings", { key: k, value: v });
  },
  async reset() {
    current = { ...DEFAULT_SETTINGS };
    await idb.setKV("settings", current);
    apply();
    bus.emit("settings", {});
  },
};

function apply() {
  document.documentElement.style.setProperty("--sub-scale", current.subtitleSize / 100);
}
