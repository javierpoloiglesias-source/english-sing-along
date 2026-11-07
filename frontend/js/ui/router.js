/** Router por hash (#/ruta). La música sigue sonando al cambiar de sección. */
import { $, $$ } from "../core/utils.js";
import { bus } from "../core/bus.js";

const routes = [];
let cleanup = null;
let current = null;

// Modo memoria: en la versión web compartida (página incrustada) la URL no
// puede llevar rutas como #/top, así que la ruta se guarda aquí.
const MEMORY = !!window.ESA_DEMO;
let memPath = "/";
const stack = [];
const readPath = () => (MEMORY ? memPath : location.hash.slice(1) || "/");

/** Cambia la ruta visible sin volver a pintar (p. ej. búsqueda en vivo). */
export function setPathSilently(hash) {
  if (MEMORY) memPath = hash.replace(/^#/, "") || "/";
  else history.replaceState(null, "", hash);
}

export function route(pattern, name, render) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/?]+)")) + "/?(?:\\?.*)?$");
  routes.push({ re, keys, name, render });
}

export function go(hash) {
  if (MEMORY) {
    stack.push(memPath);
    memPath = hash.replace(/^#/, "") || "/";
    render();
    return;
  }
  if (location.hash === hash) render();
  else location.hash = hash;
}

export function back() {
  if (MEMORY) {
    memPath = stack.pop() || "/";
    render();
  } else history.back();
}

export const currentRoute = () => current;

export function query() {
  const p = readPath();
  const i = p.indexOf("?");
  return new URLSearchParams(i >= 0 ? p.slice(i + 1) : "");
}

export async function render() {
  const path = readPath();
  const view = $("#view");
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try { cleanup?.(); } catch {}
    cleanup = null;
    current = { name: r.name, params, path };
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === r.name));
    document.body.classList.remove("menu-open");
    document.body.dataset.route = r.name;
    view.scrollTop = 0;
    try {
      cleanup = (await r.render(view, params)) || null;
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="empty"><b>Algo ha fallado al mostrar esta sección</b>${e.message}</div>`;
    }
    bus.emit("route", current);
    return;
  }
  go("#/");
}

export function startRouter() {
  if (MEMORY) {
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#/"]');
      if (!a || e.defaultPrevented) return;
      e.preventDefault();
      go(a.getAttribute("href"));
    });
  } else addEventListener("hashchange", render);
  render();
}
