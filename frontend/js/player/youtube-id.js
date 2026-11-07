/** Extrae el identificador de 11 caracteres de un enlace de YouTube. */
export function parseVideoId(s) {
  s = String(s || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
