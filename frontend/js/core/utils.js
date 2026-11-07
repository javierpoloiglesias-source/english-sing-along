export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

export const normalize = (s) =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Portada generada (SVG) cuando no hay imagen: no usa imágenes con derechos. */
export function coverSVG(title, artist) {
  let h = 0;
  for (const c of `${artist}${title}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const h1 = h % 360;
  const h2 = (h1 + 40 + (h >> 8) % 80) % 360;
  const initials = (artist || title || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},75%,55%)"/><stop offset="1" stop-color="hsl(${h2},70%,28%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="150" cy="50" r="70" fill="rgba(255,255,255,.08)"/><text x="18" y="182" font-family="Segoe UI,Arial,sans-serif" font-size="64" font-weight="800" fill="rgba(255,255,255,.92)">${esc(initials)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function downloadFile(name, content, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
