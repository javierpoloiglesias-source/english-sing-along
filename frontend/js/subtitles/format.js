/** Lectura y escritura de formatos de subtítulos: LRC, SRT, VTT, texto y JSON. */

const toSec = (h, m, s, ms) => Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number((ms || "0").padEnd(3, "0").slice(0, 3)) / 1000;

export function parseLRC(text) {
  const out = [];
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const off = line.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) offset = Number(off[1]) / 1000;
    const tags = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const content = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const t of tags) out.push({ start: toSec(0, t[1], t[2], t[3]) - offset, text: content });
  }
  out.sort((a, b) => a.start - b.start);
  return fillEnds(out.filter((s) => s.text));
}

export function parseSRT(text) {
  const out = [];
  const blocks = text.replace(/\r/g, "").replace(/^WEBVTT.*\n/, "").split(/\n\s*\n/);
  const re = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
  for (const b of blocks) {
    const lines = b.split("\n");
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) continue;
    const m = lines[i].match(re);
    const body = lines.slice(i + 1).map((l) => l.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    if (!body.length) continue;
    // Si el bloque trae dos líneas, se interpreta "inglés / traducción" solo si se pide
    out.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text: body.join(" ") });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Texto plano: una línea por frase, sin tiempos (se sincroniza después). */
export function parsePlain(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[.*\]$/.test(l))
    .map((t) => ({ start: null, end: null, text: t }));
}

export function parseAny(text, filename = "") {
  const f = filename.toLowerCase();
  if (f.endsWith(".lrc") || /^\[\d{1,2}:\d{2}/m.test(text)) return { kind: "lrc", segments: parseLRC(text) };
  if (f.endsWith(".srt") || f.endsWith(".vtt") || /-->/.test(text)) return { kind: "srt", segments: parseSRT(text) };
  if (f.endsWith(".json")) {
    const d = JSON.parse(text);
    return { kind: "json", segments: Array.isArray(d) ? d : d.segments || [] };
  }
  return { kind: "plain", segments: parsePlain(text) };
}

export function fillEnds(segs, maxLen = 8) {
  for (let i = 0; i < segs.length; i++) {
    const next = segs[i + 1];
    if (segs[i].end == null || segs[i].end <= segs[i].start) {
      segs[i].end = next ? Math.min(next.start, segs[i].start + maxLen) : segs[i].start + 5;
    }
  }
  return segs;
}

const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, "0");
const srtTime = (t) => `${pad(t / 3600)}:${pad((t % 3600) / 60)}:${pad(t % 60)},${pad((t % 1) * 1000, 3)}`;
const vttTime = (t) => srtTime(t).replace(",", ".");
const lrcTime = (t) => `${pad(t / 60)}:${pad(t % 60)}.${pad((t % 1) * 100)}`;

export function toSRT(segs, withTranslation = true) {
  return segs
    .filter((s) => s.start != null)
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}${withTranslation && s.translation ? `\n${s.translation}` : ""}\n`)
    .join("\n");
}
export function toVTT(segs, withTranslation = true) {
  return "WEBVTT\n\n" + segs
    .filter((s) => s.start != null)
    .map((s) => `${vttTime(s.start)} --> ${vttTime(s.end)}\n${s.text}${withTranslation && s.translation ? `\n${s.translation}` : ""}\n`)
    .join("\n");
}
export function toLRC(segs, meta = {}) {
  const head = [meta.title && `[ti:${meta.title}]`, meta.artist && `[ar:${meta.artist}]`].filter(Boolean);
  return [...head, ...segs.filter((s) => s.start != null).map((s) => `[${lrcTime(s.start)}]${s.text}`)].join("\n");
}
