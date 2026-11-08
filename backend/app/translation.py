"""Traducción local con Argos Translate (código abierto, sin claves).

El paquete de idioma (p. ej. inglés→español, ~100 MB) se descarga gratis una
sola vez del índice público de Argos y después funciona sin conexión.
"""
from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from . import db

# En servidores con poca memoria (p. ej. Render Free) se traduce en línea
# en vez de cargar el modelo de Argos.
REMOTE = os.environ.get("ESA_REMOTE_TRANSLATE") == "1"


def _remote_one(text: str, src: str, tgt: str) -> str:
    try:
        r = httpx.get("https://translate.googleapis.com/translate_a/single",
                      params={"client": "gtx", "sl": src, "tl": tgt, "dt": "t", "q": text}, timeout=15)
        r.raise_for_status()
        out = "".join(seg[0] for seg in r.json()[0] if seg and seg[0])
        if out:
            return out
    except Exception:  # noqa: BLE001
        pass
    try:
        r = httpx.get("https://api.mymemory.translated.net/get",
                      params={"q": text, "langpair": f"{src}|{tgt}"}, timeout=15)
        r.raise_for_status()
        return r.json()["responseData"]["translatedText"]
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"No se pudo traducir en línea: {e}") from e

_install_lock = threading.Lock()
_last_failure: dict[str, tuple[float, str]] = {}
RETRY_AFTER = 300  # s: no reintentar descargas fallidas en cada frase


def is_available() -> bool:
    if REMOTE:
        return True
    try:
        import argostranslate.translate  # noqa: F401
        return True
    except Exception:
        return False


def installed_pairs() -> list[str]:
    if REMOTE:
        return ["en-es (en linea)"]
    if not is_available():
        return []
    try:
        import argostranslate.package
        return [f"{p.from_code}-{p.to_code}" for p in argostranslate.package.get_installed_packages()]
    except Exception:
        return []


def has_pair(src: str, tgt: str) -> bool:
    if REMOTE:
        return True
    return f"{src}-{tgt}" in installed_pairs()


def install_pair(src: str, tgt: str, force: bool = False) -> str:
    """Descarga e instala el paquete de idioma si falta.

    Si una descarga falla, no se reintenta durante unos minutos (salvo
    `force`), para no bloquear cada traducción sin conexión.
    """
    if REMOTE:
        return "ya instalado"
    import argostranslate.package
    with _install_lock:
        if has_pair(src, tgt):
            return "ya instalado"
        key = f"{src}-{tgt}"
        if not force and key in _last_failure and time.time() - _last_failure[key][0] < RETRY_AFTER:
            raise RuntimeError(_last_failure[key][1])
        try:
            try:
                argostranslate.package.update_package_index()
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"No se pudo descargar el índice de idiomas de Argos (¿sin conexión?): {e}") from e
            pkgs = [p for p in argostranslate.package.get_available_packages()
                    if p.from_code == src and p.to_code == tgt]
            if not pkgs:
                raise RuntimeError(f"Argos no tiene paquete {src}→{tgt}")
            try:
                path = pkgs[0].download()
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"No se pudo descargar el paquete {src}→{tgt} de Argos (¿sin conexión?): {e}") from e
            argostranslate.package.install_from_path(path)
            _last_failure.pop(key, None)
            return "instalado"
        except Exception as e:
            _last_failure[key] = (time.time(), str(e))
            raise


def translate_many(texts: list[str], src: str = "en", tgt: str = "es") -> list[str]:
    """Traduce una lista de frases usando caché SQLite para no repetir trabajo."""
    clean = [t.strip() for t in texts]
    cache = db.cached_translations(src, tgt, [t for t in clean if t])
    missing = [t for t in dict.fromkeys(clean) if t and t not in cache]
    if missing:
        if REMOTE:
            with ThreadPoolExecutor(max_workers=4) as ex:
                new = dict(zip(missing, ex.map(lambda t: _remote_one(t, src, tgt), missing)))
            db.store_translations(src, tgt, new)
            cache.update(new)
            return [cache.get(t, "") if t else "" for t in clean]
        if not is_available():
            raise RuntimeError("Argos Translate no está instalado")
        if not has_pair(src, tgt):
            install_pair(src, tgt)
        import argostranslate.translate
        new = {t: argostranslate.translate.translate(t, src, tgt) for t in missing}
        db.store_translations(src, tgt, new)
        cache.update(new)
    return [cache.get(t, "") if t else "" for t in clean]
