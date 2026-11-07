/**
 * Pronunciación: aproximación para hispanohablantes + IPA (servidor local,
 * diccionario CMU / eSpeak NG) y audio con la voz inglesa del sistema
 * (Web Speech API, gratuita y local en Windows) o con eSpeak NG.
 */
import { api } from "../core/api.js";
import { settings } from "../core/settings.js";

const cache = new Map();

export async function pronounce(text) {
  const key = text.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const h = await api.health();
  if (!h.ok) return null;
  const p = api.pronounce(key).catch(() => null);
  cache.set(key, p);
  return p;
}

let voices = [];
function loadVoices() {
  voices = window.speechSynthesis?.getVoices() || [];
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

export function englishVoices() {
  return voices.filter((v) => /^en[-_]/i.test(v.lang));
}

let audio = null;
/** Lee el texto en inglés. Devuelve una promesa que acaba al terminar. */
export async function speak(text, { rate } = {}) {
  rate = rate ?? settings.get("ttsRate") ?? 0.9;
  stopSpeaking();
  const engine = settings.get("ttsEngine");
  const h = api.cachedHealth;
  const useEspeak = engine === "espeak" ? !!h.espeak : !("speechSynthesis" in window) || !englishVoices().length ? !!h.espeak : false;
  if (useEspeak) {
    audio = new Audio(api.ttsUrl(text, Math.round(175 * rate)));
    return audio.play().then(() => new Promise((r) => (audio.onended = r)));
  }
  if (!("speechSynthesis" in window)) throw new Error("Este navegador no tiene síntesis de voz");
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    const vs = englishVoices();
    const pref = settings.get("ttsVoice");
    u.voice = vs.find((v) => v.name === pref) || vs.find((v) => /en-US/i.test(v.lang)) || vs[0] || null;
    u.lang = u.voice?.lang || "en-US";
    u.rate = rate;
    u.onend = resolve;
    u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(e.error)));
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (audio) {
    audio.pause();
    audio = null;
  }
}
